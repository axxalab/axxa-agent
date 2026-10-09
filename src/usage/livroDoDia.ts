// src/usage/livroDoDia.ts
// O LIVRO do dia: quantos pedidos e tokens cada modelo gastou, hora a hora,
// nas últimas ~48 horas. É dele que sai o "quanto sobra hoje" da tela de Uso
// (a cota grátis da OpenAI, o limite diário do Gemini, os grátis do
// OpenRouter) — coisas que a conta POR CONVERSA não responde: uma conversa
// atravessa dias, e o limite é por dia.
//
// Hora a hora, e não dia a dia, porque cada provider vira o dia num lugar: a
// OpenAI e o OpenRouter à meia-noite UTC, o Gemini à meia-noite do Pacífico.
// Com a hora guardada, qualquer um desses dias é uma soma das horas certas.
// Sem DOM: o chat e os embeddings avisam (usage/anotador.ts), o plugin anota
// aqui e grava, e a tela lê.

/** O que uma hora de um modelo gastou: pedidos, tokens de entrada e saída. */
export interface Lancamento {
  r: number;
  /** Toda a entrada — inclusive o que veio do cache. */
  i: number;
  o: number;
  /** Da entrada, o que o provider leu do cache de prompt (cobra menos). Só
   *  aparece quando houve: livros antigos não têm, e ausente é 0. */
  c?: number;
  /** Da entrada, o que foi gravado no cache (Anthropic e GPT-5.6+ cobram
   *  mais por isso). */
  w?: number;
}

/** Soma `l` em `acc`, com os campos de cache só quando há o que somar. */
function somarEm(acc: Lancamento, l: Partial<Lancamento>): void {
  acc.r += l.r ?? 0;
  acc.i += l.i ?? 0;
  acc.o += l.o ?? 0;
  if (l.c) acc.c = (acc.c ?? 0) + l.c;
  if (l.w) acc.w = (acc.w ?? 0) + l.w;
}

/** Hora UTC ("2026-10-02T14") → "provider\u0001modelo" → o lançamento. */
export type LivroDoDia = Record<string, Record<string, Lancamento>>;

const SEP = "\u0001";

/** A chave da hora UTC de um instante. */
export function horaDe(quando: Date): string {
  return quando.toISOString().slice(0, 13);
}

/** Soma `delta` no lançamento do modelo naquela hora. */
export function lancar(
  livro: LivroDoDia,
  quando: Date,
  provider: string,
  model: string,
  delta: Partial<Lancamento>
): void {
  const hora = (livro[horaDe(quando)] ??= {});
  const chave = `${provider}${SEP}${model}`;
  somarEm((hora[chave] ??= { r: 0, i: 0, o: 0 }), delta);
}

/** Joga fora o que passou de `horas` atrás — o livro nunca cresce. */
export function podar(livro: LivroDoDia, agora: Date, horas = 50): void {
  const limite = horaDe(new Date(agora.getTime() - horas * 3_600_000));
  for (const hora of Object.keys(livro)) {
    if (hora < limite) delete livro[hora];
  }
}

/** As partes do relógio de parede num fuso, naquele instante. */
function relogioEm(quando: Date, fuso: string): { y: number; m: number; d: number; ms: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(quando);
  const n = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  const y = n("year");
  const m = n("month");
  const d = n("day");
  return { y, m, d, ms: Date.UTC(y, m - 1, d, n("hour") % 24, n("minute"), n("second")) };
}

/** Quanto o relógio de lá está à frente do UTC naquele instante (ms; negativo
 *  a oeste), em minutos inteiros. */
function deslocamento(quando: Date, fuso: string): number {
  const semMs = Math.floor(quando.getTime() / 1000) * 1000;
  return Math.round((relogioEm(quando, fuso).ms - semMs) / 60_000) * 60_000;
}

/**
 * O instante (UTC) em que o dia de hoje começou num fuso — a meia-noite de
 * lá. "UTC" dá a meia-noite UTC; "America/Los_Angeles", a do Pacífico (o
 * Gemini zera aí).
 *
 * O deslocamento que vale é o DA MEIA-NOITE, não o de agora: no dia em que o
 * horário de verão acaba, às 13h já é PST (−8), mas a meia-noite foi em PDT
 * (−7) — medir agora erraria o começo do dia em uma hora. Então mede duas
 * vezes: agora, pra achar a meia-noite aproximada, e nela, pra acertar.
 */
export function inicioDoDia(agora: Date, fuso: string): Date {
  const { y, m, d } = relogioEm(agora, fuso);
  const meiaNoite = Date.UTC(y, m - 1, d);
  const palpite = meiaNoite - deslocamento(agora, fuso);
  return new Date(meiaNoite - deslocamento(new Date(palpite), fuso));
}

/** Quanto falta pro próximo começo de dia naquele fuso. O dia da troca de
 *  horário tem 23 ou 25 horas: o próximo começo é o do dia que contém
 *  "começo de hoje + 36h", e não "começo de hoje + 24h". */
export function faltaParaVirar(agora: Date, fuso: string): number {
  const inicio = inicioDoDia(agora, fuso).getTime();
  const proximo = inicioDoDia(new Date(inicio + 36 * 3_600_000), fuso).getTime();
  return Math.max(0, proximo - agora.getTime());
}

/** Soma o livro desde `inicio` (inclusive), só nos modelos que `filtro` aceita. */
export function somarDesde(
  livro: LivroDoDia,
  inicio: Date,
  filtro: (provider: string, model: string) => boolean
): Lancamento {
  const desde = horaDe(inicio);
  const total: Lancamento = { r: 0, i: 0, o: 0 };
  for (const [hora, modelos] of Object.entries(livro)) {
    if (hora < desde) continue;
    for (const [chave, l] of Object.entries(modelos)) {
      const corte = chave.indexOf(SEP);
      const provider = chave.slice(0, corte);
      const model = chave.slice(corte + 1);
      if (!filtro(provider, model)) continue;
      somarEm(total, l);
    }
  }
  return total;
}

/** Os modelos de um provider que aparecem no livro desde `inicio`, com o que
 *  cada um gastou — os mais usados primeiro. */
export function modelosDesde(
  livro: LivroDoDia,
  inicio: Date,
  provider: string
): Array<{ model: string } & Lancamento> {
  const desde = horaDe(inicio);
  const porModelo = new Map<string, Lancamento>();
  for (const [hora, modelos] of Object.entries(livro)) {
    if (hora < desde) continue;
    for (const [chave, l] of Object.entries(modelos)) {
      const corte = chave.indexOf(SEP);
      if (chave.slice(0, corte) !== provider) continue;
      const model = chave.slice(corte + 1);
      const acc = porModelo.get(model) ?? { r: 0, i: 0, o: 0 };
      somarEm(acc, l);
      porModelo.set(model, acc);
    }
  }
  return Array.from(porModelo.entries())
    .map(([model, l]) => ({ model, ...l }))
    .sort((a, b) => b.r - a.r || a.model.localeCompare(b.model));
}

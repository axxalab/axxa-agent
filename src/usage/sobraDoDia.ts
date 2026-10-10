// src/usage/sobraDoDia.ts
// O "quanto sobra HOJE" de cada lugar com cota grátis — a seção do topo da
// tela de Uso. Sem DOM: recebe o livro do dia (livroDoDia.ts), o que a pessoa
// configurou e o que o OpenRouter disse da chave, e devolve um cartão por
// provider, com os medidores prontos pra desenhar.
//
// Cada provider conta o dia de um jeito, e o cartão diz qual:
//   - OpenAI: tokens grátis do data-sharing, por balde (grandes e mini),
//     zerando à 00:00 UTC. A cota é da ORGANIZAÇÃO — o que outro app gasta
//     com ela não passa por aqui, então o "sobra" daqui é otimista.
//   - Gemini: pedidos por dia POR MODELO, zerando à meia-noite do Pacífico.
//     O Google não publica os números do tier grátis: eles moram no AI Studio
//     de cada projeto, e a pessoa traz o dela pra cá (limitesDiarios).
//   - OpenRouter: os pedidos aos modelos ":free", zerando à 00:00 UTC. A
//     própria chave diz quantos foram (o /api/v1/key) — contando qualquer app
//     que use a chave; sem resposta, vale a conta deste aparelho.
//   - NIM: os endpoints grátis limitam por MINUTO (40), não por dia. O cartão
//     diz quanto foi hoje e que não há teto diário publicado.

import type { EstadoDaChave } from "../providers/openrouter";
import { tr } from "../i18n/tr";
import { geminiTemTierGratis } from "./freeTag";
import { openaiFreeAllowance, openaiFreeTierForModel } from "./freeTokens";
import {
  faltaParaVirar,
  inicioDoDia,
  modelosDesde,
  somarDesde,
  type LivroDoDia,
} from "./livroDoDia";
import { gastoDesde } from "./gastoDoDia";

/** A chave do limite de GASTO no editor de teto (não é um modelo). */
export const CHAVE_LIMITE_GASTO = "__gasto";

/** Onde a pessoa vê os limites do projeto dela no Gemini. */
export const AI_STUDIO_LIMITES = "https://aistudio.google.com/rate-limit";

/** O fuso em que o dia do Gemini vira. */
const PACIFICO = "America/Los_Angeles";

/** A chave de um limite informado pela pessoa (o mesmo separador do livro). */
export function chaveDoLimite(provider: string, model: string): string {
  return `${provider}\u0001${model}`;
}

export type Unidade = "tokens" | "requests" | "usd";

/** Uma coisa medida: um balde da OpenAI, um modelo do Gemini, os grátis do
 *  OpenRouter, o dia do NIM. */
export interface Medidor {
  id: string;
  /** O que se mede ("Flagship models", "Free models"). Num medidor de UM
   *  modelo, a tela usa o nome bonito dele no lugar. */
  rotulo: string;
  /** O id do modelo, quando o medidor é de um só. */
  modelo?: string;
  usado: number;
  /** O teto do dia — ausente quando ninguém sabe (Gemini sem limite
   *  informado, NIM). */
  limite?: number;
  /** O que sobra: o que o provider disse, ou limite − usado (nunca < 0). */
  restante?: number;
  unidade: Unidade;
  /** "live" = o provider contou; "local" = contado neste aparelho. */
  fonte: "live" | "local";
  /** Uma etiqueta curta no pé da linha ("Paid only"). O que explica o
   *  número mora na nota do cartão, atrás do ⓘ. */
  nota?: string;
  /** A chave em limitesDiarios, quando a pessoa pode informar o teto. */
  limiteEditavel?: string;
}

export interface Cartao {
  provider: "spend" | "openai" | "gemini" | "openrouter" | "nim";
  nome: string;
  /** Quanto falta pro dia da cota virar (ms); null = não há dia de cota. */
  viraEm: number | null;
  /** Onde ele vira, pra quem quer conferir ("00:00 UTC"). */
  viraOnde?: string;
  /** No lugar do "resets in", quando não há dia de cota ("no daily cap"). */
  semDia?: string;
  medidores: Medidor[];
  /** Sem medidor: o porquê, numa frase. */
  vazio?: string;
  /** A explicação do cartão — o que se conta, de onde vem o número, o que
   *  ele não pega. A tela mostra atrás do ⓘ: à vista ela dobrava a altura
   *  da seção. */
  nota?: string;
  /** Onde conferir os números do próprio provider. */
  link?: { rotulo: string; url: string };
  /** O crédito da chave do OpenRouter, quando a chave contou. */
  credito?: { restante: number | null; gastoHoje?: number; volta?: string };
}

export interface EntradaDoDia {
  livro: LivroDoDia;
  agora: Date;
  /** O provider tem chave (ou endpoint) configurada? */
  comChave: (provider: string) => boolean;
  openai: { dataSharing: boolean; tier: number };
  /** Os tetos que a pessoa informou ("provider\u0001modelo" → pedidos/dia). */
  limites: Record<string, number>;
  /** A cota dos grátis do OpenRouter guardada no último fetch de modelos. */
  cotaOpenRouter?: { limit: number; remaining?: number };
  /** O que a chave do OpenRouter disse agora (null/ausente = não disse). */
  chaveOpenRouter?: EstadoDaChave | null;
  /** O fuso de quem usa — o "hoje" do NIM e do orçamento. */
  fusoLocal?: string;
  /** O limite de gasto do dia, em USD (0 = sem limite). */
  limiteGasto?: number;
  /** No limite, os modelos pagos param (senão, só avisa). */
  travarNoLimite?: boolean;
  /** A chave do Gemini é do plano grátis (a pessoa disse nas settings). */
  geminiFreeTier?: boolean;
}

const sobra = (limite: number | undefined, usado: number): number | undefined =>
  limite == null ? undefined : Math.max(0, limite - usado);

/** Um teto informado vale se for um número positivo. */
function tetoInformado(limites: Record<string, number>, chave: string): number | undefined {
  const v = limites[chave];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}

function fusoDaMaquina(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Os cartões do "Left today": um por provider com cota grátis que a pessoa
 * usa — tem chave, ou gastou hoje (a chave pode ter saído depois do uso).
 * Ordem fixa (OpenAI, Gemini, OpenRouter, NIM): a seção não troca de lugar
 * conforme o dia.
 */
export function sobraDoDia(e: EntradaDoDia): Cartao[] {
  const { livro, agora } = e;
  const cartoes: Cartao[] = [];
  const meiaNoiteUtc = inicioDoDia(agora, "UTC");
  const viraUtc = faltaParaVirar(agora, "UTC");
  const usouDesde = (provider: string, desde: Date) =>
    somarDesde(livro, desde, (p) => p === provider).r > 0;
  const fuso = e.fusoLocal ?? fusoDaMaquina();
  const meiaNoiteLocal = inicioDoDia(agora, fuso);

  // ── O dinheiro (primeiro: é o que pode surpreender na conta) ──────────
  // Aparece com limite definido, ou quando já houve gasto pago hoje.
  const gasto = gastoDesde(livro, meiaNoiteLocal);
  const limiteGasto = e.limiteGasto && e.limiteGasto > 0 ? e.limiteGasto : 0;
  if (limiteGasto > 0 || gasto.total > 0) {
    cartoes.push({
      provider: "spend",
      nome: tr("Paid models"),
      viraEm: faltaParaVirar(agora, fuso),
      viraOnde: tr("midnight, your time"),
      medidores: [
        {
          id: "spend-today",
          rotulo: tr("Spent today"),
          usado: gasto.total,
          limite: limiteGasto || undefined,
          restante: limiteGasto ? Math.max(0, limiteGasto - gasto.total) : undefined,
          unidade: "usd",
          fonte: "local",
          limiteEditavel: CHAVE_LIMITE_GASTO,
        },
      ],
      nota: [
        e.geminiFreeTier
          ? tr("Counted in this vault from public token prices. Your Gemini key is on the free tier, so Gemini models with a free tier count as $0.")
          : tr("Counted in this vault from public token prices. Gemini counts at paid prices unless you mark your key as free tier in Settings › Providers › Gemini."),
        gasto.semPreco > 0
          ? gasto.semPreco === 1
            ? tr("1 request on models without a public price isn't included.")
            : tr("{n} requests on models without a public price aren't included.", { n: gasto.semPreco })
          : "",
        limiteGasto > 0
          ? e.travarNoLimite
            ? tr("At the limit, paid models pause until midnight.")
            : tr("At the limit you get a heads-up; turn on “Stop paid models at the limit” in settings to pause them.")
          : tr("Set a limit to get a heads-up at 80% and 100%."),
        tr("Resets at midnight, your time."),
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  // ── OpenAI ────────────────────────────────────────────────────────────
  if (e.comChave("openai") || usouDesde("openai", meiaNoiteUtc)) {
    const cota = openaiFreeAllowance(e.openai.tier, e.openai.dataSharing);
    const base: Cartao = {
      provider: "openai",
      nome: "OpenAI",
      viraEm: viraUtc,
      viraOnde: tr("00:00 UTC"),
      medidores: [],
    };
    if (!e.openai.dataSharing) {
      base.vazio = tr(
        "No free tokens to track. If your organization shares API data with OpenAI, turn that on in settings."
      );
      base.viraEm = null;
    } else if (!cota.eligible) {
      base.vazio = tr("Free tokens start at usage tier 1.");
      base.viraEm = null;
    } else {
      const balde = (qual: "big" | "mini") => {
        const s = somarDesde(
          livro,
          meiaNoiteUtc,
          (p, m) => p === "openai" && openaiFreeTierForModel(m) === qual
        );
        return s.i + s.o;
      };
      const grandes = balde("big");
      const minis = balde("mini");
      base.medidores = [
        {
          id: "openai-big",
          rotulo: tr("Flagship models"),
          usado: grandes,
          limite: cota.bigPerDay,
          restante: sobra(cota.bigPerDay, grandes),
          unidade: "tokens",
          fonte: "local",
        },
        {
          id: "openai-mini",
          rotulo: tr("Mini models"),
          usado: minis,
          limite: cota.miniPerDay,
          restante: sobra(cota.miniPerDay, minis),
          unidade: "tokens",
          fonte: "local",
        },
      ];
      base.nota = tr(
        "Free daily tokens for sharing API data with OpenAI. Flagship: GPT-5, GPT-4.1, GPT-4o, o1, o3. Mini: their mini and nano versions, and o4-mini. Counted in this vault: other apps on the same OpenAI organization draw from the same quota, so the real number may be lower. Resets at 00:00 UTC."
      );
    }
    cartoes.push(base);
  }

  // ── Gemini ────────────────────────────────────────────────────────────
  const meiaNoitePacifico = inicioDoDia(agora, PACIFICO);
  const usadosGemini = modelosDesde(livro, meiaNoitePacifico, "gemini");
  if (e.comChave("gemini") || usadosGemini.length > 0) {
    // Os usados hoje primeiro (os mais usados no topo); depois os que têm
    // teto informado e ainda não foram usados — o "250 left" deles também
    // é resposta.
    const prefixo = chaveDoLimite("gemini", "");
    const soComTeto = Object.keys(e.limites)
      .filter((k) => k.startsWith(prefixo))
      .map((k) => k.slice(prefixo.length))
      .filter((m) => m && tetoInformado(e.limites, chaveDoLimite("gemini", m)) != null)
      .filter((m) => !usadosGemini.some((u) => u.model === m))
      .sort((a, b) => a.localeCompare(b));
    const modelos = [
      ...usadosGemini.map((u) => ({ model: u.model, r: u.r })),
      ...soComTeto.map((model) => ({ model, r: 0 })),
    ];
    cartoes.push({
      provider: "gemini",
      nome: "Gemini",
      viraEm: faltaParaVirar(agora, PACIFICO),
      viraOnde: tr("midnight Pacific"),
      medidores: modelos.map(({ model, r }): Medidor => {
        const chave = chaveDoLimite("gemini", model);
        const limite = tetoInformado(e.limites, chave);
        return {
          id: `gemini:${model}`,
          rotulo: model,
          modelo: model,
          usado: r,
          limite,
          restante: sobra(limite, r),
          unidade: "requests",
          fonte: "local",
          limiteEditavel: chave,
          ...(geminiTemTierGratis(model) ? {} : { nota: tr("Paid only") }),
        };
      }),
      vazio: modelos.length === 0 ? tr("Nothing used since midnight Pacific.") : undefined,
      nota: tr(
        "Requests per day, per model and per Google Cloud project. The free tier only exists on projects without billing, and Google shows its numbers in AI Studio, not in the docs: set each model's limit here to see what's left. Resets at midnight Pacific."
      ),
      link: { rotulo: tr("Your limits in AI Studio"), url: AI_STUDIO_LIMITES },
    });
  }

  // ── OpenRouter ────────────────────────────────────────────────────────
  if (e.comChave("openrouter") || usouDesde("openrouter", meiaNoiteUtc)) {
    // O limite diário é dos ids ":free" (a documentação do OpenRouter); um
    // modelo de preço zero sem o sufixo não entra nele.
    const local = somarDesde(
      livro,
      meiaNoiteUtc,
      (p, m) => p === "openrouter" && m.endsWith(":free")
    ).r;
    const viva = e.chaveOpenRouter ?? null;
    const g = viva?.gratis;
    let medidor: Medidor;
    if (g && (g.usados != null || g.restantes != null)) {
      const usado = g.usados ?? Math.max(0, g.limite - (g.restantes ?? g.limite));
      medidor = {
        id: "openrouter-free",
        rotulo: tr("Free models"),
        usado,
        limite: g.limite,
        restante: g.restantes ?? sobra(g.limite, usado),
        unidade: "requests",
        fonte: "live",
      };
    } else {
      const limite = g?.limite ?? e.cotaOpenRouter?.limit;
      medidor = {
        id: "openrouter-free",
        rotulo: tr("Free models"),
        usado: local,
        limite,
        restante: sobra(limite, local),
        unidade: "requests",
        fonte: "local",
      };
    }
    const cartao: Cartao = {
      provider: "openrouter",
      nome: "OpenRouter",
      viraEm: viraUtc,
      viraOnde: tr("00:00 UTC"),
      medidores: [medidor],
      nota: [
        medidor.fonte === "live"
          ? tr("Counted by OpenRouter for this key, across every app that uses it.")
          : tr("Counted on this device: OpenRouter didn't answer, so other apps using this key aren't included."),
        tr(
          "Models ending in :free allow 20 requests a minute and 50 a day, or 1,000 a day once you've bought $10 in credits. Resets at 00:00 UTC."
        ),
      ].join(" "),
    };
    if (viva && (viva.creditoRestante !== undefined || viva.gastoHoje !== undefined)) {
      cartao.credito = {
        restante: viva.creditoRestante ?? null,
        ...(viva.gastoHoje !== undefined ? { gastoHoje: viva.gastoHoje } : {}),
        ...(viva.creditoVolta ? { volta: viva.creditoVolta } : {}),
      };
    }
    cartoes.push(cartao);
  }

  // ── NIM ───────────────────────────────────────────────────────────────
  if (e.comChave("nim") || usouDesde("nim", meiaNoiteLocal)) {
    const hoje = somarDesde(livro, meiaNoiteLocal, (p) => p === "nim").r;
    cartoes.push({
      provider: "nim",
      nome: "NVIDIA NIM",
      viraEm: null,
      semDia: tr("no daily cap"),
      medidores: [
        {
          id: "nim-today",
          rotulo: tr("All models"),
          usado: hoje,
          unidade: "requests",
          fonte: "local",
        },
      ],
      nota: tr(
        "Free endpoints allow 40 requests a minute. NVIDIA publishes no daily cap, so this is just what you used today (your local day)."
      ),
    });
  }

  return cartoes;
}

/** "9h 12m", "42m", "<1m" — quanto falta pro dia virar. */
export function emQuanto(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "<1m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** A fração que SOBRA (0–1), pro desenho do medidor; null sem teto. */
export function fracaoQueSobra(m: Medidor): number | null {
  if (m.limite == null || m.limite <= 0 || m.restante == null) return null;
  return Math.max(0, Math.min(1, m.restante / m.limite));
}

/** O estado do medidor: acabou, quase (≤ 10%), ou ok; null sem teto. */
export function nivel(m: Medidor): "ok" | "baixo" | "fim" | null {
  const f = fracaoQueSobra(m);
  if (f == null) return null;
  if (m.restante === 0) return "fim";
  return f <= 0.1 ? "baixo" : "ok";
}

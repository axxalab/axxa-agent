// src/usage/freeTag.ts
// A etiqueta "free" de um modelo — o que a lista de modelos mostra ao lado do
// nome, e o que ela SIGNIFICA em cada caso.
//
// Havia um só rótulo pra duas coisas muito diferentes:
//
//   - de graça SEMPRE (um `:free` do OpenRouter, um modelo local do Ollama):
//     não existe fatura, ponto;
//   - de graça ATÉ UM LIMITE, e só se você tiver ligado o data-sharing no
//     painel da OpenAI (Data controls): passou da cota do dia, é cobrado
//     normal.
//
// Chamar as duas de "free" faz a segunda parecer a primeira — e a conta chega.
// Aqui elas viram etiquetas diferentes, e a da OpenAI carrega o NÚMERO, que é
// a única parte que interessa: 250k/dia não é o mesmo que 2,5M/dia.
//
// A cota depende do tier da conta (1–2 vs 3–5), então a etiqueta é montada com
// as settings da pessoa, e não com uma tabela fixa.

import { openaiFreeAllowance, openaiFreeTierForModel } from "./freeTokens";
import { localeDaInterface, tr } from "../i18n/tr";

export interface FreeTag {
  /** `always` = sem fatura. `daily` = cota diária já valendo. `offer` = de graça
   *  sob uma condição da conta que a gente não enxerga (OpenAI: data-sharing
   *  desligado; Gemini: projeto sem cobrança) — uma oferta, não um fato. */
  kind: "always" | "daily" | "offer";
  /** Tokens/dia da cota (só em `daily` e `offer`). */
  perDay?: number;
  /** O que aparece na etiqueta. */
  label: string;
  /** A frase inteira, pro title/tooltip. */
  detail: string;
}

/** 250000 → "250k"; 2500000 → "2.5M". O número é o recado; o resto é ruído. */
export function compactTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/**
 * O modelo é grátis DE VERDADE?
 *
 * Quando o fetch trouxe a lista do provider — pelo preço zero no OpenRouter,
 * pela marca "Free Endpoint" do catálogo da NVIDIA no NIM —, ela é a verdade,
 * e o nome não conta: o OpenRouter tem grátis sem `:free` no id, e no NIM
 * 61 dos 81 modelos da API NÃO são do tier grátis, embora nada no id diga.
 * Sem lista (ninguém buscou ainda), vale o palpite do motor. O "_" do
 * catálogo da NVIDIA é o "." da API — os dois lados são comparados assim.
 */
export function gratisDeVerdade(
  model: string,
  livres: readonly string[] | undefined,
  palpite: boolean
): boolean {
  // A variante ":free" do OpenRouter é a grátis declarada — inclusive a dos
  // embeddings, que não vêm na lista do catálogo de chat.
  if (/:free$/i.test(model)) return true;
  if (!livres || livres.length === 0) return palpite;
  const igual = (s: string) => s.toLowerCase().replace(/_/g, ".");
  const alvo = igual(model);
  return livres.some((l) => igual(l) === alvo);
}

/** 1000 → "1,000": o número da cota é o recado, e lido de relance. */
function milhar(n: number): string {
  return n.toLocaleString(localeDaInterface());
}

/**
 * O modelo do Gemini tem tier GRÁTIS? (ai.google.dev › Pricing, out/2026)
 *
 * O tier grátis é de quem usa um projeto SEM cobrança ativada — e aí o Google
 * pode usar o que você manda pra melhorar os produtos dele. Mesmo assim, nem
 * todo modelo entra: os que geram imagem (o Nano Banana incluído), o 3.1 Pro
 * preview, Omni, Veo e Lyria são só pagos. Têm tier grátis os Flash (2.5 e
 * 3.x, Lite, Live e TTS), o 2.5 Pro, os embeddings, o Gemma. Modelo que não
 * casa com nada conhecido: não diz que é grátis.
 */
export function geminiTemTierGratis(model: string): boolean {
  const id = (model || "").toLowerCase().replace(/^(models|google)\//, "");
  if (/(image|imagen|veo|lyria|omni)/.test(id)) return false;
  if (/^gemini-\d+(\.\d+)?-flash/.test(id)) return true;
  if (/^gemini-2\.5-pro(-|$)/.test(id)) return !/tts/.test(id);
  if (/^gemini-\d+(\.\d+)?-(live|transcribe)/.test(id)) return true;
  if (/^gemini-embedding-[2-9]/.test(id)) return true;
  if (/^gemma-/.test(id)) return true;
  if (/^gemini-robotics/.test(id)) return true;
  return false;
}

export function freeTag(
  provider: string,
  model: string,
  opts: {
    /** O modelo é grátis de verdade (ver gratisDeVerdade). */
    free: boolean;
    /** Data-sharing ligado no painel da OpenAI. */
    dataSharing: boolean;
    /** Usage tier da conta OpenAI (1–5). */
    tier: number;
    /** A cota diária dos grátis na chave (OpenRouter), quando o fetch soube. */
    cota?: { limit: number; remaining?: number };
    /** A chave do Gemini é do plano grátis (a pessoa disse nas settings). */
    geminiFreeTier?: boolean;
  }
): FreeTag | null {
  const pool = provider === "openai" ? openaiFreeTierForModel(model) : null;
  if (pool) {
    // O tier decide a cota; sem data-sharing a conta é a do tier mesmo assim,
    // porque o que a etiqueta diz então é "é isto que você GANHARIA".
    const allow = openaiFreeAllowance(Math.max(opts.tier, 1), true);
    const perDay = pool === "mini" ? allow.miniPerDay : allow.bigPerDay;
    const qtd = compactTokens(perDay);
    if (opts.dataSharing) {
      return {
        kind: "daily",
        perDay,
        label: tr("{n}/day", { n: qtd }),
        detail: tr(
          "{n} tokens a day at no cost while you share API data with OpenAI. Past that, this model is billed normally — and the quota counts ALL your OpenAI API use, not just this vault.",
          { n: qtd }
        ),
      };
    }
    // O "+" é o que separa a oferta do fato: ele lê como "isto você GANHARIA".
    // Sem ele, a etiqueta de quem não ligou o programa fica igual à de quem
    // ligou — e a fatura desmente a tela no fim do mês.
    return {
      kind: "offer",
      perDay,
      label: tr("+{n}/day", { n: qtd }),
      detail: tr(
        "Turn on data sharing in OpenAI's Data controls to get {n} tokens a day here at no cost.",
        { n: qtd }
      ),
    };
  }

  // O Gemini decide pelo modelo e pela conta — não pelo "free" do motor.
  if (provider === "gemini") {
    if (!geminiTemTierGratis(model)) return null;
    // A pessoa disse que a chave é do plano grátis: deixa de ser oferta.
    if (opts.geminiFreeTier) {
      return {
        kind: "daily",
        label: tr("free tier"),
        detail: tr(
          "No cost: your Gemini key is on the free tier (a project without billing), within its rate limits. Google may use what you send to improve its products. The daily spending counts it as $0."
        ),
      };
    }
    return {
      kind: "offer",
      label: tr("free tier"),
      detail: tr(
        "No cost on the Gemini API's free tier — a project without billing turned on, where Google may use what you send to improve its products — within its rate limits. With billing on, this model is charged."
      ),
    };
  }
  if (!opts.free) return null;
  // Grátis, mas cada casa com a sua regra — e a regra é o que deixa claro o
  // que "free" quer dizer ali.
  if (provider === "openrouter") {
    const c = opts.cota;
    const frase = c
      ? c.limit >= 1000
        ? tr(
            "No cost. OpenRouter's free models share 20 requests a minute and {limit} a day on this key.",
            { limit: milhar(c.limit) }
          )
        : tr(
            "No cost. OpenRouter's free models share 20 requests a minute and {limit} a day on this key — 1,000 once you've bought $10 in credits.",
            { limit: milhar(c.limit) }
          )
      : tr(
          "No cost. OpenRouter's free models share 20 requests a minute and 50 a day (1,000 once you've bought $10 in credits)."
        );
    const resta =
      c?.remaining != null
        ? tr("{n} were left when you fetched.", { n: milhar(c.remaining) })
        : "";
    return {
      kind: "always",
      label: c ? tr("free · {n}/day", { n: milhar(c.limit) }) : tr("free"),
      detail: [
        frase,
        resta,
        tr("A free variant can run on a different host, with a smaller context than the paid one."),
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  if (provider === "nim") {
    return {
      kind: "always",
      label: tr("free · 40/min"),
      detail: tr(
        "A Free Endpoint in NVIDIA's API catalog: no cost with your developer key, for development and testing, up to 40 requests a minute. Models without this mark aren't part of the free tier."
      ),
    };
  }
  if (provider === "ollama") {
    return {
      kind: "always",
      label: tr("free"),
      detail: tr("Runs on your own machine — there's no bill at all."),
    };
  }
  return {
    kind: "always",
    label: tr("free"),
    detail: tr("No cost — this model has no billing at all."),
  };
}

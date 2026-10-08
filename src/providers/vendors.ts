// src/providers/vendors.ts
// O FABRICANTE de um modelo nos providers que revendem os de todo mundo
// (OpenRouter, NVIDIA NIM). Lá o id carrega a casa no prefixo
// (`anthropic/claude-opus-4.8`, `meta/llama-3.3-70b-instruct`) e a lista
// ganha um nível a mais: fabricante → classe → modelo. Nos providers de uma
// casa só (OpenAI, Anthropic, Gemini) esse nível não diria nada.

import { tr } from "../i18n/tr";

/** Os providers cuja lista é de VÁRIOS fabricantes. */
export const PROVIDERS_MULTI_FABRICANTE = new Set(["openrouter", "nim"]);

/** Prefixos diferentes pra mesma casa: o OpenRouter escreve `meta-llama`, o
 *  NIM escreve `meta`; o NIM tem `deepseek-ai`, o OpenRouter `deepseek`. */
const APELIDOS: Record<string, string> = {
  "meta-llama": "meta",
  "deepseek-ai": "deepseek",
  mistralai: "mistral",
  "nv-mistralai": "mistral",
  "x-ai": "xai",
  "z-ai": "zai",
  zhipuai: "zai",
  alibaba: "qwen",
  "ibm-granite": "ibm",
  ai21labs: "ai21",
  "google-deepmind": "google",
};

/** O nome de cada casa como ela se escreve. */
const NOMES: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  meta: "Meta",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  xai: "xAI",
  nvidia: "NVIDIA",
  microsoft: "Microsoft",
  amazon: "Amazon",
  cohere: "Cohere",
  moonshotai: "Moonshot AI",
  zai: "Z.ai",
  perplexity: "Perplexity",
  ibm: "IBM",
  minimax: "MiniMax",
  baidu: "Baidu",
  tencent: "Tencent",
  bytedance: "ByteDance",
  nousresearch: "Nous Research",
  liquid: "Liquid AI",
  ai21: "AI21",
  inflection: "Inflection",
  "01-ai": "01.AI",
  allenai: "Ai2",
  "arcee-ai": "Arcee AI",
  stabilityai: "Stability AI",
  "black-forest-labs": "Black Forest Labs",
  writer: "Writer",
  upstage: "Upstage",
  sarvamai: "Sarvam AI",
  tiiuae: "TII",
  poolside: "Poolside",
  "baichuan-inc": "Baichuan",
  databricks: "Databricks",
  adept: "Adept",
  bigcode: "BigCode",
  aisingapore: "AI Singapore",
  snowflake: "Snowflake",
  servicenow: "ServiceNow",
  inception: "Inception",
  thudm: "THUDM",
  inclusionai: "inclusionAI",
  thinkingmachines: "Thinking Machines",
};

/** As casas grandes primeiro (é por elas que se procura); o resto em ordem
 *  alfabética depois. */
const ORDEM = [
  "openrouter",
  "openai",
  "anthropic",
  "google",
  "meta",
  "mistral",
  "deepseek",
  "qwen",
  "xai",
  "nvidia",
  "microsoft",
  "amazon",
  "cohere",
  "moonshotai",
  "zai",
  "perplexity",
  "ibm",
];

export interface Fabricante {
  /** A chave canônica ("meta" pra `meta` e `meta-llama`); "" sem prefixo. */
  chave: string;
  /** O nome de exibição ("Meta"; "Other" sem prefixo). */
  nome: string;
}

/** "some-new-lab" → "Some New Lab": casa nova não fica sem nome. */
function titulo(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** O fabricante de um id `vendor/modelo`. */
export function fabricante(id: string): Fabricante {
  const s = (id || "").trim().toLowerCase();
  const barra = s.indexOf("/");
  if (barra <= 0) return { chave: "", nome: tr("Other") };
  const cru = s.slice(0, barra).replace(/^~/, "");
  const chave = APELIDOS[cru] ?? cru;
  return { chave, nome: NOMES[chave] ?? titulo(chave) };
}

/** Ordena fabricantes: os grandes na ordem da lista, os outros por nome, e
 *  "Other" (sem prefixo) por último. */
export function compararFabricantes(a: Fabricante, b: Fabricante): number {
  if (!a.chave !== !b.chave) return a.chave ? -1 : 1;
  const ia = ORDEM.indexOf(a.chave);
  const ib = ORDEM.indexOf(b.chave);
  if (ia !== ib) {
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  }
  return a.nome.localeCompare(b.nome);
}

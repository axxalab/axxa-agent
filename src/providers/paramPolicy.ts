// src/providers/paramPolicy.ts
// Política de PARÂMETROS por provider/modelo (v0.1.155; revista na 0.9.22
// contra a documentação de cada provider, out/2026).
//
// É o ponto ÚNICO que adapta o que o Effort pede ao que cada modelo aceita.
// Mandar o que o modelo recusa é HTTP 400 — e a pessoa vê "erro" sem saber
// que foi a temperatura. Quirks tratados aqui:
//   - Claude atuais — Fable e Mythos (todos), Opus 4.7+, Sonnet 5+ — recusam
//     QUALQUER temperature/top_p/top_k fora do padrão, em toda requisição
//     (platform.claude.com › Thinking › Sampling parameters). Os anteriores
//     aceitam 0..1. Claude que não dá pra ler: não manda (omitir nunca é 400).
//   - Teto de saída do Claude: 128K (Fable, Mythos, Opus e Sonnet 4.6+), 64K
//     (os 4.5, Sonnet 4 e 3.7), 32K (Opus 4 e 4.1), 8K (3.5), 4K (3).
//   - OpenAI o-series + gpt-5 (não -chat) e outros de raciocínio (DeepSeek R1,
//     QwQ, Magistral): sem temperature.
//   - NVIDIA NIM: temperature até 1 — e acima de 0 no DeepSeek (o V4 Pro
//     recusa 0) — e saída até 4096 nos modelos hospedados (o DeepSeek V4 Pro
//     vai a 16k; ele fica nos 8k de todo DeepSeek).
//   - Modelos que PENSAM antes de responder (os de raciocínio, Claude 5,
//     Gemini 2.5/3): o pensamento sai do MESMO max_tokens da resposta — pouco
//     teto e a resposta volta vazia (OpenAI e Google documentam isso). Eles
//     ganham um piso (pisoPensando), e o nível do Effort vira o "quanto
//     pensar" do provider quando ele tem esse controle (esforcoDoProvider).

import type { EffortLevel } from "../core/effort";

export interface ParamPolicy {
  /** O modelo aceita o param `temperature`? */
  supportsTemperature: boolean;
  /** Range válido de temperatura [min, max] (Claude 0..1, NIM 0.01..1, resto 0..2). */
  tempMin: number;
  tempMax: number;
  /** Modelo de reasoning (chain-of-thought interno) — recusa sampling params. */
  reasoning: boolean;
}

/** Tail = parte após "/" (ex: "openai/o3-mini" → "o3-mini"). */
function tailOf(model: string): string {
  const id = (model || "").toLowerCase();
  return id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
}

/** Modelo de reasoning que recusa temperature/top_p/penalties. */
export function isReasoningModel(model: string): boolean {
  const tail = tailOf(model);
  // OpenAI o-series (o1/o3/o4/o5…) — exige dígito após o "o" (não pega "opus").
  if (/^o[1-9]([-.]|$)/.test(tail)) return true;
  // GPT-5 reasoning — o gpt-5-chat (não-reasoning) AINDA aceita temperature.
  // v0.1.228: 'chat' precisa ser segmento exato (split por '-'), senão um
  // hipotético "gpt-5-chatty" cairia no `includes` e seria excluído por engano.
  if (/(^|[-/])gpt-5/.test(tail) && !tail.split("-").includes("chat")) return true;
  // DeepSeek R1 / reasoner (via NIM / OpenRouter / Ollama).
  if (/deepseek-?(r1|reasoner)/.test(tail)) return true;
  // Qwen QwQ / Qwen3 "thinking", Magistral (Mistral reasoning).
  if (/(qwq|qwen3[\w.-]*think|magistral)/.test(tail)) return true;
  return false;
}

/** Modelo da família Claude (provider direto OU via OpenRouter `anthropic/…`). */
function isClaude(provider: string, model: string): boolean {
  const id = (model || "").toLowerCase();
  return provider === "anthropic" || id.includes("claude") || id.includes("anthropic/");
}

/** Família e versão de um Claude, lidas do id. `maior` NaN = sem número
 *  (claude-mythos-preview), que conta como da geração nova. */
export interface ClaudeVersao {
  familia: "opus" | "sonnet" | "haiku" | "fable" | "mythos";
  maior: number;
  menor: number;
}

/**
 * A versão de um Claude pelo id, nos dois jeitos de escrever: nome primeiro
 * ("claude-opus-4-8", "claude-haiku-4-5-20251001", e "anthropic/claude-opus-
 * 4.8" no OpenRouter) ou número primeiro, da geração 3 ("claude-3-5-sonnet").
 * Uma data no lugar do menor ("claude-sonnet-4-20250514") conta como .0.
 * null quando não é Claude, ou não dá pra ler.
 */
export function claudeVersao(model: string): ClaudeVersao | null {
  const id = (model || "").toLowerCase();
  let m = /claude-(opus|sonnet|haiku|fable|mythos)(?:-(\d+)(?:[-.](\d{1,2})(?!\d))?)?/.exec(id);
  if (m) {
    return {
      familia: m[1] as ClaudeVersao["familia"],
      maior: m[2] ? Number(m[2]) : NaN,
      menor: m[3] ? Number(m[3]) : 0,
    };
  }
  m = /claude-(\d+)(?:[-.](\d))?-(opus|sonnet|haiku)/.exec(id);
  if (m) {
    return {
      familia: m[3] as ClaudeVersao["familia"],
      maior: Number(m[1]),
      menor: m[2] ? Number(m[2]) : 0,
    };
  }
  return null;
}

/** A versão é pelo menos `maior.menor`? Sem número (preview) conta como nova. */
function noMinimo(c: ClaudeVersao, maior: number, menor = 0): boolean {
  if (Number.isNaN(c.maior)) return true;
  return c.maior > maior || (c.maior === maior && c.menor >= menor);
}

/** Da geração que pensa sempre e não aceita sampling: Fable e Mythos. */
function claudeNovo(c: ClaudeVersao): boolean {
  return c.familia === "fable" || c.familia === "mythos";
}

/** Claude que ainda aceita temperatura: os anteriores ao Opus 4.7 (inclusive
 *  o Haiku 4.5). Fable, Mythos, Opus 4.7+ e Sonnet 5+ recusam qualquer valor
 *  fora do padrão — e Claude que não dá pra ler fica sem (omitir nunca é 400). */
function claudeAceitaTemperatura(model: string): boolean {
  const c = claudeVersao(model);
  if (!c || claudeNovo(c) || Number.isNaN(c.maior)) return false;
  return !noMinimo(c, 4, 7);
}

export function paramPolicy(provider: string, model: string): ParamPolicy {
  const reasoning = isReasoningModel(model);
  const claude = isClaude(provider, model);
  const supportsTemperature = !reasoning && (!claude || claudeAceitaTemperatura(model));
  // Claude e NVIDIA NIM: até 1 (o NIM devolve erro de validação acima). E o
  // NIM pede ACIMA de 0 em parte dos modelos (DeepSeek V4 Pro): 0.01 no lugar.
  const tempMax = claude || provider === "nim" ? 1 : 2;
  const tempMin = provider === "nim" ? 0.01 : 0;
  return { supportsTemperature, tempMin, tempMax, reasoning };
}

/**
 * Temperatura FINAL a enviar pro provider, ou `undefined` = NÃO enviar.
 *   - requested < 0 ou null → não enviar (Effort "default do provider").
 *   - modelo que não aceita (reasoning, Claude atuais) → não enviar (evita 400).
 *   - senão → clampa pro range do modelo.
 */
export function resolveTemperature(
  provider: string,
  model: string,
  requested: number | undefined
): number | undefined {
  if (requested == null || requested < 0) return undefined;
  const p = paramPolicy(provider, model);
  if (!p.supportsTemperature) return undefined;
  return Math.max(p.tempMin, Math.min(p.tempMax, requested));
}

/** Teto de saída de um Claude (platform.claude.com › Output limits, out/2026). */
function tetoClaude(c: ClaudeVersao): number {
  if (claudeNovo(c) || Number.isNaN(c.maior)) return 128000;
  if (c.familia !== "haiku" && noMinimo(c, 4, 6)) return 128000; // Opus/Sonnet 4.6+
  if (noMinimo(c, 4, 5)) return 64000; // Opus, Sonnet e Haiku 4.5 (e Haiku novo)
  if (c.familia === "sonnet" && noMinimo(c, 3, 7)) return 64000; // Sonnet 4 e 3.7
  if (c.familia === "opus" && noMinimo(c, 4, 0)) return 32000; // Opus 4 e 4.1
  if (noMinimo(c, 3, 5)) return 8192; // 3.5
  return 4096; // 3
}

/**
 * Teto de tokens de OUTPUT por modelo (≠ context window!). O Effort "Max" pede
 * ~80% do context (ex: 159k num Claude de 200k), mas o output máximo é bem
 * menor → 400. Aqui clampa pro limite real. Valores curados (out/2026):
 *   Claude: ver tetoClaude · GPT-5.x = 128k · o-series = 100k (inclui o
 *   raciocínio) · GPT-4.1 = 32k · GPT-4o = 16k · Gemini 2.5/3 = 64k ·
 *   DeepSeek = 8k · NVIDIA NIM = 4k · resto = 16k (conservador)
 */
export function maxOutputTokens(provider: string, model: string): number {
  const id = (model || "").toLowerCase();
  const tail = tailOf(model);
  const claude = claudeVersao(model);
  if (claude) return tetoClaude(claude);
  // OpenAI (direto ou via openrouter "openai/…")
  if (/(^|[-/])gpt-5/.test(tail)) return 128000;
  if (/^o[1-9]([-.]|$)/.test(tail)) return 100000;
  if (/(^|[-/])gpt-4\.1/.test(tail)) return 32768;
  if (/(^|[-/])gpt-4o/.test(tail)) return 16384;
  // Gemini
  if (/gemini-([3-9]|2\.5)/.test(id)) return 65536;
  if (/gemini/.test(id)) return 8192;
  // DeepSeek capa output em 8k (API própria e na maioria dos hosts; no NIM o
  // V4 Pro aceita até 16k).
  if (/deepseek/.test(id)) return 8192;
  // NIM hosted: os outros modelos capam a saída em 4096 (Llama 3.1 70B, por
  // exemplo) e devolvem 400 acima disso.
  if (provider === "nim") return 4096;
  return 16384;
}

/**
 * O modelo PENSA antes de responder, gastando do mesmo max_tokens?
 *   - os de raciocínio (o-series, GPT-5, DeepSeek R1, QwQ, Magistral);
 *   - Claude Fable, Mythos e 5+ (o pensamento vem ligado; o Opus 4.7/4.8 só
 *     pensa se pedirem, e a gente não pede);
 *   - Gemini 2.5 (menos o Flash-Lite, que vem sem) e 3+;
 *   - locais que pensam por padrão: gpt-oss, qwen3.
 */
export function pensaAntes(_provider: string, model: string): boolean {
  if (isReasoningModel(model)) return true;
  const id = (model || "").toLowerCase();
  const c = claudeVersao(model);
  if (c) return claudeNovo(c) || noMinimo(c, 5, 0);
  if (/gemini-2\.5-(pro|flash)(?!-lite)/.test(id) || /gemini-([3-9]|\d{2})/.test(id)) return true;
  if (/gpt-oss/.test(id)) return true;
  if (/qwen3(?![\w.-]*instruct)/.test(id)) return true;
  return false;
}

/**
 * O mínimo de max_tokens pra um modelo que pensa: o pensamento entra nessa
 * conta e, com menos, a resposta pode sair vazia. A OpenAI recomenda reservar
 * 25k; a Anthropic pede "um max_tokens folgado" do high pra cima e sugere 64k
 * no xhigh/max. Teto é teto: só se paga o que o modelo gerar.
 */
export function pisoPensando(effort?: EffortLevel): number {
  if (effort === "xhigh" || effort === "max") return 64000;
  if (effort === "high") return 32000;
  return 16000;
}

/** maxTokens FINAL: o piso de quem pensa, depois o teto de output do modelo
 *  e, por último, o que ainda cabe na janela (`teto`, quando o motor sabe). */
export function resolveMaxTokens(
  provider: string,
  model: string,
  requested: number,
  effort?: EffortLevel,
  teto?: number
): number {
  const pedido = pensaAntes(provider, model) ? Math.max(requested, pisoPensando(effort)) : requested;
  const doModelo = Math.min(pedido, maxOutputTokens(provider, model));
  return teto && teto > 0 ? Math.min(doModelo, teto) : doModelo;
}

/** O nível do Effort nos três degraus que todo provider com esse controle
 *  aceita (low/medium/high) — Extra high e Max viram high. */
function degrauBasico(effort: EffortLevel): "low" | "medium" | "high" {
  return effort === "low" ? "low" : effort === "med" ? "medium" : "high";
}

/**
 * O nível que um Claude aceita em `output_config.effort` (platform.claude.com
 * › Effort, out/2026): low, medium e high em todos que têm o controle; xhigh
 * só nos novos (Fable/Mythos 5+, Opus 4.7+, Sonnet 5+); max em quase todos
 * (menos o Opus 4.5). Sem o controle — Haiku 4.5, Sonnet 4.5 e anteriores —:
 * null, porque mandar a quem não aceita é 400.
 */
function nivelClaude(c: ClaudeVersao, effort: EffortLevel): string | null {
  const temControle =
    claudeNovo(c) ||
    (c.familia === "opus" && noMinimo(c, 4, 5)) ||
    (c.familia === "sonnet" && noMinimo(c, 4, 6));
  if (!temControle) return null;
  const temXhigh =
    (claudeNovo(c) && !Number.isNaN(c.maior)) ||
    (c.familia === "opus" && noMinimo(c, 4, 7)) ||
    (c.familia === "sonnet" && noMinimo(c, 5, 0));
  const temMax = !(c.familia === "opus" && c.maior === 4 && c.menor === 5);
  if (effort === "xhigh") return temXhigh ? "xhigh" : "high";
  if (effort === "max") return temMax ? "max" : "high";
  return degrauBasico(effort);
}

/** O que entra no corpo pra dizer ao modelo QUANTO pensar. */
export type EsforcoNoCorpo =
  | { campo: "reasoning_effort"; valor: "low" | "medium" | "high" }
  | { campo: "output_config"; valor: { effort: string } }
  | { campo: "reasoning"; valor: { effort: "low" | "medium" | "high" } };

/**
 * O nível do Effort no idioma de cada provider, ou null quando o modelo não
 * tem esse controle (mandar a quem não aceita é 400):
 *   - Claude: `output_config.effort`, nos níveis que o modelo tem;
 *   - OpenAI (o-series, GPT-5): `reasoning_effort` low/medium/high — fora os
 *     "-pro" e o o1-mini/preview, que não deixam escolher;
 *   - Gemini 2.5/3: `reasoning_effort` low/medium/high;
 *   - OpenRouter: `reasoning.effort`, só nos da OpenAI (nos outros ele vira
 *     orçamento de pensamento, que o Claude 5 recusa);
 *   - NIM e Ollama: sem um controle padrão.
 */
export function esforcoDoProvider(
  provider: string,
  model: string,
  effort?: EffortLevel
): EsforcoNoCorpo | null {
  if (!effort) return null;
  if (provider === "anthropic") {
    const c = claudeVersao(model);
    const nivel = c ? nivelClaude(c, effort) : null;
    return nivel ? { campo: "output_config", valor: { effort: nivel } } : null;
  }
  if (!pensaAntes(provider, model)) return null;
  const tail = tailOf(model);
  const daOpenAI = /^o[1-9]([-.]|$)/.test(tail) || /(^|[-/])gpt-5/.test(tail);
  const semEscolha = /-pro\b/.test(tail) || /^o1-(mini|preview)/.test(tail);
  if (provider === "openai") {
    return daOpenAI && !semEscolha ? { campo: "reasoning_effort", valor: degrauBasico(effort) } : null;
  }
  if (provider === "gemini") return { campo: "reasoning_effort", valor: degrauBasico(effort) };
  if (provider === "openrouter" && /^openai\//.test((model || "").toLowerCase()) && daOpenAI && !semEscolha) {
    return { campo: "reasoning", valor: { effort: degrauBasico(effort) } };
  }
  return null;
}

/**
 * Modelos da OpenAI que recusam ferramentas COM raciocínio no
 * /v1/chat/completions. Do GPT-5.4 em diante, um pedido com `tools` e
 * `reasoning_effort` diferente de "none" volta 400 ("Function tools with
 * reasoning_effort are not supported … use /v1/responses or set
 * reasoning_effort to 'none'") — o modo Agent quebrava logo no primeiro
 * pedido. A regra cobre os conhecidos; um modelo novo que recuse entra na
 * lista pelo próprio erro (ver lembrarSemRaciocinioComFerramentas).
 */
const aprendidosSemRaciocinioComFerramentas = new Set<string>();

export function semRaciocinioComFerramentas(provider: string, model: string): boolean {
  if (provider !== "openai") return false;
  const tail = tailOf(model);
  if (aprendidosSemRaciocinioComFerramentas.has(tail)) return true;
  const m = /(?:^|[-/])gpt-(\d+)(?:\.(\d+))?/.exec(tail);
  if (!m) return false;
  const maior = Number(m[1]);
  const menor = m[2] === undefined ? 0 : Number(m[2]);
  return maior > 5 || (maior === 5 && menor >= 4);
}

/** O próprio erro ensinou que este modelo recusa ferramentas com raciocínio. */
export function lembrarSemRaciocinioComFerramentas(model: string): void {
  aprendidosSemRaciocinioComFerramentas.add(tailOf(model));
}

/** O erro da OpenAI que diz exatamente isso (pra tentar de novo sem raciocínio). */
export function ehRecusaDeRaciocinioComFerramentas(mensagem: string): boolean {
  return (
    /reasoning_effort/i.test(mensagem) &&
    /tools?\b/i.test(mensagem) &&
    /not supported/i.test(mensagem)
  );
}

/** Põe o esforço no corpo do pedido (se houver o que pôr). */
export function aplicarEsforco(
  body: Record<string, unknown>,
  provider: string,
  model: string,
  effort?: EffortLevel
): void {
  const e = esforcoDoProvider(provider, model, effort);
  if (e) body[e.campo] = e.valor;
}

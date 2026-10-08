// src/providers/modelCapabilities.ts
// Matriz de capacidades por modelo — usada por:
//   - UI: badges visuais ao lado do nome do modelo (StarterScreen, PlusModal)
//   - Composer: habilita botão "anexar imagem" quando modelo aceita vision
//   - Agent: só permite Agent Mode em modelos com tools=true
//   - Stream: indica se streaming é "real" (fetch SSE) ou "fake" (NIM via requestUrl)
//
// Match é por prefixo (mais resiliente a versões), com lookup ordenado por
// especificidade. Quando o modelo não bate em nenhum prefixo, retorna
// fallback conservador (apenas streaming).

import { Platform } from "obsidian";
import { getEnrichedInfo } from "./modelInfoStore";

export interface ModelCapabilities {
  /** Aceita imagens (input multimodal: image_url / image base64) */
  vision: boolean;
  /** Suporta function/tool calling (Agent Mode) */
  tools: boolean;
  /** Streaming SSE real (fetch). false = streaming "fake" via requestUrl */
  streaming: boolean;
  /** Modelo gratuito (sem custo de uso). null = informação desconhecida */
  free?: boolean;
  /** Gera imagens (text-to-image). Salvas em axxa-ai/generation/images/ */
  imageGen?: boolean;
  /** Gera áudio (TTS ou voice models). Salvos em axxa-ai/generation/audio/ */
  audioGen?: boolean;
  /** Gera vídeo (Veo, Sora, Cosmos, etc). Salvos em axxa-ai/generation/video/ */
  videoGen?: boolean;
  /** Aceita PDF anexado no wire (bloco document / content part `file`). v0.1.248 */
  pdf?: boolean;
}

const DEFAULT_CAPS: ModelCapabilities = {
  vision: false,
  tools: false,
  streaming: true,
};

// Fallback POR PROVIDER pra modelos fora da tabela (auditoria v0.1.225):
//   - openrouter: o roteador NORMALIZA tools — modelos modernos esmagadoramente
//     suportam. tools:false aqui bloqueava o Agent em qualquer vendor não
//     mapeado (x-ai, cohere, amazon, moonshot, z-ai…). Otimista + overlay do
//     catálogo (abaixo) corrige por-modelo com dado REAL.
//   - nim: 100% OpenAI-compat com tools; e o streaming é SEMPRE pseudo
//     (requestUrl/CORS) — streaming:true aqui era mentira no badge.
const FALLBACK_BY_PROVIDER: Record<string, ModelCapabilities> = {
  openrouter: { vision: false, tools: true, streaming: true },
  nim: { vision: false, tools: true, streaming: false },
};

interface CapsEntry {
  prefix: string;
  caps: ModelCapabilities;
}

// Ordem importa: prefixos mais específicos vêm antes (ex: "gpt-4o-mini" antes de "gpt-4o").
// Provider-prefixed (OpenRouter / NIM) também são mapeados pra reusar conhecimento dos
// upstream labs.
const ENTRIES_BY_PROVIDER: Record<string, CapsEntry[]> = {
  // ─────────────────────────────── OpenAI ───────────────────────────────
  openai: [
    // Image generation
    { prefix: "dall-e-3", caps: { vision: false, tools: false, streaming: false, imageGen: true } },
    { prefix: "dall-e-2", caps: { vision: false, tools: false, streaming: false, imageGen: true } },
    { prefix: "gpt-image", caps: { vision: false, tools: false, streaming: false, imageGen: true } },
    // Audio (TTS)
    { prefix: "tts-1-hd", caps: { vision: false, tools: false, streaming: false, audioGen: true } },
    { prefix: "tts-1", caps: { vision: false, tools: false, streaming: false, audioGen: true } },
    { prefix: "gpt-4o-mini-tts", caps: { vision: false, tools: false, streaming: false, audioGen: true } },
    // Video gen — Sora API (quando GA)
    { prefix: "sora", caps: { vision: false, tools: false, streaming: false, videoGen: true } },
    // Chat LLM
    { prefix: "gpt-4o-mini", caps: { vision: true, tools: true, streaming: true } },
    // gpt-4o-audio/gpt-4o-realtime NÃO são expostos no plugin; se algum id de
    // chat parecido aparecer, herdar do prefixo "gpt-4o" (chat+vision) é
    // intencional — caps conservadoras e corrigíveis pelo overlay. (v0.1.228)
    { prefix: "gpt-4o", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "gpt-5", caps: { vision: true, tools: true, streaming: true } },
    // o1/o3/o4 séries — reasoning, com vision a partir do o1
    { prefix: "o1-mini", caps: { vision: false, tools: false, streaming: true } },
    { prefix: "o1", caps: { vision: true, tools: false, streaming: true } },
    { prefix: "o3-mini", caps: { vision: false, tools: true, streaming: true } },
    { prefix: "o3", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "o4", caps: { vision: true, tools: true, streaming: true } },
  ],

  // ─────────────────────────────── Anthropic ───────────────────────────
  anthropic: [
    // Fable 5 — modelo topo mais recente: multimodal + tools + streaming
    { prefix: "claude-fable", caps: { vision: true, tools: true, streaming: true } },
    // Toda família Claude 3/4 tem vision + tools + streaming
    { prefix: "claude-opus-4", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "claude-sonnet-4", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "claude-haiku-4", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "claude-3", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "claude-2", caps: { vision: false, tools: false, streaming: true } },
  ],

  // ─────────────────────────────── Gemini ──────────────────────────────
  gemini: [
    // Image generation — "Nano Banana" é o codename do gemini-2.5-flash-image
    // ID correto (sem -preview) confirmado em ai.google.dev/gemini-api/docs/image-generation
    { prefix: "gemini-2.5-flash-image", caps: { vision: true, tools: false, streaming: false, imageGen: true } },
    { prefix: "gemini-2.0-flash-exp-image", caps: { vision: true, tools: false, streaming: false, imageGen: true } },
    { prefix: "imagen-3", caps: { vision: false, tools: false, streaming: false, imageGen: true } },
    { prefix: "imagen-4", caps: { vision: false, tools: false, streaming: false, imageGen: true } },
    { prefix: "imagen-", caps: { vision: false, tools: false, streaming: false, imageGen: true } },
    // Audio (TTS)
    { prefix: "gemini-2.5-flash-preview-tts", caps: { vision: false, tools: false, streaming: false, audioGen: true } },
    // Video gen (Veo)
    { prefix: "veo", caps: { vision: false, tools: false, streaming: false, videoGen: true } },
    // Chat LLM — toda família Gemini 1.5+ aceita imagem nativa
    { prefix: "gemini-3", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "gemini-2.5", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "gemini-2.0", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "gemini-1.5", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "gemini-1.0", caps: { vision: true, tools: false, streaming: true } },
  ],

  // ─────────────────────────── OpenRouter ───────────────────────────
  // Modelos prefixados por upstream — reusa as caps do lab origem.
  openrouter: [
    // OpenRouter Auto-Router suporta multimodal (visão/imagem, áudio, PDF) e tools nativamente
    { prefix: "openrouter/auto", caps: { vision: true, tools: true, streaming: true } },
    // Anthropic via OpenRouter
    { prefix: "anthropic/claude-3", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "anthropic/claude-4", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "anthropic/claude-", caps: { vision: true, tools: true, streaming: true } },
    // OpenAI via OpenRouter
    { prefix: "openai/gpt-4o", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "openai/gpt-5", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "openai/o", caps: { vision: true, tools: true, streaming: true } },
    // Google — gemini-3 ANTES do genérico (caía em tools:false e bloqueava
    // o Agent no Gemini 3 via OpenRouter — bug da auditoria v0.1.225).
    { prefix: "google/gemini-3", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "google/gemini-2", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "google/gemini-1.5", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "google/gemini", caps: { vision: true, tools: false, streaming: true } },
    { prefix: "google/gemma", caps: { vision: false, tools: false, streaming: true } },
    // Meta Llama 3.2+ tem vision em variantes "vision"; Llama 3.3 base é texto-only
    { prefix: "meta-llama/llama-3.3", caps: { vision: false, tools: true, streaming: true } },
    { prefix: "meta-llama/llama-3.2-vision", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "meta-llama/llama-3.2", caps: { vision: false, tools: true, streaming: true } },
    { prefix: "meta-llama/llama-3.1", caps: { vision: false, tools: true, streaming: true } },
    // Mistral, DeepSeek, Qwen — vision em variantes específicas
    { prefix: "mistralai/pixtral", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "mistralai/", caps: { vision: false, tools: true, streaming: true } },
    { prefix: "qwen/qwen2.5-vl", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "qwen/qwen-vl", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "qwen/qwen", caps: { vision: false, tools: true, streaming: true } },
    { prefix: "deepseek/deepseek-vl", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "deepseek/", caps: { vision: false, tools: true, streaming: true } },
    // Vendors que faltavam (auditoria v0.1.225) — sem eles, caíam no fallback.
    { prefix: "x-ai/grok-4", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "x-ai/", caps: { vision: false, tools: true, streaming: true } },
    { prefix: "amazon/nova", caps: { vision: true, tools: true, streaming: true } },
    { prefix: "cohere/", caps: { vision: false, tools: true, streaming: true } },
    { prefix: "moonshotai/", caps: { vision: false, tools: true, streaming: true } },
    { prefix: "z-ai/", caps: { vision: false, tools: true, streaming: true } },
    { prefix: "nvidia/", caps: { vision: false, tools: true, streaming: true } },
    { prefix: "microsoft/", caps: { vision: false, tools: true, streaming: true } },
    // Perplexity Sonar NÃO suporta tool calling (search-grounded).
    { prefix: "perplexity/", caps: { vision: false, tools: false, streaming: true } },
    // (o sufixo ":free" é tratado como OVERLAY no getModelCapabilities — um
    // entry de prefixo nunca casaria com sufixo; o antigo era código morto.)
  ],

  // ─────────────────────────── Nvidia NIM ──────────────────────────
  // streaming:false aqui = verdade do MOBILE (pseudo-stream via requestUrl).
  // No DESKTOP o getModelCapabilities vira true (SSE real via Node https,
  // v0.1.226) pra chat models — ver override no fim da função.
  nim: [
    // ===== Image generation (NIM Visual GenAI) =====
    { prefix: "stabilityai/stable-diffusion", caps: { vision: false, tools: false, streaming: false, imageGen: true, free: true } },
    { prefix: "stabilityai/sdxl", caps: { vision: false, tools: false, streaming: false, imageGen: true, free: true } },
    { prefix: "black-forest-labs/flux", caps: { vision: false, tools: false, streaming: false, imageGen: true, free: true } },
    { prefix: "shutterstock/", caps: { vision: false, tools: false, streaming: false, imageGen: true, free: true } },
    // Nemotron VL / Vision tem suporte multimodal
    { prefix: "nvidia/llama-3.2-nv-embedqa", caps: { vision: false, tools: false, streaming: false } },
    { prefix: "nvidia/llama-nemotron-embed", caps: { vision: true, tools: false, streaming: false } },
    { prefix: "nvidia/vila", caps: { vision: true, tools: false, streaming: false } },
    { prefix: "nvidia/llama-3.2-90b-vision", caps: { vision: true, tools: true, streaming: false } },
    { prefix: "nvidia/llama-3.2-11b-vision", caps: { vision: true, tools: true, streaming: false } },
    { prefix: "nvidia/", caps: { vision: false, tools: true, streaming: false } },
    { prefix: "meta/llama-3.2-90b-vision", caps: { vision: true, tools: true, streaming: false } },
    { prefix: "meta/llama-3.2-11b-vision", caps: { vision: true, tools: true, streaming: false } },
    { prefix: "meta/llama-3.3", caps: { vision: false, tools: true, streaming: false } },
    { prefix: "meta/llama-3.1", caps: { vision: false, tools: true, streaming: false } },
    { prefix: "meta/", caps: { vision: false, tools: true, streaming: false } },
    { prefix: "qwen/qwen2-vl", caps: { vision: true, tools: true, streaming: false } },
    { prefix: "qwen/qwen2.5-vl", caps: { vision: true, tools: true, streaming: false } },
    { prefix: "qwen/", caps: { vision: false, tools: true, streaming: false } },
    { prefix: "deepseek-ai/", caps: { vision: false, tools: true, streaming: false } },
    { prefix: "microsoft/phi-4", caps: { vision: false, tools: true, streaming: false } },
    { prefix: "microsoft/", caps: { vision: false, tools: false, streaming: false } },
    { prefix: "mistralai/", caps: { vision: false, tools: true, streaming: false } },
    { prefix: "google/gemma", caps: { vision: false, tools: false, streaming: false } },
  ],

  // ─────────────────────────── Ollama (local) ──────────────────────
  // Models são nome simples (sem prefixo de publisher). Vision em llava, bakllava, minicpm-v, etc.
  ollama: [
    { prefix: "llava", caps: { vision: true, tools: false, streaming: true, free: true } },
    { prefix: "bakllava", caps: { vision: true, tools: false, streaming: true, free: true } },
    { prefix: "minicpm-v", caps: { vision: true, tools: false, streaming: true, free: true } },
    { prefix: "moondream", caps: { vision: true, tools: false, streaming: true, free: true } },
    { prefix: "llama3.2-vision", caps: { vision: true, tools: true, streaming: true, free: true } },
    { prefix: "llama3.2", caps: { vision: false, tools: true, streaming: true, free: true } },
    { prefix: "llama3.1", caps: { vision: false, tools: true, streaming: true, free: true } },
    { prefix: "llama3.3", caps: { vision: false, tools: true, streaming: true, free: true } },
    { prefix: "qwen2.5-vl", caps: { vision: true, tools: true, streaming: true, free: true } },
    { prefix: "qwen2.5", caps: { vision: false, tools: true, streaming: true, free: true } },
    // O qwen3.5 lê imagem: o `/api/show` do Ollama lista "vision" (e "tools")
    // nele. Sem esta linha ele caía no prefixo "qwen3" e o botão de anexar
    // imagem ficava apagado.
    { prefix: "qwen3.5", caps: { vision: true, tools: true, streaming: true, free: true } },
    { prefix: "qwen3", caps: { vision: false, tools: true, streaming: true, free: true } },
    { prefix: "mistral-large", caps: { vision: false, tools: true, streaming: true, free: true } },
    { prefix: "mistral", caps: { vision: false, tools: false, streaming: true, free: true } },
    { prefix: "deepseek-r1", caps: { vision: false, tools: true, streaming: true, free: true } },
    { prefix: "deepseek", caps: { vision: false, tools: false, streaming: true, free: true } },
    { prefix: "phi", caps: { vision: false, tools: false, streaming: true, free: true } },
    { prefix: "gemma", caps: { vision: false, tools: false, streaming: true, free: true } },
  ],
};

/**
 * Lookup das capacidades do modelo dado o provider.
 * Match por prefixo, ordem do array (mais específico primeiro).
 * Fallback: por-provider (FALLBACK_BY_PROVIDER) → DEFAULT_CAPS.
 *
 * OVERLAY do catálogo vivo (auditoria v0.1.225): se o user já fez "Fetch info"
 * (ou o auto-fetch do card rodou), o cache enriquecido tem `supportsTools` +
 * `modalities` REAIS do catálogo OpenRouter. Regras:
 *   - openrouter: o catálogo é a VERDADE pro próprio id → tools pode subir E
 *     descer (ex: perplexity/sonar sem tools).
 *   - demais providers: só UPGRADE (a tabela curada é a verdade do API direto;
 *     o catálogo serve pra ligar o que faltou, nunca pra desligar).
 *   - vision/free: upgrade-only em todos.
 *   - streaming NUNCA vem do overlay — é propriedade do NOSSO transporte
 *     (NIM é pseudo-stream independente do modelo).
 *
 * Sufixo `:free` no OpenRouter — overlay no flag free sem mudar outras caps.
 */
/**
 * Tokens diários GRÁTIS da OpenAI (programa de compartilhar tráfego).
 * Quem liga "share traffic with OpenAI" no painel ganha uma cota diária; o que
 * passar disso, e todo modelo fora destas duas listas, é cobrado normal.
 *
 * É uma lista EXATA de propósito: `gpt-5.4` (250k) e `gpt-5.4-mini` (2.5M) são
 * cotas diferentes, então prefixo daria a resposta errada. Aceita o id puro ou
 * o id datado que a API devolve (`gpt-4o-2024-08-06`).
 */
const FREE_DAILY_OPENAI: Record<string, number> = {};
for (const m of ["gpt-5.4", "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4.1", "gpt-4o", "o1", "o3"])
  FREE_DAILY_OPENAI[m] = 250_000;
for (const m of [
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o-mini",
  "o3-mini",
  "o4-mini",
])
  FREE_DAILY_OPENAI[m] = 2_500_000;

/** Cota diária grátis do modelo, em tokens/dia — ou null se não tem. */
export function getFreeDailyTokens(provider: string, model: string): number | null {
  if (provider !== "openai" || !model) return null;
  const id = model.toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return FREE_DAILY_OPENAI[id] ?? null;
}

export function getModelCapabilities(
  provider: string,
  model: string
): ModelCapabilities {
  if (!model) return { ...DEFAULT_CAPS };

  const fallback = FALLBACK_BY_PROVIDER[provider] ?? DEFAULT_CAPS;
  const entries = ENTRIES_BY_PROVIDER[provider];
  const lower = model.toLowerCase();

  let matched: ModelCapabilities | null = null;
  if (entries) {
    for (const entry of entries) {
      if (lower.startsWith(entry.prefix.toLowerCase())) {
        matched = entry.caps;
        break;
      }
    }
  }
  // Spread raso já é clone COMPLETO: ModelCapabilities é plano (só primitivos),
  // então nenhuma referência mutável é compartilhada com a entry/fallback.
  // Se um dia adicionar campo não-primitivo, trocar por deep clone. (v0.1.228)
  const caps: ModelCapabilities = matched ? { ...matched } : { ...fallback };

  // Overlay do cache enriquecido (catálogo OpenRouter, por provider::model).
  const enriched = getEnrichedInfo(provider, model);
  if (enriched) {
    if (enriched.supportsTools != null) {
      if (provider === "openrouter") caps.tools = enriched.supportsTools;
      else if (enriched.supportsTools) caps.tools = true;
    }
    if (enriched.modalities?.includes("image")) caps.vision = true;
    if (enriched.outputModalities?.includes("image")) caps.imageGen = true;
    if (enriched.tier === "free") caps.free = true;
  }

  // Sufixo :free no OpenRouter — marca free sem mudar outras caps.
  if (provider === "openrouter" && lower.endsWith(":free")) caps.free = true;

  // OpenAI: cota diária grátis de quem compartilha tráfego (mesma ideia —
  // marca free, não mexe no resto).
  if (getFreeDailyTokens(provider, model) !== null) caps.free = true;

  // NIM: streaming REAL no DESKTOP (Node https fura o CORS — v0.1.226); o
  // pseudo-stream agora é só mobile. A tabela estática mantém false (verdade
  // do mobile); aqui vira true em chat models quando há Node.
  if (
    provider === "nim" &&
    !Platform.isMobile &&
    !caps.streaming &&
    !(caps.imageGen || caps.audioGen || caps.videoGen)
  ) {
    caps.streaming = true;
  }

  // PDF anexado: derivado (provider + modelo + vision), nunca da tabela.
  caps.pdf = supportsPdf(provider, model, caps);

  return caps;
}

/**
 * O modelo aceita um PDF anexado indo pro wire? (v0.1.248)
 *
 * Derivado em vez de tabelado porque a regra é por FAMÍLIA e por transporte,
 * não por modelo — e a tabela de caps tem centenas de linhas que ficariam
 * desatualizadas a cada modelo novo.
 *
 *  - **anthropic**: bloco `document` nativo, suportado do Claude 3.5 em diante.
 *    Os Claude 3 originais (opus/sonnet/haiku), o Claude 2 e o Instant ficam de
 *    fora — mandar PDF pra eles é 400 na cara do usuário.
 *  - **openai**: content part `file` no Chat Completions; a doc exige modelo com
 *    visão (gpt-4o em diante), então `vision` é o gate exato.
 *  - **openrouter**: o roteador aceita `file` em qualquer modelo de chat — quando
 *    o modelo não lê PDF nativamente, o plugin file-parser extrai (ver
 *    openrouter.ts, que escolhe o engine e NUNCA deixa cair no default pago).
 *  - **gemini/nim/ollama**: `false`. Não é limitação do modelo — é do nosso
 *    transporte: o chat do Gemini aqui roda no endpoint OpenAI-compat, que não
 *    documenta parts de arquivo; NIM e Ollama idem. A UI avisa e o anexo fica
 *    registrado na conversa em vez de sumir.
 */
export function supportsPdf(
  provider: string,
  model: string,
  caps: Pick<ModelCapabilities, "vision" | "imageGen" | "audioGen" | "videoGen">
): boolean {
  if (!model) return false;
  // Modelo de geração não recebe anexo de entrada — o turno vira mídia.
  if (caps.imageGen || caps.audioGen || caps.videoGen) return false;
  const lower = model.toLowerCase();
  switch (provider) {
    case "anthropic":
      if (!lower.startsWith("claude")) return false;
      return !/^claude-(2|instant|3-(opus|sonnet|haiku))/.test(lower);
    case "openai":
      return !!caps.vision;
    case "openrouter":
      return true;
    default:
      return false;
  }
}

export type CapabilityBadgeId =
  | "vision"
  | "tools"
  | "stream"
  | "free"
  | "img-gen"
  | "audio-gen"
  | "video-gen";

/** Helper conveniência: o modelo é qualquer tipo de generation? */
export function isGenerationModel(caps: ModelCapabilities): boolean {
  return Boolean(caps.imageGen || caps.audioGen || caps.videoGen);
}

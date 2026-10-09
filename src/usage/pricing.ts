// src/usage/pricing.ts
// Tabela de preços por modelo — USD por 1M tokens (in/out).
//
// Estratégia:
//   - Match por prefixo (mesma logic do modelCapabilities)
//   - `null` em campo = preço desconhecido (UI mostra "—")
//   - input/output em USD por 1 MILHÃO de tokens (é a unidade comum dos labs)
//   - Atualizar via webfetch periodicamente — preços mudam
//   - Fonte principal: tabelas oficiais de cada provider + LiteLLM JSON
//     (https://github.com/BerriAI/litellm/blob/main/litellm/model_prices_and_context_window_backup.json)
//
// Free models (gemini free tier, openrouter :free, ollama local) = 0.
// Generation models têm preço por imagem ou por minuto de áudio em vez de tokens.

export interface ModelPricing {
  /** USD por 1M tokens de input. null = desconhecido. */
  inputPerMillion: number | null;
  /** USD por 1M tokens de output. null = desconhecido. */
  outputPerMillion: number | null;
  /** USD por 1M tokens de input LIDOS DO CACHE de prompt (cache hit).
   *  Ausente = sem desconto conhecido (cobra a entrada cheia). */
  cachedInputPerMillion?: number;
  /** USD por 1M tokens GRAVADOS no cache (Anthropic: escrita de 5 min;
   *  OpenAI GPT-5.6+). Ausente = a entrada cheia. */
  cacheWritePerMillion?: number;
  /** Pra image gen: USD por imagem (size 1024x1024). */
  imagePerCall?: number;
  /** Pra TTS: USD por 1M caracteres input. */
  charPerMillion?: number;
  /** Pricing tier conhecido (free / paid / unknown). */
  tier?: "free" | "paid" | "unknown";
  /** Data da última verificação (ISO YYYY-MM-DD). */
  asOf?: string;
}

interface PricingEntry {
  prefix: string;
  pricing: ModelPricing;
}

const PRICES_BY_PROVIDER: Record<string, PricingEntry[]> = {
  // ─────────────────────────────── OpenAI ───────────────────────────────
  // Fonte: developers.openai.com/api/docs/pricing (out/2026), faixa padrão
  // (≤272K de entrada nos que têm faixa longa: acima disso, 2× a entrada e o
  // cache, 1,5× a saída). Cache de escrita só do GPT-5.6 em diante.
  openai: [
    // GPT-6
    { prefix: "gpt-6.1-sol", pricing: { inputPerMillion: 2, outputPerMillion: 10, cachedInputPerMillion: 0.1, cacheWritePerMillion: 2.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-6-astra", pricing: { inputPerMillion: 10, outputPerMillion: 50, cachedInputPerMillion: 1, cacheWritePerMillion: 12.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-6-sol", pricing: { inputPerMillion: 2, outputPerMillion: 10, cachedInputPerMillion: 0.2, cacheWritePerMillion: 2.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-6-luna", pricing: { inputPerMillion: 0.1, outputPerMillion: 0.5, cachedInputPerMillion: 0.01, cacheWritePerMillion: 0.125, tier: "paid", asOf: "2026-10" } },
    // GPT-5.x (os específicos antes do prefixo curto)
    { prefix: "gpt-5.6-cyber", pricing: { inputPerMillion: 12.5, outputPerMillion: 75, cachedInputPerMillion: 1.25, cacheWritePerMillion: 15.625, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.6-terra", pricing: { inputPerMillion: 2, outputPerMillion: 12, cachedInputPerMillion: 0.2, cacheWritePerMillion: 2.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.6-luna", pricing: { inputPerMillion: 0.2, outputPerMillion: 1.2, cachedInputPerMillion: 0.02, cacheWritePerMillion: 0.25, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.6-sol", pricing: { inputPerMillion: 4, outputPerMillion: 20, cachedInputPerMillion: 0.4, cacheWritePerMillion: 5, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.6", pricing: { inputPerMillion: 4, outputPerMillion: 20, cachedInputPerMillion: 0.4, cacheWritePerMillion: 5, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.5-pro", pricing: { inputPerMillion: 30, outputPerMillion: 180, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.5", pricing: { inputPerMillion: 5, outputPerMillion: 30, cachedInputPerMillion: 0.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.4-mini", pricing: { inputPerMillion: 0.75, outputPerMillion: 4.5, cachedInputPerMillion: 0.075, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.4-nano", pricing: { inputPerMillion: 0.2, outputPerMillion: 1.25, cachedInputPerMillion: 0.02, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.4-pro", pricing: { inputPerMillion: 30, outputPerMillion: 180, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.4", pricing: { inputPerMillion: 2.5, outputPerMillion: 15, cachedInputPerMillion: 0.25, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.3-codex", pricing: { inputPerMillion: 1.75, outputPerMillion: 14, cachedInputPerMillion: 0.175, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.2-pro", pricing: { inputPerMillion: 21, outputPerMillion: 168, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.2", pricing: { inputPerMillion: 1.75, outputPerMillion: 14, cachedInputPerMillion: 0.175, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5.1", pricing: { inputPerMillion: 1.25, outputPerMillion: 10, cachedInputPerMillion: 0.125, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5-search-api", pricing: { inputPerMillion: 1.25, outputPerMillion: 10, cachedInputPerMillion: 0.125, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5-pro", pricing: { inputPerMillion: 15, outputPerMillion: 120, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5-nano", pricing: { inputPerMillion: 0.05, outputPerMillion: 0.4, cachedInputPerMillion: 0.005, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5-mini", pricing: { inputPerMillion: 0.25, outputPerMillion: 2, cachedInputPerMillion: 0.025, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-5", pricing: { inputPerMillion: 1.25, outputPerMillion: 10, cachedInputPerMillion: 0.125, tier: "paid", asOf: "2026-10" } },
    { prefix: "chat-latest", pricing: { inputPerMillion: 5, outputPerMillion: 30, cachedInputPerMillion: 0.5, tier: "paid", asOf: "2026-10" } },
    // GPT-4.1 / GPT-4o
    { prefix: "gpt-4.1-nano", pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4, cachedInputPerMillion: 0.025, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-4.1-mini", pricing: { inputPerMillion: 0.4, outputPerMillion: 1.6, cachedInputPerMillion: 0.1, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-4.1", pricing: { inputPerMillion: 2, outputPerMillion: 8, cachedInputPerMillion: 0.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-4o-mini-tts", pricing: { inputPerMillion: 0.60, outputPerMillion: 12.00, charPerMillion: 12.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "gpt-4o-mini", pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6, cachedInputPerMillion: 0.075, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-4o-2024-05-13", pricing: { inputPerMillion: 5, outputPerMillion: 15, tier: "paid", asOf: "2026-10" } },
    { prefix: "gpt-4o", pricing: { inputPerMillion: 2.5, outputPerMillion: 10, cachedInputPerMillion: 1.25, tier: "paid", asOf: "2026-10" } },
    // o-series (reasoning)
    { prefix: "o4-mini", pricing: { inputPerMillion: 1.1, outputPerMillion: 4.4, cachedInputPerMillion: 0.275, tier: "paid", asOf: "2026-10" } },
    { prefix: "o4", pricing: { inputPerMillion: 7.50, outputPerMillion: 30.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "o3-pro", pricing: { inputPerMillion: 20, outputPerMillion: 80, tier: "paid", asOf: "2026-10" } },
    { prefix: "o3-mini", pricing: { inputPerMillion: 1.1, outputPerMillion: 4.4, cachedInputPerMillion: 0.55, tier: "paid", asOf: "2026-10" } },
    { prefix: "o3", pricing: { inputPerMillion: 2, outputPerMillion: 8, cachedInputPerMillion: 0.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "o1-pro", pricing: { inputPerMillion: 150, outputPerMillion: 600, tier: "paid", asOf: "2026-10" } },
    { prefix: "o1-mini", pricing: { inputPerMillion: 1.1, outputPerMillion: 4.4, cachedInputPerMillion: 0.55, tier: "paid", asOf: "2026-10" } },
    { prefix: "o1", pricing: { inputPerMillion: 15, outputPerMillion: 60, cachedInputPerMillion: 7.5, tier: "paid", asOf: "2026-10" } },
    // Image gen
    { prefix: "dall-e-3", pricing: { inputPerMillion: null, outputPerMillion: null, imagePerCall: 0.040, tier: "paid", asOf: "2026-06" } },
    { prefix: "dall-e-2", pricing: { inputPerMillion: null, outputPerMillion: null, imagePerCall: 0.020, tier: "paid", asOf: "2026-06" } },
    { prefix: "gpt-image-1", pricing: { inputPerMillion: 5, outputPerMillion: 40, cachedInputPerMillion: 1.25, imagePerCall: 0.042, tier: "paid", asOf: "2026-10" } },
    // TTS
    { prefix: "tts-1-hd", pricing: { inputPerMillion: null, outputPerMillion: null, charPerMillion: 30.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "tts-1", pricing: { inputPerMillion: null, outputPerMillion: null, charPerMillion: 15.00, tier: "paid", asOf: "2026-06" } },
  ],

  // ─────────────────────────────── Anthropic ─────────────────────────────
  // Fonte: platform.claude.com/docs/en/about-claude/pricing (out/2026).
  // Cache: leitura 0,1× (0,05× no Opus/Sonnet 5.5, 0,025× no Fable/Mythos
  // 5.1); escrita de 5 min 1,25×.
  anthropic: [
    { prefix: "claude-fable-5-1", pricing: { inputPerMillion: 10, outputPerMillion: 50, cachedInputPerMillion: 0.25, cacheWritePerMillion: 12.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-fable-5", pricing: { inputPerMillion: 10, outputPerMillion: 50, cachedInputPerMillion: 1, cacheWritePerMillion: 12.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-mythos-5-1", pricing: { inputPerMillion: 10, outputPerMillion: 50, cachedInputPerMillion: 0.25, cacheWritePerMillion: 12.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-mythos-5", pricing: { inputPerMillion: 10, outputPerMillion: 50, cachedInputPerMillion: 1, cacheWritePerMillion: 12.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-opus-5-5", pricing: { inputPerMillion: 4, outputPerMillion: 20, cachedInputPerMillion: 0.2, cacheWritePerMillion: 5, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-opus-5", pricing: { inputPerMillion: 5, outputPerMillion: 25, cachedInputPerMillion: 0.5, cacheWritePerMillion: 6.25, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-opus-4-8", pricing: { inputPerMillion: 5, outputPerMillion: 25, cachedInputPerMillion: 0.5, cacheWritePerMillion: 6.25, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-opus-4-7", pricing: { inputPerMillion: 5, outputPerMillion: 25, cachedInputPerMillion: 0.5, cacheWritePerMillion: 6.25, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-opus-4-6", pricing: { inputPerMillion: 5, outputPerMillion: 25, cachedInputPerMillion: 0.5, cacheWritePerMillion: 6.25, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-opus-4-5", pricing: { inputPerMillion: 5, outputPerMillion: 25, cachedInputPerMillion: 0.5, cacheWritePerMillion: 6.25, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-opus-4-1", pricing: { inputPerMillion: 15, outputPerMillion: 75, cachedInputPerMillion: 1.5, cacheWritePerMillion: 18.75, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-opus-4", pricing: { inputPerMillion: 15, outputPerMillion: 75, cachedInputPerMillion: 1.5, cacheWritePerMillion: 18.75, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-sonnet-5-5", pricing: { inputPerMillion: 2, outputPerMillion: 10, cachedInputPerMillion: 0.1, cacheWritePerMillion: 2.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-sonnet-5", pricing: { inputPerMillion: 2, outputPerMillion: 10, cachedInputPerMillion: 0.2, cacheWritePerMillion: 2.5, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-sonnet-4-6", pricing: { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3, cacheWritePerMillion: 3.75, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-sonnet-4-5", pricing: { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3, cacheWritePerMillion: 3.75, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-sonnet-4", pricing: { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3, cacheWritePerMillion: 3.75, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-haiku-5-5", pricing: { inputPerMillion: 0.1, outputPerMillion: 0.5, cachedInputPerMillion: 0.01, cacheWritePerMillion: 0.125, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-haiku-4-5", pricing: { inputPerMillion: 1, outputPerMillion: 5, cachedInputPerMillion: 0.1, cacheWritePerMillion: 1.25, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-haiku-4", pricing: { inputPerMillion: 1, outputPerMillion: 5, cachedInputPerMillion: 0.1, cacheWritePerMillion: 1.25, tier: "paid", asOf: "2026-10" } },
    { prefix: "claude-3-5-haiku", pricing: { inputPerMillion: 0.8, outputPerMillion: 4, cachedInputPerMillion: 0.08, cacheWritePerMillion: 1, tier: "paid", asOf: "2026-10" } },
    // Aposentados (a página não lista mais): o preço de quando existiam,
    // pras conversas antigas.
    { prefix: "claude-3-5-sonnet", pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-3-opus", pricing: { inputPerMillion: 15.00, outputPerMillion: 75.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-3-sonnet", pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-3-haiku", pricing: { inputPerMillion: 0.25, outputPerMillion: 1.25, tier: "paid", asOf: "2026-06" } },
  ],

  // ─────────────────────────────── Gemini ────────────────────────────────
  // Fonte: ai.google.dev/gemini-api/docs/pricing (out/2026), preço PAGO (no
  // orçamento, contar a mais é o erro seguro). Cache = preço de contexto em
  // cache, sem o armazenamento. 3.6/3.7/3.8 Flash: promoção até 2026-12-31
  // (depois $1,50 / $0,15 de cache).
  gemini: [
    // Image generation
    { prefix: "gemini-2.5-flash-image", pricing: { inputPerMillion: 0.30, outputPerMillion: 30.00, imagePerCall: 0.039, tier: "paid", asOf: "2026-06" } },
    { prefix: "imagen-3", pricing: { inputPerMillion: null, outputPerMillion: null, imagePerCall: 0.040, tier: "paid", asOf: "2026-06" } },
    { prefix: "imagen-4", pricing: { inputPerMillion: null, outputPerMillion: null, imagePerCall: 0.040, tier: "paid", asOf: "2026-06" } },
    // TTS
    { prefix: "gemini-2.5-flash-preview-tts", pricing: { inputPerMillion: null, outputPerMillion: null, charPerMillion: 0.50, tier: "free", asOf: "2026-06" } },
    // Chat (Gemini 3.x)
    { prefix: "gemini-3.8-flash", pricing: { inputPerMillion: 0.75, outputPerMillion: 3.75, cachedInputPerMillion: 0.075, tier: "paid", asOf: "2026-10" } },
    { prefix: "gemini-3.7-flash", pricing: { inputPerMillion: 0.75, outputPerMillion: 3.75, cachedInputPerMillion: 0.075, tier: "paid", asOf: "2026-10" } },
    { prefix: "gemini-3.6-flash", pricing: { inputPerMillion: 0.75, outputPerMillion: 3.75, cachedInputPerMillion: 0.075, tier: "paid", asOf: "2026-10" } },
    { prefix: "gemini-3.5-flash-lite", pricing: { inputPerMillion: 0.3, outputPerMillion: 2.5, cachedInputPerMillion: 0.03, tier: "paid", asOf: "2026-10" } },
    { prefix: "gemini-3.5-flash", pricing: { inputPerMillion: 1.5, outputPerMillion: 9, cachedInputPerMillion: 0.15, tier: "paid", asOf: "2026-10" } },
    { prefix: "gemini-3.1-flash-lite", pricing: { inputPerMillion: 0.25, outputPerMillion: 1.5, cachedInputPerMillion: 0.025, tier: "paid", asOf: "2026-10" } },
    { prefix: "gemini-3.1-pro", pricing: { inputPerMillion: 2, outputPerMillion: 12, cachedInputPerMillion: 0.2, tier: "paid", asOf: "2026-10" } },
    { prefix: "gemini-3-flash", pricing: { inputPerMillion: 0.5, outputPerMillion: 3, cachedInputPerMillion: 0.05, tier: "paid", asOf: "2026-10" } },
    { prefix: "gemini-3-pro", pricing: { inputPerMillion: 2, outputPerMillion: 12, tier: "paid", asOf: "2026-10" } },
    { prefix: "gemini-omni-1.1-flash", pricing: { inputPerMillion: 1.5, outputPerMillion: 9, tier: "paid", asOf: "2026-10" } },
    // Chat (Gemini 2.5)
    { prefix: "gemini-2.5-pro", pricing: { inputPerMillion: 1.25, outputPerMillion: 10, cachedInputPerMillion: 0.125, tier: "paid", asOf: "2026-10" } },
    { prefix: "gemini-2.5-flash-lite", pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4, cachedInputPerMillion: 0.01, tier: "paid", asOf: "2026-10" } },
    { prefix: "gemini-2.5-flash", pricing: { inputPerMillion: 0.3, outputPerMillion: 2.5, cachedInputPerMillion: 0.03, tier: "paid", asOf: "2026-10" } },
    // Chat (Gemini 2.0/1.5) — aposentados: o preço de quando existiam
    { prefix: "gemini-2.0-flash", pricing: { inputPerMillion: 0.10, outputPerMillion: 0.40, tier: "paid", asOf: "2026-06" } },
    { prefix: "gemini-1.5-pro", pricing: { inputPerMillion: 1.25, outputPerMillion: 5.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "gemini-1.5-flash", pricing: { inputPerMillion: 0.075, outputPerMillion: 0.30, tier: "paid", asOf: "2026-06" } },
  ],

  // ─────────────────────────── OpenRouter ────────────────────────────────
  // OpenRouter cobra o mesmo preço do upstream + pequena margem.
  // :free suffix = 0. Outros usam o pricing do provider de origem (aprox).
  openrouter: [
    // Anthropic, OpenAI e Google via OR: a tabela do fabricante (ver
    // precoDeOrigem). Aqui só os que não têm tabela própria.
    // Meta Llama
    { prefix: "meta-llama/llama-3.3-70b", pricing: { inputPerMillion: 0.13, outputPerMillion: 0.40, tier: "paid", asOf: "2026-06" } },
    { prefix: "meta-llama/llama-3.1-405b", pricing: { inputPerMillion: 1.79, outputPerMillion: 1.79, tier: "paid", asOf: "2026-06" } },
    { prefix: "meta-llama/llama-3.1-70b", pricing: { inputPerMillion: 0.13, outputPerMillion: 0.40, tier: "paid", asOf: "2026-06" } },
    { prefix: "meta-llama/llama-3.1-8b", pricing: { inputPerMillion: 0.02, outputPerMillion: 0.05, tier: "paid", asOf: "2026-06" } },
    // Qwen
    { prefix: "qwen/qwen3-coder", pricing: { inputPerMillion: 0.60, outputPerMillion: 2.40, tier: "paid", asOf: "2026-06" } },
    { prefix: "qwen/qwen2.5-72b", pricing: { inputPerMillion: 0.35, outputPerMillion: 0.40, tier: "paid", asOf: "2026-06" } },
    // DeepSeek
    { prefix: "deepseek/deepseek-r1", pricing: { inputPerMillion: 0.55, outputPerMillion: 2.19, tier: "paid", asOf: "2026-06" } },
    { prefix: "deepseek/", pricing: { inputPerMillion: 0.14, outputPerMillion: 0.28, tier: "paid", asOf: "2026-06" } },
    // Free tier (:free suffix) é tratado pelo caso especial endsWith(":free") em
    // getPricing() — um match por prefixo nunca casaria um SUFIXO, então não há
    // entry aqui (seria código morto). v0.1.228
  ],

  // ─────────────────────────── Nvidia NIM ────────────────────────────────
  // Grátis no NIM é só o que a NVIDIA marca "Free Endpoint" (20 dos 81 da API
  // em out/2026), e esses vêm da lista do fetch (ver definirGratisConhecidos).
  // O resto não tem preço público por modelo: custo desconhecido, não zero —
  // até a 0.9.21 todo modelo do NIM saía "free" e custando US$ 0 no painel.
  nim: [
    { prefix: "", pricing: { inputPerMillion: null, outputPerMillion: null, tier: "unknown", asOf: "2026-10" } },
  ],

  // ─────────────────────────── Ollama (local) ────────────────────────────
  // Sempre 0 — roda local sem custo de API.
  ollama: [
    { prefix: "", pricing: { inputPerMillion: 0, outputPerMillion: 0, tier: "free", asOf: "2026-06" } },
  ],
};

/**
 * Retorna pricing do modelo dado o provider. Match por prefixo, ordem do array.
 * Retorna `null` em ambos os campos quando não encontra match.
 */
/** Os grátis de verdade que o fetch descobriu, por provider (OpenRouter pelo
 *  preço, NIM pela marca "Free Endpoint"). O plugin chama ao carregar as
 *  settings e depois de cada fetch; a tabela abaixo não sabe disso sozinha. */
const gratisConhecidos = new Map<string, Set<string>>();

/** "_" e "." são o mesmo modelo (o catálogo da NVIDIA escreve "_"). */
const normalizado = (id: string) => id.toLowerCase().replace(/_/g, ".");

export function definirGratisConhecidos(provider: string, ids: readonly string[]): void {
  gratisConhecidos.set(provider, new Set(ids.map(normalizado)));
}

/** O preço de um id do OpenRouter na tabela do fabricante (ou null). */
function precoDeOrigem(id: string): ModelPricing | null {
  const barra = id.indexOf("/");
  if (barra < 0) return null;
  const casa = id.slice(0, barra);
  const nome = id.slice(barra + 1);
  const origem =
    casa === "openai"
      ? { provider: "openai", model: nome }
      : casa === "anthropic"
        ? { provider: "anthropic", model: nome.replace(/(\d)\.(\d)/g, "$1-$2") }
        : casa === "google"
          ? { provider: "gemini", model: nome }
          : null;
  if (!origem) return null;
  for (const entry of PRICES_BY_PROVIDER[origem.provider] ?? []) {
    if (entry.prefix !== "" && origem.model.startsWith(entry.prefix.toLowerCase())) {
      return { ...entry.pricing };
    }
  }
  return null;
}

export function getPricing(provider: string, model: string): ModelPricing {
  if (!model) return { inputPerMillion: null, outputPerMillion: null, tier: "unknown" };
  const entries = PRICES_BY_PROVIDER[provider];
  if (!entries) return { inputPerMillion: null, outputPerMillion: null, tier: "unknown" };

  const lower = model.toLowerCase();

  // Grátis de verdade que o fetch confirmou: custo zero, seja qual for o nome.
  if (gratisConhecidos.get(provider)?.has(normalizado(model))) {
    return { inputPerMillion: 0, outputPerMillion: 0, tier: "free", asOf: "2026-10" };
  }

  // Caso especial OpenRouter :free
  if (provider === "openrouter" && lower.endsWith(":free")) {
    return { inputPerMillion: 0, outputPerMillion: 0, tier: "free", asOf: "2026-06" };
  }

  // OpenRouter repassa o preço de origem. Os modelos da OpenAI, da Anthropic
  // e do Google usam a tabela DO FABRICANTE — uma segunda tabela aqui perdia
  // as variantes (o openai/gpt-5.4-pro caía no gpt-5.4, 12× mais barato, e
  // furava o teto de gasto). A Anthropic no OpenRouter escreve versão com
  // ponto (claude-opus-4.5); a dela, com hífen.
  if (provider === "openrouter") {
    const daOrigem = precoDeOrigem(lower);
    if (daOrigem) return daOrigem;
  }

  for (const entry of entries) {
    if (entry.prefix === "" || lower.startsWith(entry.prefix.toLowerCase())) {
      return { ...entry.pricing };
    }
  }
  return { inputPerMillion: null, outputPerMillion: null, tier: "unknown" };
}

/**
 * Calcula custo em USD pra uma conversa.
 * - tokens chat: tokensIn * (inputPerMillion / 1e6) + tokensOut * (outputPerMillion / 1e6)
 * - image gen: imagePerCall por chamada (caller passa imageCount opcional)
 * - audio gen: charPerMillion * (charCount / 1e6)
 *
 * Retorna `null` se o pricing for parcial (campos null) e o cálculo não der.
 */
export function calculateCost(
  pricing: ModelPricing,
  tokensIn: number,
  tokensOut: number,
  imageCount = 0,
  charCount = 0,
  /** Do tokensIn, o lido do cache e o gravado nele (cada um com o seu preço). */
  cache: { lido?: number; gravado?: number } = {}
): number | null {
  let cost = 0;
  let hasAnyKnown = false;

  if (pricing.inputPerMillion != null && tokensIn > 0) {
    const lido = Math.min(cache.lido ?? 0, tokensIn);
    const gravado = Math.min(cache.gravado ?? 0, tokensIn - lido);
    const cheio = tokensIn - lido - gravado;
    cost +=
      (cheio * pricing.inputPerMillion +
        lido * (pricing.cachedInputPerMillion ?? pricing.inputPerMillion) +
        gravado * (pricing.cacheWritePerMillion ?? pricing.inputPerMillion)) /
      1_000_000;
    hasAnyKnown = true;
  } else if (tokensIn > 0) {
    return null; // tokens existem mas preço unknown
  }

  if (pricing.outputPerMillion != null && tokensOut > 0) {
    cost += (tokensOut / 1_000_000) * pricing.outputPerMillion;
    hasAnyKnown = true;
  } else if (tokensOut > 0 && pricing.outputPerMillion == null) {
    return null;
  }

  if (pricing.imagePerCall != null && imageCount > 0) {
    cost += imageCount * pricing.imagePerCall;
    hasAnyKnown = true;
  }

  if (pricing.charPerMillion != null && charCount > 0) {
    cost += (charCount / 1_000_000) * pricing.charPerMillion;
    hasAnyKnown = true;
  }

  // Se nenhum campo casou e não tinha o que cobrar mesmo, retorna 0 (não null)
  if (!hasAnyKnown && tokensIn === 0 && tokensOut === 0) return 0;
  return cost;
}

/**
 * Dinheiro do jeito que dinheiro se escreve: duas casas.
 *
 * `formatUsd` existe pra o custo de UMA conversa, onde a quarta casa é o
 * valor inteiro. Ao lado de um orçamento ela vira ruído — "$0.430 of $5.00"
 * parece defeito. Abaixo de um centavo diz "<$0.01" em vez de "$0.00": gastou
 * pouco não é o mesmo que não gastou.
 */
export function formatUsdRounded(n: number | null): string {
  if (n == null) return "—";
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

/** Formata número USD: $0.0023 / $1.42 / $128.50 */
export function formatUsd(n: number | null): string {
  if (n == null) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}

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
  // Fonte: platform.openai.com/docs/pricing (jun/2026)
  openai: [
    // GPT-5 family
    { prefix: "gpt-5-nano", pricing: { inputPerMillion: 0.05, outputPerMillion: 0.40, tier: "paid", asOf: "2026-06" } },
    { prefix: "gpt-5-mini", pricing: { inputPerMillion: 0.25, outputPerMillion: 2.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "gpt-5", pricing: { inputPerMillion: 1.25, outputPerMillion: 10.00, tier: "paid", asOf: "2026-06" } },
    // GPT-4o family
    { prefix: "gpt-4o-mini", pricing: { inputPerMillion: 0.15, outputPerMillion: 0.60, tier: "paid", asOf: "2026-06" } },
    { prefix: "gpt-4o", pricing: { inputPerMillion: 2.50, outputPerMillion: 10.00, tier: "paid", asOf: "2026-06" } },
    // o-series (reasoning)
    { prefix: "o4-mini", pricing: { inputPerMillion: 1.10, outputPerMillion: 4.40, tier: "paid", asOf: "2026-06" } },
    { prefix: "o4", pricing: { inputPerMillion: 7.50, outputPerMillion: 30.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "o3-mini", pricing: { inputPerMillion: 1.10, outputPerMillion: 4.40, tier: "paid", asOf: "2026-06" } },
    { prefix: "o3", pricing: { inputPerMillion: 2.00, outputPerMillion: 8.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "o1-mini", pricing: { inputPerMillion: 1.10, outputPerMillion: 4.40, tier: "paid", asOf: "2026-06" } },
    { prefix: "o1", pricing: { inputPerMillion: 15.00, outputPerMillion: 60.00, tier: "paid", asOf: "2026-06" } },
    // Image gen
    { prefix: "dall-e-3", pricing: { inputPerMillion: null, outputPerMillion: null, imagePerCall: 0.040, tier: "paid", asOf: "2026-06" } },
    { prefix: "dall-e-2", pricing: { inputPerMillion: null, outputPerMillion: null, imagePerCall: 0.020, tier: "paid", asOf: "2026-06" } },
    { prefix: "gpt-image-1", pricing: { inputPerMillion: 5.00, outputPerMillion: 40.00, imagePerCall: 0.042, tier: "paid", asOf: "2026-06" } },
    // TTS
    { prefix: "tts-1-hd", pricing: { inputPerMillion: null, outputPerMillion: null, charPerMillion: 30.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "tts-1", pricing: { inputPerMillion: null, outputPerMillion: null, charPerMillion: 15.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "gpt-4o-mini-tts", pricing: { inputPerMillion: 0.60, outputPerMillion: 12.00, charPerMillion: 12.00, tier: "paid", asOf: "2026-06" } },
  ],

  // ─────────────────────────────── Anthropic ─────────────────────────────
  // Fonte: anthropic.com/pricing (jun/2026)
  anthropic: [
    // Fable 5: preço exato ainda não publicado → tier paid, valores null (UI mostra "—" no custo, mas "PAID" no badge).
    { prefix: "claude-fable-5", pricing: { inputPerMillion: null, outputPerMillion: null, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-opus-4-8", pricing: { inputPerMillion: 15.00, outputPerMillion: 75.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-opus-4", pricing: { inputPerMillion: 15.00, outputPerMillion: 75.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-sonnet-4-6", pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-sonnet-4", pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-haiku-4", pricing: { inputPerMillion: 1.00, outputPerMillion: 5.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-3-5-sonnet", pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-3-5-haiku", pricing: { inputPerMillion: 0.80, outputPerMillion: 4.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-3-opus", pricing: { inputPerMillion: 15.00, outputPerMillion: 75.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-3-sonnet", pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "claude-3-haiku", pricing: { inputPerMillion: 0.25, outputPerMillion: 1.25, tier: "paid", asOf: "2026-06" } },
  ],

  // ─────────────────────────────── Gemini ────────────────────────────────
  // Fonte: ai.google.dev/pricing (jun/2026)
  // Free tier: até 500/dia em 2.5-flash-image (Nano Banana), 1500/dia 2.5-flash
  gemini: [
    // Image generation
    { prefix: "gemini-2.5-flash-image", pricing: { inputPerMillion: 0.30, outputPerMillion: 30.00, imagePerCall: 0.039, tier: "paid", asOf: "2026-06" } },
    { prefix: "imagen-3", pricing: { inputPerMillion: null, outputPerMillion: null, imagePerCall: 0.040, tier: "paid", asOf: "2026-06" } },
    { prefix: "imagen-4", pricing: { inputPerMillion: null, outputPerMillion: null, imagePerCall: 0.040, tier: "paid", asOf: "2026-06" } },
    // TTS
    { prefix: "gemini-2.5-flash-preview-tts", pricing: { inputPerMillion: null, outputPerMillion: null, charPerMillion: 0.50, tier: "free", asOf: "2026-06" } },
    // Chat (Gemini 3.x)
    { prefix: "gemini-3-pro", pricing: { inputPerMillion: 1.25, outputPerMillion: 5.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "gemini-3.5-flash", pricing: { inputPerMillion: 0.075, outputPerMillion: 0.30, tier: "paid", asOf: "2026-06" } },
    { prefix: "gemini-3.1-flash-lite", pricing: { inputPerMillion: 0.05, outputPerMillion: 0.20, tier: "paid", asOf: "2026-06" } },
    // Chat (Gemini 2.5)
    { prefix: "gemini-2.5-pro", pricing: { inputPerMillion: 1.25, outputPerMillion: 5.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "gemini-2.5-flash-lite", pricing: { inputPerMillion: 0.05, outputPerMillion: 0.20, tier: "paid", asOf: "2026-06" } },
    { prefix: "gemini-2.5-flash", pricing: { inputPerMillion: 0.10, outputPerMillion: 0.40, tier: "paid", asOf: "2026-06" } },
    // Chat (Gemini 2.0/1.5)
    { prefix: "gemini-2.0-flash", pricing: { inputPerMillion: 0.10, outputPerMillion: 0.40, tier: "paid", asOf: "2026-06" } },
    { prefix: "gemini-1.5-pro", pricing: { inputPerMillion: 1.25, outputPerMillion: 5.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "gemini-1.5-flash", pricing: { inputPerMillion: 0.075, outputPerMillion: 0.30, tier: "paid", asOf: "2026-06" } },
  ],

  // ─────────────────────────── OpenRouter ────────────────────────────────
  // OpenRouter cobra o mesmo preço do upstream + pequena margem.
  // :free suffix = 0. Outros usam o pricing do provider de origem (aprox).
  openrouter: [
    // Auto Router (OpenRouter cobra o preço do modelo roteado a montante)
    { prefix: "openrouter/auto", pricing: { inputPerMillion: 1.00, outputPerMillion: 3.00, tier: "paid", asOf: "2026-06" } },
    // Anthropic via OR
    { prefix: "anthropic/claude-opus-4", pricing: { inputPerMillion: 15.00, outputPerMillion: 75.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "anthropic/claude-sonnet-4", pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "anthropic/claude-haiku-4", pricing: { inputPerMillion: 1.00, outputPerMillion: 5.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "anthropic/claude-3.5-sonnet", pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "anthropic/claude-3.5-haiku", pricing: { inputPerMillion: 0.80, outputPerMillion: 4.00, tier: "paid", asOf: "2026-06" } },
    // OpenAI via OR
    { prefix: "openai/gpt-5", pricing: { inputPerMillion: 1.25, outputPerMillion: 10.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "openai/gpt-4o-mini", pricing: { inputPerMillion: 0.15, outputPerMillion: 0.60, tier: "paid", asOf: "2026-06" } },
    { prefix: "openai/gpt-4o", pricing: { inputPerMillion: 2.50, outputPerMillion: 10.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "openai/o1", pricing: { inputPerMillion: 15.00, outputPerMillion: 60.00, tier: "paid", asOf: "2026-06" } },
    // Google via OR
    { prefix: "google/gemini-2.5-flash", pricing: { inputPerMillion: 0.10, outputPerMillion: 0.40, tier: "paid", asOf: "2026-06" } },
    { prefix: "google/gemini-2.5-pro", pricing: { inputPerMillion: 1.25, outputPerMillion: 5.00, tier: "paid", asOf: "2026-06" } },
    { prefix: "google/gemini-2.0-flash", pricing: { inputPerMillion: 0.10, outputPerMillion: 0.40, tier: "paid", asOf: "2026-06" } },
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
  charCount = 0
): number | null {
  let cost = 0;
  let hasAnyKnown = false;

  if (pricing.inputPerMillion != null && tokensIn > 0) {
    cost += (tokensIn / 1_000_000) * pricing.inputPerMillion;
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

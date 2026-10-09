// src/providers/openrouter.ts
// Provider OpenRouter — proxy multi-modelo OpenAI-compatible.
// Endpoint: https://openrouter.ai/api/v1/chat/completions
// Auth: Bearer (igual OpenAI)
// Modelos: prefixados por provider — ex: "anthropic/claude-3.5-sonnet", "openai/gpt-4o"
// Streaming SSE no mesmo formato da OpenAI.
//
// Headers extras opcionais (boa prática do OpenRouter):
//   HTTP-Referer: identifica seu site/app
//   X-Title:      nome legível

import { requestUrl } from "obsidian";
import {
  Provider,
  ProviderError,
  ProviderRequest,
  ProviderResponse,
  TokenHandler,
  UsageHandler,
} from "./base";
import { isEmbeddingModelId } from "../rag/types";
import {
  buildChatBody,
  ensureOkStream,
  ensureOkRequest,
  parseOpenAIChatMessage,
  usageFrom,
  parseOpenAICompatSSE,
  streamFallbackToChat,
  hasPdfAttachment,
  fetchStream,
} from "./_shared";
import type { RespostaNoFio } from "./_shared";
import { ehGratisNoOpenRouter, ehPrecoZero, type EntradaOpenRouter } from "./gratisOpenRouter";
// A regra mora em gratisOpenRouter.ts (o cache do catálogo usa a mesma);
// daqui ela segue exportada pra quem já importava deste módulo.
export { ehGratisNoOpenRouter, ehPrecoZero };

// ---- O que o OpenRouter devolve (ver a nota em _shared.ts) ---------------
// O chat fala OpenAI-compatible. O catálogo tem preço junto, e é por ele —
// não pelo sufixo `:free` do nome — que descobrimos o que é grátis de verdade.

interface ModeloOpenRouter {
  id?: unknown;
  pricing?: Record<string, unknown>;
  architecture?: { output_modalities?: unknown };
  description?: unknown;
}

interface CatalogoOpenRouter {
  data?: unknown;
}

/** As entradas com `id` string. Catálogo malformado já chegou daqui. */
function modelosDo(json: unknown): EntradaOpenRouter[] {
  const data = (json as CatalogoOpenRouter | undefined)?.data;
  if (!Array.isArray(data)) return [];
  return (data as ModeloOpenRouter[]).filter(
    (m): m is EntradaOpenRouter => typeof m?.id === "string"
  );
}
import { getModelCapabilities } from "./modelCapabilities";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
/** Os modelos de embedding moram aqui desde 2026 (fora do catálogo geral). */
const OPENROUTER_EMBEDDING_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/embeddings/models";

/** O endereço da próxima página de uma listagem do OpenRouter, se houver. */
export function proximaPagina(json: unknown): string | null {
  const next = (json as { links?: { next?: unknown } } | null)?.links?.next;
  return typeof next === "string" && /^https:\/\/openrouter\.ai\//.test(next) ? next : null;
}

/** A chave (limites, créditos, cota dos grátis). */
const OPENROUTER_KEY_ENDPOINT = "https://openrouter.ai/api/v1/key";

// OpenRouter usa esses headers só pra ATRIBUIÇÃO (aparece no dashboard/ranking
// deles) — não é telemetria nossa. Referer = URL pública real do plugin.
const APP_HEADERS = {
  "HTTP-Referer": "https://github.com/axxalab/axxa-agent",
  "X-Title": "AXXA Agent",
};

/**
 * Plugin file-parser do OpenRouter — só quando a request leva PDF. (v0.1.248)
 *
 * O engine é SEMPRE explícito de propósito: sem ele o OpenRouter cai no
 * `mistral-ocr`, que custa US$ 2 por 1.000 páginas — cobrança silenciosa num
 * plugin que promete "sua key, seu custo". Modelo com visão lê o PDF
 * nativamente (`native`, cobrado como tokens de entrada, que é o esperado);
 * os demais usam `cloudflare-ai`, que é grátis.
 */
export function applyPdfPlugin(
  body: Record<string, unknown>,
  req: ProviderRequest
): Record<string, unknown> {
  if (!hasPdfAttachment(req.messages)) return body;
  const caps = getModelCapabilities("openrouter", req.model);
  body.plugins = [
    {
      id: "file-parser",
      pdf: { engine: caps.vision ? "native" : "cloudflare-ai" },
    },
  ];
  return body;
}

/**
 * Cache de prompt no OpenRouter (só em conversa — ver ProviderRequest.cacheKey).
 *
 * `session_id`: os pedidos da conversa vão pro MESMO provedor de lá — sem
 * isso, um pedido podia cair noutro provedor do mesmo modelo, que não tem o
 * cache. Os Claude (anthropic/…) só guardam em cache se a gente pedir: o
 * `cache_control` no topo é o automático, que anda com a conversa. Os
 * demais (OpenAI, Gemini, DeepSeek, Grok…) guardam sozinhos.
 */
export function aplicarCache(
  body: Record<string, unknown>,
  req: ProviderRequest
): Record<string, unknown> {
  if (!req.cacheKey) return body;
  body.session_id = req.cacheKey.slice(0, 256);
  if (/^~?anthropic\//.test(req.model)) body.cache_control = { type: "ephemeral" };
  return body;
}

export class OpenRouterProvider implements Provider {
  id = "openrouter";
  name = "OpenRouter";
  // OpenRouter é OpenAI-compatible. Tool calling FUNCIONA pra modelos que
  // suportam (Claude, GPT-4o, Gemini, Llama 3.1+, etc). Modelos antigos
  // ignoram tools silenciosamente — agent vai falhar com erro do LLM.
  supportsTools = true;

  async chat(req: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError("OpenRouter API key not configured.", "no-key");
    }

    const body = aplicarCache(
      applyPdfPlugin(buildChatBody(req, { provider: "openrouter" }), req),
      req
    );

    let res;
    try {
      res = await requestUrl({
        url: OPENROUTER_ENDPOINT,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${apiKey.trim()}`, ...APP_HEADERS },
        body: JSON.stringify(body),
        throw: false,
      });
    } catch {
      throw new ProviderError("Connection failed.", "network");
    }
    ensureOkRequest(res, { label: "OpenRouter" });

    const corpo = res.json as RespostaNoFio | undefined;
    const message = corpo?.choices?.[0]?.message;
    if (!message) throw new ProviderError("Empty response.", "unknown");
    const { content, toolCalls, reasoning } = parseOpenAIChatMessage(message);
    if (!toolCalls && !content) {
      throw new ProviderError("Empty response from OpenRouter (no text or tool_calls).", "unknown");
    }
    // v0.1.228: propaga reasoning (DeepSeek R1 & afins expõem reasoning_content
    // em non-stream); antes era descartado aqui.
    return { content, toolCalls, usage: usageFrom(corpo ?? {}), reasoning };
  }

  async streamChat(
    req: ProviderRequest,
    apiKey: string,
    onToken: TokenHandler,
    onUsage?: UsageHandler,
    signal?: AbortSignal,
    onReasoning?: (delta: string) => void
  ): Promise<ProviderResponse> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError("OpenRouter API key not configured.", "no-key");
    }

    const body = aplicarCache(
      applyPdfPlugin(
        buildChatBody(req, {
          provider: "openrouter",
          stream: true,
          includeUsage: true,
        }),
        req
      ),
      req
    );

    let res: Response;
    try {
      res = await fetchStream(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
          ...APP_HEADERS,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      // Falha de CONEXÃO do fetch SSE (típico: CORS no WebView mobile) → cai pro
      // chat() via requestUrl (fura CORS) e emite tudo de uma vez. v0.1.232
      return streamFallbackToChat(
        () => this.chat(req, apiKey),
        onToken,
        onUsage,
        onReasoning
      );
    }
    await ensureOkStream(res, { label: "OpenRouter" });
    if (!res.body) throw new ProviderError("Empty stream.", "unknown");

    return parseOpenAICompatSSE(res.body, onToken, onUsage, "openrouter_call", onReasoning);
  }

  /** Lista modelos modernos do OpenRouter (sem free/auto/etc) */
  async listModels(apiKey: string): Promise<string[]> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError("OpenRouter API key not configured.", "no-key");
    }
    const res = await requestUrl({
      url: OPENROUTER_MODELS_ENDPOINT,
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        ...APP_HEADERS,
      },
      throw: false,
    });
    if (res.status === 401) {
      throw new ProviderError("Invalid OpenRouter API key.", "invalid-key");
    }
    if (res.status < 200 || res.status >= 300) {
      throw new ProviderError(`OpenRouter: HTTP ${res.status}`, "unknown");
    }
    // v0.1.228: guarda contra catálogo malformado — `data` que não é array, ou
    // entradas sem `id` string, fariam o filtro chamar startsWith em undefined.
    const all = modelosDo(res.json).map((m) => m.id);
    return all.filter(isRelevantOpenRouterModel).sort();
  }

  /**
   * Os modelos GRÁTIS de verdade — pelo PREÇO, não pelo nome.
   *
   * O app inteiro reconhecia free pelo sufixo `:free` do id. Isso acerta a
   * maioria e perde os outros: o OpenRouter também publica modelos com
   * `pricing.prompt: "0"` sem sufixo nenhum, e esses simplesmente não
   * existiam pra gente — inclusive pra assistente de criação, que é feita pra
   * rodar em free e ficava sem candidato.
   *
   * O preço vem no mesmo `/models` que já buscamos, então isto não é uma
   * chamada a mais: é olhar um campo que estava ali.
   *
   * Graceful: lista vazia em erro. Não saber quais são grátis é pior que a
   * lista antiga, mas não é motivo pra derrubar o SCAN inteiro.
   */
  /**
   * A cota diária dos modelos grátis NESTA chave. O OpenRouter dá 50 pedidos
   * por dia a quem comprou menos de US$ 10 em créditos e 1.000 a quem comprou
   * mais (fora os 20 por minuto) — o número que a etiqueta "free" precisa
   * mostrar pra não prometer de graça sem fim. Graceful: null em erro.
   */
  async freeQuota(apiKey: string): Promise<{ limit: number; remaining?: number } | null> {
    if (!apiKey || !apiKey.trim()) return null;
    try {
      const res = await requestUrl({
        url: OPENROUTER_KEY_ENDPOINT,
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey.trim()}`, ...APP_HEADERS },
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return null;
      return cotaGratisDaChave(res.json);
    } catch {
      return null;
    }
  }

  /** O estado da chave AGORA (o /api/v1/key): os grátis de hoje e o
   *  crédito. Conta o uso de qualquer app com esta chave, não só o do vault.
   *  Graceful: null em erro. */
  async keyStatus(apiKey: string): Promise<EstadoDaChave | null> {
    if (!apiKey || !apiKey.trim()) return null;
    try {
      const res = await requestUrl({
        url: OPENROUTER_KEY_ENDPOINT,
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey.trim()}`, ...APP_HEADERS },
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return null;
      return estadoDaChave(res.json);
    } catch {
      return null;
    }
  }

  async listFreeModels(apiKey: string): Promise<string[]> {
    if (!apiKey || !apiKey.trim()) return [];
    try {
      const res = await requestUrl({
        url: OPENROUTER_MODELS_ENDPOINT,
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey.trim()}`, ...APP_HEADERS },
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return [];
      return modelosDo(res.json)
        .filter(ehGratisNoOpenRouter)
        .map((m) => m.id)
        .filter(isRelevantOpenRouterModel)
        .sort();
    } catch {
      return [];
    }
  }

  /** Modelos de EMBEDDING do catálogo (pro RAG). Mantém os :free (o embedding
   *  multimodal da NVIDIA no OpenRouter é :free). Graceful: [] em erro/no-key. */
  /**
   * Os modelos de EMBEDDING. Eles têm endereço próprio desde 2026
   * (`/api/v1/embeddings/models`) e saíram do catálogo geral — pelo caminho
   * antigo o fetch voltava sem nenhum. Ali todos são de embedding, então não
   * se filtra por nome (`baai/bge-m3` não tem "embed" no nome). Paginado:
   * segue o `links.next` por algumas páginas. Se o endereço novo falhar,
   * tenta o antigo, filtrando pelo nome.
   */
  async listEmbeddingModels(apiKey: string): Promise<string[]> {
    if (!apiKey || !apiKey.trim()) return [];
    const headers = { Authorization: `Bearer ${apiKey.trim()}`, ...APP_HEADERS };
    try {
      const ids: string[] = [];
      let url: string | null = OPENROUTER_EMBEDDING_MODELS_ENDPOINT;
      for (let pagina = 0; url && pagina < 5; pagina++) {
        const res = await requestUrl({ url, method: "GET", headers, throw: false });
        if (res.status < 200 || res.status >= 300) break;
        ids.push(...modelosDo(res.json).map((m) => m.id));
        url = proximaPagina(res.json);
      }
      if (ids.length > 0) return [...new Set(ids)].sort();
    } catch {
      // cai no caminho antigo
    }
    try {
      const res = await requestUrl({ url: OPENROUTER_MODELS_ENDPOINT, method: "GET", headers, throw: false });
      if (res.status < 200 || res.status >= 300) return [];
      return modelosDo(res.json)
        .map((m) => m.id)
        .filter(isEmbeddingModelId)
        .sort();
    } catch {
      return [];
    }
  }
}

/**
 * Filtro do catálogo OpenRouter (auditoria v0.1.225).
 * O antigo `!id.includes("auto")` excluía QUALQUER modelo com "auto" no nome
 * (falso-positivo), e `!id.includes(":free")` escondia TODAS as variantes
 * grátis — justamente as do onboarding sem cartão. Agora:
 *   - exclui só os pseudo-modelos do roteador ("openrouter/auto", etc);
 *   - exclui embeddings (vão pro listEmbeddingModels);
 *   - MANTÉM ":free" (capabilities marcam free via overlay).
 */
/**
 * O preço zera nos dois lados?
 *
 * O catálogo manda os valores como STRING ("0", "0.0000001"), então comparar
 * com 0 direto falha em silêncio — `"0" == 0` é true por coerção, mas
 * `"0.0000001"` também vira um número que ninguém compara certo sem converter.
 * E um modelo grátis de entrada e pago na saída não é grátis: os dois contam.
 */
/** O que a tela de Uso mostra da chave do OpenRouter. */
export interface EstadoDaChave {
  /** Pedidos grátis de hoje: limite, usados e o que sobra. */
  gratis?: { limite: number; usados?: number; restantes?: number };
  /** Crédito que ainda cabe NA CHAVE (null = a chave não tem teto). */
  creditoRestante?: number | null;
  /** De quanto em quanto o teto da chave volta ("daily", "weekly",
   *  "monthly"); sem isto, ele é um teto só, pra sempre. */
  creditoVolta?: string;
  /** Gasto de hoje, em dólar. */
  gastoHoje?: number;
}

const numero = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Lê o /api/v1/key. Campo que não vem fica de fora — a tela não inventa. */
export function estadoDaChave(json: unknown): EstadoDaChave | null {
  const d = (json as { data?: Record<string, unknown> } | undefined)?.data;
  if (!d || typeof d !== "object") return null;
  const out: EstadoDaChave = {};
  const cota = cotaGratisDaChave(json);
  if (cota) {
    const f = d.free_model_daily_requests as { used?: unknown } | undefined;
    const usados = numero(f?.used);
    out.gratis = {
      limite: cota.limit,
      ...(usados != null ? { usados } : {}),
      ...(cota.remaining != null ? { restantes: cota.remaining } : {}),
    };
  }
  if ("limit_remaining" in d) {
    out.creditoRestante = d.limit_remaining === null ? null : (numero(d.limit_remaining) ?? null);
  }
  if (typeof d.limit_reset === "string" && d.limit_reset) out.creditoVolta = d.limit_reset;
  const hoje = numero(d.usage_daily);
  if (hoje != null) out.gastoHoje = hoje;
  return out;
}

/** A cota dos grátis na resposta do /api/v1/key: o `free_model_daily_requests`
 *  quando vem, senão o `is_free_tier` (sem crédito comprado = 50 por dia). */
export function cotaGratisDaChave(json: unknown): { limit: number; remaining?: number } | null {
  const d = (json as { data?: Record<string, unknown> } | undefined)?.data;
  if (!d || typeof d !== "object") return null;
  const f = d.free_model_daily_requests as { limit?: unknown; remaining?: unknown } | undefined;
  if (f && typeof f.limit === "number" && f.limit > 0) {
    return typeof f.remaining === "number"
      ? { limit: f.limit, remaining: f.remaining }
      : { limit: f.limit };
  }
  if (typeof d.is_free_tier === "boolean") return { limit: d.is_free_tier ? 50 : 1000 };
  return null;
}

export function isRelevantOpenRouterModel(id: string): boolean {
  if (id.startsWith("openrouter/")) return false; // auto-router etc
  if (isEmbeddingModelId(id)) return false;
  return true;
}

export const openrouterProvider = new OpenRouterProvider();

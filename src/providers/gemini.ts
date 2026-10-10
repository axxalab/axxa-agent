// src/providers/gemini.ts
// Provider Google Gemini — via endpoint OpenAI-compatible do Google AI.
// Endpoint: https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
// Auth: Bearer ${GEMINI_API_KEY} (chave do aistudio.google.com/apikey)
//
// Por que OpenAI-compat e não /generateContent nativo?
//   - Reuso TOTAL de toOpenAIMessages() + parser SSE existentes
//   - Tool calling funciona no mesmo formato (tools[] + tool_choice:"auto")
//   - Trade-off: perde features Gemini-only (grounding, thinking budget,
//     native multimodal de vídeo). Migrar pra generateContent vira upgrade
//     futuro se algum cliente pedir.
//
// Modelos com tool calling validado: gemini-2.5-pro, 2.5-flash, 2.5-flash-lite,
// 3.5-flash, 3.1-flash-lite. Modelos *-tts, *-live, *-image, *-embedding são
// pulados no listModels (não são chat).

import { requestUrl } from "obsidian";
import {
  Provider,
  ProviderError,
  ProviderRequest,
  ProviderResponse,
  TokenHandler,
  UsageHandler,
  MediaGenerationRequest,
  MediaGenerationItem,
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
  fetchStream,
} from "./_shared";
import type { ErroNoFio, RespostaNoFio } from "./_shared";

// ---- O que a Gemini devolve (ver a nota em _shared.ts) -------------------
// O chat fala OpenAI-compatible; imagem e catálogo têm forma própria.

/** Parte de conteúdo do endpoint de imagem — dois shapes, camel e snake. */
interface ParteDeImagem {
  inlineData?: { data: string; mimeType: string };
  inline_data?: { data: string; mime_type: string };
  text?: string;
}

interface RespostaDeImagem extends ErroNoFio {
  candidates?: Array<{ content?: { parts?: ParteDeImagem[] } }>;
}

interface RespostaImagen extends ErroNoFio {
  predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
}

/** Catálogo de modelos. `id` chega como unknown porque já foi visto ausente. */
interface CatalogoGemini {
  data?: Array<{ id?: unknown }>;
}

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_MODELS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/models";
// Endpoint nativo do Gemini pra image generation ("Nano Banana" e Imagen).
// Usa /v1beta porque /v1 reclama "Unknown name 'responseModalities'" (não
// suporta image gen ainda). Confirmado via ai.google.dev/api/generate-content
// que tudo de generation passa por v1beta com fields snake_case.
const GEMINI_NATIVE_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Detecta o "muro" de billing do Gemini (free tier / sem billing ativo na API).
 *
 * Contexto (v0.1.162): a assinatura CONSUMER (Google AI Pro/Ultra) NÃO cobre a
 * Gemini API — ela é cobrada à parte no AI Studio (Cloud Billing / Prepay).
 * Quando o user só tem a assinatura, a API responde com erro de quota/billing.
 * A ação certa nesse caso é "ativar billing", não "tentar de novo" — por isso
 * mapeamos pro código `billing` (bolha de erro com botão dedicado).
 *
 * - Frases fortes (billed users / paid tier / billing / FAILED_PRECONDITION /
 *   free tier) → billing em QUALQUER contexto.
 * - context="image": 429 com quota/credit é quase sempre free-tier barrando
 *   modelos de imagem (Imagen/Nano Banana não entram no free tier) → billing.
 *   No chat deixamos 429 genérico como rate-limit (pode ser limite real numa
 *   conta JÁ paga).
 */
export function isGeminiBillingError(
  status: number,
  message: string,
  context: "chat" | "image"
): boolean {
  const m = (message || "").toLowerCase();
  if (
    m.includes("billed users") ||
    m.includes("paid tier") ||
    m.includes("only available on the paid") ||
    m.includes("only accessible to billed")
  ) {
    return true;
  }
  // No chat, o 429 de cota do Google SEMPRE cita "billing details" e a métrica
  // do plano grátis (…free_tier_requests) — inclusive quando é só o teto do
  // dia de quem usa o plano grátis. Cobrança é quando a cota grátis do modelo
  // é ZERO ("limit: 0": o modelo não tem plano grátis); com teto acima de
  // zero é limite de uso, e o aviso certo é "espere", não "ative a cobrança".
  if (context === "chat" && status === 429) {
    return /free[_ ]tier/.test(m) && /\blimit:\s*0\b/.test(m);
  }
  if (
    m.includes("billing") ||
    m.includes("failed_precondition") ||
    m.includes("free tier") ||
    m.includes("free_tier")
  ) {
    return true;
  }
  if (
    context === "image" &&
    status === 429 &&
    (m.includes("quota") || m.includes("credit"))
  ) {
    return true;
  }
  return false;
}

export class GeminiProvider implements Provider {
  id = "gemini";
  name = "Gemini";
  // OpenAI-compat endpoint do Google aceita tools[] + tool_choice
  // exatamente igual à OpenAI. Funciona nos modelos 2.5+ e 3.x.
  supportsTools = true;

  async chat(req: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError("Gemini API key not configured.", "no-key");
    }
    const body = buildChatBody(req, { provider: "gemini" });

    let res;
    try {
      res = await requestUrl({
        url: GEMINI_ENDPOINT,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify(body),
        throw: false,
      });
    } catch {
      throw new ProviderError("Connection failed.", "network");
    }
    // Muro de billing ANTES do mapeamento genérico (senão 429 vira rate-limit).
    if (res.status >= 400) {
      const detail = (res.json as ErroNoFio | undefined)?.error?.message ?? "";
      if (isGeminiBillingError(res.status, detail, "chat")) {
        throw new ProviderError(`Gemini billing: ${detail}`, "billing");
      }
    }
    ensureOkRequest(res, { label: "Gemini", authStatuses: [401, 403] });

    const corpo = res.json as RespostaNoFio | undefined;
    const message = corpo?.choices?.[0]?.message;
    if (!message) throw new ProviderError("Empty response from Gemini.", "unknown");
    const { content, toolCalls } = parseOpenAIChatMessage(message);
    if (!toolCalls && !content) {
      throw new ProviderError("Empty response from Gemini (no text or tool_calls).", "unknown");
    }
    return { content, toolCalls, usage: usageFrom(corpo ?? {}) };
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
      throw new ProviderError(
        "Gemini API key not configured. Create one at aistudio.google.com/apikey.",
        "no-key"
      );
    }

    const body = buildChatBody(req, {
      provider: "gemini",
      stream: true,
      includeUsage: true,
    });

    let res: Response;
    try {
      res = await fetchStream(GEMINI_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
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
    // Billing primeiro (lê uma cópia do corpo; ensureOkStream ainda lê o original).
    if (!res.ok) {
      // v0.1.228: só aciona billing se houver mensagem de erro REAL. Antes,
      // JSON.stringify(j ?? "") transformava um corpo sem .error.message em
      // texto cru ("null"/objeto inteiro) — ruído inútil no detail.
      try {
        const j = (await res.clone().json()) as ErroNoFio;
        const msg = j?.error?.message;
        if (typeof msg === "string" && isGeminiBillingError(res.status, msg, "chat")) {
          throw new ProviderError(`Gemini billing: ${msg}`, "billing");
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        /* corpo não-JSON — segue pro mapeamento padrão */
      }
    }
    await ensureOkStream(res, { label: "Gemini", authStatuses: [401, 403] });
    if (!res.body) throw new ProviderError("Empty stream from Gemini.", "unknown");

    return parseOpenAICompatSSE(res.body, onToken, onUsage, "gemini_call", onReasoning);
  }

  /**
   * Gera imagem via Gemini Nano Banana (gemini-2.5-flash-image) ou Imagen.
   * Endpoint nativo:  /v1/models/{model}:generateContent
   *
   * Quirks confirmados via webfetch (ai.google.dev/gemini-api/docs/image-generation):
   *  - **responseModalities** precisa de `["TEXT", "IMAGE"]`, não só `["IMAGE"]`
   *  - **Endpoint** é `/v1/` (não `/v1beta/`) pro Nano Banana
   *  - **Response shape** usa `inlineData` (camelCase) no JSON
   *  - **Model ID** correto é `gemini-2.5-flash-image` (sem "-preview")
   *
   * Body:
   *   {
   *     contents: [{ parts: [{ text: prompt }] }],
   *     generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
   *   }
   *
   * Response: candidates[0].content.parts[i].inlineData.{data, mimeType}
   */
  async generateImage(
    request: MediaGenerationRequest,
    apiKey: string
  ): Promise<MediaGenerationItem[]> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError(
        "Gemini API key not configured.",
        "no-key"
      );
    }
    // Imagen usa um contrato DIFERENTE do Nano Banana: `:predict` com
    // instances/parameters (não `:generateContent` + responseModalities).
    // Mandar Imagen pro generateContent dava HTTP 400 na hora. v0.1.163
    if (request.model.startsWith("imagen-")) {
      return this.generateWithImagen(request, apiKey);
    }
    // v0.1.228: chave vai no header x-goog-api-key (não na query string —
    // evita vazar a key em logs/proxies), igual ao chat. Model id é
    // URL-encoded no path por segurança.
    const url = `${GEMINI_NATIVE_BASE}/${encodeURIComponent(request.model)}:generateContent`;
    // CRÍTICO: API v1beta exige snake_case nos campos.
    // Erro observado: "Unknown name 'responseModalities' at 'generation_config'"
    // → mudar pra response_modalities (snake_case) resolve.
    // Também precisa de TEXT + IMAGE (só IMAGE retorna parts vazio).
    // IMG2IMG: se veio imagem de entrada, anexa como inline_data — o Nano Banana
    // EDITA a imagem seguindo o prompt em vez de gerar do zero. v0.1.165
    const inputParts: Array<Record<string, unknown>> = [{ text: request.prompt }];
    if (request.image) {
      inputParts.push({
        inline_data: {
          mime_type: request.image.mimeType,
          data: request.image.data,
        },
      });
    }
    const body = {
      contents: [{ parts: inputParts }],
      generation_config: {
        response_modalities: ["TEXT", "IMAGE"],
        ...(request.seed != null ? { seed: request.seed } : {}),
      },
    };
    let res;
    try {
      res = await requestUrl({
        url,
        method: "POST",
        contentType: "application/json",
        headers: { "x-goog-api-key": apiKey.trim() },
        body: JSON.stringify(body),
        throw: false,
      });
    } catch (err) {
      console.error("[axxa] Gemini image gen network error:", err);
      throw new ProviderError("Connection failed.", "network");
    }
    if (res.status < 200 || res.status >= 300) {
      const detail =
        (res.json as ErroNoFio | undefined)?.error?.message ??
        (typeof res.text === "string" ? res.text.slice(0, 240) : null) ??
        `HTTP ${res.status}`;
      console.error("[axxa] Gemini image gen failed:", res.status, res.json ?? res.text);
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError("Invalid Gemini API key.", "invalid-key");
      }
      // Muro de billing: modelos de imagem (Imagen/Nano Banana) NÃO entram no
      // free tier — sem billing ativo na API o request é barrado. A assinatura
      // consumer (AI Pro/Ultra) não cobre a API. Ação certa = ativar billing.
      if (isGeminiBillingError(res.status, detail, "image")) {
        throw new ProviderError(`Gemini billing: ${detail}`, "billing");
      }
      if (res.status === 429) {
        throw new ProviderError("Gemini rate limit.", "rate-limit");
      }
      throw new ProviderError(`Gemini images (${res.status}): ${detail}`, "unknown");
    }
    // Aceita ambos os shapes: inlineData (camelCase, comum em REST JS clients)
    // OU inline_data (snake_case, formato cru REST)
    const imagem = res.json as RespostaDeImagem | undefined;
    const parts: ParteDeImagem[] =
      imagem?.candidates?.[0]?.content?.parts ?? [];
    const items: MediaGenerationItem[] = [];
    let textAccum = "";
    for (const p of parts) {
      const inline = p.inlineData ?? (
        p.inline_data
          ? { data: p.inline_data.data, mimeType: p.inline_data.mime_type }
          : null
      );
      if (inline?.data) {
        const data = base64ToBytes(inline.data);
        items.push({
          data,
          mime: inline.mimeType || "image/png",
        });
      } else if (p.text) {
        textAccum += p.text;
      }
    }
    if (items.length === 0) {
      // Erro mais claro: cita modelo + sugere usar gemini-2.5-flash-image
      throw new ProviderError(
        `Gemini "${request.model}" returned no images. ` +
          `Confirmed image gen models: gemini-2.5-flash-image (Nano Banana), imagen-3.0-generate-002.`,
        "unknown"
      );
    }
    // Anexa o texto auxiliar (se houver) no primeiro item
    if (textAccum && items[0]) items[0].text = textAccum;
    return items;
  }

  /**
   * Gera imagem com modelos **Imagen** (imagen-3.0/4.0) — contrato `:predict`.
   *
   * Confirmado via ai.google.dev/gemini-api/docs/imagen:
   *  - POST /v1beta/models/{model}:predict
   *  - body: { instances: [{ prompt }], parameters: { sampleCount, aspectRatio,
   *    personGeneration } }
   *  - response: { predictions: [{ bytesBase64Encoded, mimeType }] }
   *
   * Imagen NÃO entra no free tier → conta sem billing ativo é barrada (erro
   * billing/FAILED_PRECONDITION, capturado por isGeminiBillingError). v0.1.163
   */
  private async generateWithImagen(
    request: MediaGenerationRequest,
    apiKey: string
  ): Promise<MediaGenerationItem[]> {
    // v0.1.228: chave no header x-goog-api-key (não na query string) + model id
    // URL-encoded no path, igual ao generateContent.
    const url = `${GEMINI_NATIVE_BASE}/${encodeURIComponent(request.model)}:predict`;
    const body = {
      instances: [{ prompt: request.prompt }],
      parameters: {
        sampleCount: request.n ?? 1,
        aspectRatio: sizeToImagenAspect(request.size),
        personGeneration: "allow_adult",
      },
    };
    let res;
    try {
      res = await requestUrl({
        url,
        method: "POST",
        contentType: "application/json",
        headers: { "x-goog-api-key": apiKey.trim() },
        body: JSON.stringify(body),
        throw: false,
      });
    } catch (err) {
      console.error("[axxa] Imagen network error:", err);
      throw new ProviderError("Connection failed.", "network");
    }
    if (res.status < 200 || res.status >= 300) {
      const detail =
        (res.json as ErroNoFio | undefined)?.error?.message ??
        (typeof res.text === "string" ? res.text.slice(0, 240) : null) ??
        `HTTP ${res.status}`;
      console.error("[axxa] Imagen gen failed:", res.status, res.json ?? res.text);
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError("Invalid Gemini API key.", "invalid-key");
      }
      if (isGeminiBillingError(res.status, detail, "image")) {
        throw new ProviderError(`Gemini billing: ${detail}`, "billing");
      }
      if (res.status === 429) {
        throw new ProviderError("Gemini rate limit.", "rate-limit");
      }
      throw new ProviderError(`Imagen (${res.status}): ${detail}`, "unknown");
    }
    const preds = (res.json as RespostaImagen | undefined)?.predictions ?? [];
    const items: MediaGenerationItem[] = [];
    for (const p of preds) {
      if (p.bytesBase64Encoded) {
        items.push({
          data: base64ToBytes(p.bytesBase64Encoded),
          mime: p.mimeType || "image/png",
        });
      }
    }
    if (items.length === 0) {
      throw new ProviderError(
        `Imagen "${request.model}" returned no images (response has no predictions).`,
        "unknown"
      );
    }
    return items;
  }

  /**
   * Lista modelos Gemini relevantes (chat + image gen + TTS).
   * Alguns endpoints retornam IDs prefixados com "models/" — normalizamos.
   */
  async listModels(apiKey: string): Promise<string[]> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError(
        "Gemini API key not configured.",
        "no-key"
      );
    }
    const res = await requestUrl({
      url: GEMINI_MODELS_ENDPOINT,
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      throw: false,
    });
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError("Invalid Gemini API key.", "invalid-key");
    }
    if (res.status < 200 || res.status >= 300) {
      throw new ProviderError(`Gemini: HTTP ${res.status}`, "unknown");
    }
    // v0.1.228: guarda contra id ausente/não-string antes do .startsWith/.slice
    // (alinha com o padrão do anthropic.ts).
    const all: string[] = ((res.json as CatalogoGemini | undefined)?.data ?? [])
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === "string");
    return all
      .map((id) => (id.startsWith("models/") ? id.slice(7) : id))
      .filter(isRelevantGeminiModel)
      .sort();
  }

  /** Modelos de EMBEDDING do catálogo (pro RAG). Graceful: [] em erro/no-key. */
  async listEmbeddingModels(apiKey: string): Promise<string[]> {
    if (!apiKey || !apiKey.trim()) return [];
    try {
      const res = await requestUrl({
        url: GEMINI_MODELS_ENDPOINT,
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return [];
      // v0.1.228: mesma guarda de string do listModels.
      const all: string[] = ((res.json as CatalogoGemini | undefined)?.data ?? [])
        .map((m) => m?.id)
        .filter((id): id is string => typeof id === "string");
      return all
        .map((id) => (id.startsWith("models/") ? id.slice(7) : id))
        .filter(isEmbeddingModelId)
        .sort();
    } catch {
      return [];
    }
  }
}

/**
 * Mantém modelos relevantes — chat, image gen (Nano Banana / Imagen),
 * TTS (gemini-*-preview-tts) e Veo (video gen).
 * Filtra só embed e legacy (aqa).
 */
function isRelevantGeminiModel(id: string): boolean {
  // Chat / multimodal
  if (id.startsWith("gemini-")) {
    if (id.includes("embedding") || id.includes("aqa") || id.includes("live")) return false;
    return true;
  }
  // Image generation
  if (id.startsWith("imagen-")) return true;
  // Video generation
  if (id.startsWith("veo")) return true;
  return false;
}

/** size canonical → aspectRatio aceito pelo Imagen (1:1, 9:16, 16:9, 3:4, 4:3). */
function sizeToImagenAspect(size?: string): string {
  switch (size) {
    case "1024x1792":
      return "9:16";
    case "1792x1024":
      return "16:9";
    case "512x512":
    case "1024x1024":
    case "auto":
    case undefined:
      return "1:1";
    default:
      return "1:1";
  }
}

/** Decode base64 → Uint8Array. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const geminiProvider = new GeminiProvider();

// src/providers/openai.ts
// Provider OpenAI — duas modalidades:
//   chat()       — não-streaming, usa requestUrl (sem CORS, mas espera resposta completa)
//   streamChat() — streaming SSE, usa fetch (ReadableStream, token a token)
//
// Por que dois? requestUrl não suporta streaming. fetch suporta mas pode ter CORS
// em alguns contextos. OpenAI permite CORS via Bearer auth, então fetch funciona.

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
  ehRecusaDeRaciocinioComFerramentas,
  lembrarSemRaciocinioComFerramentas,
} from "./paramPolicy";
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
// Reexporta os helpers compartilhados (gemini/nim/openrouter importavam daqui).
export { toOpenAIMessages, finalizeOpenAIResponse } from "./_shared";
import type { ErroNoFio, RespostaNoFio } from "./_shared";

// ---- O que a OpenAI devolve (ver a nota em _shared.ts) -------------------

interface ItemDeImagem {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

interface RespostaDeImagemOpenAI extends ErroNoFio {
  data?: unknown;
}

interface CatalogoOpenAI {
  data?: Array<{ id?: unknown }>;
}

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

/**
 * A OpenAI guarda o começo do pedido em cache sozinha (a partir de 1.024
 * tokens), mas só acerta se o pedido cair na máquina que guardou. A
 * `prompt_cache_key` entra no roteamento: com a conversa como chave, os
 * pedidos dela vão pro mesmo lugar e o histórico sai pelo preço de cache.
 */
export function comChaveDeCache(
  body: Record<string, unknown>,
  req: ProviderRequest
): Record<string, unknown> {
  if (req.cacheKey) body.prompt_cache_key = req.cacheKey;
  return body;
}

/**
 * A OpenAI recusou ferramentas com raciocínio pra este modelo (o GPT-5.4 em
 * diante faz isso no /chat/completions; a regra em paramPolicy cobre os
 * conhecidos). Um modelo que a regra ainda não conhecia aprende aqui: fica
 * lembrado, e o corpo vai de novo — uma vez — com `reasoning_effort: "none"`.
 */
function recusouRaciocinioComFerramentas(
  err: unknown,
  body: Record<string, unknown>,
  model: string
): boolean {
  if (!(err instanceof ProviderError)) return false;
  if (!body.tools || body.reasoning_effort === undefined || body.reasoning_effort === "none") {
    return false;
  }
  if (!ehRecusaDeRaciocinioComFerramentas(err.message)) return false;
  lembrarSemRaciocinioComFerramentas(model);
  body.reasoning_effort = "none";
  return true;
}
const OPENAI_MODELS_ENDPOINT = "https://api.openai.com/v1/models";
const OPENAI_IMAGES_ENDPOINT = "https://api.openai.com/v1/images/generations";
const OPENAI_AUDIO_SPEECH_ENDPOINT = "https://api.openai.com/v1/audio/speech";

export class OpenAIProvider implements Provider {
  id = "openai";
  name = "OpenAI";
  supportsTools = true;

  async chat(req: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError("OpenAI API key not configured.", "no-key");
    }
    const body = comChaveDeCache(
      buildChatBody(req, {
        provider: "openai",
        maxTokensField: "max_completion_tokens", // gpt-4o+ exigem (max_tokens deprecado)
      }),
      req
    );

    const pedir = async () => {
      let r;
      try {
        r = await requestUrl({
          url: OPENAI_ENDPOINT,
          method: "POST",
          contentType: "application/json",
          headers: { Authorization: `Bearer ${apiKey.trim()}` },
          body: JSON.stringify(body),
          throw: false,
        });
      } catch {
        throw new ProviderError("Connection failed. Check your internet.", "network");
      }
      ensureOkRequest(r, { label: "OpenAI" });
      return r;
    };
    let res;
    try {
      res = await pedir();
    } catch (err) {
      if (!recusouRaciocinioComFerramentas(err, body, req.model)) throw err;
      res = await pedir();
    }

    const corpo = res.json as RespostaNoFio | undefined;
    const message = corpo?.choices?.[0]?.message;
    if (!message) throw new ProviderError("Empty response from OpenAI.", "unknown");
    const { content, toolCalls } = parseOpenAIChatMessage(message);
    if (!toolCalls && !content) {
      throw new ProviderError("Empty response from OpenAI (no text or tool_calls).", "unknown");
    }
    return { content, toolCalls, usage: usageFrom(corpo ?? {}) };
  }

  /**
   * Streaming SSE — chama onToken pra cada delta recebido.
   * Retorna ProviderResponse com o estado FINAL acumulado: content total,
   * toolCalls (se houve) e usage. Agent mode usa esse retorno pra decidir
   * se executa tools ou se a resposta tá completa.
   *
   * Lança ProviderError em falhas e AbortError quando o signal aborta.
   * O caller deve tratar AbortError como cancelamento intencional.
   */
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
        "OpenAI API key not configured. Go to Settings → AXXA Agent to paste your key.",
        "no-key"
      );
    }

    const body = comChaveDeCache(
      buildChatBody(req, {
        provider: "openai",
        stream: true,
        includeUsage: true,
        maxTokensField: "max_completion_tokens",
      }),
      req
    );

    const abrir = () =>
      fetchStream(OPENAI_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    let res: Response;
    try {
      res = await abrir();
    } catch (err) {
      // AbortError sobe sem mudar pra ProviderError — caller distingue
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
    try {
      await ensureOkStream(res, { label: "OpenAI" });
    } catch (err) {
      if (!recusouRaciocinioComFerramentas(err, body, req.model)) throw err;
      res = await abrir();
      await ensureOkStream(res, { label: "OpenAI" });
    }
    if (!res.body) throw new ProviderError("Empty stream from OpenAI.", "unknown");

    return parseOpenAICompatSSE(res.body, onToken, onUsage, "openai_call", onReasoning);
  }

  /**
   * Gera imagem via DALL-E 3 ou gpt-image-1.
   * Endpoint: /v1/images/generations.
   *
   * Quirks confirmados via webfetch:
   *  - **gpt-image-1** NÃO aceita `response_format` — sempre devolve `b64_json`.
   *    Mandar o param dá erro 400 "Unknown parameter: response_format".
   *  - **DALL-E 3** aceita só sizes `1024x1024`, `1024x1792`, `1792x1024`.
   *  - **DALL-E 2** aceita `256x256`, `512x512`, `1024x1024`.
   *  - **gpt-image-1** aceita `1024x1024`, `1024x1536`, `1536x1024`, `auto`.
   */
  async generateImage(
    request: MediaGenerationRequest,
    apiKey: string
  ): Promise<MediaGenerationItem[]> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError("OpenAI API key not configured.", "no-key");
    }
    const isGptImage = request.model.startsWith("gpt-image");
    const isDallE3 = request.model.startsWith("dall-e-3");

    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      n: request.n ?? 1,
      size: request.size && request.size !== "auto" ? request.size : "1024x1024",
    };
    // gpt-image-1 NÃO aceita response_format (sempre b64_json). DALL-E aceita.
    if (!isGptImage) {
      body.response_format = "b64_json";
    }
    // DALL-E 3 só gera 1 imagem por chamada
    if (isDallE3) body.n = 1;

    // Retry com backoff em 500 (server-side transitório). 3 tentativas, 1s/2s/4s.
    let res;
    let attempt = 0;
    const MAX_ATTEMPTS = 3;
    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      try {
        res = await requestUrl({
          url: OPENAI_IMAGES_ENDPOINT,
          method: "POST",
          contentType: "application/json",
          headers: { Authorization: `Bearer ${apiKey.trim()}` },
          body: JSON.stringify(body),
          throw: false,
        });
      } catch (err) {
        console.error("[axxa] OpenAI image gen network error:", err);
        throw new ProviderError("Connection failed during generation.", "network");
      }
      if (res.status < 500 || attempt >= MAX_ATTEMPTS) break;
      // 500/502/503 → retry com backoff exponencial
      console.warn(`[axxa] OpenAI image gen ${res.status}, retry ${attempt}/${MAX_ATTEMPTS}`);
      await new Promise((r) => window.setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
    if (!res) {
      throw new ProviderError("OpenAI images: no response.", "unknown");
    }
    if (res.status < 200 || res.status >= 300) {
      console.error("[axxa] OpenAI image gen failed:", res.status, res.json ?? res.text);
    }
    if (res.status === 401) {
      throw new ProviderError("Invalid API key.", "invalid-key");
    }
    if (res.status === 403) {
      // Verifica se é problema de org verification (gpt-image-1)
      const apiMsg = (res.json as ErroNoFio | undefined)?.error?.message ?? "";
      const isOrgIssue = /verif|organization/i.test(apiMsg);
      if (isOrgIssue || isGptImage) {
        throw new ProviderError(
          `OpenAI: organization not verified for ${request.model}. ` +
            `Go to platform.openai.com → Settings → Organization → General → "Verify Organization" ` +
            `(requires a phone + valid ID). After verifying, wait up to 30 min and try again.`,
          "invalid-key"
        );
      }
      throw new ProviderError(`OpenAI: access denied. ${apiMsg}`, "invalid-key");
    }
    if (res.status === 429) {
      throw new ProviderError("OpenAI rate limit.", "rate-limit");
    }
    if (res.status >= 500) {
      throw new ProviderError(
        `OpenAI server issue (${res.status}). ` +
          `May be a temporary incident — check status.openai.com. ` +
          `Retried ${MAX_ATTEMPTS} times with backoff.`,
        "unknown"
      );
    }
    if (res.status < 200 || res.status >= 300) {
      const msg =
        (res.json as ErroNoFio | undefined)?.error?.message ??
        (typeof res.text === "string" ? res.text.slice(0, 240) : null) ??
        `HTTP ${res.status}`;
      throw new ProviderError(`OpenAI images (${res.status}): ${msg}`, "unknown");
    }
    const items = (res.json as RespostaDeImagemOpenAI | undefined)?.data;
    if (!Array.isArray(items) || items.length === 0) {
      throw new ProviderError("OpenAI: response had no images (empty data).", "unknown");
    }
    // v0.1.228: quando o size pedido era 'auto' (gpt-image-1), a API escolhe a
    // dimensão real — não fixe 1024x1024. Deixa width/height undefined; o
    // consumidor lê as dimensões reais dos bytes do PNG se precisar.
    const sizeRequested = request.size && request.size !== "auto" ? body.size as string : "";
    const [width, height] = parseSize(sizeRequested);
    return (items as ItemDeImagem[]).map((it) => {
      const b64 = it.b64_json ?? "";
      if (!b64) {
        // Fallback se vier `url` em vez de b64 (caso raro)
        throw new ProviderError(
          "OpenAI: image returned without b64_json (url only). URL fetch not implemented.",
          "unknown"
        );
      }
      const data = base64ToBytes(b64);
      return {
        data,
        mime: "image/png",
        width,
        height,
        text: it.revised_prompt,
      };
    });
  }

  /**
   * Gera áudio (TTS) via /v1/audio/speech.
   * Modelos: tts-1, tts-1-hd, gpt-4o-mini-tts. Voice default "alloy".
   * Retorna 1 item (a API só gera 1 saída por chamada).
   */
  async generateAudio(
    request: MediaGenerationRequest,
    apiKey: string
  ): Promise<MediaGenerationItem[]> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError("OpenAI API key not configured.", "no-key");
    }
    const body: Record<string, unknown> = {
      model: request.model,
      input: request.prompt,
      voice: request.voice ?? "alloy",
      response_format: "mp3",
    };
    let res;
    try {
      res = await requestUrl({
        url: OPENAI_AUDIO_SPEECH_ENDPOINT,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify(body),
        throw: false,
      });
    } catch {
      throw new ProviderError("TTS connection failed.", "network");
    }
    if (res.status === 401) {
      throw new ProviderError("Invalid API key.", "invalid-key");
    }
    if (res.status === 429) {
      throw new ProviderError("OpenAI TTS rate limit.", "rate-limit");
    }
    if (res.status < 200 || res.status >= 300) {
      const msg =
        (res.json as ErroNoFio | undefined)?.error?.message ?? `HTTP ${res.status}`;
      throw new ProviderError(`OpenAI TTS: ${msg}`, "unknown");
    }
    // Retorna binário (audio/mpeg). res.arrayBuffer é o buffer cru.
    const buf = res.arrayBuffer;
    const data = new Uint8Array(buf);
    return [{ data, mime: "audio/mpeg" }];
  }

  /**
   * Lista modelos relevantes (modernos) da OpenAI.
   * Filtra legacy / audio / embeddings / etc.
   */
  async listModels(apiKey: string): Promise<string[]> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError("OpenAI API key not configured.", "no-key");
    }
    const res = await requestUrl({
      url: OPENAI_MODELS_ENDPOINT,
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      throw: false,
    });
    if (res.status === 401) {
      throw new ProviderError("Invalid API key.", "invalid-key");
    }
    if (res.status < 200 || res.status >= 300) {
      throw new ProviderError(`OpenAI: HTTP ${res.status}`, "unknown");
    }
    // v0.1.228: a API pode trazer item sem `id` string — filtra antes do
    // filtro de relevância pra não passar undefined/non-string adiante.
    const all: string[] = ((res.json as CatalogoOpenAI | undefined)?.data ?? [])
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === "string");
    return all.filter(isRelevantOpenAIModel).sort();
  }

  /** Modelos de EMBEDDING do catálogo (pro RAG). Graceful: [] em erro/no-key. */
  async listEmbeddingModels(apiKey: string): Promise<string[]> {
    if (!apiKey || !apiKey.trim()) return [];
    try {
      const res = await requestUrl({
        url: OPENAI_MODELS_ENDPOINT,
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return [];
      const all: string[] = ((res.json as CatalogoOpenAI | undefined)?.data ?? [])
        .map((m) => m?.id)
        .filter((id): id is string => typeof id === "string");
      return all.filter(isEmbeddingModelId).sort();
    } catch {
      return [];
    }
  }
}

/** Mantém modelos relevantes — chat moderno + image gen (DALL-E, gpt-image)
 *  + TTS (tts-*, gpt-4o-mini-tts). Filtra só embed/legacy/moderation.
 *  Auditoria v0.1.225: o filtro antigo perdia gpt-4.1*, gpt-4-turbo,
 *  chatgpt-4o-latest, gpt-3.5-turbo e o-series futuras (o5+); e "preview"
 *  derrubava modelos de chat legítimos (o1-preview, gpt-4.5-preview). */
export function isRelevantOpenAIModel(id: string): boolean {
  // Generation PRIMEIRO (gpt-4o-mini-tts casaria com o branch de chat e seria
  // excluído pelo keyword "tts" antes de chegar aqui).
  if (id.startsWith("dall-e") || id.startsWith("gpt-image")) return true;
  if (id === "tts-1" || id === "tts-1-hd" || id.startsWith("gpt-4o-mini-tts"))
    return true;
  // Chat — famílias gpt-3.5/4/5, chatgpt-* e o-series (qualquer número).
  if (
    /^gpt-(3\.5-turbo|4|5)/.test(id) ||
    /^chatgpt-/.test(id) ||
    /^o[0-9]+(-|$)/.test(id)
  ) {
    const excludeKeywords = [
      "audio",
      "realtime",
      "transcribe",
      "search",
      "vision", // gpt-4-vision-preview (deprecado)
      "instruct", // API /completions, não /chat
      "moderation",
      "tts", // TTS já tratado acima
    ];
    return !excludeKeywords.some((kw) => id.includes(kw));
  }
  return false;
}

/** Helper: parse "1024x1024" → [1024, 1024]. */
function parseSize(s: string): [number | undefined, number | undefined] {
  const m = /^(\d+)x(\d+)$/.exec(s);
  if (!m) return [undefined, undefined];
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

/** Decode base64 → Uint8Array. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const openaiProvider = new OpenAIProvider();

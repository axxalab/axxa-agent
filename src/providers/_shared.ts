// src/providers/_shared.ts
// Núcleo COMPARTILHADO dos providers (v0.1.156). Os providers OpenAI-compatible
// (openai/gemini/nim/openrouter) eram ~90% código idêntico — body, parser SSE,
// error mapping, tool-calls. Tudo isso vive aqui agora; cada provider vira um
// wrapper fino que só declara suas diferenças (endpoint, auth, filtro, quirks).
//
// Nota sobre mensagens de erro: desde v0.1.147 a UI re-localiza o erro pelo
// CÓDIGO (no-key/invalid-key/rate-limit/network), então o TEXTO genérico daqui
// é só fallback/detalhe — não há regressão de UX em genericizar.

import {
  ProviderError,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderToolCall,
  type ProviderToolDefinition,
  type ProviderMessage,
  type ImageAttachment,
  type TokenHandler,
  type Usage,
  type UsageHandler,
  type ReasoningHandler,
} from "./base";
import {
  aplicarEsforco,
  resolveTemperature,
  resolveMaxTokens,
  semRaciocinioComFerramentas,
} from "./paramPolicy";

// ============================================================
// Fallback de streaming → não-streaming (pseudo-stream). v0.1.232
// ============================================================
//
// O streaming REAL usa fetch() pra ler SSE token-a-token. No WebView do mobile
// (iOS WKWebView / Android), o fetch cross-origin pode bater em CORS e FALHAR
// na conexão — e aí o usuário levava um erro duro "Falha de conexão", mesmo com
// internet ok. Mas todo provider tem um chat() não-streaming via requestUrl, que
// é uma requisição NATIVA do Obsidian e FURA o CORS.
//
// Então, quando o fetch SSE falha em CONECTAR (não é abort, não é erro HTTP do
// servidor — esses a gente respeita), em vez de erro duro caímos pro chat() e
// emitimos a resposta inteira de uma vez via onToken. O usuário perde o efeito
// "digitando", mas RECEBE a resposta. Degradação graciosa em vez de falha.
//
// Só dispara em falha de CONEXÃO do fetch — no desktop e onde o CORS já
// funciona, o caminho de streaming real continua intacto (este código nem roda).
export async function streamFallbackToChat(
  call: () => Promise<ProviderResponse>,
  onToken: TokenHandler,
  onUsage?: UsageHandler,
  onReasoning?: ReasoningHandler
): Promise<ProviderResponse> {
  const resp = await call();
  if (resp.reasoning && onReasoning) onReasoning(resp.reasoning);
  if (resp.content) onToken(resp.content);
  if (resp.usage && onUsage) onUsage(resp.usage);
  return resp;
}

/**
 * O ÚNICO `fetch` do plugin: por onde passa o streaming dos providers.
 *
 * `requestUrl` do Obsidian não faz streaming — ele devolve a resposta inteira
 * de uma vez —, e streaming é o produto. Então os cinco providers que fazem
 * SSE por fetch (Anthropic, Gemini, Ollama, OpenAI, OpenRouter) passam por
 * aqui, em vez de cinco chamadas espalhadas. Não é TODA a saída de rede: o
 * resto (chamadas sem streaming, embeddings do RAG, o "anexar link" do chat)
 * vai por `requestUrl`, e o NIM, no desktop, faz o streaming por Node `https`.
 *
 * É repasse puro, de propósito. Nada de timeout (uma geração longa seria
 * cortada, e o TimeoutError escaparia do teste de AbortError e dispararia o
 * fallback, fazendo uma SEGUNDA requisição), nada de embrulhar o erro (os
 * `catch` dos providers dependem do erro original) e nada de ler a Response
 * (o Gemini precisa dela crua pra detectar o erro de billing). E `fetch` é lido
 * na CHAMADA, não guardado no carregamento do módulo — senão os testes, que
 * trocam o global, iriam pra rede de verdade.
 *
 * `window.fetch` É O MESMO `fetch` — no navegador, `fetch` sozinho é só o
 * atalho pra ele: mesma função, mesma pilha de rede, mesmo CORS. Está escrito
 * assim desde a 0.9.19 porque a regra `no-restricted-globals` da revisão do
 * Obsidian só reconhece o nome solto, e o aviso dela segurava a nota pública
 * do plugin mesmo depois de o uso estar declarado no README (0.9.18). Não é
 * outro mecanismo nem esconde nada: o README diz com todas as letras que o
 * streaming usa `fetch`, e por quê. Se o Obsidian der streaming ao
 * `requestUrl`, este é o único lugar a trocar.
 */
export function fetchStream(url: string, init: RequestInit): Promise<Response> {
  return window.fetch(url, init);
}

// ============================================================
// Data URLs (anexos) — parse único usado por imagem e PDF
// ============================================================

/**
 * `data:application/pdf;base64,AAAA` → `{ mediaType, base64 }`. null quando não
 * é data URL base64 (URL externa, string vazia, base64 truncado). Os providers
 * pulam o anexo em vez de mandar lixo pro wire.
 */
export function parseDataUrl(
  dataUrl: string | undefined
): { mediaType: string; base64: string } | null {
  if (!dataUrl) return null;
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

/**
 * Data URL de PDF pronta pro wire OpenAI-compat (`file_data`). Aceita tanto a
 * data URL completa quanto base64 cru (normaliza o prefixo). null se não dá.
 */
export function pdfFileData(dataUrl: string | undefined): string | null {
  if (!dataUrl) return null;
  if (dataUrl.startsWith("data:")) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return null;
    // Alguns WebViews (Android) devolvem application/octet-stream pro .pdf
    // escolhido — o picker já validou que é PDF, então re-rotulamos. Qualquer
    // outro mime (image/*, text/*) é recusado pra não virar arquivo mentiroso.
    const mime = parsed.mediaType.toLowerCase();
    const isPdf = mime.includes("pdf") || mime === "application/octet-stream";
    if (!isPdf) return null;
    return `data:application/pdf;base64,${parsed.base64}`;
  }
  // Base64 cru (sem prefixo) — aceita se parecer base64.
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(dataUrl) && dataUrl.length > 16) {
    return `data:application/pdf;base64,${dataUrl.replace(/\s+/g, "")}`;
  }
  return null;
}

/** Alguma mensagem carrega PDF? (decide o plugin file-parser no OpenRouter) */
export function hasPdfAttachment(messages: ProviderMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "user" &&
      !!m.attachments?.some((a) => a.type === "pdf" && pdfFileData(a.dataUrl))
  );
}

// ============================================================
// Mensagens → formato wire OpenAI (text + tool_calls + vision + PDF)
// ============================================================
export function toOpenAIMessages(messages: ProviderMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    if (m.role === "user" && m.attachments && m.attachments.length > 0) {
      const imageAtt = m.attachments.filter(
        (a): a is ImageAttachment => a.type === "image"
      );
      // PDF vira content part `file` com data URL (OpenAI Chat Completions e
      // OpenRouter usam o mesmo shape). Anexos ilegíveis são pulados. v0.1.248
      const pdfParts: Array<Record<string, unknown>> = [];
      for (const a of m.attachments) {
        if (a.type !== "pdf") continue;
        const fileData = pdfFileData(a.dataUrl);
        if (!fileData) continue;
        pdfParts.push({
          type: "file",
          file: { filename: a.name, file_data: fileData },
        });
      }
      if (imageAtt.length === 0 && pdfParts.length === 0) {
        return { role: "user", content: m.content };
      }
      const parts: Array<Record<string, unknown>> = [];
      if (m.content) parts.push({ type: "text", text: m.content });
      for (const att of imageAtt) {
        parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
      }
      parts.push(...pdfParts);
      return { role: "user", content: parts };
    }
    return { role: m.role, content: m.content };
  });
}

/** Tools → formato `function` da OpenAI. undefined se não há tools. */
export function toOpenAITools(tools?: ProviderToolDefinition[]) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// ============================================================
// Body builder — aplica paramPolicy (temperature/max_tokens) + tools
// ============================================================
export interface BodyOpts {
  /** Id do provider (pra paramPolicy). */
  provider: string;
  stream?: boolean;
  /** Campo de max tokens: "max_tokens" (default) ou "max_completion_tokens". */
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  /** Pede `stream_options: { include_usage: true }` (OpenAI/Gemini/OpenRouter). */
  includeUsage?: boolean;
}

export function buildChatBody(
  req: ProviderRequest,
  opts: BodyOpts
): Record<string, unknown> {
  const field = opts.maxTokensField ?? "max_tokens";
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toOpenAIMessages(req.messages),
    [field]: resolveMaxTokens(opts.provider, req.model, req.maxTokens ?? 2000, req.effort),
  };
  // Quanto pensar (reasoning_effort / reasoning.effort), quando o modelo tem.
  aplicarEsforco(body, opts.provider, req.model, req.effort);
  if (opts.stream) {
    body.stream = true;
    if (opts.includeUsage) body.stream_options = { include_usage: true };
  }
  const temp = resolveTemperature(opts.provider, req.model, req.temperature);
  if (temp !== undefined) body.temperature = temp;
  const tools = toOpenAITools(req.tools);
  if (tools) {
    body.tools = tools;
    body.tool_choice = "auto";
    // GPT-5.4+ no /chat/completions: ferramentas só sem raciocínio (o
    // Agent quebrava no primeiro pedido). Ver paramPolicy.
    if (body.reasoning_effort !== undefined && semRaciocinioComFerramentas(opts.provider, req.model)) {
      body.reasoning_effort = "none";
    }
  }
  return body;
}

// ============================================================
// Error mapping (HTTP status → ProviderError). Detalhe vem do body da API.
// ============================================================
export interface ErrorMapOpts {
  /** Rótulo do provider no texto do erro ("OpenAI", "Gemini", …). */
  label: string;
  /** Status tratados como invalid-key. Default [401]. Gemini/NIM usam [401,403]. */
  authStatuses?: number[];
}

function extractApiMessage(json: unknown): string | null {
  const j = json as
    | {
        error?: unknown;
        errors?: unknown;
        detail?: string;
        message?: string;
      }
    | undefined;
  // error pode vir como string crua, objeto { message } ou objeto/array
  // aninhado (alguns hosts OpenAI-compat). v0.1.228: cobre os 3 casos.
  if (typeof j?.error === "string") return j.error;
  if (j?.error && typeof j.error === "object") {
    const m = (j.error as { message?: unknown }).message;
    if (typeof m === "string") return m;
    if (m != null) return shortJson(m);
  }
  // Alguns provedores devolvem `errors: [...]` em vez de `error`.
  if (Array.isArray(j?.errors) && j.errors.length > 0) {
    const first = j.errors[0] as { message?: unknown };
    if (typeof first?.message === "string") return first.message;
    return shortJson(j.errors);
  }
  return j?.detail ?? j?.message ?? null;
}

/** Serializa um valor não-string em JSON curto (cap 200 chars) p/ detalhe de erro. */
function shortJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return String(v);
  }
}

/** Retorna o ProviderError pra um status de erro, ou null se status é OK. */
export function mapHttpError(
  status: number,
  bodyJson: unknown,
  opts: ErrorMapOpts
): ProviderError | null {
  if (status >= 200 && status < 300) return null;
  const auth = opts.authStatuses ?? [401];
  if (auth.includes(status)) {
    return new ProviderError(`Invalid ${opts.label} API key.`, "invalid-key");
  }
  if (status === 429) {
    return new ProviderError(
      `${opts.label} rate limit. Wait a few seconds.`,
      "rate-limit"
    );
  }
  // Transientes/retryáveis: 5xx (inclui 529 "overloaded" do Anthropic), 408
  // (timeout) e 409 (conflito). Mapeados em "rate-limit" porque é o único code
  // transiente da union e a UI já o re-localiza como "tente de novo". v0.1.228.
  if (status >= 500 || status === 408 || status === 409) {
    return new ProviderError(
      `${opts.label} service unavailable. Try again.`,
      "rate-limit"
    );
  }
  const detail = extractApiMessage(bodyJson) ?? `HTTP ${status}`;
  // (P1-26) Context-length excedido: todo provider devolve 400 com um texto
  // próprio — sem este mapeamento caía em "unknown" com retry inútil.
  if (
    /context.{0,8}length|maximum context|context window|too many tokens|prompt is too long|exceeds? the (model'?s? )?context/i.test(
      detail
    )
  ) {
    return new ProviderError(`${opts.label}: ${detail}`, "context-overflow");
  }
  return new ProviderError(`${opts.label}: ${detail}`, "unknown");
}

/** Valida uma Response de fetch (stream); lê o body p/ detalhe e lança se erro. */
export async function ensureOkStream(
  res: Response,
  opts: ErrorMapOpts
): Promise<void> {
  if (res.ok) return;
  // Lê como texto e tenta parsear JSON: assim também capturamos detalhe em
  // corpos text/plain (alguns gateways/proxies). v0.1.228.
  let json: unknown;
  try {
    const raw = await res.text();
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = { message: raw };
      }
    }
  } catch {
    /* sem corpo legível — usa o status */
  }
  const err = mapHttpError(res.status, json, opts);
  if (err) throw err;
}

/** Valida uma resposta de requestUrl (json síncrono) e lança se erro. */
export function ensureOkRequest(
  res: { status: number; json?: unknown },
  opts: ErrorMapOpts
): void {
  const err = mapHttpError(res.status, res.json, opts);
  if (err) throw err;
}

// ============================================================
// A forma do fio (OpenAI-compatible)
// ============================================================
// `JSON.parse` devolve `any`, e `any` apaga a checagem de tipo de tudo que
// encosta nele — era daí que saíam as ~260 reclamações de `no-unsafe-*`.
// Declarar a forma que a API promete devolve a checagem. Em execução nada
// muda: tipo não sobrevive ao build.
//
// Tudo é opcional de propósito. Host OpenAI-compatible é um zoológico: o que
// a spec chama de obrigatório vem faltando na prática, e os `typeof` que já
// existem abaixo continuam sendo a verdade sobre o que chegou.

/** Tool call no fio — inteira (non-stream) ou em pedaço (stream). */
export interface ToolCallNoFio {
  index?: number;
  type?: string;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** O `delta` de um chunk de streaming. */
export interface DeltaNoFio {
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  tool_calls?: ToolCallNoFio[];
}

/** Contagem de tokens, quando o host manda. */
export interface UsoNoFio {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** O pedaço do prompt que veio do cache (subconjunto de prompt_tokens) e,
   *  onde há preço de escrita (GPT-5.6+, OpenRouter), o que foi gravado. */
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
}

/** Um chunk `data:` do SSE. */
export interface ChunkNoFio {
  choices?: Array<{ delta?: DeltaNoFio; finish_reason?: string }>;
  usage?: UsoNoFio;
}

/** A mensagem de uma resposta non-stream. */
export interface MensagemNoFio {
  content?: unknown;
  tool_calls?: ToolCallNoFio[];
  reasoning_content?: unknown;
  reasoning?: unknown;
}

/** O corpo de erro que quase todo host devolve. */
export interface ErroNoFio {
  error?: { message?: string; code?: unknown; status?: unknown };
}

/** A resposta non-stream inteira. */
export interface RespostaNoFio {
  choices?: Array<{ message?: MensagemNoFio; finish_reason?: string }>;
  usage?: UsoNoFio;
}

// ============================================================
// Resposta non-stream (chat): message → content + toolCalls
// ============================================================
export function parseOpenAIChatMessage(
  message: MensagemNoFio
): { content: string; toolCalls?: ProviderToolCall[]; reasoning?: string } {
  let toolCalls: ProviderToolCall[] | undefined;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const lidas: ProviderToolCall[] = [];
    for (const tc of message.tool_calls) {
      if (tc.type !== "function") continue;
      // Sem nome não há o que chamar; e `function` ausente estourava aqui
      // antes de haver tipo — o `any` escondia que o host podia omiti-lo.
      const nome = tc.function?.name;
      if (!nome) continue;
      const brutos = tc.function?.arguments ?? "";
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = brutos ? (JSON.parse(brutos) as Record<string, unknown>) : {};
      } catch {
        parsedArgs = { _raw: brutos };
      }
      lidas.push({
        id: tc.id || `call_${crypto.randomUUID()}`,
        name: nome,
        arguments: parsedArgs,
      });
    }
    if (lidas.length > 0) toolCalls = lidas;
  }
  // content pode vir como string OU array de parts ({ type:"text", text }) em
  // alguns hosts OpenAI-compat. v0.1.228: concatena os parts de texto; '' só
  // quando content é realmente nulo/ausente.
  const content =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? (message.content as Array<{ type?: string; text?: unknown }>)
            .filter((p) => p?.type === "text" && typeof p.text === "string")
            .map((p) => p.text as string)
            .join("")
        : "";
  // Reasoning de resposta NÃO-stream (DeepSeek R1 e afins expõem
  // reasoning_content; alguns hosts usam "reasoning"). Auditoria v0.1.225.
  const reasoning =
    (typeof message.reasoning_content === "string" && message.reasoning_content) ||
    (typeof message.reasoning === "string" && message.reasoning) ||
    undefined;
  return { content, toolCalls, reasoning };
}

export function usageFrom(json: { usage?: UsoNoFio }): Usage | undefined {
  const u = json.usage;
  if (!u) return undefined;
  const usage: Usage = {
    input: u.prompt_tokens ?? 0,
    output: u.completion_tokens ?? 0,
  };
  // Só quando vieram: um 0 explícito também é informação (não houve cache).
  const lido = u.prompt_tokens_details?.cached_tokens;
  const gravado = u.prompt_tokens_details?.cache_write_tokens;
  if (typeof lido === "number") usage.cacheRead = lido;
  if (typeof gravado === "number" && gravado > 0) usage.cacheWrite = gravado;
  return usage;
}

// ============================================================
// Finalize do stream — buffers acumulados → ProviderResponse
// ============================================================
type ToolAccum = Record<number, { id: string; name: string; argsBuf: string }>;

export function finalizeOpenAIResponse(
  content: string,
  toolCallAccum: ToolAccum,
  usage?: { input: number; output: number },
  idPrefix = "openai_call"
): ProviderResponse {
  const indices = Object.keys(toolCallAccum)
    .map((k) => Number(k))
    .sort((a, b) => a - b);
  const toolCalls: ProviderToolCall[] = [];
  for (const i of indices) {
    const acc = toolCallAccum[i];
    if (!acc.name) continue;
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = acc.argsBuf
        ? (JSON.parse(acc.argsBuf) as Record<string, unknown>)
        : {};
    } catch {
      parsedArgs = { _raw: acc.argsBuf };
    }
    toolCalls.push({
      // Fallback de id: randomUUID garante unicidade absoluta entre turnos
      // (Date.now() podia colidir entre finalizes no mesmo ms). v0.1.228.
      id: acc.id || `${idPrefix}_${crypto.randomUUID()}`,
      name: acc.name,
      arguments: parsedArgs,
    });
  }
  const result: ProviderResponse = { content };
  if (toolCalls.length > 0) result.toolCalls = toolCalls;
  if (usage) result.usage = usage;
  return result;
}

// ============================================================
// Parser SSE OpenAI-compat: `data: {choices[0].delta}` … `data: [DONE]`
// Reusado por openai / gemini / openrouter (mesmo formato).
// ============================================================
export async function parseOpenAICompatSSE(
  body: ReadableStream<Uint8Array>,
  onToken: TokenHandler,
  onUsage: UsageHandler | undefined,
  idPrefix: string,
  onReasoning?: (delta: string) => void
): Promise<ProviderResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedText = "";
  const toolCallAccum: ToolAccum = {};
  // Fallback p/ quando o chunk de tool_call vem SEM `index` (raro, mas alguns
  // hosts OpenAI-compat omitem): em vez de cair sempre em 0 e fundir tools
  // distintas, avança um contador no 1º chunk de cada tool (id/name presentes).
  // v0.1.228.
  let lastToolIdx = -1;
  let usage: Usage | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        if (data === "[DONE]") {
          return finalizeOpenAIResponse(accumulatedText, toolCallAccum, usage, idPrefix);
        }
        continue;
      }
      try {
        const json = JSON.parse(data) as ChunkNoFio;
        const delta = json?.choices?.[0]?.delta;
        if (delta) {
          const token = delta.content;
          if (typeof token === "string" && token.length > 0) {
            accumulatedText += token;
            onToken(token);
          }
          // Reasoning/thinking exposto por alguns modelos (DeepSeek R1 via
          // reasoning_content; OpenRouter via reasoning). Roteado à parte.
          if (onReasoning) {
            const r =
              (typeof delta.reasoning === "string" && delta.reasoning) ||
              (typeof delta.reasoning_content === "string" &&
                delta.reasoning_content) ||
              "";
            if (r) onReasoning(r);
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              // `index` presente (caminho padrão OpenAI) é sempre respeitado;
              // só usamos o contador quando ele falta. O 1º chunk de uma tool
              // traz id/name, então é nele que avançamos o contador.
              let idx: number;
              if (typeof tc.index === "number") {
                idx = tc.index;
                if (idx > lastToolIdx) lastToolIdx = idx;
              } else {
                if (tc.id || tc.function?.name) lastToolIdx += 1;
                idx = lastToolIdx < 0 ? 0 : lastToolIdx;
              }
              if (!toolCallAccum[idx]) {
                toolCallAccum[idx] = { id: "", name: "", argsBuf: "" };
              }
              if (tc.id) toolCallAccum[idx].id = tc.id;
              // name só é setado se ainda vazio: hosts mandam o name uma vez no
              // 1º chunk; reescrever (ou concatenar) corromperia o nome.
              if (tc.function?.name && !toolCallAccum[idx].name) {
                toolCallAccum[idx].name = tc.function.name;
              }
              if (typeof tc.function?.arguments === "string") {
                toolCallAccum[idx].argsBuf += tc.function.arguments;
              }
            }
          }
        }
        if (json?.usage) {
          usage = usageFrom(json);
          if (usage && onUsage) onUsage(usage);
        }
      } catch {
        /* chunk JSON inválido — pula */
      }
    }
  }
  return finalizeOpenAIResponse(accumulatedText, toolCallAccum, usage, idPrefix);
}

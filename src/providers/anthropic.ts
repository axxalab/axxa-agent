// src/providers/anthropic.ts
// Provider Anthropic (Claude) — duas modalidades:
//   chat()       — não-streaming via requestUrl, com TOOL USE (Agent mode)
//   streamChat() — streaming SSE via fetch (chat mode)
//
// Diferenças em relação a OpenAI:
//   - Auth: header `x-api-key` (não Bearer)
//   - Versão obrigatória: `anthropic-version: 2023-06-01`
//   - Browser access: `anthropic-dangerous-direct-browser-access: true` (libera CORS)
//   - System prompt: campo SEPARADO no body (não dentro de messages)
//   - max_tokens: OBRIGATÓRIO (vs opcional na OpenAI)
//   - SSE events: tipos diferentes (content_block_delta com delta.text)
//
// Tool use (v0.1.32):
//   - Tools: `{ name, description, input_schema }` (vs `{ type:"function", function:{...} }`)
//   - Assistant w/ tools: content = array de blocks [text, tool_use]
//   - Tool result: vira role "user" com content array `[{ type:"tool_result", tool_use_id, content }]`
//   - Anthropic exige alternância user/assistant — tool_results consecutivos viram 1 user msg

import { requestUrl } from "obsidian";
import {
  Provider,
  ProviderError,
  ProviderRequest,
  ProviderResponse,
  ProviderMessage,
  ProviderToolCall,
  TokenHandler,
  Usage,
  UsageHandler,
  ReasoningHandler,
} from "./base";
import { aplicarEsforco, resolveTemperature, resolveMaxTokens } from "./paramPolicy";
import {
  ensureOkRequest,
  ensureOkStream,
  streamFallbackToChat,
  parseDataUrl,
  fetchStream,
} from "./_shared";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// ============================================================
// Content blocks — formato Anthropic
// ============================================================

interface TextBlock {
  type: "text";
  text: string;
}
interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}
interface ImageBlock {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}
/** PDF anexado — bloco nativo do Messages API (Claude 3.5+). v0.1.248 */
interface DocumentBlock {
  type: "document";
  source: {
    type: "base64";
    media_type: "application/pdf";
    data: string;
  };
  /** Nome do arquivo — ajuda o modelo a se referir ao documento. */
  title?: string;
}
type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock
  | DocumentBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: object;
}

interface AnthropicBody {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  stream?: boolean;
  system?: string;
  tools?: AnthropicTool[];
  temperature?: number;
  /** Quanto pensar (low…max), nos Claude que têm o controle. */
  output_config?: { effort: string };
}

// ---- O que a Anthropic devolve (ver a nota em _shared.ts) ----------------
// Tudo opcional: o que chega é o que o `typeof` abaixo disser, não o que a
// spec promete. Com `any` no lugar disto, nenhuma dessas leituras era checada.

/** Bloco da resposta non-stream: texto ou tool_use. */
interface BlocoDaResposta {
  type?: string;
  text?: unknown;
  id?: string;
  name?: string;
  input?: unknown;
}

interface UsoAnthropic {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * O usage da Anthropic no formato do app. Na Anthropic, `input_tokens` é só o
 * que NÃO veio do cache: o prompt inteiro é ele + o lido + o gravado. Sem
 * somar, com o cache ligado, o painel e o teto de gasto contariam só a ponta.
 */
function usoDaAnthropic(u: UsoAnthropic | undefined, saida = 0): Usage {
  const lido = u?.cache_read_input_tokens ?? 0;
  const gravado = u?.cache_creation_input_tokens ?? 0;
  const usage: Usage = {
    input: (u?.input_tokens ?? 0) + lido + gravado,
    output: u?.output_tokens ?? saida,
  };
  if (u?.cache_read_input_tokens !== undefined) usage.cacheRead = lido;
  if (gravado > 0) usage.cacheWrite = gravado;
  return usage;
}

/** Resposta non-stream (requestUrl). */
interface RespostaAnthropic {
  content?: BlocoDaResposta[];
  usage?: UsoAnthropic;
}

/** Um evento `data:` do stream. Cada `type` usa um subconjunto dos campos. */
interface EventoAnthropic {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: unknown;
    thinking?: unknown;
    partial_json?: string;
  };
  message?: { usage?: UsoAnthropic };
  usage?: UsoAnthropic;
  error?: { message?: string };
}

/** Resposta do catálogo de modelos. */
interface ModelosAnthropic {
  data?: Array<{ id?: string }>;
}

/**
 * Converte ProviderMessage[] pro formato wire-level do Anthropic.
 * - system → extraído em campo separado
 * - role "tool" → vira role "user" com content array contendo tool_result block
 * - role "assistant" com toolCalls → content array com text + tool_use blocks
 * - tool_results consecutivos viram 1 user msg com content[] mergeado
 *   (Anthropic exige alternância user/assistant)
 */
export function toAnthropicPayload(messages: ProviderMessage[]): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  let system: string | undefined;
  const converted: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      // Concatena se tiver vários systems (raro mas seguro)
      system = system ? system + "\n\n" + m.content : m.content;
      continue;
    }

    if (m.role === "tool") {
      // tool_use_id vazio garante 400 na Anthropic. Sem o id de correlação não
      // dá pra emitir um tool_result válido → degrada pra texto (preserva o
      // conteúdo da tool em vez de quebrar a request inteira). v0.1.228
      if (!m.toolCallId) {
        console.warn(
          "[anthropic] tool message sem toolCallId — anexando como texto pra evitar 400"
        );
        converted.push({ role: "user", content: m.content || " " });
        continue;
      }
      converted.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId,
            content: m.content,
          },
        ],
      });
      continue;
    }

    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: ContentBlock[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      converted.push({ role: "assistant", content: blocks });
      continue;
    }

    // User normal — pode ter attachments (imagens e PDFs) em content array.
    // Note/audio vêm inlinados como texto pelo caller (não wire).
    const imageAtt =
      m.role === "user" && m.attachments
        ? m.attachments.filter((a) => a.type === "image")
        : [];
    const pdfAtt =
      m.role === "user" && m.attachments
        ? m.attachments.filter((a) => a.type === "pdf")
        : [];
    if (m.role === "user" && (imageAtt.length > 0 || pdfAtt.length > 0)) {
      const blocks: ContentBlock[] = [];
      // PDF ANTES do texto: a doc do Anthropic recomenda o documento primeiro
      // (a pergunta depois costuma render resposta melhor).
      for (const att of pdfAtt) {
        if (att.type !== "pdf" || !att.dataUrl) continue;
        const parsed = parseDataUrl(att.dataUrl);
        if (!parsed) continue;
        blocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: parsed.base64,
          },
          title: att.name,
        });
      }
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const att of imageAtt) {
        if (att.type === "image") {
          // Anthropic aceita base64 inline OU URL externa
          const isDataUrl = att.dataUrl.startsWith("data:");
          if (isDataUrl) {
            // data:image/png;base64,XXXX → media_type + data separados
            const match = /^data:([^;]+);base64,(.+)$/.exec(att.dataUrl);
            if (match) {
              blocks.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: match[1],
                  data: match[2],
                },
              });
            }
          } else {
            blocks.push({
              type: "image",
              source: { type: "url", url: att.dataUrl },
            });
          }
        }
      }
      // Se TODOS os anexos falharam o parse (data URL malformada), sobra no
      // máximo o bloco de texto — e aí a mensagem volta a ser string simples.
      // blocks vazio seria 400 do Anthropic (string vazia vira " "). v0.1.227
      const onlyText = blocks.every((b) => b.type === "text");
      if (onlyText) {
        converted.push({ role: "user", content: m.content || " " });
      } else {
        converted.push({ role: "user", content: blocks });
      }
      continue;
    }

    // Assistant text-only
    converted.push({
      role: m.role,
      content: m.content,
    });
  }

  // Anthropic exige alternância ESTRITA user/assistant. Juntamos msgs
  // consecutivas do MESMO role num content[] só. Cobre dois casos:
  //   - user: tool_results consecutivos (expansão do agentSteps)
  //   - assistant: múltiplos turns do agent (ao reabrir um chat de agente
  //     multi-turn, cada turn vira um ai-response → assistant consecutivos).
  //     OpenAI-compat tolera, Anthropic não — sem o merge, dá 400. v0.1.162
  // toBlocks dropa texto vazio (assistant com toolCalls tem content:"" → não
  // vira um text-block vazio, que o Anthropic rejeita).
  const toBlocks = (c: string | ContentBlock[]): ContentBlock[] =>
    Array.isArray(c) ? c : c ? [{ type: "text" as const, text: c }] : [];

  const merged: AnthropicMessage[] = [];
  for (const m of converted) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      // Acumula in-place: garante array UMA vez e dá push (evita reconstruir o
      // content[] a cada msg consecutiva — era O(n²) com o spread). v0.1.228
      if (!Array.isArray(last.content)) last.content = toBlocks(last.content);
      last.content.push(...toBlocks(m.content));
    } else {
      merged.push({ ...m });
    }
  }

  return { system, messages: merged };
}

function buildBody(req: ProviderRequest, stream: boolean): AnthropicBody {
  const { system, messages } = toAnthropicPayload(req.messages);

  const body: AnthropicBody = {
    model: req.model,
    max_tokens: resolveMaxTokens("anthropic", req.model, req.maxTokens ?? 2000, req.effort),
    messages,
    stream,
  };
  if (system) body.system = system;
  // Claude usa range 0..1 (paramPolicy clampa) — não 0..2 como a OpenAI — e
  // os atuais (Fable, Opus 4.7+, Sonnet 5+) não aceitam nenhuma: a política
  // devolve undefined e o campo nem vai.
  const temp = resolveTemperature("anthropic", req.model, req.temperature);
  if (temp !== undefined) body.temperature = temp;
  // O nível do Effort vira o `output_config.effort` dos que têm o controle.
  aplicarEsforco(body as unknown as Record<string, unknown>, "anthropic", req.model, req.effort);
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }
  return body;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey.trim(),
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

export class AnthropicProvider implements Provider {
  id = "anthropic";
  name = "Anthropic";
  supportsTools = true;

  async chat(req: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError(
        "Anthropic API key not configured. Go to Settings → AXXA Agent.",
        "no-key"
      );
    }

    let res;
    try {
      res = await requestUrl({
        url: ANTHROPIC_ENDPOINT,
        method: "POST",
        contentType: "application/json",
        headers: authHeaders(apiKey),
        body: JSON.stringify(buildBody(req, false)),
        throw: false,
      });
    } catch {
      throw new ProviderError("Connection failed. Check your internet.", "network");
    }

    ensureOkRequest(res, { label: "Anthropic" });

    // Anthropic devolve content como array de blocks tipados (text + tool_use)
    const corpo = res.json as RespostaAnthropic | undefined;
    const content = corpo?.content;
    if (!Array.isArray(content)) {
      throw new ProviderError("Empty response from Anthropic.", "unknown");
    }

    let text = "";
    const toolCalls: ProviderToolCall[] = [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        text += block.text;
      } else if (block.type === "tool_use" && block.name) {
        toolCalls.push({
          id: block.id || `anthropic_call_${crypto.randomUUID()}`,
          name: block.name,
          arguments: (block.input as Record<string, unknown> | undefined) ?? {},
        });
      }
    }

    if (!text && toolCalls.length === 0) {
      throw new ProviderError(
        "Empty response from Anthropic (no text or tool_use).",
        "unknown"
      );
    }

    const result: ProviderResponse = { content: text };
    if (toolCalls.length > 0) result.toolCalls = toolCalls;

    // Usage tokens
    if (corpo?.usage) result.usage = usoDaAnthropic(corpo.usage);

    return result;
  }

  async streamChat(
    req: ProviderRequest,
    apiKey: string,
    onToken: TokenHandler,
    onUsage?: UsageHandler,
    signal?: AbortSignal,
    onReasoning?: ReasoningHandler
  ): Promise<ProviderResponse> {
    if (!apiKey || !apiKey.trim()) {
      throw new ProviderError(
        "Anthropic API key not configured. Go to Settings → AXXA Agent.",
        "no-key"
      );
    }

    let res: Response;
    try {
      res = await fetchStream(ANTHROPIC_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(apiKey),
        },
        body: JSON.stringify(buildBody(req, true)),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      // Falha de CONEXÃO do fetch SSE (típico: CORS no WebView mobile). Em vez
      // de erro duro, cai pro chat() via requestUrl (fura CORS) e emite tudo de
      // uma vez. O header dangerous-direct-browser-access já libera o desktop;
      // isto cobre o mobile onde o WebView ainda barra o stream. v0.1.232
      return streamFallbackToChat(
        () => this.chat(req, apiKey),
        onToken,
        onUsage,
        onReasoning
      );
    }

    await ensureOkStream(res, { label: "Anthropic" });
    if (!res.body) {
      throw new ProviderError("Empty stream from Anthropic.", "unknown");
    }

    // Parser SSE — Anthropic envia events tipados.
    // Nos interessam:
    //   content_block_start (text ou tool_use), content_block_delta (text_delta
    //   ou input_json_delta), content_block_stop, message_stop, error.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // O input chega no message_start (com os campos de cache); o
    // message_delta pode trazer os totais corridos de novo. A saída vem no
    // delta e, em alguns formatos, só no stop.
    const entrada: UsoAnthropic = {};
    let outputTokens = 0;
    const usoAgora = (): Usage => usoDaAnthropic({ ...entrada, output_tokens: outputTokens });
    const temUso = () => (entrada.input_tokens ?? 0) > 0 || outputTokens > 0;
    let accumulatedText = "";
    // Tool use accumulator por content_block_index
    const toolUseAccum: Record<number, { id: string; name: string; jsonBuf: string }> = {};

    // try/finally garante que o reader seja liberado em QUALQUER saída do loop
    // (break, return no message_stop, throw de ProviderError ou AbortError) —
    // sem isso o stream vazava a cada abort/erro mid-stream. v0.1.228
    try {
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
        if (!data) continue;
        let json: EventoAnthropic;
        try {
          json = JSON.parse(data) as EventoAnthropic;
        } catch {
          // JSON inválido (linha SSE parcial/keep-alive) — pula
          continue;
        }
        try {
          if (json.type === "content_block_start") {
            const block = json.content_block;
            if (block?.type === "tool_use" && typeof json.index === "number") {
              toolUseAccum[json.index] = {
                id: block.id ?? "",
                name: block.name ?? "",
                jsonBuf: "",
              };
            }
          } else if (json.type === "content_block_delta") {
            if (json.delta?.type === "text_delta") {
              const token = json.delta.text;
              if (typeof token === "string" && token.length > 0) {
                accumulatedText += token;
                onToken(token);
              }
            } else if (json.delta?.type === "thinking_delta") {
              // Extended thinking do Claude → canal de reasoning. v0.1.195
              const th = json.delta.thinking;
              if (onReasoning && typeof th === "string" && th.length > 0) {
                onReasoning(th);
              }
            } else if (json.delta?.type === "input_json_delta") {
              const idx = json.index ?? -1;
              if (toolUseAccum[idx]) {
                toolUseAccum[idx].jsonBuf += json.delta.partial_json ?? "";
              }
            }
          } else if (json.type === "message_start") {
            Object.assign(entrada, campoDeEntrada(json.message?.usage));
            // Avisa JÁ: o prompt (e o cache) foi cobrado a partir daqui, e um
            // Stop ou erro no meio do stream não chega ao message_stop. Quem
            // ouve guarda só o último aviso — avisar de novo não soma.
            if (onUsage && temUso()) onUsage(usoAgora());
          } else if (json.type === "message_delta") {
            outputTokens = json.usage?.output_tokens ?? outputTokens;
            Object.assign(entrada, campoDeEntrada(json.usage));
            if (onUsage && temUso()) onUsage(usoAgora());
          } else if (json.type === "message_stop") {
            // Alguns shapes só trazem o usage final aqui (não no message_delta)
            // → lê o fallback e mantém o MAIOR visto pra não zerar. v0.1.228
            const stopOut =
              json.message?.usage?.output_tokens ??
              json.usage?.output_tokens ??
              0;
            if (stopOut > outputTokens) outputTokens = stopOut;
            if (onUsage) onUsage(usoAgora());
            return buildAnthropicStreamResponse(
              accumulatedText,
              toolUseAccum,
              temUso() ? usoAgora() : undefined
            );
          } else if (json.type === "error") {
            throw new ProviderError(
              `Anthropic: ${json.error?.message ?? "error during stream"}`,
              "unknown"
            );
          }
        } catch (err) {
          if (err instanceof ProviderError) throw err;
          // Erro inesperado no handler de um event conhecido (ex: TypeError de
          // onToken/onReasoning) — re-lança em vez de engolir. O JSON.parse já
          // foi isolado acima, então isto NÃO é mais erro de parse. v0.1.228
          throw err;
        }
      }
    }
    } finally {
      // Libera o stream em toda saída — inclusive return/throw/abort. v0.1.228
      try {
        await reader.cancel();
      } catch {
        /* reader já fechado/cancelado — ignora */
      }
    }

    // Stream encerrou sem message_stop — dispara usage com o que temos
    if (onUsage && temUso()) onUsage(usoAgora());
    return buildAnthropicStreamResponse(
      accumulatedText,
      toolUseAccum,
      temUso() ? usoAgora() : undefined
    );
  }

  /** Monta ProviderResponse do stream — text + tool_use blocks parseados. */

  /** Lista curada — fallback quando não há key ou o fetch falha. Manter em
   *  sincronia com os 5 arquivos de metadata (caps/pricing/cards/ctx). */
  private curatedModels(): string[] {
    return [
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ];
  }

  async listModels(apiKey: string): Promise<string[]> {
    // Com key, busca o catálogo VIVO da Anthropic (GET /v1/models) — assim a
    // lista nunca fica presa nos hardcoded. Sem key / em erro, cai na curada.
    if (!apiKey || !apiKey.trim()) return this.curatedModels();
    try {
      const res = await requestUrl({
        url: "https://api.anthropic.com/v1/models?limit=100",
        method: "GET",
        headers: {
          "x-api-key": apiKey.trim(),
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
        throw: false,
      });
      if (res.status < 200 || res.status >= 300) return this.curatedModels();
      const catalogo = res.json as ModelosAnthropic | undefined;
      const ids: string[] = (catalogo?.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string");
      // Une com a curada (garante Fable/4.x mesmo se a API atrasar) + dedup.
      const merged = Array.from(new Set([...ids, ...this.curatedModels()]));
      return merged.length > 0 ? merged : this.curatedModels();
    } catch {
      return this.curatedModels();
    }
  }
}

/**
 * Helper compartilhado pra montar ProviderResponse após o stream Anthropic terminar.
 * Parseia input_json_delta acumulado em cada tool_use block.
 */
function buildAnthropicStreamResponse(
  text: string,
  toolUseAccum: Record<number, { id: string; name: string; jsonBuf: string }>,
  usage: Usage | undefined
): ProviderResponse {
  const indices = Object.keys(toolUseAccum)
    .map((k) => Number(k))
    .sort((a, b) => a - b);
  const toolCalls: ProviderToolCall[] = [];
  for (const i of indices) {
    const acc = toolUseAccum[i];
    if (!acc.name) continue;
    let parsedArgs: Record<string, unknown> = {};
    try {
      // input_json_delta às vezes vem vazio quando o input é {} — buf vazio = {}
      parsedArgs = acc.jsonBuf
        ? (JSON.parse(acc.jsonBuf) as Record<string, unknown>)
        : {};
    } catch {
      parsedArgs = { _raw: acc.jsonBuf };
    }
    toolCalls.push({
      // Fallback com UUID evita colisão entre calls no mesmo ms (Date.now()+i
      // colidia se duas respostas caíssem no mesmo tick). v0.1.228
      id: acc.id || `anthropic_call_${crypto.randomUUID()}`,
      name: acc.name,
      arguments: parsedArgs,
    });
  }
  const result: ProviderResponse = { content: text };
  if (toolCalls.length > 0) result.toolCalls = toolCalls;
  if (usage) result.usage = usage;
  return result;
}

/** Só os campos de ENTRADA de um usage (o message_delta repete os totais
 *  corridos; os que não vieram não apagam os do message_start). */
function campoDeEntrada(u: UsoAnthropic | undefined): UsoAnthropic {
  const r: UsoAnthropic = {};
  if (typeof u?.input_tokens === "number") r.input_tokens = u.input_tokens;
  if (typeof u?.cache_read_input_tokens === "number") r.cache_read_input_tokens = u.cache_read_input_tokens;
  if (typeof u?.cache_creation_input_tokens === "number") {
    r.cache_creation_input_tokens = u.cache_creation_input_tokens;
  }
  return r;
}

export const anthropicProvider = new AnthropicProvider();

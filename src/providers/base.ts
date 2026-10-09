// src/providers/base.ts
// Interface comum a todos os providers de IA (OpenAI, Anthropic, OpenRouter, Ollama).
// Quando adicionarmos mais providers no Módulo 2, todos implementam esse contrato.
// Pensa nele como o "design token" do sistema de providers — quem encaixa aqui é compatível.

import type { EffortLevel } from "../core/effort";

/** Tool definition genérica — providers convertem pro seu formato wire-level. */
export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters: object;
}

/** Chamada de tool que o LLM produziu na resposta. */
export interface ProviderToolCall {
  /** ID único — volta como tool_call_id no result. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Anexo multimodal — imagem por enquanto, vídeo/áudio podem vir depois. */
export interface ImageAttachment {
  type: "image";
  /** Data URL (`data:image/png;base64,...`) ou URL externa (`https://...`). */
  dataUrl: string;
  /** Mime type — útil pra providers que exigem (Anthropic, Gemini nativo). */
  mimeType?: string;
  /** Nome do arquivo escolhido — só pra mostrar no chip do composer. */
  name?: string;
}

/** Nota do vault anexada — inlinada como contexto markdown no prompt. */
export interface NoteAttachment {
  type: "note";
  /** Path relativo ao vault (com extensão .md). */
  path: string;
  /** Conteúdo da nota lido na hora do envio (cacheado no client). */
  content: string;
}

/** PDF — placeholder por enquanto, sem extração de texto wired ainda. */
export interface PdfAttachment {
  type: "pdf";
  path?: string;
  dataUrl?: string;
  name: string;
}

/** Áudio gravado (webm/ogg/m4a) — wikilink ao path no vault. */
export interface AudioAttachment {
  type: "audio";
  /** Path relativo ao vault. */
  path: string;
  /** Duração estimada em ms (mostrado no chip). */
  durationMs?: number;
}

export type MessageAttachment =
  | ImageAttachment
  | NoteAttachment
  | PdfAttachment
  | AudioAttachment;

export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Set em role="assistant" quando o LLM chamou tools. */
  toolCalls?: ProviderToolCall[];
  /** Set em role="tool" — conecta o resultado à tool_call original. */
  toolCallId?: string;
  /** Anexos multimodais (imagens) — só passa se o modelo suporta vision. */
  attachments?: MessageAttachment[];
}

export interface ProviderRequest {
  model: string;
  messages: ProviderMessage[];
  maxTokens?: number;
  /** Tools disponíveis pro LLM. Agent mode envia, modos texto deixam vazio. */
  tools?: ProviderToolDefinition[];
  /** Temperatura 0..2 — se omitido, provider usa default próprio.
   *  Effort baixo = temp alta (criativo); effort alto = temp baixa (preciso). */
  temperature?: number;
  /** O nível do Effort do pedido (chat/agente). Modelo que pensa antes de
   *  responder recebe dele QUANTO pensar e um piso de max_tokens (ver
   *  paramPolicy). Sem ele (assistente, títulos), vale o padrão do provider. */
  effort?: EffortLevel;
  /** A conversa a que o pedido pertence. Com ela, o provider guarda o começo
   *  do pedido em cache (Anthropic, OpenRouter) ou manda os pedidos dela pro
   *  mesmo servidor (OpenAI, OpenRouter) — o turno seguinte relê do cache em
   *  vez de pagar o histórico inteiro de novo. Sem ela (títulos, assistente,
   *  pedido avulso), nada é gravado: gravar custa mais e ninguém relê. */
  cacheKey?: string;
  /** O teto DURO da resposta: o que ainda cabe na janela junto com o pedido
   *  (ver core/compactacao). Vale depois de tudo — inclusive do piso que os
   *  modelos que pensam ganham, que sem isto passava da janela. */
  maxTokensTeto?: number;
}

export interface ProviderResponse {
  content: string;
  /** Set se LLM decidiu chamar tools em vez de devolver texto direto. */
  toolCalls?: ProviderToolCall[];
  usage?: { input: number; output: number };
  /** Raciocínio (reasoning_content) de respostas NÃO-stream — ex: DeepSeek R1
   *  via NIM (pseudo-stream). No stream real vai pelo ReasoningHandler. */
  reasoning?: string;
}

/** Callback que recebe cada delta de token vindo do streaming. */
export type TokenHandler = (token: string) => void;

/** Callback que recebe cada delta de RACIOCÍNIO (reasoning/thinking) do stream.
 *  Só providers/modelos que expõem reasoning chamam (ex: DeepSeek R1). */
export type ReasoningHandler = (delta: string) => void;

/** Usage tokens (prompt+completion) — vem no final do stream / no response. */
export interface Usage {
  /** Todo o input do pedido — INCLUSIVE o que veio do cache. */
  input: number;
  output: number;
  /** Do `input`, quanto o provider leu do cache de prompt (cobra menos). */
  cacheRead?: number;
  /** Do `input`, quanto o provider GRAVOU no cache (Anthropic e GPT-5.6+
   *  cobram mais por isso). */
  cacheWrite?: number;
}

/** Callback opcional pra receber usage quando o provider informar. */
export type UsageHandler = (usage: Usage) => void;

/** Request pra geração de mídia (imagem/áudio/vídeo). */
export interface MediaGenerationRequest {
  model: string;
  prompt: string;
  /** Opcional: aspect ratio / dimensões. Cada provider mapeia conforme suporta. */
  size?: "1024x1024" | "1024x1792" | "1792x1024" | "512x512" | "auto";
  /** Quantas saídas (alguns providers aceitam n=1..N). Default 1. */
  n?: number;
  /** Seed determinística, se suportada. */
  seed?: number;
  /** Voz pra TTS (provider-specific). */
  voice?: string;
  /** Imagem de ENTRADA pra edição (IMG2IMG). base64 puro (sem o prefixo
   *  `data:`) + mime. Só providers/modelos que editam imagem usam (ex: Nano
   *  Banana). Ignorado pelos demais. v0.1.165 */
  image?: { data: string; mimeType: string };
}

/** Result item de geração — UM arquivo binário + meta de retorno. */
export interface MediaGenerationItem {
  /** Bytes da mídia. */
  data: Uint8Array;
  /** Mime type retornado pelo provider. */
  mime: string;
  width?: number;
  height?: number;
  /** Pra audio/video em segundos. */
  duration?: number;
  /** Seed efetivamente usada (provider às vezes adjusts). */
  seed?: number;
  /** Texto auxiliar do modelo (descrição, alt, revised prompt, etc). */
  text?: string;
}

export interface Provider {
  id: string;
  name: string;
  /** true se este provider suporta tool/function calling no Agent mode. */
  supportsTools?: boolean;
  chat(request: ProviderRequest, apiKey: string): Promise<ProviderResponse>;
  /**
   * Streaming SSE — emite tokens via onToken e RETORNA o resumo final
   * (content acumulado + toolCalls + usage). Caller pode usar o retorno
   * pra detectar tool_calls no Agent mode.
   *
   * Caller antigo (chat mode) só descarta o retorno — compatível.
   */
  streamChat(
    request: ProviderRequest,
    apiKey: string,
    onToken: TokenHandler,
    onUsage?: UsageHandler,
    signal?: AbortSignal,
    onReasoning?: ReasoningHandler
  ): Promise<ProviderResponse>;
  /**
   * Gera mídia (imagem/áudio/vídeo) conforme suportado pelo modelo.
   * Provider que não suporta retorna lista vazia / lança erro.
   * Implementação opcional — só providers com modelos de geração precisam.
   */
  generateImage?(
    request: MediaGenerationRequest,
    apiKey: string
  ): Promise<MediaGenerationItem[]>;
  generateAudio?(
    request: MediaGenerationRequest,
    apiKey: string
  ): Promise<MediaGenerationItem[]>;
  generateVideo?(
    request: MediaGenerationRequest,
    apiKey: string
  ): Promise<MediaGenerationItem[]>;
  /** Lista os modelos disponíveis no provider (catálogo /models). Usado pelo
   *  "SCAN" do seletor de modelo e pela curadoria de activeModels. */
  listModels?(apiKey: string): Promise<string[]>;
  /**
   * Quais deles são GRÁTIS, pelo preço que o catálogo publica.
   *
   * Só quem tem essa informação implementa. Reconhecer free pelo NOME (o
   * sufixo `:free` do OpenRouter) acerta a maioria e perde o resto — e quem
   * paga por essa perda é quem não quer pagar nada.
   */
  listFreeModels?(apiKey: string): Promise<string[]>;
  /** A cota diária dos modelos grátis nesta chave, quando o provider diz
   *  (OpenRouter: 50 ou 1.000 pedidos por dia). null quando não dá pra saber. */
  freeQuota?(apiKey: string): Promise<{ limit: number; remaining?: number } | null>;
  /** O estado da chave agora — grátis de hoje e crédito (OpenRouter). */
  keyStatus?(apiKey: string): Promise<import("./openrouter").EstadoDaChave | null>;
}

/**
 * Erros de provider são mapeados pra mensagens amigáveis em PT-BR.
 * Quem chamar `chat()` deve fazer try/catch e exibir `err.message` direto.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "no-key"
      | "invalid-key"
      | "rate-limit"
      | "network"
      // Gemini: API exige billing ativo (assinatura consumer não cobre a API). v0.1.162
      | "billing"
      // (P1-26) Conversa maior que a janela do modelo — retry é determinístico,
      // a saída é novo chat / reduzir histórico.
      | "context-overflow"
      | "unknown"
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

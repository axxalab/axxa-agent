// src/providers/ollama.ts
// Provider Ollama — LLMs locais via servidor HTTP.
// Endpoint: settings.ollamaEndpoint — vazio de fábrica desde a 0.9.20 (o
// Ollama começa desligado; ver core/ollamaPadrao.ts). Sem auth (local).
//
// Diferenças do OpenAI:
//   - Body: { model, messages, stream, tools?, options? }
//   - Resposta streaming: JSON delimitado por NEWLINE (não SSE com "data:")
//   - Cada linha: {"message": {"role":"assistant","content":"..."}, "done":false}
//   - Última linha: {"done":true, "prompt_eval_count":..., "eval_count":...}
//
// Tool calling (v0.1.33):
//   - Body envia `tools[]` mesmo formato OpenAI (sem `tool_choice` — Ollama ignora)
//   - Resposta: `message.tool_calls[]` no formato `{function: {name, arguments}}`
//   - Pegadinha: `arguments` no Ollama vem como OBJETO (não JSON string como OpenAI)
//   - Pegadinha: tool_calls do Ollama frequentemente vêm SEM `id` — geramos um
//   - Modelos com tool calling: llama3.1, llama3.2, qwen2.5, mistral-large, etc.
//   - Modelos antigos / pequenos ignoram silenciosamente o campo `tools`
//
// Como a key não é necessária, passamos vazia mesmo.

import { requestUrl } from "obsidian";
import { pareceEmbeddingDoOllama } from "../rag/types";
import {
  Provider,
  ProviderError,
  ProviderRequest,
  ProviderResponse,
  ProviderToolCall,
  TokenHandler,
  Usage,
  UsageHandler,
  ReasoningHandler,
} from "./base";
import { resolveTemperature, resolveMaxTokens } from "./paramPolicy";
import {
  toOpenAIMessages,
  ensureOkRequest,
  ensureOkStream,
  fetchStream,
} from "./_shared";

// ---- O que o Ollama devolve (ver a nota em _shared.ts) -------------------
// Ollama não fala OpenAI-compatible aqui: tool call vem sem `id`, e os
// arguments chegam ora como objeto, ora como string JSON (depende do modelo).

interface ToolCallOllama {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

interface MensagemOllama {
  content?: unknown;
  tool_calls?: unknown;
}

interface RespostaOllama {
  message?: MensagemOllama;
  done?: boolean;
  error?: unknown;
  prompt_eval_count?: number;
  eval_count?: number;
  /** Do prompt, quanto o Ollama reaproveitou do cache KV (0.33.3+). O
   *  prompt_eval_count já inclui isso. */
  prompt_eval_cached_count?: number;
}

/** O usage do Ollama no formato do app (o lido do cache vem junto, quando vem). */
function usoDoOllama(r: RespostaOllama): Usage {
  const usage: Usage = { input: r.prompt_eval_count ?? 0, output: r.eval_count ?? 0 };
  if (typeof r.prompt_eval_cached_count === "number") usage.cacheRead = r.prompt_eval_cached_count;
  return usage;
}

interface CatalogoOllama {
  models?: Array<{ name?: unknown }>;
}

interface MensagemOpenAI {
  role?: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
}

/**
 * O histórico no formato que o `/api/chat` do Ollama aceita. Parte do
 * conversor OpenAI (que normaliza tool results e anexos) e desfaz as três
 * diferenças que quebravam o agente na SEGUNDA volta do loop de ferramentas:
 *   - `arguments` vai como OBJETO. O OpenAI quer string JSON; o Ollama recusa
 *     com 400 ("Value looks like object, but can't find closing '}'") — o
 *     agente com Ollama morria logo depois da primeira ferramenta.
 *   - `content` nunca vai `null` numa mensagem do assistente.
 *   - a resposta da ferramenta leva `tool_name`, que é como o Ollama liga o
 *     resultado à chamada (ele não usa `tool_call_id`).
 * E uma quarta, a da IMAGEM: o conversor OpenAI põe o anexo em `content` como
 * lista de partes (`text` + `image_url` com data URL), e o `/api/chat` só
 * aceita `content` string — recusava com 400 ("cannot unmarshal array into …
 * content of type string") qualquer mensagem com imagem, em modelo de visão
 * ou não. Aqui o texto volta a ser string e as imagens vão em `images`, em
 * base64 cru (sem o `data:…;base64,`). PDF o Ollama não lê: a parte cai.
 */
export function toOllamaMessages(messages: ProviderRequest["messages"]): unknown[] {
  const nomePorId = new Map<string, string>();
  return (toOpenAIMessages(messages) as MensagemOpenAI[]).map((m) => {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      return {
        role: "assistant",
        content: typeof m.content === "string" ? m.content : "",
        tool_calls: m.tool_calls.map((tc) => {
          const nome = tc.function?.name ?? "";
          if (tc.id) nomePorId.set(tc.id, nome);
          const bruto = tc.function?.arguments;
          let args: unknown = bruto ?? {};
          if (typeof bruto === "string") {
            try {
              args = JSON.parse(bruto);
            } catch {
              args = {};
            }
          }
          return { function: { name: nome, arguments: args } };
        }),
      };
    }
    if (m.role === "tool") {
      const nome = m.tool_call_id ? nomePorId.get(m.tool_call_id) : undefined;
      return { role: "tool", content: m.content, ...(nome ? { tool_name: nome } : {}) };
    }
    if (Array.isArray(m.content)) {
      const partes = m.content as ParteOpenAI[];
      const texto = partes
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text as string)
        .join("\n\n");
      const imagens = partes
        .filter((p) => p.type === "image_url")
        .map((p) => base64DaDataUrl(p.image_url?.url ?? ""))
        .filter((b) => b !== "");
      return {
        role: m.role,
        content: texto,
        ...(imagens.length > 0 ? { images: imagens } : {}),
      };
    }
    return m;
  });
}

interface ParteOpenAI {
  type?: string;
  text?: unknown;
  image_url?: { url?: string };
}

/** `data:image/png;base64,AAAA` → `AAAA` (o que o Ollama quer). Sem o
 *  prefixo, o texto já é o base64; um link http não é imagem que dê pra
 *  mandar e vira "". */
function base64DaDataUrl(url: string): string {
  const virgula = url.indexOf(",");
  if (url.startsWith("data:")) return virgula >= 0 ? url.slice(virgula + 1) : "";
  return /^https?:/i.test(url) ? "" : url;
}

/**
 * Tool calls do Ollama → ProviderToolCall[]. Era o MESMO bloco escrito duas
 * vezes (non-stream e stream); qualquer correção tinha que ser feita em dois
 * lugares. Sem name não há o que chamar, então a entrada é descartada.
 */
function toolCallsDoOllama(brutas: unknown): ProviderToolCall[] {
  if (!Array.isArray(brutas)) return [];
  const saida: ProviderToolCall[] = [];
  for (const [idx, tc] of (brutas as ToolCallOllama[]).entries()) {
    const fn = tc?.function;
    if (!fn?.name) continue;
    const raw = fn.arguments;
    let parsedArgs: Record<string, unknown> = {};
    if (raw && typeof raw === "object") {
      // Caminho Ollama: já vem como objeto.
      parsedArgs = raw as Record<string, unknown>;
    } else if (typeof raw === "string") {
      // Caminho compat: alguns modelos devolvem string JSON.
      try {
        parsedArgs = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        parsedArgs = { _raw: raw };
      }
    }
    saida.push({
      id: tc.id ?? `ollama_call_${Date.now()}_${idx}`,
      name: fn.name,
      arguments: parsedArgs,
    });
  }
  return saida;
}

// ── o tamanho da janela (num_ctx) ────────────────────────────────────────

/** O contexto máximo de cada modelo local, lido do /api/show uma vez. Sem
 *  resposta (servidor fora, Ollama antigo, modelo sem o campo) não guarda
 *  nada — tenta de novo no próximo pedido. */
const contextoMaximo = new Map<string, number>();

async function contextoDoModelo(endpoint: string, model: string): Promise<number | undefined> {
  const chave = `${endpoint}|${model}`;
  const sabido = contextoMaximo.get(chave);
  if (sabido) return sabido;
  try {
    const res = await requestUrl({
      url: `${endpoint}/api/show`,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ model }),
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) return undefined;
    const info = (res.json as { model_info?: Record<string, unknown> } | undefined)?.model_info;
    for (const [k, v] of Object.entries(info ?? {})) {
      if (k.endsWith(".context_length") && typeof v === "number" && v > 0) {
        contextoMaximo.set(chave, v);
        return v;
      }
    }
  } catch {
    // Sem o /api/show: segue sem o teto do modelo (ver contextoDoOllama).
  }
  return undefined;
}

/** Tokens que um pedido ocupa, por alto: 3 caracteres por token (português e
 *  o JSON das ferramentas rendem menos que os 4 do inglês), ~1k por imagem. */
export function tokensDoPedido(req: ProviderRequest): number {
  let chars = 0;
  let imagens = 0;
  for (const m of req.messages) {
    chars += m.content.length;
    if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
    for (const a of m.attachments ?? []) if (a.type === "image") imagens++;
  }
  if (req.tools && req.tools.length > 0) chars += JSON.stringify(req.tools).length;
  return Math.ceil(chars / 3) + imagens * 1000;
}

const DEGRAUS_DE_CONTEXTO = [8192, 16384, 32768, 65536, 131072, 262144];

/**
 * O num_ctx de um pedido. Sem ele o Ollama usa a janela padrão do servidor
 * (pequena) e CORTA o começo do prompt sem avisar — justamente as instruções
 * e as ferramentas do agente. Aqui: o menor degrau que cabe o prompt e a
 * resposta (até 8k dela), sem passar do que o modelo aguenta. Degraus fixos
 * porque mudar o num_ctx recarrega o modelo: com eles, uma conversa que
 * cresce recarrega poucas vezes. Sem saber o máximo do modelo, até 32k.
 */
export function contextoDoOllama(prompt: number, resposta: number, maxModelo?: number): number {
  const precisa = prompt + Math.min(resposta, 8192);
  const degrau =
    DEGRAUS_DE_CONTEXTO.find((d) => d >= precisa) ??
    DEGRAUS_DE_CONTEXTO[DEGRAUS_DE_CONTEXTO.length - 1];
  const teto = maxModelo && maxModelo > 0 ? maxModelo : 32768;
  return Math.min(degrau, teto);
}

/** O num_ctx do último pedido a cada modelo, e quando foi. */
const janelaEmUso = new Map<string, { ctx: number; quando: number }>();

/** Quanto o Ollama segura o modelo carregado sem pedido (o keep_alive
 *  padrão dele). */
const MODELO_CARREGADO_MS = 5 * 60 * 1000;

/**
 * O num_ctx que vai, dado o que o pedido precisa. Mudar o num_ctx RECARREGA
 * o modelo — e joga fora o que o Ollama tinha guardado do começo do prompt
 * (o histórico da conversa). Então, com o modelo ainda carregado, a janela
 * não desce: um pedido menor no meio (o título, uma pergunta curta noutra
 * conversa) usa a janela que já está lá. Parado há mais que o keep_alive, o
 * Ollama já descarregou: volta ao que o pedido precisa.
 */
export function janelaDoPedido(
  chave: string,
  precisa: number,
  agora: number,
  maxModelo?: number
): number {
  const antes = janelaEmUso.get(chave);
  let ctx = precisa;
  if (antes && agora - antes.quando < MODELO_CARREGADO_MS && antes.ctx > ctx) {
    ctx = maxModelo && maxModelo > 0 ? Math.min(antes.ctx, maxModelo) : antes.ctx;
  }
  janelaEmUso.set(chave, { ctx, quando: agora });
  return ctx;
}

export class OllamaProvider implements Provider {
  id = "ollama";
  name = "Ollama";
  // Ollama ≥0.3 suporta tool calling em modelos compatíveis (llama3.1+,
  // qwen2.5+, mistral-large, etc). Modelos antigos ignoram silenciosamente.
  // O usuário precisa escolher um modelo que tenha tools no card do Ollama.
  supportsTools = true;

  /** Endpoint base que vem das settings (apiKey no nosso modelo, mas é URL). */
  private getEndpoint(apiKey: string): string {
    // No nosso modelo, apiKey carrega o endpoint do Ollama (settings.ollamaEndpoint)
    const DEFAULT = "http://localhost:11434";
    // Vazio é DESLIGADO, não "use o localhost": cair no padrão aqui buscaria
    // modelos (e mandaria conversa) num servidor que ninguém configurou. O
    // chat já barra antes (helpers.semCredencial); isto cobre o Fetch.
    if (!apiKey.trim()) {
      throw new ProviderError(
        "Set your Ollama server address first (Settings → Providers → Ollama, usually http://localhost:11434).",
        "unknown"
      );
    }
    const url = apiKey.trim().replace(/\/$/, "");
    // v0.1.228: valida o endpoint configurado — URL malformada ou esquema
    // não-HTTP cai pro default localhost em vez de produzir erros confusos.
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        console.warn(`[Ollama] Endpoint com esquema inválido (${parsed.protocol}), usando ${DEFAULT}.`);
        return DEFAULT;
      }
    } catch {
      console.warn(`[Ollama] Endpoint inválido ("${url}"), usando ${DEFAULT}.`);
      return DEFAULT;
    }
    return url;
  }

  /** O corpo do /api/chat — o mesmo pros dois caminhos (com e sem stream). */
  private async corpo(
    req: ProviderRequest,
    endpoint: string,
    stream: boolean
  ): Promise<Record<string, unknown>> {
    const numPredict = resolveMaxTokens("ollama", req.model, req.maxTokens ?? 2000, req.effort);
    const maxModelo = await contextoDoModelo(endpoint, req.model);
    const numCtx = janelaDoPedido(
      `${endpoint}|${req.model}`,
      contextoDoOllama(tokensDoPedido(req), numPredict, maxModelo),
      Date.now(),
      maxModelo
    );
    const temp = resolveTemperature("ollama", req.model, req.temperature);
    // Body com OpenAI-compat messages — reusa o converter pra normalizar
    // assistant.tool_calls e tool results.
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOllamaMessages(req.messages),
      stream,
      options: {
        num_predict: numPredict,
        num_ctx: numCtx,
        ...(temp !== undefined ? { temperature: temp } : {}),
      },
    };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      // Ollama NÃO usa tool_choice — qualquer valor é ignorado, então omitimos.
    }
    return body;
  }

  async chat(req: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    const endpoint = this.getEndpoint(apiKey);
    const body = await this.corpo(req, endpoint, false);

    let res;
    try {
      res = await requestUrl({
        url: `${endpoint}/api/chat`,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(body),
        throw: false,
      });
    } catch {
      throw new ProviderError(
        `Connection to Ollama at ${endpoint} failed. Make sure the server is running.`,
        "network"
      );
    }

    ensureOkRequest(res, { label: "Ollama" });

    const corpo = res.json as RespostaOllama | undefined;
    const message = corpo?.message;
    if (!message) {
      throw new ProviderError("Empty response from Ollama.", "unknown");
    }

    // Parseia tool_calls — formato Ollama:
    //   { function: { name: string, arguments: object | string } }
    // Sem `id` na maioria dos casos — geramos um pra fechar o loop.
    const lidas = toolCallsDoOllama(message.tool_calls);
    const toolCalls = lidas.length > 0 ? lidas : undefined;

    const content = typeof message.content === "string" ? message.content : "";
    if (!toolCalls && !content) {
      throw new ProviderError(
        "Empty response from Ollama (no text or tool_calls).",
        "unknown"
      );
    }

    const result: ProviderResponse = { content };
    if (toolCalls) result.toolCalls = toolCalls;
    // Usage tokens (vem no response não-streaming também)
    if (corpo?.prompt_eval_count !== undefined || corpo?.eval_count !== undefined) {
      result.usage = usoDoOllama(corpo);
    }
    return result;
  }

  async streamChat(
    req: ProviderRequest,
    apiKey: string,
    onToken: TokenHandler,
    onUsage?: UsageHandler,
    signal?: AbortSignal,
    // o Ollama não emite trilha de raciocínio separada, então o handler entra
    // só pra assinatura bater com os outros providers e fica sem uso.
    _onReasoning?: ReasoningHandler
  ): Promise<ProviderResponse> {
    const endpoint = this.getEndpoint(apiKey);
    const body = await this.corpo(req, endpoint, true);

    let res: Response;
    try {
      res = await fetchStream(`${endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ProviderError(
        `Connection to Ollama at ${endpoint} failed. Is the server running?`,
        "network"
      );
    }

    await ensureOkStream(res, { label: "Ollama" });
    if (!res.body) {
      throw new ProviderError("Empty stream from Ollama.", "unknown");
    }

    // Parser NDJSON — cada linha é um JSON completo (não SSE)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedText = "";
    let usage: Usage | undefined;
    // v0.1.228: Ollama emite o bloco INTEIRO de tool_calls (não deltas) e pode
    // reenviar o array em mais de uma linha — guardamos só o último recebido em
    // vez de concatenar, evitando tool calls duplicados.
    let lastToolCalls: ProviderToolCall[] = [];

    // v0.1.228: try/finally garante liberar o reader em erro/abort (o read()
    // já rejeita com AbortError quando o signal aborta, via fetch).
    try {
      while (true) {
        // v0.1.228: aborta cedo se o signal já disparou (read() também rejeita,
        // mas isto encurta o ciclo entre chunks).
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let json: RespostaOllama;
          try {
            json = JSON.parse(trimmed) as RespostaOllama;
          } catch {
            // v0.1.228: linha provavelmente truncada — o buffer já guarda o
            // resto (último split vira o novo buffer), então ignoramos.
            continue;
          }
          // v0.1.228: Ollama sinaliza erros de runtime com um campo `error` na
          // própria linha do stream — propaga em vez de engolir silenciosamente.
          if (typeof json.error === "string" && json.error) {
            throw new ProviderError(`Ollama: ${json.error}`, "unknown");
          }
          const message = json?.message;
          const token = message?.content;
          if (typeof token === "string" && token.length > 0) {
            accumulatedText += token;
            onToken(token);
          }
          // Ollama emite tool_calls inteiros (não em deltas) — geralmente
          // numa linha só, próximo do final do stream. Se reenviar, o array
          // novo SUBSTITUI o anterior (não acumula).
          const parsed = toolCallsDoOllama(message?.tool_calls);
          if (parsed.length > 0) lastToolCalls = parsed;
          if (json?.done === true) {
            usage = usoDoOllama(json);
            if (onUsage) onUsage(usage);
            const result: ProviderResponse = { content: accumulatedText };
            if (lastToolCalls.length > 0) result.toolCalls = lastToolCalls;
            if (usage) result.usage = usage;
            return result;
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* já liberado */ }
    }
    const result: ProviderResponse = { content: accumulatedText };
    if (lastToolCalls.length > 0) result.toolCalls = lastToolCalls;
    if (usage) result.usage = usage;
    return result;
  }

  /** Lista modelos instalados localmente via /api/tags */
  async listModels(apiKey: string): Promise<string[]> {
    const endpoint = this.getEndpoint(apiKey);
    let res;
    try {
      res = await requestUrl({
        url: `${endpoint}/api/tags`,
        method: "GET",
        throw: false,
      });
    } catch {
      throw new ProviderError(
        `Connection to Ollama at ${endpoint} failed.`,
        "network"
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new ProviderError(`Ollama: HTTP ${res.status}`, "unknown");
    }
    const models = (res.json as CatalogoOllama | undefined)?.models ?? [];
    return models
      .map((m) => m?.name)
      .filter((n): n is string => typeof n === "string")
      .sort();
  }

  /**
   * Os modelos de EMBEDDING instalados — o que deixa o Vault Q&A rodar sem
   * nuvem. O nome resolve as famílias comuns (nomic-embed-text, mxbai, bge,
   * all-minilm…); o resto pergunta ao /api/show, que nos Ollama recentes diz
   * "embedding" nas capabilities. Sem resposta dele, fica só o nome.
   */
  async listEmbeddingModels(apiKey: string): Promise<string[]> {
    const endpoint = this.getEndpoint(apiKey);
    const todos = await this.listModels(apiKey);
    const porNome = todos.filter((m) => pareceEmbeddingDoOllama(m));
    const resto = todos.filter((m) => !pareceEmbeddingDoOllama(m));
    const porCapacidade = await Promise.all(
      resto.map(async (model) => {
        try {
          const res = await requestUrl({
            url: `${endpoint}/api/show`,
            method: "POST",
            contentType: "application/json",
            body: JSON.stringify({ model }),
            throw: false,
          });
          const caps = (res.json as { capabilities?: unknown } | undefined)?.capabilities;
          return Array.isArray(caps) && caps.includes("embedding") ? model : null;
        } catch {
          return null;
        }
      })
    );
    return [...porNome, ...porCapacidade.filter((m): m is string => m !== null)].sort();
  }
}

export const ollamaProvider = new OllamaProvider();

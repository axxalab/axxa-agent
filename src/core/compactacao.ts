// src/core/compactacao.ts
// Conversa longa que não cabe mais na janela do modelo: o COMEÇO dela vira um
// resumo, e o modelo segue recebendo o resumo + as mensagens recentes inteiras.
//
// Antes, a conversa que passava da janela travava: todo turno dava "contexto
// estourado" (ou, no Ollama, que não avisa, o começo do prompt — instruções e
// ferramentas — era cortado em silêncio). Agora:
//   · antes de cada turno, se o pedido passa de 80% da janela, o começo vira
//     resumo (feito pelo próprio modelo da conversa);
//   · se o provider recusar mesmo assim, resume com mais folga e tenta de novo;
//   · o resumo fica NA mensagem do corte (e no arquivo): reabrir a conversa
//     não refaz o trabalho, e a tela continua mostrando tudo.
//
// Cache: resumir troca o começo do pedido (o cache recomeça uma vez); depois,
// resumo + recentes viram o começo estável, e o histórico volta a crescer só
// no fim. Por isso o corte deixa folga (30% da janela) — pra não resumir de
// novo no turno seguinte.

import {
  ProviderError,
  type Provider,
  type ProviderToolDefinition,
} from "../providers/base";
import { janelaDoOllama, tokensDoAnexo, tokensDoPedido } from "../providers/ollama";
import { getEnrichedInfo } from "../providers/modelInfoStore";
import { getModelCard } from "../providers/modelDescriptions";
import { getContextWindow } from "./contextWindows";
import {
  RODADA_COM_ERRO,
  flattenAgentResponse,
  inicioVisivel,
  storeMessagesToProvider,
  type OpcoesDoHistorico,
  type StoreMessageLike,
} from "../agent/conversation";
import { useChatStore } from "../store/chat";
import { estadoDoTurno } from "./contextoDoTurno";

/** Passou disto da janela (pedido + a resposta), resume. */
export const LIMIAR = 0.8;
/** O que fica inteiro depois do corte: até isto da janela. */
export const MANTER = 0.3;
/** Depois de o provider recusar, com mais folga. */
export const MANTER_APERTADO = 0.15;

// ── o tamanho da janela ──────────────────────────────────────────────────

/** A janela que o próprio provider disse ter, num erro de contexto estourado. */
const aprendidas = new Map<string, number>();

/**
 * O tamanho da janela dito no texto de um erro de contexto estourado. Cada
 * provider diz de um jeito; o número que vale é o do máximo, não o do pedido.
 */
export function janelaNoErro(texto: string): number | null {
  const padroes = [
    // OpenAI e compatíveis: "maximum context length is 32768 tokens"
    /maximum context length is\s*([\d,.]+)/i,
    // Anthropic: "prompt is too long: 215000 tokens > 200000 maximum"
    /tokens?\s*>\s*([\d,.]+)\s*maximum/i,
    // Anthropic: "exceed context limit: 188240 + 21333 > 200000"
    /context limit:\s*[\d,.]+\s*\+\s*[\d,.]+\s*>\s*([\d,.]+)/i,
    // Gemini: "exceeds the maximum number of tokens allowed (1048576)"
    /maximum number of tokens allowed\s*\(?\s*([\d,.]+)/i,
    // Genérico: "context window of 8192", "context length: 4096"
    /context (?:window|length)(?: of| is|:)\s*([\d,.]+)/i,
  ];
  for (const re of padroes) {
    const m = re.exec(texto);
    if (!m) continue;
    const n = parseInt(m[1].replace(/[,.]/g, ""), 10);
    if (n >= 1024 && n <= 50_000_000) return n;
  }
  return null;
}

/** Guarda a janela que o erro do provider revelou (vale pra sessão). */
export function aprenderJanela(provider: string, model: string, erro: unknown): void {
  const n = janelaNoErro(erro instanceof Error ? erro.message : String(erro ?? ""));
  if (n) aprendidas.set(`${provider}|${model}`, n);
}

/** O provider recusou o pedido por tamanho? */
export function ehEstouro(erro: unknown): boolean {
  return erro instanceof ProviderError && erro.code === "context-overflow";
}

/**
 * Quantos tokens cabem num pedido a este modelo. Na ordem: o que o próprio
 * provider disse num erro; no Ollama, o máximo do modelo (/api/show) até onde
 * o num_ctx vai; o catálogo buscado ("Fetch info"); o cartão do modelo; a
 * tabela. Errar pra cima é o caso que o erro do provider corrige.
 */
export async function janelaDoModelo(
  provider: string,
  model: string,
  credencial: string
): Promise<number> {
  const aprendida = aprendidas.get(`${provider}|${model}`);
  if (aprendida) return aprendida;
  if (provider === "ollama") return janelaDoOllama(credencial, model);
  const doCatalogo = getEnrichedInfo(provider, model)?.contextWindow;
  if (doCatalogo && doCatalogo > 0) return doCatalogo;
  const doCartao = getModelCard(provider, model).contextWindow;
  if (doCartao && doCartao > 0) return doCartao;
  return getContextWindow(model);
}

/**
 * O teto da resposta que ainda cabe: pedido + resposta não podem passar da
 * janela (vários providers recusam o pedido inteiro se passar). Vai como
 * `maxTokensTeto` — vale depois do piso dos modelos que pensam. Nunca abaixo
 * de 1k: a estimativa é por alto, e quem decide no fim é o provider.
 */
export function tetoDaResposta(janela: number, pedido: number): number {
  return Math.max(1024, janela - pedido - 512);
}

/** O erro de quem apertou Parar. */
function parado(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/** Espera a promessa, ou o Parar — o que vier primeiro. */
function ateParar<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(parado());
  return new Promise<T>((ok, falha) => {
    const aoParar = () => falha(parado());
    signal.addEventListener("abort", aoParar, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", aoParar);
        ok(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", aoParar);
        falha(e);
      }
    );
  });
}

// ── onde cortar ──────────────────────────────────────────────────────────

/** A mensagem vai pro modelo? (as de atividade e os erros sem passos, não) */
function vai(m: StoreMessageLike): boolean {
  return (
    m.type === "user" ||
    (m.type === "ai-response" && (!m.isError || (m.agentSteps?.length ?? 0) > 0))
  );
}

/** Tokens de uma mensagem do store, por alto (a mesma conta do pedido). */
export function custoDaMensagem(m: StoreMessageLike): number {
  if (!vai(m)) return 0;
  let chars = (m.content ?? "").length + (m.contexto ?? "").length + (m.resumo ?? "").length;
  if (m.agentSteps) chars += JSON.stringify(m.agentSteps).length;
  return Math.ceil(chars / 3) + (m.anexos ?? []).reduce((s, a) => s + tokensDoAnexo(a), 0);
}

/**
 * O índice da mensagem do usuário a partir da qual a conversa fica inteira:
 * a mais antiga cujo trecho até o fim cabe em `orcamento` — e, no mínimo, a
 * última mensagem do usuário (a do turno). Corta sempre numa mensagem do
 * usuário (nunca no meio de uma rodada) e sempre DEPOIS do resumo atual. Null:
 * não há o que resumir.
 */
export function pontoDeCorte(
  msgs: readonly StoreMessageLike[],
  orcamento: number
): number | null {
  const inicio = inicioVisivel(msgs);
  let soma = 0;
  let corte: number | null = null;
  for (let i = msgs.length - 1; i > inicio; i--) {
    soma += custoDaMensagem(msgs[i]);
    if (msgs[i].type !== "user") continue;
    if (corte === null || soma <= orcamento) corte = i;
    else break;
  }
  if (corte === null) return null;
  // Antes do corte precisa haver conversa de verdade pra resumir.
  return msgs.slice(inicio, corte).some(vai) ? corte : null;
}

// ── o resumo ─────────────────────────────────────────────────────────────

const PROMPT_DO_RESUMO =
  "You compress the earlier part of a conversation between a user and an AI assistant " +
  "that works inside Obsidian (a notes app), so the assistant can continue without the " +
  "full transcript.\n\n" +
  "Write a faithful, dense summary that keeps:\n" +
  "- what the user wants: goals, constraints, preferences, and instructions about how to answer;\n" +
  "- decisions made and conclusions reached;\n" +
  "- concrete facts, names, numbers, dates and short quotes that may matter later;\n" +
  "- the notes and files mentioned, read, created, edited, moved or deleted (with their paths), " +
  "and what was done to each;\n" +
  "- open questions and anything still pending.\n\n" +
  "Rules: never invent anything; say who said what when it matters; write in the same " +
  "language as the conversation; use short headed sections with bullet points; no preamble. " +
  "If a previous summary is given, merge it into the new one and keep everything in it " +
  "that still matters.";

/** As notas que foram junto com uma mensagem (pelo cabeçalho de cada uma). */
function notasDoContexto(contexto?: string): string[] {
  if (!contexto) return [];
  const nomes = new Set<string>();
  for (const m of contexto.matchAll(/^### (.+)$/gm)) nomes.add(m[1].trim());
  return [...nomes];
}

/**
 * A conversa em texto, pra quem vai resumir: o que cada um disse, as ações do
 * agente, e QUAIS notas foram junto (o conteúdo delas não — está no vault, e o
 * modelo busca de novo se precisar).
 */
export function transcricao(msgs: readonly StoreMessageLike[]): string[] {
  const partes: string[] = [];
  for (const m of msgs) {
    if (!vai(m)) continue;
    if (m.type === "user") {
      const linhas = [`### User\n${(m.content ?? "").trim()}`];
      const notas = notasDoContexto(m.contexto);
      if (notas.length) linhas.push(`[Notes sent along: ${notas.join(", ")}]`);
      const midia = (m.anexos ?? [])
        .map((a) => (a.type === "image" || a.type === "pdf" ? `${a.type} "${a.name}"` : a.type))
        .filter(Boolean);
      if (midia.length) linhas.push(`[Attached: ${midia.join(", ")}]`);
      partes.push(linhas.join("\n"));
    } else {
      const texto = m.isError ? RODADA_COM_ERRO : (m.content ?? "").trim();
      partes.push(
        `### Assistant\n${m.agentSteps?.length ? flattenAgentResponse(texto, m.agentSteps) : texto}`
      );
    }
  }
  return partes;
}

/** Junta as partes em pedaços de até `teto` caracteres (parte maior é aparada). */
export function emPedacos(partes: readonly string[], teto: number): string[] {
  const pedacos: string[] = [];
  let atual = "";
  for (const bruta of partes) {
    const parte = bruta.length > teto ? `${bruta.slice(0, teto - 40)}\n[… trimmed]` : bruta;
    if (atual && atual.length + parte.length + 2 > teto) {
      pedacos.push(atual);
      atual = "";
    }
    atual = atual ? `${atual}\n\n${parte}` : parte;
  }
  if (atual) pedacos.push(atual);
  return pedacos;
}

interface Resumidor {
  provider: Provider;
  model: string;
  apiKey: string;
  janela: number;
  /** A conversa a que o gasto do resumo pertence. */
  dono: string | null;
  /** O Parar do turno: larga o resumo na hora (o gasto do pedido que já
   *  saiu ainda entra quando ele voltar). */
  signal?: AbortSignal;
}

/**
 * O resumo das mensagens `antigas` (somado ao resumo anterior, se houver).
 * Pedido avulso, sem stream e sem ferramentas; se a conversa antiga não cabe
 * num pedido só, vai em pedaços, cada um somado ao resumo do anterior.
 */
export async function resumir(
  r: Resumidor,
  antigas: readonly StoreMessageLike[],
  resumoAnterior?: string
): Promise<string> {
  const teto = Math.floor(r.janela * 0.5) * 3; // ~50% da janela, em caracteres
  const saida = Math.max(1024, Math.min(4096, Math.floor(r.janela * 0.1)));
  let resumo = resumoAnterior?.trim() || "";
  for (const pedaco of emPedacos(transcricao(antigas), teto)) {
    if (r.signal?.aborted) throw parado();
    const pedido =
      (resumo ? `<previous_summary>\n${resumo}\n</previous_summary>\n\n` : "") +
      `<transcript>\n${pedaco}\n</transcript>\n\nWrite the summary now.`;
    const mensagens = [
      { role: "system" as const, content: PROMPT_DO_RESUMO },
      { role: "user" as const, content: pedido },
    ];
    // O gasto entra quando o pedido volta — mesmo que o Parar já tenha
    // largado ele (o provider cobrou).
    const pedidoAoModelo = r.provider
      .chat(
        {
          model: r.model,
          messages: mensagens,
          maxTokens: saida,
          maxTokensTeto: tetoDaResposta(r.janela, tokensDoPedido({ model: r.model, messages: mensagens })),
          temperature: 0.2,
          effort: "low",
        },
        r.apiKey
      )
      .then((resp) => {
        if (resp.usage) useChatStore.getState().addUsage(resp.usage, r.dono);
        return resp;
      });
    const resp = await ateParar(pedidoAoModelo, r.signal);
    const texto = (resp.content ?? "").trim();
    if (!texto) throw new Error("empty summary");
    resumo = texto;
  }
  return resumo;
}

// ── no meio de uma rodada do agente ──────────────────────────────────────

/** O que fica de um resultado de ferramenta encolhido. */
const RESTO_DO_RESULTADO = 1000;
/** Os resultados mais recentes que ficam inteiros. */
const RESULTADOS_INTEIROS = 2;

/**
 * Uma rodada longa do agente (muitas notas lidas) que passou da janela: os
 * resultados de ferramenta mais antigos encolhem pro começo deles — o modelo
 * já tirou deles o que precisava, e pode chamar a ferramenta de novo. Os 2
 * mais recentes ficam inteiros. Devolve quantos encolheu.
 */
export function encolherResultados(history: { role: string; content: string }[]): number {
  const deFerramenta = history
    .map((m, i) => (m.role === "tool" ? i : -1))
    .filter((i) => i >= 0)
    .slice(0, -RESULTADOS_INTEIROS);
  let encolhidos = 0;
  for (const i of deFerramenta) {
    const m = history[i];
    if (m.content.length <= RESTO_DO_RESULTADO + 200) continue;
    history[i] = {
      ...m,
      content:
        m.content.slice(0, RESTO_DO_RESULTADO) +
        "\n[… result trimmed to fit the context window — call the tool again if you need the rest]",
    };
    encolhidos++;
  }
  return encolhidos;
}

// ── no turno ─────────────────────────────────────────────────────────────

export interface PedidoDoTurno {
  provider: Provider;
  providerId: string;
  model: string;
  apiKey: string;
  /** O system prompt do turno e o jeito de montar o histórico. */
  system: string;
  opcoes: OpcoesDoHistorico;
  tools?: ProviderToolDefinition[];
  maxTokens: number;
  dono: string | null;
  /** Depois de o provider recusar por tamanho: resume com mais folga. */
  apertado?: boolean;
  /** Avisos pra tela (o "Pensando…" vira "Resumindo…" e volta). */
  avisar?: (fase: "resumindo" | "pronto" | "falhou") => void;
  /** O Parar do turno. */
  signal?: AbortSignal;
}

/** Quando resumir falhou por último, por conversa: não tenta de novo a cada
 *  turno (cada tentativa é um pedido pago). */
const falhouEm = new Map<string, number>();
const ESPERA_DEPOIS_DE_FALHAR = 5 * 60 * 1000;

export type ResultadoDaJanela = { janela: number; resumiu: boolean };

/**
 * Garante que o pedido do turno caiba na janela do modelo, resumindo o começo
 * da conversa se preciso. Falha ao resumir não derruba o turno: ele segue como
 * está (e, se não couber, o provider diz).
 */
export async function caberNaJanela(p: PedidoDoTurno): Promise<ResultadoDaJanela> {
  const janela = await janelaDoModelo(p.providerId, p.model, p.apiKey);
  const msgs = estadoDoTurno().mensagens;
  const pedido = tokensDoPedido({
    model: p.model,
    messages: [{ role: "system", content: p.system }, ...storeMessagesToProvider(msgs, p.opcoes)],
    tools: p.tools,
  });
  const reserva = Math.min(p.maxTokens, 8192);
  if (!p.apertado && pedido + reserva <= janela * LIMIAR) return { janela, resumiu: false };
  const chaveDaFalha = `${p.providerId}|${p.model}|${p.dono ?? ""}`;
  const falhou = falhouEm.get(chaveDaFalha);
  if (!p.apertado && falhou && Date.now() - falhou < ESPERA_DEPOIS_DE_FALHAR) {
    return { janela, resumiu: false };
  }

  const corte = pontoDeCorte(msgs, Math.floor(janela * (p.apertado ? MANTER_APERTADO : MANTER)));
  if (corte === null) return { janela, resumiu: false };
  const inicio = inicioVisivel(msgs);
  const alvo = msgs[corte];
  p.avisar?.("resumindo");
  try {
    const resumo = await resumir(
      { provider: p.provider, model: p.model, apiKey: p.apiKey, janela, dono: p.dono, signal: p.signal },
      msgs.slice(inicio, corte),
      msgs[inicio]?.type === "user" ? msgs[inicio].resumo : undefined
    );
    useChatStore.getState().setResumo(alvo.id, resumo);
    falhouEm.delete(chaveDaFalha);
    p.avisar?.("pronto");
    return { janela, resumiu: true };
  } catch (err) {
    p.avisar?.("falhou");
    // Parar não é falha: sobe, e o turno para.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    console.warn("[AXXA] couldn't summarize the conversation:", err);
    falhouEm.set(chaveDaFalha, Date.now());
    return { janela, resumiu: false };
  }
}

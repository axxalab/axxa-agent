// src/store/chat.ts
// Store Zustand do chat — fonte única de verdade pras mensagens.
// Analogia: pensa nele como o "Layers panel" no Figma — uma lista ordenada de
// elementos (mensagens), cada um com seu tipo. Componentes leem essa lista e
// renderizam o variant correto pra cada item.

import { create } from "zustand";
import type { AIToolStep } from "../agent/types";
import type { MessageAttachment } from "../providers/base";

export type MessageType = "user" | "ai-response" | "ai-comment" | "ai-options";

/** Código de erro propagado do provider → UI (mesma união do ProviderError). */
export type AIErrorCode =
  | "no-key"
  | "invalid-key"
  | "rate-limit"
  | "network"
  | "billing"
  | "context-overflow"
  | "unknown";

interface BaseMessage {
  id: string;
  type: MessageType;
  timestamp: number;
}

export interface UserMessage extends BaseMessage {
  type: "user";
  content: string;
  /**
   * O que foi junto com esta mensagem pro modelo: os trechos do vault que a
   * busca achou e as notas anexadas, já em texto. Fica NA mensagem (e no
   * arquivo) pra ir de novo em todo turno seguinte — antes o modelo via isso
   * uma vez e esquecia; e, no começo do pedido, mudava a cada turno e
   * derrubava o cache de prompt de todos os providers.
   */
  contexto?: string;
  /** Imagens e PDFs desta mensagem (só na sessão: não vão pro arquivo). Vão
   *  de novo em todo turno, no lugar onde foram mandados. */
  anexos?: MessageAttachment[];
}

export interface AIResponseMessage extends BaseMessage {
  type: "ai-response";
  content: string;
  /** Reaction do user — persiste no .md, sobrevive a reload. */
  reaction?: "like" | "dislike" | null;
  /** True quando essa "resposta" é uma mensagem de erro do sistema (rate limit,
   *  network, etc.), não uma resposta real do LLM. Mensagens com isError:
   *   - NÃO entram no history enviado ao provider (não poluem o contexto)
   *   - NÃO são persistidas no .md (somem ao recarregar o chat)
   *  Renderizam normalmente na UI pro user ver o que aconteceu. */
  isError?: boolean;
  /** Código do erro (quando isError). Permite à UI oferecer ação específica:
   *  no-key/invalid-key → "Abrir Configurações"; os demais → só "Tentar de novo". */
  errorCode?: AIErrorCode;
  /** Ações de tool do agent que levaram a esta resposta (Agent mode). Persistidas
   *  pra dar continuidade de contexto ao reabrir o chat. v0.1.160 */
  agentSteps?: AIToolStep[];
  /** True quando a resposta foi cortada no limite de tokens (output ≈ maxTokens).
   *  Mostra um botão "Continuar" no footer pra emendar de onde parou. */
  truncated?: boolean;
  /** Raciocínio (reasoning/thinking) acumulado do stream — só modelos que
   *  expõem (ex: DeepSeek R1). Renderizado num painel colapsável. v0.1.193 */
  reasoning?: string;
  /** Versões geradas ao regenerar (branching). content = variants[variantIndex].
   *  Ausente/≤1 = sem ramificação. Permite navegar ‹ 1/N › entre respostas. */
  variants?: string[];
  variantIndex?: number;
}

/**
 * Activity tracking — opcional. Quando presente, o ai-comment vira um
 * "activity step" com ícone animado durante phase="pending" e ícone fixo
 * + check quando phase="done"/"failed".
 *
 * Inspiração: estilo do Claude Code (timeline de tools que pulsa enquanto
 * roda e mostra resultado quando termina).
 */
export interface ActivityMeta {
  phase: "pending" | "done" | "failed";
  /** Ícone Lucide enquanto pending (pulsando). Ex: "eye", "file-pen-line". */
  iconPending: string;
  /** Ícone Lucide quando done (estático). Default: "check". */
  iconDone?: string;
  /** Ícone Lucide quando failed. Default: "x". */
  iconFailed?: string;
  /** Texto enquanto pending (ex: "Lendo notas/foo.md"). */
  pendingText: string;
  /** Texto quando done (ex: "Notas/foo.md lida — 1.2k chars"). Fallback: pendingText sem o gerúndio. */
  doneText?: string;
  /** Texto quando failed. Default: "Falhou: " + error message. */
  failedText?: string;
  /** Conteúdo expansível (snippet do resultado) — mostrado no chip ao clicar
   *  no chevron, estilo Claude Code (v0.1.111). */
  detail?: string;
  /** Quando "image" e phase=pending, renderiza um PLACEHOLDER com gradiente
   *  animado (a "moldura" da imagem sendo gerada, estilo ChatGPT). v0.1.182 */
  placeholder?: "image";
  /** A mudança no vault que esta linha narra pode ser desfeita: o id no
   *  registro do agent/undo.ts (o da própria mensagem). Só vale na sessão em
   *  que ela aconteceu — fora dela o registro não tem, e o Undo não aparece. */
  undoId?: string;
  /** Já foi desfeita. */
  undone?: boolean;
}

export interface AICommentMessage extends BaseMessage {
  type: "ai-comment";
  content: string;
  /** Quando set, renderiza como ActivityComment animado em vez de bubble simples. */
  activity?: ActivityMeta;
}

export interface AIOptionsMessage extends BaseMessage {
  type: "ai-options";
  prompt: string;
  options: string[];
  selectedIndex?: number;
}

export type ChatMessage =
  | UserMessage
  | AIResponseMessage
  | AICommentMessage
  | AIOptionsMessage;

// DistributiveOmit aplica o Omit em cada membro do union separadamente.
// Sem isso, Omit<ChatMessage, "id"> colapsa pros campos comuns dos 4 variants
// e perde a discriminação por `type`.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type NewMessageInput = DistributiveOmit<ChatMessage, "id" | "timestamp">;

/**
 * Um turno que continua rodando com a conversa dele FORA da tela.
 *
 * O store é um só e o motor escreve nele direto (ele pega as ações no topo,
 * uma vez só). Então "responder em segundo plano" aqui não é rodar em outro
 * lugar: é DESVIAR a escrita. Enquanto isto existe, tudo que o turno produz —
 * mensagem, token, passo de tool — cai aqui dentro em vez de cair na conversa
 * que a pessoa está olhando.
 *
 * Sem o desvio, sair do chat no meio de uma resposta fazia a mensagem de
 * "Interrompido", os passos do agente e a contagem de tokens caírem NO ARQUIVO
 * DA OUTRA CONVERSA: o turno morria DEPOIS da troca, e a essa altura o store
 * já tinha outro dono.
 *
 * Carrega a identidade da conversa junto porque quem salva no fim é ela, e o
 * `currentChatId` já pertence a outra pessoa quando isso acontece.
 */
export interface BackgroundRun {
  chatId: string;
  /**
   * Onde a leitura parou quando a conversa saiu da tela (scrollTop em px).
   *
   * Funciona porque o texto novo é sempre ACRESCENTADO embaixo: o que está
   * acima não se mexe, então o mesmo scrollTop mostra exatamente a mesma
   * coisa quando ela volta — e tudo que chegou enquanto você não estava
   * olhando fica logo abaixo.
   */
  scrollTop: number;
  title: string;
  mode: string;
  provider: string;
  model: string;
  effort: string;
  messages: ChatMessage[];
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  tokensCacheWrite: number;
  /** O que é DA CONVERSA e vai junto com o turno: sem isto, a gravação em
   *  segundo plano apagava do arquivo as instruções do projeto (e a persona,
   *  a estrela, o interruptor das notas), e o turno lia as da conversa que
   *  estivesse na tela. */
  persona?: string;
  instructions?: string;
  starred?: boolean;
  vault?: boolean;
}

/** O uso de UM pedido, como o provider contou (ver providers/base Usage). */
export interface UsoDoPedido {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  /** Carregando uma conversa antiga do disco (read + parse + render). Enquanto
   *  true, o ChatArea mostra um skeleton no lugar das mensagens. */
  loadingChat: boolean;
  /** Tokens acumulados da sessão atual (in = prompt, out = completion). */
  tokensIn: number;
  tokensOut: number;
  /** Do tokensIn, quanto veio do cache de prompt / foi gravado nele. */
  tokensCached: number;
  tokensCacheWrite: number;
  /** Última snapshot de prompt_tokens (usado pra estimar "contexto usado") */
  lastPromptTokens: number;
  /** Id da mensagem que tá sendo streamada agora (pra esconder footer durante stream). */
  streamingMessageId: string | null;
  /** Timestamp (ms) do primeiro token do stream atual. null entre streams. */
  streamStartedAt: number | null;
  /** Quantidade aproximada de tokens recebidos no stream atual (chars/3.5). */
  streamTokens: number;
  /** Tokens por segundo calculado durante streaming. Persiste após o fim. */
  tokensPerSec: number;
  /** Provider/model/mode TRAVADOS após primeira mensagem (session lock). null = não travado. */
  sessionProvider: string | null;
  sessionModel: string | null;
  sessionMode: string | null;
  /** Persona / system prompt custom do chat atual ("" = prompt padrão). */
  sessionPersona: string;
  /** Instruções do projeto onde a conversa nasceu ("" = nenhuma). Somam ao
   *  prompt, não substituem — ver agent/conversation.ts. */
  sessionInstructions: string;
  /** ID do chat atual (UUID). null antes da primeira msg. Usado pra save/load. */
  currentChatId: string | null;
  /** Título do chat atual (auto-gerado da primeira msg do user). */
  currentChatTitle: string;
  /**
   * Rascunho por conversa, indexado por chat id (a que ainda não tem id usa
   * NEW_CHAT_DRAFT). Mora AQUI, e não no componente, por dois motivos que são
   * bugs de verdade: a tela do chat é desmontada ao ir pra Projects/Skills (e
   * ao fechar a gaveta), o que matava o texto digitado; e um rascunho guardado
   * no componente seguia o usuário pra dentro de outra conversa.
   */
  drafts: Record<string, string>;
  /**
   * Anexos escolhidos e ainda não enviados (nota do vault, imagem, texto
   * colado). Ficam no store, e não na sessão, porque quem mostra os chips é a
   * tela — e a tela precisa re-renderizar quando eles mudam. O envio consome e
   * limpa.
   */
  attachments: MessageAttachment[];
  /**
   * Mensagens escritas DURANTE uma resposta, esperando a vez. Mora no store (e
   * quem dispara é a sessão) pra sobreviver a sair da tela — uma fila que só
   * existe enquanto o componente está montado é uma fila que às vezes some.
   * É LISTA: enfileirar de novo não pode apagar o que já estava esperando.
   */
  queued: string[];
  /** Turno rodando com a conversa fora da tela (null = nada em segundo plano). */
  background: BackgroundRun | null;
  /** Conversa dona do turno em andamento (null = ninguém respondendo). */
  turnChatId: string | null;
  /** Última posição de leitura da timeline (px) e de QUAL conversa ela é.
   *
   *  A tela publica; lê quem precisa saber onde você parou — a sessão, quando
   *  a conversa sai de cena no meio de uma resposta, e a própria tela quando
   *  ela REMONTA. Remontar acontece o tempo todo: ir na home e voltar desmonta
   *  a timeline, e sem isto ela renascia no fim do fio, desfazendo a leitura.
   *  Ninguém assina estes campos — escrever aqui não redesenha nada. */
  viewScrollTop: number;
  viewChatId: string | null;
  /**
   * Onde a timeline deve ABRIR quando esta conversa entrar na tela:
   *  • `resumeScroll` — px guardados (voltando de um turno em segundo plano);
   *  • `resumeMessageId` — a mensagem que chegou sem você ver (conversa não
   *    lida, relida do disco, onde não há px nenhum pra lembrar).
   * Os dois são de uso ÚNICO: quem usa, limpa.
   */
  resumeScroll: number | null;
  resumeMessageId: string | null;
  /**
   * Conversa cujo turno PAROU esperando uma aprovação sua (o gate do agente).
   *
   * Ao vivo e não gravado: se o app fechar, não há mais modal nenhum esperando
   * — guardar isso no disco seria ressuscitar uma pergunta que já morreu.
   */
  waitingChatId: string | null;
  /** Chat atual favoritado (item "Star" do menu ⋮). Faz parte da identidade do
   *  chat — o auto-save reescreve o .md inteiro, então precisa vir daqui pra
   *  não apagar a marca a cada mensagem nova. */
  currentChatStarred: boolean;
  addMessage: (msg: NewMessageInput) => string;
  removeMessage: (id: string) => void;
  appendToMessage: (id: string, text: string) => void;
  appendReasoning: (id: string, text: string) => void;
  /** Atualiza meta `activity` de um ai-comment existente (transição
   *  pending → done / failed). No-op se a msg não for ai-comment.
   *  contentPatch opcional substitui o `content` na mesma operação (usado
   *  pra anexar meta-result como "1.2k chars"). */
  updateActivity: (
    id: string,
    patch: Partial<ActivityMeta>,
    contentPatch?: string
  ) => void;
  /** Marca como DESFEITA a mudança que esta linha narra — na conversa que
   *  estiver com ela, a da tela ou a que roda em segundo plano (o Undo é
   *  tocado pela pessoa, não pelo turno, então não segue a regra do turno). */
  markUndone: (id: string) => void;
  /** Toggle/seta reaction num ai-response. null = neutro, "like"/"dislike". */
  setReaction: (id: string, reaction: "like" | "dislike" | null) => void;
  /** Anexa as ações de tool do agent a uma ai-response (Agent mode). */
  setAgentSteps: (id: string, steps: AIToolStep[]) => void;
  /** Grava o contexto (vault + notas) que foi junto com uma mensagem do usuário. */
  setContexto: (id: string, contexto: string) => void;
  /** Tira de uma mensagem do usuário o contexto e/ou os anexos (o turno dela
   *  falhou POR causa deles — reenviar em todo turno travava a conversa). */
  descartarDaMensagem: (id: string, oQue: { contexto?: boolean; anexos?: boolean }) => void;
  /** Marca/desmarca uma ai-response como truncada (cortada no limite de tokens). */
  setTruncated: (id: string, truncated: boolean) => void;
  /** Inicia uma nova variante: arquiva o content atual e abre uma vazia. */
  beginVariant: (id: string) => void;
  /** Sincroniza variants[variantIndex] com o content atual (após o stream). */
  syncVariant: (id: string) => void;
  /** (P1-58) Descarta a variante ATIVA se ela estiver vazia (regen falhou). */
  discardEmptyVariant: (id: string) => void;
  /** Navega entre variantes (dir -1/+1), atualizando o content exibido. */
  navigateVariant: (id: string, dir: number) => void;
  selectOption: (messageId: string, optionIndex: number) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  /** Dono do turno em andamento. */
  setTurnChatId: (id: string | null) => void;
  /** Conversa parada esperando aprovação (null = nenhuma). */
  setWaitingChatId: (id: string | null) => void;
  /** Manda a timeline abrir naquele ponto (px) ou naquela mensagem. */
  setResume: (p: { scroll?: number | null; messageId?: string | null }) => void;
  /** Desvia a escrita do turno pra fora da tela (ver BackgroundRun). */
  detachTurn: (run: BackgroundRun) => void;
  /** Traz o turno de volta pra tela; devolve o que estava rodando. */
  attachTurn: () => BackgroundRun | null;
  /** Descarta o turno de fundo — já salvo, ou a conversa foi apagada. */
  clearBackground: () => void;
  setLoadingChat: (loading: boolean) => void;
  /** Soma o uso de UM pedido terminado (uma vez por pedido — ver chatEngine).
   *  `dono` = a conversa do pedido: o uso vai pra ela, esteja na tela ou em
   *  segundo plano; se ela não está em nenhum dos dois (o painel fechou no
   *  meio), não vai pra conversa de ninguém — o livro do dia já contou. */
  addUsage: (uso: UsoDoPedido, dono?: string | null) => void;
  /** Põe os totais de uma conversa reaberta (não é um pedido: o "último
   *  prompt" fica como está). */
  restaurarUso: (totais: {
    tokensIn: number;
    tokensOut: number;
    tokensCached?: number;
    tokensCacheWrite?: number;
  }) => void;
  resetUsage: () => void;
  setStreamingMessageId: (id: string | null) => void;
  /** Marca início do stream (reset de tokensPerSec + start time). */
  startStreamTimer: () => void;
  /** Incrementa contagem aproximada de tokens + recomputa tokensPerSec.
   *  Recebe o texto do delta — estimamos tokens por chars/3.5. */
  tickStreamTokens: (chunk: string) => void;
  /** Encerra o timer mas mantém o último valor de tokensPerSec visível. */
  endStreamTimer: () => void;
  lockSession: (provider: string, model: string, mode?: string) => void;
  unlockSession: () => void;
  /** Define a persona (system prompt custom) do chat atual. */
  setSessionPersona: (persona: string) => void;
  setSessionInstructions: (instructions: string) => void;
  setCurrentChatId: (id: string | null) => void;
  setCurrentChatTitle: (title: string) => void;
  setCurrentChatStarred: (starred: boolean) => void;
  /** Substitui o array de mensagens inteiro (usado ao carregar chat do disco). */
  setMessages: (msgs: ChatMessage[]) => void;
  /** Reset completo pra "Nova conversa" — limpa msgs, lock, IDs, tokens. */
  newChat: () => void;
  /** Escreve o rascunho de UMA conversa (texto vazio apaga a entrada). */
  setDraft: (key: string, text: string) => void;
  pushQueued: (text: string) => void;
  removeQueued: (index: number) => void;
  clearQueued: () => void;
  addAttachment: (att: MessageAttachment) => void;
  removeAttachment: (index: number) => void;
  setAttachments: (atts: MessageAttachment[]) => void;
}

function makeId(): string {
  // crypto.randomUUID está disponível em Electron/Obsidian e em browsers modernos
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback simples (não precisa ser globally unique, só local-unique)
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Campos comuns ao reset de "limpar mensagens" e "nova conversa" — single
// source of truth pros dois (já tinham divergido antes). clearMessages preserva
// a identidade do chat (currentChatId/Title); newChat sobrescreve pra zerar. v0.1.228
/**
 * Para onde vai uma escrita DO TURNO: a conversa da tela, ou a de fundo.
 *
 * Só as escritas do turno passam por aqui. O que a pessoa faz com a conversa
 * que está vendo (reagir, apagar mensagem, regenerar) sempre mexe no que está
 * na tela — senão um toque numa conversa mexeria em outra.
 */
function escritaDoTurno(
  state: ChatState,
  mudar: (msgs: ChatMessage[]) => ChatMessage[]
): Partial<ChatState> {
  const bg = state.background;
  if (!bg) return { messages: mudar(state.messages) };
  return { background: { ...bg, messages: mudar(bg.messages) } };
}

/**
 * As mensagens da conversa do TURNO — a que está respondendo, na tela ou em
 * segundo plano (só existe um turno por vez). O motor LÊ daqui pelo mesmo
 * motivo que escreve por `escritaDoTurno`: se a pessoa troca de conversa no
 * meio (durante a busca no vault, por exemplo), ler `messages` mandava pro
 * modelo o histórico da conversa ERRADA.
 */
export function mensagensDoTurno(state: Pick<ChatState, "background" | "messages">): ChatMessage[] {
  return state.background ? state.background.messages : state.messages;
}

const BASE_RESET = {
  messages: [] as ChatMessage[],
  attachments: [] as MessageAttachment[],
  queued: [] as string[],
  isLoading: false,
  tokensIn: 0,
  tokensOut: 0,
  tokensCached: 0,
  tokensCacheWrite: 0,
  lastPromptTokens: 0,
  streamingMessageId: null as string | null,
  sessionProvider: null as string | null,
  sessionModel: null as string | null,
  sessionMode: null as string | null,
  sessionPersona: "",
  sessionInstructions: "",
} as const;

/** Chave do rascunho da conversa que ainda não foi salva. */
export const NEW_CHAT_DRAFT = "__new__";

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  drafts: {},
  attachments: [],
  queued: [],
  isLoading: false,
  loadingChat: false,
  tokensIn: 0,
  tokensOut: 0,
  tokensCached: 0,
  tokensCacheWrite: 0,
  lastPromptTokens: 0,
  streamingMessageId: null,
  streamStartedAt: null,
  streamTokens: 0,
  tokensPerSec: 0,
  sessionProvider: null,
  sessionModel: null,
  sessionMode: null,
  sessionPersona: "",
  sessionInstructions: "",
  currentChatId: null,
  background: null,
  turnChatId: null,
  viewScrollTop: 0,
  viewChatId: null,
  resumeScroll: null,
  resumeMessageId: null,
  waitingChatId: null,
  currentChatTitle: "",
  currentChatStarred: false,
  addMessage: (msg) => {
    const id = makeId();
    set((state) =>
      escritaDoTurno(state, (ms) => [
        ...ms,
        { ...msg, id, timestamp: Date.now() },
      ])
    );
    return id;
  },
  removeMessage: (id) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
    })),
  // appendToMessage adiciona texto ao final de uma mensagem com content
  // (user, ai-response, ai-comment). Usado no streaming pra mostrar tokens
  // chegando um a um. Não-op em ai-options (não tem content).
  appendToMessage: (id, text) =>
    set((state) =>
      escritaDoTurno(state, (ms) =>
        ms.map((m) => {
          if (m.id !== id) return m;
          if (m.type === "ai-options") return m;
          return { ...m, content: m.content + text };
        })
      )
    ),
  // Acumula raciocínio (reasoning/thinking) numa ai-response. v0.1.193
  appendReasoning: (id, text) =>
    set((state) =>
      escritaDoTurno(state, (ms) =>
        ms.map((m) =>
          m.id === id && m.type === "ai-response"
            ? { ...m, reasoning: (m.reasoning ?? "") + text }
            : m
        )
      )
    ),
  markUndone: (id) =>
    set((state) => {
      const marcar = (ms: ChatMessage[]) =>
        ms.map((m) =>
          m.id === id && m.type === "ai-comment" && m.activity
            ? { ...m, activity: { ...m.activity, undone: true } }
            : m
        );
      return {
        messages: marcar(state.messages),
        ...(state.background
          ? { background: { ...state.background, messages: marcar(state.background.messages) } }
          : {}),
      };
    }),
  // Patch atômico de campos do activity meta. Usado pelo agent loop pra
  // mudar phase=pending → done/failed mantendo iconPending/pendingText.
  updateActivity: (id, patch, contentPatch) =>
    set((state) =>
      escritaDoTurno(state, (ms) =>
        ms.map((m) => {
          if (m.id !== id) return m;
          if (m.type !== "ai-comment") return m;
          if (!m.activity) return m;
          return {
            ...m,
            activity: { ...m.activity, ...patch },
            ...(contentPatch !== undefined ? { content: contentPatch } : {}),
          };
        })
      )
    ),
  setReaction: (id, reaction) =>
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.id !== id) return m;
        if (m.type !== "ai-response") return m;
        return { ...m, reaction };
      }),
    })),
  setAgentSteps: (id, steps) =>
    set((state) =>
      escritaDoTurno(state, (ms) =>
        ms.map((m) =>
          m.id === id && m.type === "ai-response"
            ? { ...m, agentSteps: steps }
            : m
        )
      )
    ),
  setContexto: (id, contexto) =>
    set((state) =>
      escritaDoTurno(state, (ms) =>
        ms.map((m) => (m.id === id && m.type === "user" ? { ...m, contexto } : m))
      )
    ),
  descartarDaMensagem: (id, oQue) =>
    set((state) =>
      escritaDoTurno(state, (ms) =>
        ms.map((m) => {
          if (m.id !== id || m.type !== "user") return m;
          const r = { ...m };
          if (oQue.contexto) delete r.contexto;
          if (oQue.anexos) delete r.anexos;
          return r;
        })
      )
    ),
  setTruncated: (id, truncated) =>
    set((state) =>
      escritaDoTurno(state, (ms) =>
        ms.map((m) =>
          m.id === id && m.type === "ai-response" ? { ...m, truncated } : m
        )
      )
    ),
  beginVariant: (id) =>
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.id !== id || m.type !== "ai-response") return m;
        // Primeira regeneração: arquiva o content atual como variante 0
        const variants =
          m.variants && m.variants.length > 0 ? m.variants : [m.content];
        return {
          ...m,
          variants: [...variants, ""],
          variantIndex: variants.length,
          content: "",
          truncated: false,
        };
      }),
    })),
  // (P1-58) Regeneração que falhou sem produzir nada: descarta a variante
  // vazia e restaura a versão anterior — sem isto a bolha virava um branco
  // ‹2/2› e a resposta antiga "sumia" atrás de uma seta que ninguém conhece.
  discardEmptyVariant: (id) =>
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.id !== id || m.type !== "ai-response" || !m.variants) return m;
        if (m.content.trim() !== "") return m;
        const cur = m.variantIndex ?? m.variants.length - 1;
        const variants = m.variants.filter((_, i) => i !== cur);
        if (variants.length === 0) return m;
        const idx = Math.min(Math.max(0, cur - 1), variants.length - 1);
        if (variants.length === 1) {
          return {
            ...m,
            content: variants[0],
            variants: undefined,
            variantIndex: undefined,
          };
        }
        return { ...m, content: variants[idx], variants, variantIndex: idx };
      }),
    })),
  syncVariant: (id) =>
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.id !== id || m.type !== "ai-response") return m;
        if (!m.variants || m.variantIndex === undefined) return m;
        const variants = [...m.variants];
        variants[m.variantIndex] = m.content;
        return { ...m, variants };
      }),
    })),
  navigateVariant: (id, dir) =>
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.id !== id || m.type !== "ai-response" || !m.variants) return m;
        const n = m.variants.length;
        const current = m.variantIndex ?? n - 1;
        let i = current + dir;
        if (i < 0) i = 0;
        if (i > n - 1) i = n - 1;
        // Persiste o content exibido no slot vigente antes de trocar (como
        // syncVariant), pra ida-e-volta entre variantes não descartar a versão
        // atual. v0.1.228
        const variants = [...m.variants];
        variants[current] = m.content;
        return { ...m, variants, variantIndex: i, content: variants[i] };
      }),
    })),
  selectOption: (messageId, optionIndex) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId && m.type === "ai-options"
          ? { ...m, selectedIndex: optionIndex }
          : m
      ),
    })),
  clearMessages: () =>
    // Preserva currentChatId/currentChatTitle (limpa só o conteúdo). v0.1.228
    //
    // Com um turno rodando em segundo plano, `isLoading` e o id do turno NÃO
    // são zerados: eles descrevem aquele turno, não esta tela. Zerá-los aqui
    // liberaria o guarda de envio e deixaria DOIS turnos vivos disputando o
    // mesmo AbortController.
    set((state) =>
      state.background
        ? {
            ...BASE_RESET,
            isLoading: state.isLoading,
            streamingMessageId: state.streamingMessageId,
          }
        : { ...BASE_RESET }
    ),
  setLoading: (loading) => set({ isLoading: loading }),
  setTurnChatId: (id) => set({ turnChatId: id }),
  setWaitingChatId: (id) => set({ waitingChatId: id }),
  setResume: (p) =>
    set({
      resumeScroll: p.scroll ?? null,
      resumeMessageId: p.messageId ?? null,
    }),
  detachTurn: (run) => set({ background: run }),
  attachTurn: () => {
    const bg: BackgroundRun | null = get().background;
    if (bg) set({ background: null });
    return bg;
  },
  clearBackground: () => set({ background: null }),
  setLoadingChat: (loading) => set({ loadingChat: loading }),
  // Os tokens são do turno, então seguem o turno: com a conversa fora da tela
  // eles iam parar na conta da conversa que estivesse aberta.
  addUsage: (uso, dono) =>
    set((state) => {
      const lido = uso.cacheRead ?? 0;
      const gravado = uso.cacheWrite ?? 0;
      const bg = state.background;
      const conhecido = typeof dono === "string" && dono !== "";
      const praFundo = bg && (!conhecido || bg.chatId === dono);
      if (
        !praFundo &&
        conhecido &&
        state.currentChatId !== dono &&
        state.turnChatId !== dono
      ) {
        return {};
      }
      if (praFundo && bg) {
        return {
          background: {
            ...bg,
            tokensIn: bg.tokensIn + uso.input,
            tokensOut: bg.tokensOut + uso.output,
            tokensCached: (bg.tokensCached ?? 0) + lido,
            tokensCacheWrite: (bg.tokensCacheWrite ?? 0) + gravado,
          },
        };
      }
      return {
        tokensIn: state.tokensIn + uso.input,
        tokensOut: state.tokensOut + uso.output,
        tokensCached: state.tokensCached + lido,
        tokensCacheWrite: state.tokensCacheWrite + gravado,
        lastPromptTokens: uso.input > 0 ? uso.input : state.lastPromptTokens,
      };
    }),
  restaurarUso: (t) =>
    set({
      tokensIn: t.tokensIn,
      tokensOut: t.tokensOut,
      tokensCached: t.tokensCached ?? 0,
      tokensCacheWrite: t.tokensCacheWrite ?? 0,
    }),
  resetUsage: () =>
    set({ tokensIn: 0, tokensOut: 0, tokensCached: 0, tokensCacheWrite: 0, lastPromptTokens: 0 }),
  setStreamingMessageId: (id) => set({ streamingMessageId: id }),
  startStreamTimer: () =>
    set({ streamStartedAt: Date.now(), streamTokens: 0, tokensPerSec: 0 }),
  tickStreamTokens: (chunk) =>
    set((state) => {
      if (state.streamStartedAt === null) {
        // Primeiro tick — começa o timer agora se não foi iniciado antes
        const now = Date.now();
        const approx = Math.max(1, Math.ceil(chunk.length / 3.5));
        return {
          streamStartedAt: now,
          streamTokens: approx,
          tokensPerSec: 0,
        };
      }
      const approx = Math.ceil(chunk.length / 3.5);
      const newTokens = state.streamTokens + approx;
      const elapsedSec = (Date.now() - state.streamStartedAt) / 1000;
      const tps = elapsedSec > 0.05 ? newTokens / elapsedSec : 0;
      return {
        streamTokens: newTokens,
        tokensPerSec: tps,
      };
    }),
  endStreamTimer: () => set({ streamStartedAt: null }),
  lockSession: (provider, model, mode) =>
    set({
      sessionProvider: provider,
      sessionModel: model,
      sessionMode: mode ?? "chat",
    }),
  unlockSession: () =>
    set({ sessionProvider: null, sessionModel: null, sessionMode: null }),
  setSessionPersona: (persona) => set({ sessionPersona: persona }),
  setSessionInstructions: (instructions) =>
    set({ sessionInstructions: instructions }),
  setCurrentChatId: (id) => set({ currentChatId: id }),
  setCurrentChatTitle: (title) => set({ currentChatTitle: title }),
  setCurrentChatStarred: (starred) => set({ currentChatStarred: starred }),
  setMessages: (msgs) => set({ messages: msgs }),
  pushQueued: (text) =>
    set((state) => ({ queued: [...state.queued, text] })),
  removeQueued: (index) =>
    set((state) => ({ queued: state.queued.filter((_, i) => i !== index) })),
  clearQueued: () => set({ queued: [] }),
  addAttachment: (att) =>
    set((state) => ({ attachments: [...state.attachments, att] })),
  removeAttachment: (index) =>
    set((state) => ({
      attachments: state.attachments.filter((_, i) => i !== index),
    })),
  setAttachments: (atts) => set({ attachments: atts }),
  setDraft: (key, text) =>
    set((state) => {
      if ((state.drafts[key] ?? "") === text) return state;
      const drafts = { ...state.drafts };
      // Vazio APAGA a entrada: o mapa não pode crescer sem fim com conversa
      // antiga que ficou só com string vazia.
      if (text) drafts[key] = text;
      else delete drafts[key];
      return { drafts };
    }),
  newChat: () =>
    // Reset completo: BASE_RESET + zera a identidade do chat. v0.1.228
    //
    // Mesma ressalva do `clearMessages`: com um turno rodando em segundo plano
    // os sinais DELE ficam de pé. Zerar `isLoading` aqui abriria o guarda de
    // envio e deixaria dois turnos vivos no mesmo AbortController.
    set((state) => ({
      ...BASE_RESET,
      ...(state.background
        ? {
            isLoading: state.isLoading,
            streamingMessageId: state.streamingMessageId,
          }
        : {}),
      currentChatId: null,
      currentChatTitle: "",
      currentChatStarred: false,
    })),
}));

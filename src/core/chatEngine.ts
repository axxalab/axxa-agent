// src/core/chatEngine.ts
// Motor de CHAT (stream): [Vault Q&A → busca híbrida no vault] → "Pensando…" →
// provider.streamChat → trata erro/abort. Sem React: recebe um `EngineCtx` e
// opera direto no store (src/store/chat.ts). Chamado pela ChatSession
// (src/core/session.ts). A lógica é a mesma do app antigo (useChatEngine).

import { useChatStore } from "../store/chat";
import {
  descartarDoTurnoQueFalhou,
  estadoDoTurno,
  gravarContextoDoTurno,
  oQueOModeloLe,
} from "./contextoDoTurno";
import type { getProvider } from "../providers";
import { semCredencial, describeProviderError } from "./helpers";
import { resolveEffortConfig, effortToMaxTokensSmart, isEffortLevel } from "./effort";
import { resolveMaxTokens } from "../providers/paramPolicy";
import { getContextWindow } from "./contextWindows";
import {
  buildChatSystemPrompt,
  storeMessagesToProvider,
} from "../agent/conversation";
import type { getTranslations } from "../i18n";
import type { MessageAttachment, ProviderMessage, Usage } from "../providers/base";
import type AxxaPlugin from "../main";
import { buscarContextoDoVault } from "./vaultLookup";

/** Ref mutável do AbortController do turno em andamento (null = ocioso). */
export interface AbortRef {
  current: AbortController | null;
}

/** Tudo que um turno precisa saber da sessão — montado pela ChatSession. */
export interface EngineCtx {
  plugin: AxxaPlugin;
  t: ReturnType<typeof getTranslations>;
  abortRef: AbortRef;
  activeProviderId: string;
  activeProvider: ReturnType<typeof getProvider>;
  activeModel: string;
  /** "chat" | "vault-qa" | "agent" */
  activeMode: string;
  /** Buscar nas notas antes de responder. Vem do interruptor da conversa (ver
   *  core/vaultContext.ts), e não do modo: modo é escolha grossa demais pra
   *  uma coisa que muda de mensagem pra mensagem. */
  useVault: boolean;
  apiKeyFor: (providerId: string) => string;
  effort: string;
  /** Instrução extra de estilo pro system prompt ("" = nenhuma). */
  resolveStyleInstruction: () => string;
}

/**
 * Um turno de chat: lê a história ATUAL do store (não captura via closure),
 * faz a busca no vault quando o modo é vault-qa, streama a resposta e
 * registra erros como mensagens `isError` (efêmeras — não persistem).
 * `userAttachments`: notas/imagens anexadas — notas viram bloco de contexto
 * no system prompt; o resto é filtrado por capability em storeMessagesToProvider.
 */
export async function streamReply(
  ctx: EngineCtx,
  userText: string,
  userAttachments?: MessageAttachment[]
): Promise<void> {
  const {
    plugin,
    t,
    abortRef,
    activeProviderId,
    activeProvider,
    activeModel,
    apiKeyFor,
    effort,
    useVault,
    resolveStyleInstruction,
  } = ctx;
  const {
    addMessage,
    appendToMessage,
    updateActivity,
    setLoading,
    setStreamingMessageId,
    addUsage,
    startStreamTimer,
    tickStreamTokens,
    endStreamTimer,
  } = useChatStore.getState();

  // Pre-flight: sem API key (ou sem o endereço do Ollama) não adianta nem
  // mostrar "Pensando..." — emite direto a bolha de erro acionável.
  const falta = semCredencial(
    activeProviderId,
    apiKeyFor(activeProviderId),
    t,
    activeProvider.name
  );
  if (falta) {
    addMessage({
      type: "ai-response",
      content: `${t.ai.errorPrefix} ${falta}`,
      isError: true,
      errorCode: "no-key",
    });
    return;
  }

  // Config completo do effort atual (com overrides do usuário).
  const effortCfg = resolveEffortConfig(effort, plugin.settings.effortConfigs);

  // "Respondendo" JÁ, antes da busca no vault: trocar de conversa durante a
  // busca agora leva o turno junto pro segundo plano (com isLoading falso, o
  // turno continuava achando que a conversa da tela era a dele).
  setLoading(true);
  // E o "Parar" vale desde já: com o controle nascendo só depois da busca, o
  // botão aparecia, não parava nada, e o pedido saía (e era cobrado).
  const controller = new AbortController();
  abortRef.current = controller;

  // Notas como contexto (ver core/vaultLookup.ts). Quem decide é o
  // interruptor da conversa, não o modo.
  const vaultContextBlock = useVault
    ? await buscarContextoDoVault({
        plugin,
        t,
        effort,
        query: userText,
        addMessage,
        updateActivity,
      })
    : "";

  // Pararam durante a busca: o pedido nem sai.
  if (controller.signal.aborted) {
    if (abortRef.current === controller) abortRef.current = null;
    setLoading(false);
    return;
  }

  // "Pensando..." — vira done quando o primeiro token chega.
  const commentId = addMessage({
    type: "ai-comment",
    content: "",
    activity: {
      phase: "pending",
      iconPending: "sparkles",
      iconDone: "check",
      pendingText: t.ai.thinking,
      doneText: t.ai.thinking,
    },
  });

  let responseId: string | null = null;
  let reasoningBuf = "";

  try {
    // O contexto deste turno (trechos do vault + notas anexadas) vai NA
    // mensagem do usuário e fica gravado nela — ver montarContexto.
    gravarContextoDoTurno(vaultContextBlock, userAttachments);
    const turno = estadoDoTurno();
    const fullSystem = buildChatSystemPrompt({
      persona: turno.persona,
      base: t.systemPrompt.base,
      vaultSuffix: useVault ? t.systemPrompt.vaultQaSuffix : undefined,
      instructions: turno.instrucoes,
      styleInstruction: resolveStyleInstruction(),
    });
    const history: ProviderMessage[] = [
      { role: "system", content: fullSystem },
      ...storeMessagesToProvider(turno.mensagens, oQueOModeloLe(activeProviderId, activeModel)),
    ];

    const apiKey = apiKeyFor(activeProviderId);
    const maxTokens = effortToMaxTokensSmart(
      effort,
      getContextWindow(activeModel),
      plugin.settings.effortConfigs
    );
    let lastOutputTokens = 0;
    let ultimoUso: Usage | null = null;
    // A conversa DESTE pedido (o uso vai pra ela mesmo que você troque de
    // conversa no meio, ou ela vá pro segundo plano).
    const donoDoPedido = useChatStore.getState().turnChatId ?? useChatStore.getState().currentChatId;

    startStreamTimer();
    try {
    await activeProvider.streamChat(
      {
        model: activeModel,
        messages: history,
        maxTokens,
        temperature: effortCfg.temperature,
        effort: isEffortLevel(effort) ? effort : undefined,
      },
      apiKey,
      (token) => {
        if (responseId === null) {
          updateActivity(commentId, { phase: "done" });
          responseId = addMessage({ type: "ai-response", content: token });
          setStreamingMessageId(responseId);
          // Flush do raciocínio bufferizado antes do 1º token de conteúdo.
          if (reasoningBuf) {
            useChatStore.getState().appendReasoning(responseId, reasoningBuf);
            reasoningBuf = "";
          }
        } else {
          appendToMessage(responseId, token);
        }
        tickStreamTokens(token);
      },
      (usage) => {
        // Só GUARDA: há provider que manda o uso em todo pedaço do stream (o
        // Gemini manda), e somar cada um multiplicava os tokens da conversa.
        // A soma é uma por pedido, quando o stream acaba (abaixo).
        lastOutputTokens = usage.output;
        ultimoUso = usage;
      },
      controller.signal,
      (reasoningDelta) => {
        // Reasoning costuma vir ANTES do conteúdo (R1). Buffera até a
        // ai-response existir; depois acumula direto na mensagem.
        reasoningBuf += reasoningDelta;
        if (responseId !== null) {
          useChatStore.getState().appendReasoning(responseId, reasoningDelta);
        }
      }
    );
    } finally {
      // Uma soma por pedido — também quando parou no meio (o que chegou foi
      // gasto).
      if (ultimoUso) addUsage(ultimoUso, donoDoPedido);
    }
    endStreamTimer();

    // Heurística de truncamento: output ≈ teto de tokens → "Continuar". O
    // teto é o que FOI pro provider: modelo que pensa recebe um piso bem acima
    // do nível (ver paramPolicy) — comparar com o do nível acusaria corte em
    // toda resposta dele.
    const tetoEnviado = resolveMaxTokens(
      activeProviderId,
      activeModel,
      maxTokens,
      isEffortLevel(effort) ? effort : undefined
    );
    if (
      responseId !== null &&
      lastOutputTokens > 0 &&
      lastOutputTokens >= tetoEnviado * 0.95
    ) {
      useChatStore.getState().setTruncated(responseId, true);
    }

    if (responseId === null) {
      updateActivity(commentId, { phase: "done" });
      addMessage({ type: "ai-response", content: t.ai.emptyResponse });
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (responseId === null) {
        updateActivity(commentId, {
          phase: "failed",
          iconFailed: "circle-stop",
          failedText: t.ai.interrupted,
        });
      } else {
        // Stop com resposta PARCIAL: marca truncated.
        useChatStore.getState().setTruncated(responseId, true);
      }
    } else {
      if (responseId === null) {
        updateActivity(commentId, {
          phase: "failed",
          iconFailed: "x-circle",
          failedText: t.ai.failed,
        });
      }
      const { message, code } = describeProviderError(
        err,
        t,
        activeProvider.name
      );
      addMessage({
        type: "ai-response",
        content: `${t.ai.errorPrefix} ${message}`,
        isError: true,
        errorCode: code,
      });
      descartarDoTurnoQueFalhou(code, responseId === null);
    }
  } finally {
    setLoading(false);
    setStreamingMessageId(null);
    abortRef.current = null;
  }
}

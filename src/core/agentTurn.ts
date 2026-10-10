// src/core/agentTurn.ts
// Loop do AGENTE: stream + tool calls + confirmação NATIVA (ConfirmationModal
// com diff) + loop detection + retry de tools. Sem React: recebe um `AgentCtx`
// e opera no store. Chamado pela ChatSession (src/core/session.ts).
//
// Diferença pro app antigo: a tool `generate_image` não é oferecida ao modelo
// nesta base (o fluxo de geração de imagem saiu com a casca antiga); se o
// modelo insistir, recebe um resultado explicando que não está disponível.

import { useChatStore, type UsoDoPedido } from "../store/chat";
import {
  chaveDeCache,
  descartarDoTurnoQueFalhou,
  estadoDoTurno,
  gravarContextoDoTurno,
  oQueOModeloLe,
} from "./contextoDoTurno";
import {
  semCredencial,
  describeProviderError,
  agentActivitySpec,
  summarizeToolResult,
} from "./helpers";
import { resolveEffortConfig, effortToMaxTokensSmart, isEffortLevel } from "./effort";
import { getContextWindow } from "./contextWindows";
import {
  buildAgentSystemPrompt,
  storeMessagesToProvider,
} from "../agent/conversation";
import { decideToolGate } from "../agent/permissions";
import { antesDe, apagarVaiPraLixeira, depoisDe, registrarDesfazer } from "../agent/undo";
import { ConfirmationModal } from "../agent/ConfirmationModal";
import { TOOL_REGISTRY, isTransientError } from "../agent/tools";
import { TOOL_DEFINITIONS, getToolDefinition } from "../agent/toolSchemas";
import {
  makeCallSignature,
  isLooping,
  trimSignatures,
} from "../agent/loopDetection";
import type { MessageAttachment, ProviderMessage } from "../providers/base";
import type { AIToolStep, PermissionLevel } from "../agent/types";
import type { EngineCtx } from "./chatEngine";
import { buscarContextoDoVault } from "./vaultLookup";
import {
  aprenderJanela,
  caberNaJanela,
  ehEstouro,
  encolherResultados,
  conferirJanelaDoOllama,
  janelaDoModelo,
  tetoDaResposta,
  type ResultadoDaJanela,
} from "./compactacao";
import { tokensDoPedido } from "../providers/ollama";
import { anotarPedido, ttlParaOTurno } from "./cacheDoTurno";

export interface AgentCtx extends EngineCtx {
  /** "Aprovar todas" da rodada — resetado a cada turno. */
  agentApproveAllRef: { current: boolean };
}

const UNAVAILABLE_TOOLS = new Set(["generate_image"]);

export async function runAgentTurn(
  ctx: AgentCtx,
  userText: string,
  userAttachments?: MessageAttachment[]
): Promise<void> {
  const {
    plugin,
    t,
    abortRef,
    agentApproveAllRef,
    activeProviderId,
    activeProvider,
    activeModel,
    apiKeyFor,
    effort,
    useVault,
  } = ctx;
  const {
    addMessage,
    appendToMessage,
    updateActivity,
    setLoading,
    setStreamingMessageId,
    setAgentSteps,
    addUsage,
    startStreamTimer,
    tickStreamTokens,
    endStreamTimer,
  } = useChatStore.getState();
  void userText; // já está no store (última mensagem do usuário)

  // Pre-flight: sem API key (ou sem o endereço do Ollama), erro acionável direto.
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

  if (!activeProvider.supportsTools) {
    addMessage({
      type: "ai-response",
      content: `${t.ai.errorPrefix} ${t.agent.needsOpenAI}`,
    });
    return;
  }

  setLoading(true);
  const commentId = addMessage({
    type: "ai-comment",
    content: "",
    activity: {
      phase: "pending",
      iconPending: "sparkles",
      iconDone: "check",
      pendingText: t.agent.thinking,
      doneText: t.agent.thinking,
    },
  });

  const permissionLevel: PermissionLevel = (plugin.settings
    .agentPermissionLevel || "ask") as PermissionLevel;
  // Diff-approval: toda ação que ESCREVE passa por preview/diff antes de gravar.
  const diffApproval = plugin.settings.agentDiffApproval !== false;
  agentApproveAllRef.current = false;
  // O "aprovar todas" dado num pedido à web: só pra web, e só nesta rodada.
  let webAprovadaNaRodada = false;

  const effortCfg = resolveEffortConfig(effort, plugin.settings.effortConfigs);

  // As notas como contexto, quando o interruptor da conversa está ligado (ver
  // core/vaultContext.ts). O agente já LÊ o vault com as ferramentas — o que
  // isto muda é ele chegar sabendo o que já está escrito, em vez de descobrir
  // procurando. É a mesma busca do turno de chat, no mesmo módulo.
  // O "Parar" vale desde já (ver chatEngine): o controle nasce antes da busca.
  const controller = new AbortController();
  abortRef.current = controller;
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

  // As ferramentas de web só entram com a web ligada nas settings — e a busca
  // só com a chave da Tavily. Fora da lista, o modelo nem sabe que existem.
  const webLigada = plugin.settings.agentWeb !== false;
  const tavily = (plugin.settings.tavilyApiKey ?? "").trim();
  const foraDaLista = (nome: string) =>
    UNAVAILABLE_TOOLS.has(nome) ||
    ((nome === "web_search" || nome === "web_fetch") && !webLigada) ||
    (nome === "web_search" && !tavily);

  // O contexto deste turno (trechos do vault + notas anexadas) vai NA
  // mensagem do usuário e fica gravado nela. No Agent as notas anexadas não
  // chegavam ao modelo de jeito nenhum (só imagem e PDF passavam).
  gravarContextoDoTurno(vaultContextBlock, userAttachments);
  const turno = estadoDoTurno();
  const systemDoAgente = buildAgentSystemPrompt(
    turno.persona,
    t.agent.systemPrompt + (webLigada ? t.agent.webPrompt : ""),
    useVault ? t.systemPrompt.vaultQaSuffix : undefined,
    turno.instrucoes
  );
  // toolMode=true → agentSteps são expandidos pro shape wire (replay preciso).
  const opcoesDoHistorico = { toolMode: true, ...oQueOModeloLe(activeProviderId, activeModel) };
  // Lido de novo quando o começo vira resumo (ver core/compactacao).
  const montarHistorico = (): ProviderMessage[] => [
    { role: "system", content: systemDoAgente },
    ...storeMessagesToProvider(estadoDoTurno().mensagens, opcoesDoHistorico),
  ];
  // Preenchido no começo da rodada (depois de caber na janela).
  const history: ProviderMessage[] = [];

  const tools = TOOL_DEFINITIONS.filter((td) => !foraDaLista(td.name)).map((td) => ({
    name: td.name,
    description: td.description,
    parameters: td.parameters,
  }));

  const apiKey = apiKeyFor(activeProviderId);
  const donoDaRodada =
    useChatStore.getState().turnChatId ?? useChatStore.getState().currentChatId;
  // Quanto o cache da rodada dura: pelo ritmo da conversa, o MESMO em todos
  // os passos (ver core/cacheDoTurno).
  const ttlDoCache = ttlParaOTurno({
    chatId: donoDaRodada,
    provider: activeProviderId,
    modo: "agent",
    agora: Date.now(),
    mensagens: estadoDoTurno().mensagens,
  });
  const maxTokensDoNivel = effortToMaxTokensSmart(
    effort,
    getContextWindow(activeModel),
    plugin.settings.effortConfigs
  );
  // A conversa cabe na janela do modelo? Se não, o começo vira resumo — o
  // "Pensando…" diz "Resumindo…" enquanto isso.
  // Com o começo resumido, o contexto deste turno é refeito (um trecho do
  // vault que ficou de fora por já estar numa mensagem que agora é resumo
  // volta).
  const caber = async (apertado: boolean): Promise<ResultadoDaJanela> => {
    const r = await caberNaJanela({
      provider: activeProvider,
      providerId: activeProviderId,
      model: activeModel,
      apiKey,
      system: systemDoAgente,
      opcoes: opcoesDoHistorico,
      tools,
      maxTokens: maxTokensDoNivel,
      dono: donoDaRodada,
      apertado,
      signal: controller.signal,
      avisar: (fase) =>
        updateActivity(
          commentId,
          fase === "resumindo"
            ? { pendingText: t.ai.compacting, agora: t.ai.compacting }
            : { pendingText: t.agent.thinking, agora: undefined }
        ),
    });
    if (r.resumiu) gravarContextoDoTurno(vaultContextBlock, userAttachments);
    return r;
  };
  let janela = 0;
  // Quantas vezes a rodada já se recuperou de um "não cabe" do provider.
  let recuperacoes = 0;

  // MAX_TURNS vem do effort config (0 = sem teto; loop detection é o limite).
  const MAX_TURNS = effortCfg.agentMaxTurns;
  const isUncapped = MAX_TURNS === 0;
  const loopWindow = effortCfg.loopDetectionWindow;
  const recentCallSignatures: string[] = [];
  let loopNudges = 0;
  const MAX_LOOP_NUDGES = 3;
  // Ações de tool do run inteiro — anexadas à resposta final p/ continuidade.
  const runSteps: AIToolStep[] = [];

  let turn = 0;
  let firstTurn = true;

  try {
    // Pararam durante a busca: nada sai (o finally desliga o "respondendo").
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    janela = (await caber(false)).janela;
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    history.push(...montarHistorico());
    // Até aqui é a conversa; o que vier depois é desta rodada.
    let tamanhoDaConversa = history.length;
    while (isUncapped || turn < MAX_TURNS) {
      turn++;
      // Stop entre turnos.
      if (controller.signal.aborted) {
        throw new DOMException("Interrupted", "AbortError");
      }

      let responseId: string | null = null;
      // O começo deste pedido (o relógio do cache conta daqui) e se ele chegou
      // ao provider — recusado antes não tocou no cache e não conta no ritmo.
      let inicioDoPedido = Date.now();
      let chegou = false;
      const onToken = (token: string) => {
        chegou = true;
        if (responseId === null) {
          if (firstTurn) {
            updateActivity(commentId, { phase: "done" });
            firstTurn = false;
          }
          responseId = addMessage({ type: "ai-response", content: token, pedidoEm: inicioDoPedido });
          setStreamingMessageId(responseId);
        } else {
          appendToMessage(responseId, token);
        }
        tickStreamTokens(token);
      };

      startStreamTimer();
      // O uso de cada pedido entra UMA vez, no fim (ver chatEngine: há
      // provider que manda o uso em todo pedaço do stream).
      let ultimoUso: UsoDoPedido | null = null;
      const donoDoPedido =
        useChatStore.getState().turnChatId ?? useChatStore.getState().currentChatId;
      // Ollama: a janela conferida a cada passo (ver conferirJanelaDoOllama).
      conferirJanelaDoOllama({
        providerId: activeProviderId,
        model: activeModel,
        history,
        tools,
        resposta: maxTokensDoNivel,
        janela,
        inicioDaRodada: tamanhoDaConversa,
      });
      // A resposta cabe junto com o pedido, que cresce a cada passo — e o
      // teto vale depois do piso dos modelos que pensam.
      const tetoDaJanela = tetoDaResposta(
        janela,
        tokensDoPedido({ model: activeModel, messages: history, tools })
      );
      let response;
      inicioDoPedido = Date.now();
      try {
        response = await activeProvider.streamChat(
          {
            model: activeModel,
            messages: history,
            maxTokens: maxTokensDoNivel,
            maxTokensTeto: tetoDaJanela,
            temperature: effortCfg.temperature,
            effort: isEffortLevel(effort) ? effort : undefined,
            tools,
            cacheKey: chaveDeCache(donoDoPedido),
            cacheTtl: ttlDoCache,
          },
          apiKey,
          onToken,
          (usage) => {
            chegou = true;
            ultimoUso = usage;
          },
          controller.signal
        );
        chegou = true;
      } catch (err) {
        // Recusado por TAMANHO antes de responder: o provider disse quanto
        // cabe (guardado pros próximos). No 1º pedido, o começo da conversa
        // vira resumo; no meio da rodada, os resultados de ferramenta mais
        // antigos encolhem. E o pedido vai de novo (até 3 vezes na rodada).
        if (responseId !== null || !ehEstouro(err) || controller.signal.aborted || recuperacoes >= 3) {
          throw err;
        }
        aprenderJanela(activeProviderId, activeModel, err);
        recuperacoes++;
        // A janela que o provider disse (se disse) vale já nesta tentativa.
        janela = await janelaDoModelo(activeProviderId, activeModel, apiKey);
        let mudou: boolean;
        if (history.length === tamanhoDaConversa) {
          const segunda = await caber(true);
          janela = segunda.janela;
          mudou = segunda.resumiu;
          if (mudou) {
            history.splice(0, history.length, ...montarHistorico());
            tamanhoDaConversa = history.length;
          }
        } else {
          mudou = encolherResultados(history) > 0;
        }
        // Nada encolheu: só vale tentar de novo se a janela nova encolhe a
        // resposta.
        if (!mudou && tetoDaResposta(janela, tokensDoPedido({ model: activeModel, messages: history, tools })) >= tetoDaJanela) {
          throw err;
        }
        endStreamTimer();
        turn--; // a tentativa recusada não conta como passo
        continue;
      } finally {
        if (ultimoUso) addUsage(ultimoUso, donoDoPedido);
        if (chegou) anotarPedido(donoDaRodada, ttlDoCache, inicioDoPedido);
      }
      endStreamTimer();
      setStreamingMessageId(null);

      // Caso 1: sem tool_calls = resposta final.
      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (responseId === null) {
          if (firstTurn) {
            updateActivity(commentId, { phase: "done" });
            firstTurn = false;
          }
          responseId = addMessage({
            type: "ai-response",
            content: response.content || t.ai.emptyResponse,
            pedidoEm: inicioDoPedido,
          });
        }
        if (runSteps.length > 0 && responseId) {
          setAgentSteps(responseId, runSteps);
        }
        return;
      }

      // Caso 2: tool_calls — registra a msg do assistant na history.
      if (firstTurn) {
        updateActivity(commentId, { phase: "done" });
        firstTurn = false;
      }
      history.push({
        role: "assistant",
        content: response.content ?? "",
        toolCalls: response.toolCalls,
      });

      // Loop detection por assinatura (name + JSON(args)).
      let loopDetected = false;
      if (loopWindow > 0) {
        for (const call of response.toolCalls) {
          recentCallSignatures.push(
            makeCallSignature(call.name, call.arguments)
          );
        }
        trimSignatures(recentCallSignatures, loopWindow * 4);
        loopDetected = isLooping(recentCallSignatures, loopWindow);
      }

      type CallResult = {
        callId: string;
        content: string;
        activityId: string;
        spec: ReturnType<typeof agentActivitySpec>;
        meta: string;
        ok: boolean;
      };

      // Pre-check de permissão (sequencial — um modal por vez) e placeholders.
      const preparedCalls: Array<{
        call: (typeof response.toolCalls)[number];
        def: ReturnType<typeof getToolDefinition>;
        approved: boolean;
        activityId: string;
        spec: ReturnType<typeof agentActivitySpec>;
      }> = [];
      for (const call of response.toolCalls) {
        if (foraDaLista(call.name)) {
          const resultText = `Tool "${call.name}" is not available in this build. Do NOT retry — tell the user.`;
          addMessage({
            type: "ai-comment",
            content: "",
            activity: {
              phase: "failed",
              iconPending: "wrench",
              iconFailed: "alert-triangle",
              pendingText: t.agent.unknownTool(call.name),
              failedText: t.agent.unknownTool(call.name),
            },
          });
          history.push({ role: "tool", toolCallId: call.id, content: resultText });
          runSteps.push({
            id: call.id,
            name: call.name,
            arguments: call.arguments,
            result: resultText,
            ok: false,
          });
          continue;
        }
        const def = getToolDefinition(call.name);
        if (!def) {
          addMessage({
            type: "ai-comment",
            content: "",
            activity: {
              phase: "failed",
              iconPending: "wrench",
              iconFailed: "alert-triangle",
              pendingText: t.agent.unknownTool(call.name),
              failedText: t.agent.unknownTool(call.name),
            },
          });
          history.push({
            role: "tool",
            toolCallId: call.id,
            content: `Tool "${call.name}" does not exist. Use one of the available tools.`,
          });
          continue;
        }

        // Gate: roda direto ("auto") ou abre o preview de confirmação.
        const gate = decideToolGate(def, permissionLevel, {
          approveAll: agentApproveAllRef.current,
          approveAllWeb: webAprovadaNaRodada,
          apagarVaiPraLixeira: apagarVaiPraLixeira(plugin.app),
        });
        let approved = gate === "auto";
        if (gate === "confirm") {
          const modal = new ConfirmationModal(plugin.app, {
            toolCall: call,
            definition: def,
            showDiff: diffApproval,
            strings: t.agent,
          });
          // A conversa fica marcada como "precisa de você" enquanto a
          // pergunta estiver de pé. Desde que dá pra navegar durante a
          // resposta, o modal pode abrir com a pessoa em OUTRA tela — e aí a
          // lista é o único lugar que pode dizer de quem é aquele pedido.
          const dona =
            useChatStore.getState().background?.chatId ??
            useChatStore.getState().currentChatId;
          useChatStore.getState().setWaitingChatId(dona);
          let res;
          try {
            res = await modal.openAndWait();
          } finally {
            useChatStore.getState().setWaitingChatId(null);
          }
          approved = res.approved;
          if (res.approveAll) {
            if (def.network) webAprovadaNaRodada = true;
            else agentApproveAllRef.current = true;
          }
        }

        if (!approved) {
          addMessage({
            type: "ai-comment",
            content: "",
            activity: {
              phase: "failed",
              iconPending: "shield",
              iconFailed: "ban",
              pendingText: t.agent.deniedTool(call.name),
              failedText: t.agent.deniedTool(call.name),
            },
          });
          history.push({
            role: "tool",
            toolCallId: call.id,
            content:
              "User denied this action. Do NOT repeat this same call — consider another approach or ask the user.",
          });
          continue;
        }

        const spec = agentActivitySpec(call.name, call.arguments);
        const activityId = addMessage({
          type: "ai-comment",
          content: "",
          activity: {
            phase: "pending",
            iconPending: spec.iconPending,
            iconDone: spec.iconDone,
            pendingText: spec.pendingText,
            doneText: spec.doneText,
          },
        });
        preparedCalls.push({ call, def, approved, activityId, spec });
      }

      // Executor com retry (só erros transitórios) pra cada call.
      const execCall = async (
        prep: (typeof preparedCalls)[number]
      ): Promise<CallResult> => {
        const { call, activityId, spec } = prep;
        if (controller.signal.aborted) {
          updateActivity(activityId, {
            phase: "failed",
            iconFailed: "circle-stop",
            failedText: t.ai.interrupted,
          });
          return {
            callId: call.id,
            content: "Interrupted by the user — this call did NOT run.",
            activityId,
            spec,
            meta: "",
            ok: false,
          };
        }
        const executor = TOOL_REGISTRY[call.name];
        // O que a mudança vai tirar do lugar, guardado ANTES dela — é disso
        // que sai o Undo da conversa (agent/undo.ts). Falhar aqui não pode
        // impedir a tool: sem a cópia, a mudança só fica sem Undo.
        let antes: Awaited<ReturnType<typeof antesDe>> = null;
        if (prep.def?.destructive) {
          try {
            antes = await antesDe(plugin.app, call.name, call.arguments);
          } catch (err) {
            console.warn("[axxa] sem cópia pro Undo:", err);
          }
        }
        const maxAttempts = 1 + Math.max(0, effortCfg.toolRetryOnError);
        let lastErr: unknown = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const result = await executor(
              {
                app: plugin.app,
                vectorIndex: plugin.vectorIndex,
                embed: {
                  openaiApiKey: plugin.settings.openaiApiKey,
                  openrouterApiKey: plugin.settings.openrouterApiKey,
                  geminiApiKey: plugin.settings.geminiApiKey,
                  nimApiKey: plugin.settings.nimApiKey,
                  ollamaEndpoint: plugin.settings.ollamaEndpoint,
                },
                web: { tavilyApiKey: tavily },
              },
              call.arguments
            );
            const meta = summarizeToolResult(call.name, result);
            const detail =
              result && result.length > 800
                ? result.slice(0, 800).trimEnd() + "\n…"
                : result || undefined;
            updateActivity(activityId, { phase: "done", detail }, meta);
            if (antes) {
              try {
                const volta = await depoisDe(plugin.app, antes);
                if (volta) {
                  registrarDesfazer(activityId, volta);
                  updateActivity(activityId, { undoId: activityId });
                }
              } catch (err) {
                console.warn("[axxa] Undo não registrado:", err);
              }
            }
            return {
              callId: call.id,
              content: result,
              activityId,
              spec,
              meta,
              ok: true,
            };
          } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : "";
            if (!isTransientError(msg) || attempt === maxAttempts) break;
          }
        }
        const msg =
          lastErr instanceof Error ? lastErr.message : t.ai.unknownError;
        updateActivity(
          activityId,
          {
            phase: "failed",
            iconFailed: "x-circle",
            failedText: spec.failedText,
          },
          msg
        );
        return {
          callId: call.id,
          content: `ERROR: ${msg}. Do NOT repeat this same call — fix path/args or try another approach.`,
          activityId,
          spec,
          meta: "",
          ok: false,
        };
      };

      let results: CallResult[];
      if (effortCfg.parallelToolCalls && preparedCalls.length > 1) {
        // Paralelo POR GRUPO de path: calls no MESMO arquivo rodam em série
        // (evita race read-modify-write); paths distintos rodam em paralelo.
        const indexed = preparedCalls.map((prep, idx) => ({ prep, idx }));
        const groups = new Map<string, typeof indexed>();
        for (const item of indexed) {
          const a = item.prep.call.arguments;
          const writeKey = [a.path, a.from, a.to]
            .filter((v) => typeof v === "string" && v)
            .map((v) => String(v).replace(/^\/+|\/+$/g, ""))
            .join("→");
          const key = writeKey || `__solo_${item.idx}`;
          const bucket = groups.get(key);
          if (bucket) bucket.push(item);
          else groups.set(key, [item]);
        }
        results = new Array<CallResult>(preparedCalls.length);
        await Promise.all(
          [...groups.values()].map(async (bucket) => {
            for (const { prep, idx } of bucket) {
              results[idx] = await execCall(prep);
            }
          })
        );
      } else {
        results = [];
        for (const prep of preparedCalls) {
          results.push(await execCall(prep));
        }
      }
      for (const r of results) {
        history.push({
          role: "tool",
          toolCallId: r.callId,
          content: r.content,
        });
        const call = response.toolCalls.find((c) => c.id === r.callId);
        if (call) {
          runSteps.push({
            id: r.callId,
            name: call.name,
            arguments: call.arguments,
            result: r.content.slice(0, 1200),
            ok: r.ok,
          });
        }
      }
      // Stop no meio das tools: encerra pelo caminho de interrupção (anexa steps).
      if (controller.signal.aborted) {
        throw new DOMException("Interrupted", "AbortError");
      }

      if (loopDetected) {
        loopNudges++;
        if (loopNudges >= MAX_LOOP_NUDGES) {
          const loopId = addMessage({
            type: "ai-response",
            content: t.agent.loopAborted,
          });
          if (runSteps.length > 0) setAgentSteps(loopId, runSteps);
          return;
        }
        history.push({
          role: "user",
          content:
            "⚠️ You repeated the exact same tool call several times. " +
            "This means your current approach is not working. " +
            "STOP repeating, RECONSIDER your strategy (maybe you need " +
            "additional information — try vault_list/vault_read on another path) " +
            "OR ask the user to clarify. Do not repeat the same call.",
        });
        addMessage({
          type: "ai-comment",
          content: "",
          activity: {
            phase: "failed",
            iconPending: "rotate-cw",
            iconFailed: "alert-triangle",
            pendingText: t.agent.loopDetectedPending,
            failedText: t.agent.loopDetectedDone,
          },
        });
        recentCallSignatures.length = 0;
      }
    }
    const maxId = addMessage({
      type: "ai-response",
      content: t.agent.maxTurnsReached(MAX_TURNS),
    });
    if (runSteps.length > 0) setAgentSteps(maxId, runSteps);
  } catch (err) {
    if (firstTurn) {
      if (err instanceof DOMException && err.name === "AbortError") {
        updateActivity(commentId, {
          phase: "failed",
          iconFailed: "circle-stop",
          failedText: t.ai.interrupted,
        });
      } else {
        updateActivity(commentId, {
          phase: "failed",
          iconFailed: "x-circle",
          failedText: t.ai.failed,
        });
      }
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      if (!firstTurn) {
        const stopId = addMessage({
          type: "ai-response",
          content: t.ai.interrupted,
        });
        if (runSteps.length > 0) setAgentSteps(stopId, runSteps);
      }
    } else {
      const { message, code } = describeProviderError(
        err,
        t,
        activeProvider.name
      );
      const errId = addMessage({
        type: "ai-response",
        content: `${t.ai.errorPrefix} ${message}`,
        isError: true,
        errorCode: code,
      });
      if (runSteps.length > 0) setAgentSteps(errId, runSteps);
      descartarDoTurnoQueFalhou(code, firstTurn);
    }
  } finally {
    setLoading(false);
    setStreamingMessageId(null);
    endStreamTimer();
    abortRef.current = null;
  }
}

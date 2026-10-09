// src/ui/ChatView.tsx
// A tela do chat: barra do topo (menu · título · nova conversa), o corpo
// (StarterScreen enquanto vazio, timeline depois) e o composer. O MODO se
// escolhe na tela inicial; provider e modelo ficam nos pills do composer e
// somem quando a sessão trava (1º envio) — o effort continua livre sempre.
//
// O histórico de conversas NÃO mora aqui: é o menu lateral (Drawer.tsx).

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClipboardEvent } from "react";
import {
  arrayBufferToBase64,
  Notice,
  Platform,
  requestUrl,
  type App,
} from "obsidian";
import type AxxaPlugin from "../main";
import {
  NEW_CHAT_DRAFT,
  useChatStore,
  type ActivityMeta,
  type ChatMessage,
} from "../store/chat";
import type { ChatSession } from "../core/session";
import {
  PROVIDERS,
  providerBlockedReason,
  providerHealth,
} from "../core/providersMeta";
import {
  getModelCard,
  prettyModelName,
} from "../providers/modelDescriptions";
import {
  EFFORT_LEVELS,
  EFFORT_LABELS,
  describeEffort,
  type EffortLevel,
} from "../core/effort";
import type { AIToolStep } from "../agent/types";
import { agentActivitySpec } from "../core/helpers";
import type { Skill } from "../skills/skills";
import { Markdown } from "./Markdown";
import { Icon } from "./Icon";
import { useVoice } from "./useVoice";
import { speak, stopSpeaking } from "./readAloud";
import { commit, screen, warn } from "./haptics";
import { composerMaxHeight, readKeyboardHeight } from "./composerSize";
import { decideScroll, shouldShowJump } from "./follow";
import { pasteIsBig, pastedNote } from "./pasteAttachment";
import {
  htmlTitle,
  htmlToText,
  isImageExt,
  linkNote,
  normalizeUrl,
  rankArtifacts,
  vaultArtifacts,
  attachmentLabel,
  attachmentThumb,
  artifactIcon,
  GENERATION_DIR,
  type ArtifactLike,
} from "./attachSources";
import { getModelCapabilities } from "../providers/modelCapabilities";
import { ConfirmModal, PromptModal, openPluginSettings } from "./modals";
import { desfaziveis, desfazerRodada, desfazerUma, idDesfazivel } from "./agentUndo";
import { VoiceDock } from "./VoiceBar";
import {
  Sheet,
  SheetGroup,
  SheetNavRow,
  SheetToggleRow,
  SheetNote,
  SheetRow,
  SheetSearch,
  SheetTabs,
  SheetSeg,
  SheetTile,
  SheetTiles,
} from "./Sheet";
import { modelLogo } from "../providers/modelLogo";
import {
  rankNotes,
  readNote,
  notaAberta,
  vaultNotes,
  wikilinkQuery,
  type NoteLike,
} from "./notePicker";
import { StarterScreen } from "./StarterScreen";
import { ThinkingLine } from "./Thinking";
import type { ComposerInject } from "./App";
import { moduleFabLabel, moduleLabel, modulePlaceholder } from "./modules";
import { filterModels, groupModels } from "./modelGroups";
// O limite de favoritos é UM número, e ele mora onde se marca o favorito.
import { FAVORITE_LIMIT } from "./SettingsTab";
import { texto } from "../core/texto";
import { janelaConhecida, ocupacaoEstimada } from "../core/compactacao";
import { formatTokens } from "../core/contextWindows";
import { localeDaInterface, marca, tr } from "../i18n/tr";

/** Título da folha do "+" em cada nível. */
const PLUS_SHEET_TITLE: Record<string, string> = {
  root: marca("Add context"),
  notes: marca("Attach note"),
  skills: marca("Use a skill"),
  artifacts: marca("Attach artifact"),
};

/** Título da folha de modelos em cada nível. */
const MODEL_SHEET_TITLE: Record<string, string> = {
  root: marca("Select model"),
  list: marca("All models"),
  effort: marca("Effort"),
};

export function ChatView({
  plugin,
  session,
  inject,
  onBackHome,
  onUseSkill,
}: {
  plugin: AxxaPlugin;
  session: ChatSession;
  inject: ComposerInject | null;
  /** Volta pra home do módulo desta conversa. */
  onBackHome: () => void;
  onUseSkill: (skill: Skill) => void;
}) {
  const messages = useChatStore((s) => s.messages);
  // `isLoading` diz que ALGUMA conversa está respondendo — pode não ser esta.
  // Desde que dá pra sair do chat no meio da resposta, a tela precisa da
  // pergunta certa: "quem responde é quem eu estou vendo?". Sem isso, abrir
  // outra conversa mostrava nela o botão de parar e o indicador de pensando,
  // como se ela é que estivesse trabalhando.
  const respondendoAlguem = useChatStore((s) => s.isLoading);
  const turnChatId = useChatStore((s) => s.turnChatId);
  const loadingChat = useChatStore((s) => s.loadingChat);
  const streamingId = useChatStore((s) => s.streamingMessageId);
  const currentChatId = useChatStore((s) => s.currentChatId);
  /** É ESTA conversa que está respondendo agora. */
  const isLoading = respondendoAlguem && turnChatId === currentChatId;
  /** Outra conversa está respondendo — só uma de cada vez, por ora. */
  const outraRespondendo = respondendoAlguem && !isLoading;

  const currentChatTitle = useChatStore((s) => s.currentChatTitle);
  // Anexos pendentes (nota, imagem, texto colado) — chips acima do campo.
  const attachments = useChatStore((s) => s.attachments);
  const addAttachment = useChatStore((s) => s.addAttachment);
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  // Mensagem escrita durante a resposta, esperando a vez.
  const queued = useChatStore((s) => s.queued);
  const pushQueued = useChatStore((s) => s.pushQueued);
  const removeQueued = useChatStore((s) => s.removeQueued);
  // Lido do store pra re-renderizar quando a sessão trava/destrava.
  const locked = useChatStore((s) => s.sessionProvider) !== null;
  const cfg = session.config;
  // O medidor da janela: o prompt do último pedido desta conversa (o número
  // que o provider mandou) e o quanto dela saiu do cache.
  const ultimoPrompt = useChatStore((s) => s.lastPromptTokens);
  const tokensDaConversa = useChatStore((s) => s.tokensIn);
  const tokensDoCache = useChatStore((s) => s.tokensCached);

  // O rascunho é do CHAT, não da tela: ele mora no store (ver drafts lá) pra
  // sobreviver a sair pra Projects/Skills e pra não vazar de uma conversa pra
  // outra.
  const draftKey = currentChatId ?? NEW_CHAT_DRAFT;
  const draft = useChatStore((s) => s.drafts[draftKey] ?? "");
  const writeDraft = useChatStore((s) => s.setDraft);
  const setDraft = useCallback(
    (next: string | ((prev: string) => string)) =>
      writeDraft(
        draftKey,
        typeof next === "function"
          ? next(useChatStore.getState().drafts[draftKey] ?? "")
          : next
      ),
    [draftKey, writeDraft]
  );
  /** Qual bottom sheet do composer está aberta. */
  const [sheet, setSheet] = useState<"model" | "effort" | "plus" | null>(
    null
  );
  /** Provider que a folha de modelos está MOSTRANDO — não é o da sessão até
   *  alguém tocar num modelo. Dá pra espiar o catálogo de outro provider sem
   *  trocar nada por engano. */
  const [pickProvider, setPickProvider] = useState(cfg.provider);
  /** Nível da folha de modelos: os favoritos, ou a lista inteira. */
  /** O que foi digitado na busca da folha de modelos. */
  const [modelQuery, setModelQuery] = useState("");
  /** Aba de categoria aberta no catálogo ("" = a primeira que existir). */
  const [modelTab, setModelTab] = useState("");
  const [modelView, setModelView] = useState<"root" | "list" | "effort">(
    "root"
  );
  /** O que já foi reconhecido nesta gravação (parcial ou final). */
  const [liveText, setLiveText] = useState("");
  /** `[[` aberto no rascunho: onde começou e o que já foi digitado. */
  const [mention, setMention] = useState<{ start: number; query: string } | null>(
    null
  );
  /** Nível da folha do "+": a raiz, ou uma das listas. */
  const [plusView, setPlusView] = useState<
    "root" | "notes" | "skills" | "artifacts"
  >("root");
  const [noteQuery, setNoteQuery] = useState("");
  /** Três seletores nativos: galeria, câmera e PDF. São inputs separados
   *  porque `capture` muda o comportamento do aparelho — o mesmo input não
   *  pode ser as duas coisas. */
  const imageRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  /** Ações do agente abertas na folha (null = fechada) e qual delas está
   *  aberta no segundo nível. */
  const [tools, setTools] = useState<TurnAction[] | null>(null);
  const [toolAt, setToolAt] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLElement>(null);
  /** A função que publica a altura do composer — chamada pelo observer e por
   *  todo render. */
  const publicarRef = useRef<(() => void) | null>(null);
  /** O campo estava em foco quando a folha abriu? Só aí faz sentido devolver
   *  o foco quando ela fecha (quem abriu a folha sem estar escrevendo não quer
   *  o teclado subindo do nada). */
  const focoAntesDaFolha = useRef(false);
  /** rAF da medida de altura em voo (0 = nenhuma agendada). */
  const medindoRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Skill "Use" / sugestão: entra no rascunho, abaixo do que já estava
  // escrito. Sem texto, é só o pedido de foco — é como o painel abre uma
  // conversa nova já pronta pra escrever.
  //
  // `useLayoutEffect`, não `useEffect`: no celular o teclado só sobe se o
  // foco acontecer DENTRO do toque que o pediu. Efeito comum roda depois da
  // pintura, ou seja, depois que o toque acabou — a tela abria com o campo
  // aceso e o teclado fechado, que é o pior dos dois mundos.
  useLayoutEffect(() => {
    if (!inject) return;
    if (inject.text) {
      setDraft((d) => (d.trim() ? `${d}\n\n${inject.text}` : inject.text));
    }
    textareaRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `setDraft` troca junto com `draftKey`, ou seja, ao mudar de conversa. Listá-lo injetaria o texto de novo na conversa nova.
  }, [inject]);

  // Composer cresce com o texto. Mede com height:0 (altura definida) — com
  // `auto` o textarea é um flex item e pode ser medido esticado, o que fazia
  // o composer abrir tomando meia tela.
  //
  // O TETO vem de composerSize: 40% do que dá pra ver, não da tela inteira. E
  // o cálculo refaz quando a tela muda (teclado abrindo, aparelho girando) —
  // antes ele só dependia do texto, então uma altura calculada pra outra
  // largura ficava congelada depois de girar.
  // useLayoutEffect, não useEffect + rAF: a medida acontece ANTES da pintura,
  // então não existe o frame em que o campo aparece com a altura antiga. (E o
  // rAF simplesmente não roda quando a janela está oculta, o que deixava a
  // altura congelada ao voltar pro app.)
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const fit = () => {
      const max = composerMaxHeight(
        window.innerHeight,
        readKeyboardHeight(document),
        window.visualViewport?.height
      );
      // UMA fonte de verdade: o CSS lê esta var no max-height, então JS e CSS
      // não podem mais discordar sobre o teto.
      el.style.setProperty("--axxa-composer-max", `${max}px`);
      // Zera pra medir o conteúdo e só então fixa a altura: sem o zero, o
      // scrollHeight devolve a altura ATUAL e o campo nunca encolhe.
      el.setCssStyles({ height: "0px" });
      el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    };
    // Medir custa um layout do documento INTEIRO. Por tecla, numa conversa de
    // 120 mensagens, isso media 46ms — digitar travava. Por FRAME, o layout é
    // o que ia acontecer de qualquer jeito, e teclas seguidas se juntam numa
    // medida só. A primeira medida (e as de resize, que são raras) continuam
    // síncronas, pra altura nunca aparecer errada num quadro.
    if (!el.style.height) fit();
    else if (!medindoRef.current) {
      medindoRef.current = window.requestAnimationFrame(() => {
        medindoRef.current = 0;
        fit();
      });
    }
    const vv = window.visualViewport;
    window.addEventListener("resize", fit);
    vv?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      vv?.removeEventListener("resize", fit);
    };
  }, [draft]);

  useEffect(
    () => () => {
      if (medindoRef.current) window.cancelAnimationFrame(medindoRef.current);
    },
    []
  );

  // As narrações ("Listed root — 7 items") de uma rodada JÁ TERMINADA saem da
  // conversa e vão pra folha, junto das tool calls: elas são o passo a passo,
  // e passo a passo é auditoria. A que ainda está rodando FICA — é ela que diz
  // que tem coisa acontecendo.
  const { hiddenIds, actionsByResponse } = useMemo(() => {
    const hiddenIds = new Set<string>();
    const actionsByResponse = new Map<string, TurnAction[]>();
    let bucket: ChatMessage[] = [];
    for (const m of messages) {
      if (m.type === "ai-comment" && m.activity) {
        bucket.push(m);
        hiddenIds.add(m.id);
        continue;
      }
      if (m.type === "ai-response") {
        const narradas: TurnAction[] = bucket
          .map((c): TurnAction | null =>
            c.type === "ai-comment" && c.activity
              ? { kind: "activity", activity: c.activity }
              : null
          )
          .filter((a): a is TurnAction => a !== null);
        const passos: TurnAction[] = (m.agentSteps ?? []).map((step) => ({
          kind: "step",
          step,
        }));
        const todas = [...narradas, ...passos];
        if (todas.length > 0) actionsByResponse.set(m.id, todas);
        for (const c of bucket) hiddenIds.add(c.id);
        bucket = [];
      } else if (m.type === "user") {
        bucket = [];
      }
    }
    return { hiddenIds, actionsByResponse };
  }, [messages]);

  // A rodada EM CURSO: tudo que já aconteceu desde a última fala do usuário,
  // sem resposta ainda. Vira UMA linha "pensando" — não uma pilha de
  // narrações, que é o que empurrava a conversa pra fora da tela.
  const liveTurn = useMemo(() => {
    const bucket: TurnAction[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === "ai-response" || m.type === "user") break;
      if (m.type === "ai-comment" && m.activity) {
        bucket.unshift({ kind: "activity", activity: m.activity });
      }
    }
    return bucket;
  }, [messages]);

  // O indicador some quando o TEXTO começa a sair: a partir daí quem mostra
  // que tem coisa acontecendo é a própria resposta aparecendo.
  const ultima = messages[messages.length - 1];
  const jaEscrevendo =
    ultima?.type === "ai-response" &&
    ultima.id === streamingId &&
    ultima.content.length > 0;
  const pensandoAgora = (isLoading || liveTurn.length > 0) && !jaEscrevendo;
  // O que a rodada está fazendo agora, quando não é pensar (resumindo a
  // conversa, por exemplo): a atividade mais recente que ainda roda e diz.
  const fazendoAgora = useMemo(() => {
    for (let i = liveTurn.length - 1; i >= 0; i--) {
      const a = liveTurn[i];
      if (a.kind === "activity" && a.activity.phase === "pending" && a.activity.agora) {
        return a.activity.agora;
      }
    }
    return undefined;
  }, [liveTurn]);

  // Quando esta espera começou — é daqui que sai o relógio da linha. Em ref
  // pra não reiniciar a cada render; zera quando a espera acaba.
  const desdeRef = useRef(0);
  if (pensandoAgora && desdeRef.current === 0) desdeRef.current = Date.now();
  if (!pensandoAgora && desdeRef.current !== 0) desdeRef.current = 0;
  const pensandoDesde = desdeRef.current || Date.now();
  // O rótulo é a ação MAIS RECENTE — é ela que está acontecendo agora.
  // ── acompanhar o fim, ou deixar a pessoa ler ────────────────────────────
  // A tela só corre atrás do texto novo enquanto o usuário está no fim. Subiu
  // pra reler? Fica parado onde ele deixou até ele voltar — antes, cada pedaço
  // de resposta o arrancava de volta pro rodapé.
  const [seguindo, setSeguindo] = useState(true);
  /** Em ref também: os observers são registrados uma vez e não podem ler um
   *  `seguindo` velho. */
  const seguindoRef = useRef(true);
  seguindoRef.current = seguindo;
  /** Resposta que terminou LONGE dos olhos — é ela que acende. */
  const [avisoId, setAvisoId] = useState<string | null>(null);

  /** Altura da conversa na última vez que olhamos — é ela que diz se o
   *  usuário estava no fim ANTES do texto novo entrar. */
  const alturaAnteriorRef = useRef(0);
  /** Tem dedo (ou roda) mexendo na rolagem agora? Enquanto tem, a tela NÃO
   *  desce sozinha. */
  const gestoRef = useRef(false);

  const stickToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  /**
   * O coração disto: decide, a cada mudança, se a tela desce ou fica.
   *
   * Roda no observer de conteúdo, no effect das mensagens e na rolagem — as
   * três levam à MESMA conta, feita sobre o DOM na hora. Não há estado
   * paralelo pra dessincronizar, e não depende do evento de scroll chegar.
   */
  /**
   * Ponto onde a timeline deve abrir, enquanto ele ainda não foi alcançado.
   *
   * Não dá pra posicionar de primeira: no instante em que as mensagens entram
   * no DOM o markdown ainda não foi renderizado (ele é atrasado de propósito),
   * então a caixa tem quase nenhuma altura e qualquer alvo vira zero. O alvo
   * fica guardado aqui e é reaplicado a cada mutação até caber — aí se apaga.
   */
  const retomarRef = useRef<
    | { scroll: number; desde: number }
    | { messageId: string; desde: number }
    | null
  >(null);

  /** Depois disto, desiste do alvo. Uma conversa curta NUNCA alcança o ponto
   *  (não há o que rolar), e sem prazo o alvo ficaria pendurado pra sempre —
   *  bloqueando a timeline de voltar a acompanhar o fim. */
  const RETOMAR_MS = 1500;

  /** Tenta pousar no alvo. Devolve true quando conseguiu (e limpa o alvo). */
  const aplicarRetomada = () => {
    const alvo = retomarRef.current;
    const el = scrollRef.current;
    if (!alvo || !el) return false;
    const desistiu = Date.now() - alvo.desde > RETOMAR_MS;
    if ("messageId" in alvo) {
      const msg = el.querySelector<HTMLElement>(`[data-msg="${alvo.messageId}"]`);
      if (!msg) {
        if (!desistiu) return false;
        retomarRef.current = null;
        return false;
      }
      // 12px de folga: mensagem colada no topo parece cortada.
      const destino = Math.max(0, msg.offsetTop - 12);
      el.scrollTop = destino;
      // Só aceita quando o conteúdo já é alto o bastante pra realmente pousar
      // ali — senão o navegador limita e a gente "acerta" no lugar errado.
      // Passado o prazo, aceita o que deu: é o mais perto que dá.
      if (!desistiu && Math.abs(el.scrollTop - destino) > 2) return false;
    } else {
      const destino = alvo.scroll;
      el.scrollTop = destino;
      if (!desistiu && Math.abs(el.scrollTop - destino) > 2) return false;
    }
    retomarRef.current = null;
    alturaAnteriorRef.current = el.scrollHeight;
    seguindoRef.current = false;
    setSeguindo(false);
    return true;
  };

  const reavaliar = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Com um alvo pendente, a timeline NÃO segue o fim: ela está tentando
    // pousar onde a leitura parou, e grudar embaixo desfaria isso.
    if (retomarRef.current) {
      aplicarRetomada();
      alturaAnteriorRef.current = el.scrollHeight;
      return;
    }
    const { pin, seguindo: noFim } = decideScroll({
      gesto: gestoRef.current,
      alturaAnterior: alturaAnteriorRef.current,
      alturaAtual: el.scrollHeight,
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
    });
    if (pin) el.scrollTop = el.scrollHeight;
    alturaAnteriorRef.current = el.scrollHeight;
    if (noFim !== seguindoRef.current) {
      seguindoRef.current = noFim;
      setSeguindo(noFim);
    }
    if (noFim) setAvisoId(null);
  };

  /** Volta pro fim e volta a acompanhar (o toque no aviso e o envio). */
  const voltarPraBaixo = () => {
    // Ir pro fim de propósito desiste de qualquer alvo pendente — quem mandou
    // agora foi a pessoa.
    retomarRef.current = null;
    gestoRef.current = false;
    seguindoRef.current = true;
    setSeguindo(true);
    setAvisoId(null);
    stickToBottom();
    const el = scrollRef.current;
    if (el) alturaAnteriorRef.current = el.scrollHeight;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    alturaAnteriorRef.current = el.scrollHeight;
    // Conteúdo mudando: o markdown é renderizado com atraso (throttle), então
    // a altura cresce DEPOIS do render do React — o effect de `messages`
    // sozinho chegaria cedo demais.
    const obs = new MutationObserver(reavaliar);
    obs.observe(el, { childList: true, subtree: true, characterData: true });

    // ── o gesto ────────────────────────────────────────────────────────────
    // O dedo sai da tela mas a inércia continua: quem diz que o gesto acabou é
    // a rolagem PARAR, não o touchend. Por isso o cronômetro reinicia a cada
    // evento de rolagem enquanto ele está armado.
    let assentar = 0;
    const comecarGesto = () => {
      gestoRef.current = true;
      window.clearTimeout(assentar);
      assentar = 0;
    };
    const terminarGesto = () => {
      window.clearTimeout(assentar);
      assentar = window.setTimeout(() => {
        assentar = 0;
        gestoRef.current = false;
        reavaliar();
      }, 320);
    };
    const aoRolar = () => {
      // Onde a leitura está, pra a sessão poder guardar isso se a conversa
      // sair da tela no meio de uma resposta. Escrito com `setState` direto:
      // ninguém assina este campo, então não redesenha nada.
      useChatStore.setState({
        viewScrollTop: el.scrollTop,
        viewChatId: useChatStore.getState().currentChatId,
      });
      // Rolando com o cronômetro armado = inércia viva: adia o veredito.
      if (assentar) terminarGesto();
      reavaliar();
    };

    el.addEventListener("scroll", aoRolar, { passive: true });
    el.addEventListener("touchstart", comecarGesto, { passive: true });
    el.addEventListener("touchend", terminarGesto, { passive: true });
    el.addEventListener("touchcancel", terminarGesto, { passive: true });
    el.addEventListener("wheel", comecarGesto, { passive: true });
    el.addEventListener("wheel", terminarGesto, { passive: true });
    const mouseDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") comecarGesto();
    };
    const mouseUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") terminarGesto();
    };
    el.addEventListener("pointerdown", mouseDown);
    window.addEventListener("pointerup", mouseUp);

    return () => {
      obs.disconnect();
      window.clearTimeout(assentar);
      el.removeEventListener("scroll", aoRolar);
      el.removeEventListener("touchstart", comecarGesto);
      el.removeEventListener("touchend", terminarGesto);
      el.removeEventListener("touchcancel", terminarGesto);
      el.removeEventListener("wheel", comecarGesto);
      el.removeEventListener("wheel", terminarGesto);
      el.removeEventListener("pointerdown", mouseDown);
      window.removeEventListener("pointerup", mouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a intenção é rodar SÓ quando a conversa troca; incluir o resto das deps reabriria a rolagem a cada token que chega.
  }, []);

  useEffect(reavaliar, [messages, streamingId]);

  // O composer flutua sobre a conversa, então a área de mensagens precisa
  // saber a altura dele pra reservar espaço embaixo. Ela MUDA o tempo todo
  // (anexo, fila, campo crescendo, modo de voz), então é medida, não chutada.
  useEffect(() => {
    const el = composerRef.current;
    const raiz = el?.closest(".axxa-root") as HTMLElement | null;
    if (!el || !raiz) return;
    const publicar = () => {
      // A ALTURA dele: é o quanto a conversa precisa avançar por baixo (margem
      // negativa) e devolver por dentro (padding).
      raiz.style.setProperty(
        "--axxa-composer-h",
        `${Math.max(0, Math.round(el.getBoundingClientRect().height))}px`
      );
      // Cresceu embaixo de quem estava no fim: desce junto.
      reavaliar();
    };
    publicarRef.current = publicar;
    publicar();
    const obs = new ResizeObserver(publicar);
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depende só do id da conversa de propósito: reagir às mensagens re-rodaria isto no meio do streaming.
  }, []);

  // O observer só entrega no ciclo de pintura — com a janela oculta ele não
  // roda, e a reserva ficava velha. Medir também a CADA render cobre o que
  // muda por estado (anexo, fila, modo de voz) sem depender disso.
  useLayoutEffect(() => {
    publicarRef.current?.();
  });

  // Trocar de conversa (ou abrir uma nova) começa no fim, acompanhando: o
  // estado de leitura era da conversa anterior. Sem isto, abrir outro chat
  // depois de ter subido pra ler deixava a tela parada no meio dele.
  useEffect(() => {
    // A sessão pode ter pedido pra abrir num ponto — voltando de uma resposta
    // que rodou fora da tela, ou entrando numa conversa que respondeu sem
    // você ver. Aí o fim é o lugar errado: a resposta nova começa ACIMA dele,
    // e cair no fim obriga a subir procurando onde ela começou.
    const { resumeScroll, resumeMessageId } = useChatStore.getState();
    if (resumeScroll !== null || resumeMessageId !== null) {
      useChatStore.getState().setResume({});
      gestoRef.current = false;
      setAvisoId(null);
      seguindoRef.current = false;
      setSeguindo(false);
      retomarRef.current =
        resumeMessageId !== null
          ? { messageId: resumeMessageId, desde: Date.now() }
          : { scroll: resumeScroll as number, desde: Date.now() };
      // Tenta agora e continua tentando a cada mutação, conforme o markdown
      // vai ganhando altura (ver `aplicarRetomada`).
      window.requestAnimationFrame(() => aplicarRetomada());
      return;
    }
    // Sem pedido explícito, mas é a MESMA conversa de antes: a timeline está
    // remontando (você foi na home, ou em Projects, e voltou). Volta pro ponto
    // em que a leitura estava — ir pro fim aqui é desfazer o que você leu.
    const { viewChatId, viewScrollTop } = useChatStore.getState();
    if (currentChatId && viewChatId === currentChatId && viewScrollTop > 0) {
      gestoRef.current = false;
      setAvisoId(null);
      seguindoRef.current = false;
      setSeguindo(false);
      retomarRef.current = { scroll: viewScrollTop, desde: Date.now() };
      window.requestAnimationFrame(() => aplicarRetomada());
      return;
    }
    retomarRef.current = null;
    voltarPraBaixo();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roda no fim do turno, não a cada mudança das deps que o lint quer listar.
  }, [currentChatId]);

  // Terminou de responder enquanto a pessoa estava lendo lá em cima: a
  // mensagem acende e o aviso aparece. Sem isso, a resposta fica pronta e
  // ninguém avisa — o usuário volta do nada pra conferir.
  const respondendoRef = useRef(false);
  useEffect(() => {
    const respondendoAgora = isLoading || streamingId !== null;
    const terminou = respondendoRef.current && !respondendoAgora;
    respondendoRef.current = respondendoAgora;
    if (!terminou) return;
    if (seguindoRef.current) return;
    const ultima = [...messages]
      .reverse()
      .find((m) => m.type === "ai-response");
    if (!ultima) return;
    setAvisoId(ultima.id);
    // O aviso é visual E tátil: quem está lendo não está olhando pro rodapé.
    commit();
  }, [isLoading, streamingId, messages]);

  const mostrarAviso = shouldShowJump(
    seguindo,
    isLoading || streamingId !== null,
    avisoId !== null
  );

  // Teclado abrindo: a área da conversa encolhe, então reancora no fim
  // depois da animação (o inset em si é do useKeyboardInset).
  const onComposerFocus = () => {
    if (!seguindoRef.current) return;
    stickToBottom();
    window.setTimeout(stickToBottom, 350);
  };

  /** Reavalia se o cursor está dentro de um `[[` aberto. Roda a cada digitada
   *  e a cada movimento do cursor — sair de dentro do link fecha a lista. */
  const conferirMencao = (el: HTMLTextAreaElement) => {
    const achou = wikilinkQuery(el.value, el.selectionStart ?? el.value.length);
    setMention(achou);
  };

  /** Escolher na lista do `[[`: troca o que foi digitado pelo wikilink E
   *  anexa a nota — citar sem mandar o conteúdo junto seria só um texto. */
  const escolherMencao = (n: NoteLike) => {
    const el = textareaRef.current;
    if (!el || !mention) return;
    const cursor = el.selectionStart ?? draft.length;
    const link = `[[${n.path.replace(/\.md$/, "")}]]`;
    const antes = draft.slice(0, mention.start);
    const novo = antes + link + draft.slice(cursor);
    setDraft(novo);
    setMention(null);
    void anexarNota(n.path);
    // O cursor vai pra DEPOIS do link, senão a pessoa continua digitando
    // dentro do que acabou de inserir. Depois do commit do React.
    const fim = antes.length + link.length;
    window.setTimeout(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(fim, fim);
    }, 0);
  };

  /** Tocou num provider que ainda não está ligado. O primeiro toque explica
   *  em uma linha; o segundo, já que a pessoa insistiu, abre o caminho — sem
   *  transformar cada toque errado num modal. */
  const aoTocarBloqueado = async (
    id: string,
    motivo: string,
    insistiu: boolean
  ) => {
    const nome = PROVIDERS.find((p) => p.id === id)?.name ?? id;
    if (!insistiu) {
      new Notice(`${nome} — ${tr(motivo)}`);
      return;
    }
    const ir = await new ConfirmModal(plugin.app, {
      title: tr("{name} is not set up", { name: nome }),
      body: `${tr(motivo)}

${tr("Open Settings › Providers to add it, then run the connection test.")}`,
      confirmLabel: tr("Open settings"),
    }).openAndWait();
    if (ir) {
      closeSheet();
      openPluginSettings(plugin);
    }
  };

  /** PDF: vai como anexo mesmo quando o modelo não lê — nesse caso o motor
   *  registra o arquivo na conversa em vez de mandar, e o aviso já apareceu na
   *  linha do menu. */
  const anexarPdf = (file: File) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const dataUrl = texto(leitor.result);
      if (!dataUrl.startsWith("data:")) return;
      addAttachment({ type: "pdf", name: file.name, dataUrl });
    };
    leitor.onerror = () => new Notice(tr("Could not read that file."));
    leitor.readAsDataURL(file);
  };

  /** Link: busca a página e anexa o TEXTO dela. Sem isto, colar uma URL só
   *  dava ao modelo o endereço — e ele não navega. */
  const anexarLink = async () => {
    const digitado = await new PromptModal(plugin.app, {
      title: tr("Attach link"),
      label: tr("Address"),
      placeholder: "https://…",
      submitLabel: tr("Fetch"),
    }).openAndWait();
    const url = normalizeUrl(digitado ?? "");
    if (!url) {
      if (digitado) new Notice(tr("That doesn't look like an address."));
      return;
    }
    const aviso = new Notice(tr("Fetching {url}…", { url }), 0);
    try {
      // `requestUrl` do Obsidian: sem CORS, que é o que faz isso funcionar no
      // celular.
      const res = await requestUrl({ url });
      const texto = htmlToText(res.text ?? "");
      if (!texto) {
        new Notice(tr("Nothing readable at that address."));
        return;
      }
      addAttachment(linkNote(url, htmlTitle(res.text ?? ""), texto));
    } catch {
      new Notice(tr("Could not reach that address."));
    } finally {
      aviso.hide();
    }
  };

  /** Artefato: o que o plugin gerou volta pra conversa. Imagem vira anexo de
   *  imagem de verdade (o modelo VÊ); o resto entra como referência. */
  const anexarArtefato = async (a: ArtifactLike) => {
    try {
      if (isImageExt(a.extension) && modeloVeImagem) {
        const bin = await plugin.app.vault.adapter.readBinary(a.path);
        const mime = a.extension.toLowerCase() === "png" ? "image/png" : "image/jpeg";
        addAttachment({
          type: "image",
          dataUrl: `data:${mime};base64,${arrayBufferToBase64(bin)}`,
          mimeType: mime,
          name: `${a.basename}.${a.extension}`,
        });
        return;
      }
      addAttachment({
        type: "note",
        path: a.path,
        content: `Arquivo gerado pelo plugin: ${a.path}`,
      });
    } catch {
      new Notice(tr("Could not read that file."));
    }
  };

  /** Colar. Duas coisas que o campo não fazia:
   *   - imagem da área de transferência (print) vira anexo
   *   - bloco grande vira anexo em vez de virar parede de texto */
  const aoColar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const dados = e.clipboardData;
    if (!dados) return;

    const imagens = Array.from(dados.files ?? []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (imagens.length > 0) {
      e.preventDefault();
      if (!modeloVeImagem) {
        new Notice(tr("This model can't read images."));
        return;
      }
      for (const img of imagens) anexarImagem(img);
      return;
    }

    const texto = dados.getData("text");
    if (pasteIsBig(texto)) {
      e.preventDefault();
      addAttachment(pastedNote(texto));
    }
  };

  /** Anexa uma nota do vault (lida agora — é o conteúdo que vai no prompt). */
  const anexarNota = async (path: string) => {
    const nota = await readNote(plugin.app, path);
    if (!nota) {
      new Notice(tr("Note not found: {path}", { path }));
      return;
    }
    addAttachment({ type: "note", path: nota.path, content: nota.content });
  };

  /** Imagem do aparelho: vira data URL, que é o formato que os providers
   *  multimodais aceitam. */
  const anexarImagem = (file: File) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const dataUrl = texto(leitor.result);
      if (!dataUrl.startsWith("data:")) return;
      addAttachment({
        type: "image",
        dataUrl,
        mimeType: file.type || undefined,
        name: file.name,
      });
    };
    leitor.onerror = () => new Notice(tr("Could not read that image."));
    leitor.readAsDataURL(file);
  };

  // Identidade ESTÁVEL: uma arrow nova a cada render derrubaria o memo da
  // MessageRow, que é o ponto todo do item.
  const abrirAcoes = useCallback((acoes: TurnAction[]) => {
    setTools(acoes);
    // Lista de UM item é uma parada a mais sem informação: abre direto no
    // detalhe.
    setToolAt(acoes.length === 1 ? 0 : null);
  }, []);

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    // Mandar (ou enfileirar) é dizer "acabei de ler, estou aqui embaixo": a
    // tela volta pro fim, senão a mensagem recém-escrita — e o chip da fila —
    // nascem fora do campo de visão.
    voltarPraBaixo();
    // Escrever durante a resposta não pode ser um clique no vazio: a mensagem
    // entra na FILA e sai sozinha quando a rodada terminar.
    if (outraRespondendo) {
      // O motor roda um turno por vez. Enfileirar aqui mandaria o texto pra a
      // fila da OUTRA conversa — some da tela e aparece onde ninguém pediu.
      new Notice(tr("Another chat is still answering — try again in a moment."));
      return;
    }
    if (isLoading) {
      commit();
      pushQueued(text);
      writeDraft(draftKey, "");
      return;
    }
    commit();
    // A chave é lida AGORA: o 1º envio de uma conversa nova ganha um id no meio
    // do send, e limpar depois apagaria o rascunho da conversa errada.
    const chave = draftKey;
    // Limpa NA HORA. `send()` só resolve quando a rodada INTEIRA termina — se
    // a limpeza esperar por isso, o texto fica no campo durante toda a
    // resposta e, quando ela acaba, apaga o que a pessoa escreveu no meio.
    writeDraft(chave, "");
    const foi = await session.send(text);
    // Devolve se o envio nem engatou (sem key na 1ª mensagem, por exemplo).
    // Essa desistência é síncrona, então a volta é imediata — e só acontece se
    // o campo continuar vazio, pra não passar por cima de outra frase.
    if (!foi && !(useChatStore.getState().drafts[chave] ?? "").trim()) {
      writeDraft(chave, text);
    }
  };

  // Abrir uma sheet tira o foco do campo — senão o teclado sobe por cima dela.
  const openSheet = (which: "model" | "effort" | "plus") => {
    const campo = textareaRef.current;
    focoAntesDaFolha.current =
      campo != null && campo.ownerDocument.activeElement === campo;
    textareaRef.current?.blur();
    // A folha de modelos abre sempre no provider da sessão, e no primeiro nível.
    if (which === "model") {
      setPickProvider(cfg.provider);
      setModelView("root");
    }
    if (which === "plus") {
      setPlusView("root");
      setNoteQuery("");
    }
    setSheet(which);
  };
  const closeSheet = () => {
    setSheet(null);
    // Volta pra onde a pessoa estava: escolher um modelo no meio de uma frase
    // não pode custar um toque a mais pra continuar escrevendo.
    if (focoAntesDaFolha.current) {
      focoAntesDaFolha.current = false;
      window.setTimeout(
        () => textareaRef.current?.focus({ preventScroll: true }),
        0
      );
    }
  };

  // A lista de notas do "+" (e, mais pra frente, do `[[`). Só calcula quando a
  // folha está aberta nesse nível — varrer o vault a cada render seria caro
  // num vault grande.
  const notasAchadas = useMemo(() => {
    if (sheet !== "plus" || plusView !== "notes") return [];
    return rankNotes(vaultNotes(plugin.app), noteQuery);
  }, [sheet, plusView, noteQuery, plugin.app]);

  /** Sugestões do `[[` — poucas, porque elas cobrem a conversa. */
  const mentionHits = useMemo(
    () => (mention ? rankNotes(vaultNotes(plugin.app), mention.query, 6) : []),
    [mention, plugin.app]
  );

  /** O que ESTE modelo aceita como entrada. Imagem e PDF não somem do menu
   *  quando ele não lê — aparecem indisponíveis, que é diferente de não
   *  existir. */
  const caps = getModelCapabilities(cfg.provider, cfg.model);
  const modeloVeImagem =
    caps.vision ||
    getModelCard(cfg.provider, cfg.model).category === "chat-vision";
  const modeloLePdf = caps.pdf === true;

  /** O que o próprio plugin gerou (imagens, áudio, vídeo). */
  const artefatos = useMemo(() => {
    if (sheet !== "plus" || plusView !== "artifacts") return [];
    return rankArtifacts(vaultArtifacts(plugin.app));
  }, [sheet, plusView, plugin.app]);

  // Os dois blocos do cartão de modelos. Favoritar já implica Show, então o
  // segundo bloco tira os favoritos pra ninguém aparecer duas vezes.
  const favorites = (
    plugin.settings.favoriteModels?.[pickProvider] ?? []
  ).slice(0, 5);
  /** O catálogo inteiro do provider — é o que o nível "All models" mostra. */
  const todosOsModelos = session.modelOptions(pickProvider);
  const rest = todosOsModelos.filter((m) => !favorites.includes(m));

  // ── modo de voz ─────────────────────────────────────────────────────────
  // O gravador mora em useVoice; aqui fica só o GESTO do botão (segurar pra
  // gravar, arrastar pra cancelar, pra cima pra travar) e o rascunho.
  // O texto reconhecido aparece ACIMA do dock enquanto se fala (é o que a
  // referência faz) e só vira rascunho quando a gravação termina. Antes ele ia
  // direto pro textarea — que fica colapsado durante a gravação, então ninguém
  // via nada enquanto falava.
  const voice = useVoice({
    apiKey: () => plugin.providerCredential("openai"),
    model: () => plugin.settings.voiceModel,
    language: () => plugin.settings.voiceLanguage,
    onTranscript: setLiveText,
    // Acabou a gravação: o texto entra no rascunho, depois do que já estava
    // escrito. Quem avisa é o hook, num aviso só — ver `onFinal`.
    onFinal: (texto) => {
      setLiveText("");
      if (!texto) return;
      setDraft((d) => (d.trim() ? `${d.trim()} ${texto}` : texto));
    },
    onNotice: (m) => {
      new Notice(m);
    },
    onCancel: () => setLiveText(""),
  });

  // Um CLIQUE começa a gravar; o dock cuida do resto (✕ joga fora, ✓ usa o
  // texto). O gesto de segurar/arrastar saiu: dependia de o microfone abrir
  // antes do dedo sair, e essa corrida travava a tela no aparelho.
  //
  // A troca começa NO CLIQUE, não quando o gravador fica pronto: abrir o
  // microfone ocupa a thread principal, e a animação de altura é main-thread —
  // disparada junto, ela era atropelada e virava um pulo. Assim ela roda
  // enquanto o microfone abre, e o dock já aparece (onda parada) de imediato.
  const [arming, setArming] = useState(false);
  const startVoice = async () => {
    if (arming || voice.state !== "idle") return;
    setLiveText("");
    setArming(true);
    screen();
    const ok = await voice.start();
    if (!ok) {
      setArming(false);
      warn();
    }
  };
  useEffect(() => {
    if (voice.state === "idle") setArming(false);
  }, [voice.state]);

  // Trocar de provider ou de nível zera a busca: o que foi digitado era
  // pergunta pra a lista anterior, e uma busca invisível que esconde modelos
  // é a mesma armadilha da busca das homes.
  useEffect(() => {
    setModelQuery("");
    setModelTab("");
  }, [pickProvider, modelView]);

  /**
   * Marca/desmarca um favorito SEM sair da folha.
   *
   * Antes isso só existia em Settings, e o caminho era: sair do chat, achar a
   * aba, achar o provider, achar o modelo. Quem descobre que usa um modelo
   * toda hora descobre isso AQUI, na hora de escolher — que é onde a marca
   * deve poder ser feita.
   *
   * O limite é o mesmo das Settings, e o aviso também: cinco por provider,
   * porque cinco é o que cabe no atalho sem ele virar lista.
   */
  const alternarFavorito = async (model: string) => {
    const atuais = plugin.settings.favoriteModels?.[pickProvider] ?? [];
    const tem = atuais.includes(model);
    if (!tem && atuais.length >= FAVORITE_LIMIT) {
      new Notice(
        tr("{n} favorites per provider is the limit — unstar one first.", {
          n: FAVORITE_LIMIT,
        })
      );
      return;
    }
    plugin.settings.favoriteModels = {
      ...(plugin.settings.favoriteModels ?? {}),
      [pickProvider]: tem
        ? atuais.filter((x) => x !== model)
        : [...atuais, model],
    };
    await plugin.saveSettings();
  };

  /** Tocar num modelo comita as DUAS coisas: o provider da folha e o modelo. */
  const chooseModel = (model: string) => {
    if (pickProvider !== cfg.provider) session.setProvider(pickProvider);
    session.setModel(model);
    closeSheet();
  };

  const empty = messages.length === 0 && !loadingChat;
  const effort = cfg.effort as EffortLevel;

  return (
    <div className="axxa-chat">
      <header className="axxa-topbar">
        {/* Só a seta. O menu tem UMA porta, e ela é a home — que fica a um
            toque daqui. Duas portas pro mesmo lugar na mesma barra gastavam
            a única coisa escassa desta tela, que é largura: a seta, o
            hambúrguer, o título e o botão de nova conversa disputavam a mesma
            linha, e o título perdia. */}
        <button
          type="button"
          className="axxa-icon-btn"
          aria-label={tr("Back")}
          onClick={onBackHome}
        >
          <Icon name="arrow-left" />
        </button>
        <div className="axxa-topbar-title">
          <span className="axxa-topbar-name">
            {/* Sem conversa gravada, o título é O QUE VAI SER CRIADO — e isso
                muda com o modo escolhido logo abaixo: "New chat", "New
                question", "New session". É a mesma palavra que o botão de
                criar usa em cada módulo (moduleFabLabel), porque é a mesma
                coisa sendo nomeada. Um "New chat" fixo desmentia o trilho:
                você escolhia Agent e a barra continuava falando de chat. */}
            {currentChatId
              ? currentChatTitle || tr("Untitled")
              : tr(moduleFabLabel(cfg.mode))}
          </span>
          {locked && (
            <span className="axxa-topbar-meta">
              <span className="axxa-topbar-meta-text">
                {tr(moduleLabel(cfg.mode))} · {cfg.model}
              </span>
              <MedidorDaJanela
                provider={cfg.provider}
                model={cfg.model}
                usados={ultimoPrompt}
                mensagens={messages}
                enviados={tokensDaConversa}
                doCache={tokensDoCache}
              />
            </span>
          )}
        </div>
        <button
          type="button"
          className="axxa-icon-btn"
          aria-label={tr("New chat")}
          disabled={empty && !currentChatId}
          onClick={() => session.newChat()}
        >
          <Icon name="square-pen" />
        </button>
      </header>

      <div className="axxa-messages" ref={scrollRef}>
        {loadingChat && <p className="axxa-empty-line">{tr("Loading…")}</p>}
        {empty ? (
          <StarterScreen plugin={plugin} session={session} />
        ) : (
          messages
            .filter((m) => !hiddenIds.has(m.id))
            .map((m) => (
            <MessageRow
              key={m.id}
              msg={m}
              plugin={plugin}
              streaming={m.id === streamingId}
              glow={m.id === avisoId}
              actions={actionsByResponse.get(m.id)}
              onOpenTools={abrirAcoes}
              idioma={localeDaInterface()}
            />
          ))
        )}

        {/* O "pensando": UMA linha — o asterisco que respira, o tempo e o
            verbo da vez. Enquanto a rodada corre é ela que diz que tem coisa
            acontecendo; quando a resposta chega ela sai e o chip da mensagem
            assume. O que rodou fica a um toque, na folha. */}
        {pensandoAgora && (
          <ThinkingLine
            count={liveTurn.length}
            since={pensandoDesde}
            rotulo={fazendoAgora}
            onOpen={() => {
              if (liveTurn.length === 0) return;
              setTools(liveTurn);
              setToolAt(liveTurn.length === 1 ? 0 : null);
            }}
          />
        )}
      </div>

      {/* Composer: UM bloco só — campo em cima, barra de controles embaixo,
          sem régua horizontal separando nada. */}
      <section className="axxa-composer" ref={composerRef}>
          {/* Quem subiu pra ler precisa de um caminho de volta — e de saber que
              a resposta ficou pronta lá embaixo. Ancorado no composer (que é
              position: relative), flutuando logo acima dele. */}
          {mostrarAviso && (
            <button
              type="button"
              className={avisoId ? "axxa-jump is-done" : "axxa-jump"}
              onClick={voltarPraBaixo}
            >
              <Icon name="arrow-down" size={15} />
              {avisoId ? tr("Answer ready") : tr("Jump to latest")}
            </button>
          )}
          {/* `[[` — as notas aparecem ACIMA do campo, como no editor do
              Obsidian. Escolher insere o link e anexa a nota. Fica dentro do
              composer pra subir junto com ele quando o teclado abre. */}
          {mention && mentionHits.length > 0 && (
            <div className="axxa-mention">
              {mentionHits.map((n) => (
                <button
                  key={n.path}
                  type="button"
                  className="axxa-mention-row"
                  // mousedown antes do blur: o blur fecharia a lista antes do
                  // clique chegar.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    escolherMencao(n);
                  }}
                >
                  <Icon name="file-text" size={15} />
                  <span className="axxa-mention-name">{n.basename}</span>
                  <span className="axxa-mention-path">{n.path}</span>
                </button>
              ))}
            </div>
          )}
          {/* A TROCA: o composer de texto desce e o dock de áudio sobe no
              lugar. As duas linhas do grid (1fr/0fr) animam a altura — é o que
              faz um encolher enquanto o outro cresce, em vez de um sumir e o
              outro aparecer. */}
          {/* Os anexos e a fila ficam ACIMA do cartão, não dentro dele: o
              cartão é onde se escreve, e o que vai junto da mensagem é outra
              coisa. Cada um mostra a MINIATURA de verdade quando tem o que
              mostrar; senão, o emoji do que ele é. */}
          {(attachments.length > 0 || queued.length > 0) && (
            <div className="axxa-pills-row">
              {queued.map((q, i) => (
                <span className="axxa-pill-chip is-queued" key={`q${i}`}>
                  <Icon name="clock" size={14} />
                  <span className="axxa-pill-chip-label">{q}</span>
                  <button
                    type="button"
                    className="axxa-pill-chip-x"
                    aria-label={tr("Cancel queued message")}
                    onClick={() => {
                      removeQueued(i);
                      setDraft((d) => (d.trim() ? d : q));
                    }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </span>
              ))}
              {attachments.map((a, i) => {
                const thumb = attachmentThumb(a);
                return (
                  <span className="axxa-pill-chip" key={`a${i}`}>
                    {thumb.kind === "image" ? (
                      <img
                        className="axxa-pill-chip-thumb"
                        src={thumb.url}
                        alt=""
                      />
                    ) : (
                      <span className="axxa-pill-chip-emoji" aria-hidden="true">
                        {thumb.char}
                      </span>
                    )}
                    <span className="axxa-pill-chip-label">
                      {attachmentLabel(a)}
                    </span>
                    <button
                      type="button"
                      className="axxa-pill-chip-x"
                      aria-label={tr("Remove attachment")}
                      onClick={() => removeAttachment(i)}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <div
            className="axxa-swap"
            data-mode={voice.state !== "idle" || arming ? "voice" : "text"}
          >
            <div className="axxa-swap-row">
            <div className="axxa-input">
              {/* O que vai junto da mensagem. Fica ACIMA do texto porque é
                  contexto do que está sendo escrito — e cada um sai com um
                  toque, senão anexar vira armadilha. */}
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                placeholder={tr(modulePlaceholder(cfg.mode))}
                onFocus={onComposerFocus}
                onChange={(e) => {
                  setDraft(e.currentTarget.value);
                  conferirMencao(e.currentTarget);
                }}
                onSelect={(e) => conferirMencao(e.currentTarget)}
                onPaste={aoColar}
                onBlur={() => setMention(null)}
                onKeyDown={(e) => {
                  // Com a lista do `[[` aberta, Esc fecha ela — não o teclado.
                  if (e.key === "Escape" && mention) {
                    e.preventDefault();
                    setMention(null);
                    return;
                  }
                  if (e.key !== "Enter") return;
                  // Enter com a lista aberta ESCOLHE (é o que o editor do
                  // Obsidian faz) — mandar a mensagem no meio de um `[[` seria
                  // mandar o link pela metade.
                  if (mention && mentionHits.length > 0) {
                    e.preventDefault();
                    escolherMencao(mentionHits[0]);
                    return;
                  }
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    void submit();
                    return;
                  }
                  // Acento/IME/teclado de swipe compõem texto e mandam Enter no
                  // meio: enviar aí cortaria a palavra. `isComposing` é o sinal
                  // padrão pra isso.
                  if (e.nativeEvent.isComposing) return;
                  // No celular Enter é quebra de linha e quem envia é o botão;
                  // no desktop é o contrário, com Shift+Enter pra quebrar.
                  if (!Platform.isMobile && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />

              {/* + à esquerda, o modelo ao lado, e à direita voz e enviar. */}
              <div className="axxa-input-bar">
                <button
                  type="button"
                  className="axxa-round-btn"
                  aria-label={tr("Add to chat")}
                  onClick={() => openSheet("plus")}
                >
                  <Icon name="plus" size={22} />
                </button>
                {/* Seletores nativos: galeria, câmera e PDF. */}
                <input
                  ref={imageRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) anexarImagem(f);
                    e.currentTarget.value = "";
                  }}
                />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) anexarImagem(f);
                    e.currentTarget.value = "";
                  }}
                />
                <input
                  ref={pdfRef}
                  type="file"
                  accept="application/pdf"
                  hidden
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) anexarPdf(f);
                    e.currentTarget.value = "";
                  }}
                />

                <div className="axxa-pills">
                  <Pill
                    label={prettyModelName(cfg.model) || tr("no model")}
                    logo={
                      PROVIDERS.find((p) => p.id === cfg.provider)?.icon
                    }
                    onClick={() => openSheet("model")}
                  />
                </div>

                {plugin.settings.voiceEnabled && (
                  <button
                    type="button"
                    className="axxa-round-btn"
                    aria-label={tr("Voice mode")}
                    onClick={() => void startVoice()}
                  >
                    <Icon name="mic" size={20} />
                  </button>
                )}

                {isLoading ? (
                  <>
                    {/* Com texto escrito durante a resposta, aparece um segundo
                        botão: enfileirar. Sem ele o celular não teria como —
                        o lugar do enviar está ocupado pelo parar. */}
                    {draft.trim() && (
                      <button
                        type="button"
                        className="axxa-round-btn"
                        aria-label={tr("Send when this finishes")}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => void submit()}
                      >
                        <Icon name="arrow-up" size={20} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="axxa-send is-stop"
                      aria-label={tr("Stop")}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => session.stop()}
                    >
                      <Icon name="square" size={18} />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="axxa-send"
                    aria-label={tr("Send")}
                    disabled={!draft.trim()}
                    // Sem isto o toque tira o foco do campo e o Android fecha o
                    // teclado a cada mensagem enviada.
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => void submit()}
                  >
                    <Icon name="arrow-up" size={20} />
                  </button>
                )}
              </div>
            </div>
            </div>

            <div className="axxa-swap-row">
              <div className="axxa-voice-side">
                {liveText && <p className="axxa-voice-live">{liveText}</p>}
                <VoiceDock voice={voice} />
              </div>
            </div>
          </div>
      </section>

      {/* Bottom sheets do composer — modelo · effort. */}
      {/* Dois níveis na MESMA folha, como o app da Claude: em cima os
          favoritos (o atalho), e "Show list" é uma linha que abre a lista
          inteira aqui dentro — com seta pra voltar. Sem favorito não há de
          onde descer, então a lista já vem no primeiro nível. */}
      <Sheet
        title={tr(MODEL_SHEET_TITLE[modelView])}
        open={sheet === "model"}
        onClose={closeSheet}
        onBack={modelView === "root" ? undefined : () => setModelView("root")}
      >
        {modelView === "root" && !locked && (
          <SheetSeg
            label={tr("Provider")}
            activeId={pickProvider}
            onPick={setPickProvider}
            onBlocked={(id, motivo, insistiu) =>
              void aoTocarBloqueado(id, motivo, insistiu)
            }
            items={PROVIDERS.map((p) => ({
              id: p.id,
              icon: p.icon,
              label: p.name,
              health: providerHealth(plugin, p.id),
              blocked: providerBlockedReason(plugin, p.id),
            }))}
          />
        )}

        {modelView === "effort" ? (
          <SheetGroup>
            {EFFORT_LEVELS.map((l) => (
              <SheetRow
                key={l}
                title={tr(EFFORT_LABELS[l])}
                note={describeEffort(l, plugin.settings.effortConfigs)}
                tag={l === plugin.settings.defaultEffort ? tr("Default") : undefined}
                selected={l === cfg.effort}
                onClick={() => {
                  session.setEffort(l);
                  closeSheet();
                }}
              />
            ))}
          </SheetGroup>
        ) : modelView === "list" ? (
          <ListaDeModelos
            provider={pickProvider}
            /* TUDO, favoritos inclusive. Com `rest` (o que não é favorito), a
               linha SUMIA sob o dedo ao ser favoritada — ela passava a
               pertencer ao outro nível. "All models" promete todos. */
            models={todosOsModelos}
            atual={pickProvider === cfg.provider ? cfg.model : ""}
            query={modelQuery}
            onQuery={setModelQuery}
            aba={modelTab}
            onAba={setModelTab}
            favoritos={favorites}
            onFavorito={(m) => void alternarFavorito(m)}
            onPick={chooseModel}
          />
        ) : (
          <>
            {locked ? (
              <SheetGroup>
                <SheetNote>
                  {tr(
                    "This chat is locked to {model} — start a new chat to pick another model. Effort still changes freely.",
                    { model: prettyModelName(cfg.model) }
                  )}
                </SheetNote>
              </SheetGroup>
            ) : favorites.length > 0 ? (
              /* Só os favoritos aqui. O primeiro nível é o ATALHO — cinco
                 linhas que se lê de um golpe. O catálogo inteiro mora um
                 nível abaixo, onde há espaço pra ele. */
              <SheetGroup>
                {favorites.map((m) => (
                  <ModelRow
                    key={m}
                    provider={pickProvider}
                    model={m}
                    selected={m === cfg.model && pickProvider === cfg.provider}
                    favorito
                    onFavorito={() => void alternarFavorito(m)}
                    onClick={() => chooseModel(m)}
                  />
                ))}
              </SheetGroup>
            ) : (
              <SheetGroup>
                <SheetNote>
                  {rest.length > 0
                    ? tr(
                        "No favorites for this provider yet — star up to {n} in Settings › Providers, or open the full list below.",
                        { n: FAVORITE_LIMIT }
                      )
                    : tr(
                        "Nothing marked to show for this provider yet — pick what appears here in Settings → Providers."
                      )}
                </SheetNote>
              </SheetGroup>
            )}
            {/* Navegação num cartão só, abaixo dos modelos: a lista inteira e
                o effort. Os dois abrem OUTRO nível desta mesma folha. */}
            <SheetGroup>
              {/* Sem depender de favoritos: é ele que leva ao catálogo, e
                  quem não marcou favorito precisa MAIS dele, não menos. */}
              {!locked && rest.length > 0 && (
                <SheetNavRow
                  icon="list"
                  title={tr("All models")}
                  note={`${todosOsModelos.length}`}
                  onClick={() => setModelView("list")}
                />
              )}
              <SheetNavRow
                icon="timer"
                title={tr("Effort")}
                note={tr(EFFORT_LABELS[effort] ?? cfg.effort)}
                onClick={() => setModelView("effort")}
              />
              {/* As SUAS notas como contexto. Mora aqui porque esta folha é
                  onde se decide COMO a resposta vai ser feita — modelo,
                  esforço e agora a fonte. Como pílula no composer ela
                  disputava largura com o modelo e o "+", e uma barra com dois
                  interruptores parecidos convida ao toque errado.
                  Ao contrário do modelo e do modo, este não trava no primeiro
                  envio: "agora olha minhas notas" é pedido legítimo no meio da
                  conversa. */}
              <SheetToggleRow
                icon="library"
                title={tr("Use my notes")}
                note={cfg.vault ? tr("On") : tr("Off")}
                on={cfg.vault}
                onToggle={(on) => session.setVault(on)}
              />
            </SheetGroup>
          </>
        )}
      </Sheet>

      {/* O "+" abre o que dá pra ACRESCENTAR à conversa. Hoje são as skills —
          o mesmo atalho da tela inicial, alcançável no meio do papo. */}
      {/* O "+": três caminhos grandes em cima (nota, câmera, imagem) e o
          resto em lista — PDF, link, skill, artefato. Desenho da referência:
          cartões vazados na fileira, e as linhas num cartão cheio com brasão
          redondo e seta. */}
      <Sheet
        title={tr(PLUS_SHEET_TITLE[plusView])}
        open={sheet === "plus"}
        onClose={closeSheet}
        onBack={plusView === "root" ? undefined : () => setPlusView("root")}
      >
        {plusView === "notes" ? (
          <>
            <SheetSearch
              value={noteQuery}
              placeholder={tr("Search notes")}
              found={notasAchadas.length}
              autoFocus
              onChange={setNoteQuery}
            />
            <SheetGroup>
              {notasAchadas.map((n) => (
                <SheetRow
                  key={n.path}
                  dense
                  icon="file-text"
                  title={n.basename}
                  note={n.path}
                  onClick={() => {
                    void anexarNota(n.path);
                    closeSheet();
                  }}
                />
              ))}
              {notasAchadas.length === 0 && (
                <SheetNote>{tr("No note matches that.")}</SheetNote>
              )}
            </SheetGroup>
          </>
        ) : plusView === "skills" ? (
          <SheetGroup>
            {plugin.skills.map((sk) => (
              <SheetRow
                key={sk.id}
                title={sk.name}
                note={sk.description}
                onClick={() => {
                  onUseSkill(sk);
                  closeSheet();
                }}
              />
            ))}
            {plugin.skills.length === 0 && (
              <SheetNote>
                {tr(
                  "No skills yet — they live as notes in your vault, and show up here once you create one."
                )}
              </SheetNote>
            )}
          </SheetGroup>
        ) : plusView === "artifacts" ? (
          <SheetGroup>
            {artefatos.map((a) => (
              <SheetRow
                key={a.path}
                dense
                icon={artifactIcon(a.extension)}
                title={a.basename}
                note={a.path}
                onClick={() => {
                  void anexarArtefato(a);
                  closeSheet();
                }}
              />
            ))}
            {artefatos.length === 0 && (
              <SheetNote>
                {tr(
                  "Nothing generated yet — images, audio and video made here land in {folder} and show up in this list.",
                  { folder: GENERATION_DIR }
                )}
              </SheetNote>
            )}
          </SheetGroup>
        ) : (
          <>
            <SheetTiles>
              <SheetTile
                icon="file-text"
                label={tr("Notes")}
                onClick={() => {
                  setNoteQuery("");
                  setPlusView("notes");
                }}
              />
              <SheetTile
                icon="camera"
                label={tr("Camera")}
                disabled={!modeloVeImagem}
                hint={modeloVeImagem ? undefined : tr("unavailable")}
                onClick={() => {
                  closeSheet();
                  cameraRef.current?.click();
                }}
              />
              <SheetTile
                icon="image"
                label={tr("Image")}
                disabled={!modeloVeImagem}
                hint={modeloVeImagem ? undefined : tr("unavailable")}
                onClick={() => {
                  closeSheet();
                  imageRef.current?.click();
                }}
              />
            </SheetTiles>

            <SheetGroup>
              {/* A nota aberta, a um toque: é a que a pessoa mais quer
                  anexar, e achá-la na busca era o caminho mais longo. Some
                  quando já está anexada. */}
              {(() => {
                const aberta = sheet === "plus" ? notaAberta(plugin.app) : null;
                if (!aberta || attachments.some((a) => a.type === "note" && a.path === aberta.path)) {
                  return null;
                }
                return (
                  <SheetRow
                    badge
                    chevron
                    icon="file-check"
                    title={tr("This note")}
                    note={aberta.basename}
                    onClick={() => {
                      void anexarNota(aberta.path);
                      closeSheet();
                    }}
                  />
                );
              })()}
              <SheetRow
                badge
                chevron
                icon="file-type-2"
                title="PDF"
                note={
                  modeloLePdf
                    ? tr("From this device")
                    : tr("This model can't read PDFs")
                }
                onClick={() => {
                  closeSheet();
                  pdfRef.current?.click();
                }}
              />
              <SheetRow
                badge
                chevron
                icon="link"
                title="Link"
                note={tr("Fetch a page as context")}
                onClick={() => {
                  closeSheet();
                  void anexarLink();
                }}
              />
              <SheetRow
                badge
                chevron
                icon="sparkles"
                title="Skill"
                note={
                  plugin.skills.length > 0
                    ? tr("{n} in your vault", { n: plugin.skills.length })
                    : tr("None yet")
                }
                onClick={() => setPlusView("skills")}
              />
              <SheetRow
                badge
                chevron
                icon="box"
                title={tr("Artifact")}
                note={tr("Images, audio and video made here")}
                onClick={() => setPlusView("artifacts")}
              />
            </SheetGroup>
          </>
        )}
      </Sheet>

      {/* O que o agente fez: lista numa folha, e cada ação abre a sua com
          argumentos e resultado — o mesmo vai-e-volta da folha de modelos. */}
      <Sheet
        title={
          toolAt !== null && tools
            ? actionTitle(tools[toolAt])
            : (tools?.length ?? 0) === 1
              ? tr("Ran 1 action")
              : tr("Ran {n} actions", { n: tools?.length ?? 0 })
        }
        open={tools !== null}
        onClose={() => {
          setTools(null);
          setToolAt(null);
        }}
        onBack={
          toolAt !== null && (tools?.length ?? 0) > 1
            ? () => setToolAt(null)
            : undefined
        }
      >
        {toolAt !== null && tools ? (
          <ToolDetail
            action={tools[toolAt]}
            app={plugin.app}
            // A folha guarda uma CÓPIA das ações de quando abriu; o Undo feito
            // aqui dentro tem que aparecer nela também, não só na conversa.
            onUndone={(id) =>
              setTools((ts) =>
                ts
                  ? ts.map((x) =>
                      x.kind === "activity" && x.activity.undoId === id
                        ? { ...x, activity: { ...x.activity, undone: true } }
                        : x
                    )
                  : ts
              )
            }
          />
        ) : (
          <SheetGroup>
            {(tools ?? []).map((a, i) => (
              <SheetRow
                key={i}
                dense
                icon={actionIcon(a)}
                iconTone={actionFailed(a) ? "danger" : undefined}
                title={actionTitle(a)}
                note={actionNote(a)}
                tag={
                  actionFailed(a)
                    ? tr("failed")
                    : a.kind === "activity" && a.activity.undone
                      ? tr("undone")
                      : undefined
                }
                onClick={() => setToolAt(i)}
              />
            ))}
          </SheetGroup>
        )}
      </Sheet>

      <Sheet title={tr("Effort")} open={sheet === "effort"} onClose={closeSheet}>
        <SheetGroup>
          {EFFORT_LEVELS.map((l) => (
            <SheetRow
              key={l}
              title={tr(EFFORT_LABELS[l])}
              note={describeEffort(l, plugin.settings.effortConfigs)}
              tag={l === plugin.settings.defaultEffort ? tr("Default") : undefined}
              selected={l === cfg.effort}
              onClick={() => {
                session.setEffort(l);
                closeSheet();
              }}
            />
          ))}
        </SheetGroup>
      </Sheet>
    </div>
  );
}

/** Linha de modelo: brasão da família + nome + o que ele faz. */
function ModelRow({
  provider,
  model,
  selected,
  favorito,
  onFavorito,
  onClick,
}: {
  provider: string;
  model: string;
  selected: boolean;
  /** Está entre os favoritos deste provider. */
  favorito?: boolean;
  /** Marcar/desmarcar. Ausente = a linha não mostra estrela. */
  onFavorito?: () => void;
  onClick: () => void;
}) {
  const card = getModelCard(provider, model);
  return (
    <SheetRow
      title={prettyModelName(model)}
      note={card.goodFor ?? card.description}
      /* O logo de QUEM FEZ o modelo.
         Esta lista nasceu SEM ícone de propósito — na época, o que havia pra
         pôr ali era um lucide genérico, e ícone genérico numa lista é
         decoração: ocupa a coluna e não responde nada. Com os logos de marca
         (ver providers/modelLogo.ts) ele deixa de ser enfeite e vira a única
         coisa que se acha sem ler, numa lista onde os nomes são todos parecidos
         ("Sonnet 4.6", "Sonnet 4", "Haiku 4.5"). Onde não temos a marca, cai no
         brasão da família, que também diz algo. */
      icon={modelLogo(model)}
      selected={selected}
      action={
        onFavorito
          ? {
              icon: favorito ? "star" : "star-off",
              label: favorito ? tr("Remove from favorites") : tr("Add to favorites"),
              on: favorito,
              onClick: onFavorito,
            }
          : undefined
      }
      onClick={onClick}
    />
  );
}

/**
 * A lista de modelos da folha: busca em cima (quando a lista é grande) e os
 * modelos separados por natureza.
 *
 * O agrupamento entra porque o catálogo de um provider traz, na mesma pilha,
 * coisas que não conversam — geradores de imagem, vozes, embeddings. Elas
 * continuam ali (o app usa modelo de imagem pra gerar imagem), só param de
 * disputar espaço com o que se está escolhendo.
 */
function ListaDeModelos({
  provider,
  models,
  atual,
  query,
  onQuery,
  aba,
  onAba,
  favoritos,
  onFavorito,
  onPick,
}: {
  provider: string;
  models: string[];
  atual: string;
  query: string;
  onQuery: (v: string) => void;
  aba: string;
  onAba: (id: string) => void;
  favoritos: string[];
  onFavorito: (m: string) => void;
  onPick: (m: string) => void;
}) {
  const filtrados = useMemo(
    () => filterModels(models, query, prettyModelName),
    [models, query]
  );
  const grupos = useMemo(
    () => groupModels(provider, filtrados),
    [provider, filtrados]
  );
  // Aba pedida, ou a primeira que existir — a busca pode ter esvaziado a que
  // estava aberta, e aí insistir nela mostraria uma tela vazia com resultados
  // logo ao lado.
  const ativa = grupos.find((g) => g.label === aba) ?? grupos[0];
  // Abaixo disto a busca é um campo pedindo pra filtrar o que já cabe na tela.
  const BUSCA_A_PARTIR_DE = 8;
  return (
    <>
      {models.length >= BUSCA_A_PARTIR_DE && (
        <SheetSearch
          value={query}
          placeholder={tr("Search models")}
          found={filtrados.length}
          onChange={onQuery}
        />
      )}
      {grupos.length > 1 && (
        <SheetTabs
          label={tr("Model category")}
          activeId={ativa?.label ?? ""}
          items={grupos.map((g) => ({
            id: g.label,
            label: tr(g.label),
            count: g.models.length,
          }))}
          onPick={onAba}
        />
      )}
      {ativa && (
        <SheetGroup>
          {ativa.models.map((m) => (
            <ModelRow
              key={m}
              provider={provider}
              model={m}
              selected={m === atual}
              favorito={favoritos.includes(m)}
              onFavorito={() => onFavorito(m)}
              onClick={() => onPick(m)}
            />
          ))}
        </SheetGroup>
      )}
      {filtrados.length === 0 && (
        <SheetGroup>
          <SheetNote>{tr("No model matches that.")}</SheetNote>
        </SheetGroup>
      )}
    </>
  );
}

/** O pill do modelo. O LOGO do provider no lugar do chevron: a seta dizia
 *  "isto abre" (que o toque já ensina na primeira vez), enquanto o logo diz
 *  QUEM está respondendo — que é a informação que muda. */
function Pill({
  label,
  logo,
  active,
  onClick,
}: {
  label: string;
  logo?: string;
  /** Pílula que LIGA e DESLIGA (o contexto das notas). `undefined` = pílula
   *  comum, que abre alguma coisa. */
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "axxa-pill is-on" : "axxa-pill"}
      // `aria-pressed` só quando ela é interruptor: numa pílula que abre uma
      // folha, "pressionada" não quer dizer nada.
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
    >
      {logo && <Icon name={logo} size={16} className="axxa-pill-logo" />}
      <span className="axxa-pill-label">{label}</span>
    </button>
  );
}

function activityText(a: ActivityMeta): string {
  if (a.phase === "pending") return a.pendingText;
  if (a.phase === "done") return a.doneText ?? a.pendingText;
  return a.failedText ?? tr("Failed");
}

/** O que o agente fez numa rodada: a chamada de tool OU a narração dela. As
 *  duas coisas moram na mesma folha porque, pra quem lê, são a mesma pergunta:
 *  "o que ele fez aí?". */
export type TurnAction =
  | { kind: "step"; step: AIToolStep }
  | { kind: "activity"; activity: ActivityMeta }
  /** O raciocínio do modelo. Mesma natureza: texto gerado que interessa ter,
   *  não ter na frente. */
  | { kind: "reasoning"; text: string };

function actionTitle(a: TurnAction): string {
  if (a.kind === "step") return a.step.name;
  if (a.kind === "activity") return activityText(a.activity);
  return tr("Reasoning");
}

function actionNote(a: TurnAction): string | undefined {
  if (a.kind === "step") return toolSummary(a.step);
  if (a.kind === "reasoning") return tr("{n} chars", { n: a.text.length });
  return undefined;
}

function actionFailed(a: TurnAction): boolean {
  if (a.kind === "step") return !a.step.ok;
  if (a.kind === "activity") return a.activity.phase === "failed";
  return false;
}

/** O ícone DIZ o que a ação foi — olho pra leitura, radar pra busca, lixeira
 *  pra apagar. Um check repetido em toda linha não informava nada: o estado já
 *  está na etiqueta "failed" e no detalhe. O mapa é o MESMO que o motor usa na
 *  narração (agentActivitySpec), então a folha e a timeline não divergem. */
function actionIcon(a: TurnAction): string {
  if (a.kind === "reasoning") return "brain";
  if (a.kind === "activity") {
    return a.activity.phase === "failed"
      ? a.activity.iconFailed ?? "circle-alert"
      : a.activity.iconPending;
  }
  if (!a.step.ok) return "circle-alert";
  return agentActivitySpec(a.step.name, a.step.arguments ?? {}).iconPending;
}

/** Resumo de uma linha dos argumentos — o suficiente pra reconhecer a ação. */
function toolSummary(step: AIToolStep): string {
  const args = Object.entries(step.arguments ?? {});
  if (args.length === 0) return step.ok ? tr("done") : tr("failed");
  const [chave, valor] = args[0];
  const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
  return `${chave}: ${texto}`.slice(0, 80);
}

/**
 * O chip "Undo" da resposta: desfaz tudo o que o agente mudou na rodada.
 * Só existe enquanto sobra mudança desfazível — e só na sessão em que ela
 * aconteceu (o desfazer mora na memória; ver agent/undo.ts).
 */
function UndoChip({
  plugin,
  actions,
}: {
  plugin: AxxaPlugin;
  actions: TurnAction[];
}) {
  const [rodando, setRodando] = useState(false);
  const ids = desfaziveis(
    actions.map((a) => (a.kind === "activity" ? a.activity : undefined))
  );
  if (ids.length === 0) return null;
  return (
    <button
      type="button"
      className="axxa-tools-chip"
      disabled={rodando}
      aria-label={
        ids.length === 1
          ? tr("Undo the agent's change")
          : tr("Undo the agent's {n} changes", { n: ids.length })
      }
      onClick={() => {
        setRodando(true);
        void desfazerRodada(plugin.app, ids).finally(() => setRodando(false));
      }}
    >
      <Icon name="undo-2" size={15} />
      <span>{tr("Undo")}</span>
    </button>
  );
}

/** Detalhe de uma ação: o que foi pedido e o que voltou — e, se ela mudou o
 *  vault e ainda dá, o botão de desfazer só ela. */
function ToolDetail({
  action,
  app,
  onUndone,
}: {
  action: TurnAction;
  app: App;
  onUndone: (id: string) => void;
}) {
  const ok = !actionFailed(action);
  const [rodando, setRodando] = useState(false);
  const desfazivel =
    action.kind === "activity" ? idDesfazivel(action.activity) : null;
  const desfeita = action.kind === "activity" && action.activity.undone;
  return (
    <div className="axxa-tool-detail">
      {action.kind !== "reasoning" && (
        <p className={ok ? "axxa-tool-state is-ok" : "axxa-tool-state"}>
          <Icon name={ok ? "circle-check" : "circle-alert"} size={15} />
          {ok ? tr("Completed") : tr("Failed")}
        </p>
      )}
      {desfeita && (
        <p className="axxa-tool-state is-undone">
          <Icon name="undo-2" size={15} />
          {tr("Undone")}
        </p>
      )}
      {desfazivel && (
        <button
          type="button"
          className="axxa-tool-undo"
          disabled={rodando}
          onClick={() => {
            setRodando(true);
            void desfazerUma(app, desfazivel)
              .then((feito) => {
                if (feito) onUndone(desfazivel);
              })
              .finally(() => setRodando(false));
          }}
        >
          <Icon name="undo-2" size={16} />
          <span>{tr("Undo this change")}</span>
        </button>
      )}
      {action.kind === "step" ? (
        <>
          <p className="axxa-tool-label">{tr("Arguments")}</p>
          <pre className="axxa-tool-block">
            {JSON.stringify(action.step.arguments ?? {}, null, 2)}
          </pre>
          <p className="axxa-tool-label">{tr("Result")}</p>
          <pre className="axxa-tool-block">
            {action.step.result || tr("(empty)")}
          </pre>
        </>
      ) : action.kind === "activity" ? (
        <>
          <p className="axxa-tool-label">{tr("What happened")}</p>
          <pre className="axxa-tool-block">
            {action.activity.detail || activityText(action.activity)}
          </pre>
        </>
      ) : (
        <pre className="axxa-tool-block is-prose">{action.text}</pre>
      )}
    </div>
  );
}

/** Ouvir a resposta. O motor já tinha o TTS; faltava o botão. */
function ReadAloudButton({
  plugin,
  text,
}: {
  plugin: AxxaPlugin;
  text: string;
}) {
  const [speaking, setSpeaking] = useState(false);
  return (
    <button
      type="button"
      className={speaking ? "axxa-msg-listen is-on" : "axxa-msg-listen"}
      aria-label={speaking ? tr("Stop") : tr("Read aloud")}
      onClick={() => {
        if (speaking) {
          stopSpeaking();
          setSpeaking(false);
          return;
        }
        setSpeaking(true);
        void speak(plugin, text).finally(() => setSpeaking(false));
      }}
    >
      <Icon name={speaking ? "square" : "volume-2"} size={15} />
      <span>{speaking ? tr("Stop") : tr("Listen")}</span>
    </button>
  );
}

/**
 * Copia o texto de uma mensagem (a sua, ou a resposta em markdown cru, com os
 * [[links]] como estão). O `writeText` vai PRIMEIRO, sem nada esperado antes:
 * no celular o sistema só aceita escrever na área de transferência dentro do
 * próprio toque (achado na 0.7.41). E pela janela do botão — a conversa pode
 * estar numa janela destacada.
 */
function CopyButton({
  text,
  label,
  iconOnly,
}: {
  text: string;
  label: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  return (
    <button
      type="button"
      className={"axxa-msg-listen axxa-msg-copy" + (copied ? " is-copied" : "")}
      aria-label={copied ? tr("Copied") : label}
      onClick={(e) => {
        const area = e.currentTarget.win.navigator.clipboard;
        const escrita = area?.writeText
          ? area.writeText(text)
          : Promise.reject(new Error("no clipboard"));
        escrita.then(
          () => {
            setCopied(true);
            if (timer.current !== null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1500);
          },
          () => {
            warn();
            new Notice(tr("Couldn't copy. Select the text and use the system Copy."));
          }
        );
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={15} />
      {!iconOnly && <span>{copied ? tr("Copied") : tr("Copy")}</span>}
    </button>
  );
}

/**
 * Quanto da janela do modelo a conversa já ocupa — um anel e a porcentagem,
 * no topo. Perto de 80% o próximo turno resume o começo (core/compactacao),
 * e o anel avisa antes. O número é o prompt do último pedido (o que o
 * provider contou); na conversa recém-reaberta, uma estimativa (com "~").
 * Tocar mostra o detalhe — no celular não há passar o mouse.
 */
function MedidorDaJanela({
  provider,
  model,
  usados,
  mensagens,
  enviados,
  doCache,
}: {
  provider: string;
  model: string;
  usados: number;
  mensagens: ChatMessage[];
  enviados: number;
  doCache: number;
}) {
  const estimado = usados <= 0;
  const ocupados = estimado ? ocupacaoEstimada(mensagens) : usados;
  if (ocupados <= 0 || !model) return null;
  const janela = janelaConhecida(provider, model);
  const pct = Math.min(100, Math.round((ocupados / janela) * 100));
  const raio = 4;
  const volta = 2 * Math.PI * raio;
  const detalhe = [
    tr("{used} of {total} tokens of the model's context window. Near the limit, the start of the chat is summarized.", {
      used: (estimado ? "~" : "") + formatTokens(ocupados),
      total: formatTokens(janela),
    }),
    enviados > 0 && doCache > 0
      ? tr("{pct}% of what this chat sent came from the cache.", {
          pct: Math.round((doCache / enviados) * 100),
        })
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={"axxa-ctx-meter" + (pct >= 80 ? " is-cheio" : "")}
      aria-label={detalhe}
      title={detalhe}
      onClick={() => new Notice(detalhe)}
    >
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
        <circle className="axxa-ctx-meter-trilho" cx="5" cy="5" r={raio} />
        <circle
          className="axxa-ctx-meter-arco"
          cx="5"
          cy="5"
          r={raio}
          strokeDasharray={volta}
          strokeDashoffset={volta * (1 - pct / 100)}
        />
      </svg>
      {(estimado ? "~" : "") + pct}%
    </button>
  );
}

/** Uma linha da conversa. `memo` de propósito: sem ele, cada TECLA do
 *  composer re-renderizava a conversa inteira — medido em 2,33ms com 5
 *  mensagens contra 8,23ms com 120. O que muda numa mensagem já pronta é
 *  só o que vem por prop, então comparar props basta. */
const MessageRow = memo(function MessageRow({
  msg,
  plugin,
  streaming,
  glow,
  actions,
  onOpenTools,
}: {
  msg: ChatMessage;
  plugin: AxxaPlugin;
  streaming: boolean;
  /** Terminou enquanto o usuário lia lá em cima: acende uma vez. */
  glow?: boolean;
  /** Tudo que o agente fez nesta rodada — narrações + tool calls. */
  actions?: TurnAction[];
  onOpenTools?: (actions: TurnAction[]) => void;
  /** O idioma da interface: a linha é memo, e sem ele no props uma troca de
   *  idioma deixava "Ran 3 actions" e "Listen" no idioma velho até reabrir. */
  idioma?: string;
}) {
  switch (msg.type) {
    case "user":
      // A bolha e, embaixo dela, o copiar. O invólucro existe pra o botão não
      // engordar a bolha nem ficar longe dela (a lista tem gap grande); o
      // `data-msg` sobe pra ele, e o "ir pra mensagem" cai no mesmo lugar.
      return (
        <>
          {/* O corte do resumo (core/compactacao): daqui pra cima, o modelo
              recebe só o resumo. A conversa continua toda aqui; abrir mostra
              o que ele recebe no lugar. */}
          {msg.resumo && (
            <details className="axxa-resumo-marca">
              <summary>{tr("Earlier messages summarized for the model")}</summary>
              <div className="axxa-resumo-texto">
                <Markdown app={plugin.app} text={msg.resumo} streaming={false} />
              </div>
            </details>
          )}
          <div className="axxa-msg-mine" data-msg={msg.id}>
            <div className="axxa-msg axxa-msg-user">
              <div className="axxa-msg-text">{msg.content}</div>
            </div>
            <CopyButton text={msg.content} label={tr("Copy message")} iconOnly />
          </div>
        </>
      );
    case "ai-response":
      return (
        <div
          data-msg={msg.id}
          className={
            "axxa-msg axxa-msg-ai" +
            (msg.isError ? " axxa-msg-error" : "") +
            (glow ? " is-done" : "")
          }
        >
          {msg.reasoning && (
            <button
              type="button"
              className="axxa-tools-chip"
              onClick={() =>
                onOpenTools?.([{ kind: "reasoning", text: msg.reasoning ?? "" }])
              }
            >
              <span>{tr("Reasoning")}</span>
              <Icon name="chevron-right" size={15} />
            </button>
          )}
          {msg.isError ? (
            <div className="axxa-msg-text">{msg.content}</div>
          ) : (
            <Markdown
              app={plugin.app}
              text={msg.content}
              streaming={streaming}
            />
          )}
          {/* Ouvir e copiar só com a resposta pronta: no meio do stream o
              texto ainda muda, e copiar pela metade engana. */}
          {!streaming && msg.content.trim() && (
            <div className="axxa-msg-actions">
              {plugin.settings.ttsEnabled && !msg.isError && (
                <ReadAloudButton plugin={plugin} text={msg.content} />
              )}
              <CopyButton text={msg.content} label={tr("Copy answer")} />
            </div>
          )}
          {msg.truncated && <small className="axxa-msg-note">{tr("truncated")}</small>}
          {actions && actions.length > 0 && (
            <div className="axxa-tools-row">
              {/* O que o agente FEZ vira um chip: quem quer ver abre a folha, e
                  quem não quer não leva um <details> no meio da leitura. */}
              <button
                type="button"
                className="axxa-tools-chip"
                onClick={() => onOpenTools?.(actions)}
              >
                <span>
                  {actions.length === 1
                    ? tr("Ran 1 action")
                    : tr("Ran {n} actions", { n: actions.length })}
                </span>
                <Icon name="chevron-right" size={15} />
              </button>
              {/* E o que ele MUDOU volta com um toque: a rodada inteira, da
                  última mudança pra primeira. Some quando não sobra nada pra
                  desfazer (ou a sessão em que ela aconteceu acabou). */}
              <UndoChip plugin={plugin} actions={actions} />
            </div>
          )}
        </div>
      );
    case "ai-comment":
      return (
        <div className="axxa-msg axxa-msg-comment" data-msg={msg.id}>
          <Icon
            name={
              msg.activity?.phase === "failed"
                ? "alert-triangle"
                : msg.activity?.phase === "done"
                  ? "check"
                  : "loader"
            }
            size={13}
          />
          <span>
            {msg.activity ? activityText(msg.activity) : msg.content}
            {msg.activity && msg.content ? ` — ${msg.content}` : ""}
          </span>
          {msg.activity?.detail && (
            // Mesmo caminho de tudo o mais: abre na folha. Um <details> aqui
            // empurrava a conversa toda pra baixo no meio de uma rodada.
            <button
              type="button"
              className="axxa-tools-chip is-inline"
              onClick={() =>
                msg.activity &&
                onOpenTools?.([{ kind: "activity", activity: msg.activity }])
              }
            >
              <span>{tr("details")}</span>
              <Icon name="chevron-right" size={14} />
            </button>
          )}
        </div>
      );
    case "ai-options":
      return (
        <div className="axxa-msg axxa-msg-options" data-msg={msg.id}>
          <div>{msg.prompt}</div>
          <div className="axxa-suggestions">
            {msg.options.map((o, i) => (
              <button
                key={i}
                type="button"
                className={
                  msg.selectedIndex === i ? "axxa-chip is-active" : "axxa-chip"
                }
                disabled={msg.selectedIndex !== undefined}
                onClick={() => useChatStore.getState().selectOption(msg.id, i)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
});

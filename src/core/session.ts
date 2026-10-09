// src/core/session.ts
// ChatSession — o controller da conversa. É a "API CRUD" que a casca (UI)
// consome; não sabe de React nem de DOM. Qualquer redesign da interface fala
// com o app por aqui (+ o store zustand pra ler mensagens).
//
//   estado da conversa .......... store zustand (src/store/chat.ts)
//   seleção pré-lock ............ aqui (provider / modelo / modo / effort)
//   persistência ................ .md no vault (chatPersistence) + cache de
//                                 summaries do plugin (main.ts)
//   stream / agente ............. chatEngine.ts / agentTurn.ts
//
// Regras herdadas do app antigo (validadas em uso):
//   - a 1ª mensagem cria id/título e TRAVA provider+modelo+modo da sessão
//     (consistência de contexto); "New chat" destrava;
//   - auto-save debounced a cada mudança nas mensagens; abrir um chat NÃO
//     regrava o arquivo (pula um ciclo); fechar a view flusha o save pendente;
//   - erros (isError) não persistem; fontes de projeto entram como notas de
//     contexto no 1º envio de um chat criado "dentro" do projeto.

import { Notice, TFile } from "obsidian";
import type AxxaPlugin from "../main";
import { useChatStore, type ChatMessage } from "../store/chat";
import { getProvider } from "../providers";
import { modeloSalvoPara } from "./modeloPadrao";
import { nomeCompleto } from "./ollamaPadrao";
import { getTranslations } from "../i18n";
import { tr } from "../i18n/tr";
import {
  saveChat,
  loadChat,
  deleteChat,
  renameChat,
  generateTitle,
  type ChatData,
  type ChatMessageStored,
} from "./chatPersistence";
import { makeId, semCredencial } from "./helpers";
import { streamReply, type EngineCtx } from "./chatEngine";
import { runAgentTurn } from "./agentTurn";
import type { NoteAttachment } from "../providers/base";
import type { Project } from "../projects";
import { previewFromText } from "./chatPreview";
import { vaultAtivo } from "./vaultContext";

export type ChatMode = "chat" | "vault-qa" | "agent";
export const CHAT_MODES: ChatMode[] = ["chat", "vault-qa", "agent"];
export function isChatMode(v: string | undefined | null): v is ChatMode {
  return !!v && (CHAT_MODES as string[]).includes(v);
}

export interface SessionConfig {
  provider: string;
  model: string;
  mode: ChatMode;
  effort: string;
  /** As suas notas entram como contexto nesta conversa? (ver
   *  core/vaultContext.ts — o padrão vem do modo, a escolha é da pessoa.) */
  vault: boolean;
  /** true após a 1ª mensagem: provider/modelo/modo não mudam mais neste chat. */
  locked: boolean;
}

/** O mínimo que `load()` precisa pra achar o .md (um ChatSummary serve). */
export interface ChatRef {
  id: string;
  mode: string;
}

/**
 * O que de uma conversa vai pro arquivo. Um lugar só — o save normal e o do
 * turno em segundo plano usavam cópias, e as cópias divergem.
 *   · mensagens do usuário (com o contexto que foi junto: vault + notas) e
 *     respostas;
 *   · resposta de ERRO fica de fora — menos a de uma rodada do agente que
 *     fez coisas: ela vai, com o texto do erro e a marca (volta como erro ao
 *     reabrir), senão a conversa reaberta esquecia as notas que o agente já
 *     tinha criado ou editado. Pro modelo, o texto do erro não vai (ver
 *     storeMessagesToProvider).
 */
export function mensagensParaGravar(msgs: readonly ChatMessage[]): ChatMessageStored[] {
  const out: ChatMessageStored[] = [];
  for (const m of msgs) {
    if (m.type === "user") {
      out.push({
        type: "user",
        content: m.content,
        timestamp: m.timestamp,
        ...(m.contexto ? { contexto: m.contexto } : {}),
        ...(m.resumo ? { resumo: m.resumo } : {}),
      });
    } else if (m.type === "ai-response") {
      const passos = m.agentSteps && m.agentSteps.length > 0 ? m.agentSteps : undefined;
      if (m.isError && !passos) continue;
      out.push({
        type: "ai-response",
        content: m.content,
        timestamp: m.timestamp,
        ...(m.isError ? { isError: true } : {}),
        ...(m.reaction ? { reaction: m.reaction } : {}),
        ...(passos ? { agentSteps: passos } : {}),
      });
    }
  }
  return out;
}

export class ChatSession {
  /**
   * O dicionário é lido A CADA USO, não guardado na construção.
   *
   * A sessão vive enquanto o painel existir, e o idioma muda nas settings no
   * meio disso. Fixando na construção, trocar pra português deixava todo erro
   * de chat em inglês até reabrir o Obsidian — e ninguém liga uma coisa na
   * outra.
   */
  private get t() {
    return getTranslations(this.plugin.settings.language);
  }
  private readonly abortRef = { current: null as AbortController | null };
  private readonly approveAllRef = { current: false };
  /** Projeto que vai receber o chat criado no próximo 1º envio. */
  private pendingProjectId: string | null = null;
  private saveTimer: number | null = null;
  /** Já avisei que a gravação da conversa está falhando? (ver
   *  `avisarFalhaDeGravacao`) */
  private avisoDeGravacaoDado = false;
  private pendingSave: (() => void) | null = null;
  private skipNextSave = false;
  private readonly listeners = new Set<() => void>();
  private readonly unsubStore: () => void;
  private readonly unsubSettings: () => void;
  private provider: string;
  private model: string;
  private mode: ChatMode;
  private effort: string;
  /** null = ninguém mexeu no interruptor das notas; vale o padrão do modo. */
  private vaultEscolha: boolean | null = null;

  constructor(private readonly plugin: AxxaPlugin) {
    const s = plugin.settings;
    this.provider = s.defaultProvider || "openai";
    this.model = this.modelFor(this.provider);
    this.mode = isChatMode(s.defaultMode) ? s.defaultMode : "chat";
    this.effort = s.defaultEffort || "med";
    // Auto-save: qualquer mudança no array de mensagens agenda um save.
    this.unsubStore = useChatStore.subscribe((state, prev) => {
      if (state.messages !== prev.messages) this.scheduleSave();
    });
    // A lista do Ollama muda com a conversa aberta (a busca nas settings, a
    // conferência ao abrir o Obsidian). Sem isto, o modelo que saiu dela
    // continuava escolhido aqui — e o seletor o mostrava na frente da lista.
    this.unsubSettings = plugin.onSettingsChange(() => this.seguirOllama());
    // Cache de summaries aquecido — o upsert incremental depende dele.
    void plugin.loadChatSummaries();
  }

  /** Chamar ao fechar a view: flusha o save pendente e cancela o stream. */
  /**
   * Grava agora a conversa que está respondendo FORA da tela.
   *
   * `flushSave` não serve pra isso: ele grava a conversa VISÍVEL, e a de
   * segundo plano não está no store de ninguém — ela vive no `background`.
   * Sem esta chamada, fechar a view com um turno rodando fora da tela jogava
   * a resposta fora: o arquivo nunca tinha sido escrito, porque a gravação do
   * segundo plano só acontecia no fim do turno.
   */
  async flushBackground(): Promise<void> {
    await this.gravarFundo();
  }

  dispose(): void {
    this.unsubStore();
    this.unsubSettings();
    this.flushSave();
    // Rede de segurança pra quem chama `dispose` sem poder esperar (o await
    // de verdade está no onClose da view). Dispara antes do abort: depois
    // dele o `background` é limpo pelo `finally` do turno.
    void this.gravarFundo();
    this.abortRef.current?.abort();
    this.listeners.clear();
  }

  /** Inscreve um callback pra mudanças de seleção/sessão. Retorna unsubscribe. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(): void {
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error("[axxa] session listener falhou:", err);
      }
    });
  }

  // ── Seleção (provider / modelo / modo / effort) ─────────────────────────

  /** Config efetiva: a travada na sessão (se houver) ou a seleção atual. */
  get config(): SessionConfig {
    const st = useChatStore.getState();
    const locked = st.sessionProvider !== null;
    const provider = st.sessionProvider ?? this.provider;
    return {
      provider,
      model: st.sessionModel ?? this.model,
      mode: isChatMode(st.sessionMode) ? st.sessionMode : this.mode,
      effort: this.effort,
      vault: vaultAtivo(
        isChatMode(st.sessionMode) ? st.sessionMode : this.mode,
        this.vaultEscolha
      ),
      locked,
    };
  }

  /** Modelo salvo pro provider (ver core/modeloPadrao.ts). */
  modelFor(provider: string): string {
    return modeloSalvoPara(this.plugin.settings, provider);
  }

  /**
   * O modelo do Ollama escolhido aqui não está mais na lista do que está
   * instalado (ou nunca teve modelo): volta pro modelo salvo, que a busca já
   * acertou. Vale também com uma conversa enviada na tela — ela lê o modelo
   * dela (o travado), e este é o que a PRÓXIMA conversa usa. Sem isso, quem
   * buscou os modelos olhando uma conversa e depois abriu outra nova caía
   * de novo no modelo que não tem.
   */
  private seguirOllama(): void {
    if (this.provider !== "ollama") return;
    const ativos = this.plugin.settings.activeModels?.ollama ?? [];
    const atual = this.model;
    if (atual && ativos.some((m) => nomeCompleto(m) === nomeCompleto(atual))) return;
    const salvo = this.modelFor("ollama");
    if (salvo === atual) return;
    this.model = salvo;
    this.emit();
  }

  /** Opções do seletor de modelo (modelos ativos + o atual, se faltar). */
  modelOptions(provider: string): string[] {
    const list = this.plugin.settings.activeModels?.[provider] ?? [];
    const cfg = this.config;
    const cur = cfg.provider === provider ? cfg.model : this.modelFor(provider);
    return cur && !list.includes(cur) ? [cur, ...list] : list;
  }

  /** Credencial do provider (Ollama: o endpoint faz o papel da key). */
  apiKeyFor(provider: string): string {
    return this.plugin.providerCredential(provider);
  }

  setProvider(provider: string): void {
    if (this.config.locked) return;
    this.provider = provider;
    this.model = this.modelFor(provider);
    this.plugin.settings.defaultProvider = provider;
    void this.plugin.saveSettings();
    this.emit();
  }

  setModel(model: string): void {
    if (this.config.locked || !model) return;
    this.model = model;
    const s = this.plugin.settings;
    switch (this.provider) {
      case "anthropic":
        s.anthropicModel = model;
        break;
      case "gemini":
        s.geminiModel = model;
        break;
      case "openrouter":
        s.openrouterModel = model;
        break;
      case "nim":
        s.nimModel = model;
        break;
      case "ollama":
        s.ollamaModel = model;
        break;
      default:
        s.defaultModel = model;
    }
    void this.plugin.saveSettings();
    this.emit();
  }

  setMode(mode: ChatMode): void {
    if (this.config.locked) return;
    this.mode = mode;
    this.plugin.settings.defaultMode = mode;
    void this.plugin.saveSettings();
    this.emit();
  }

  /**
   * Liga/desliga as notas como contexto. Vale pra conversa inteira e persiste
   * com ela — diferente de provider e modo, isto NÃO trava no primeiro envio:
   * é a única decisão da barra que continua fazendo sentido no meio de uma
   * conversa ("agora eu quero que você olhe minhas notas").
   */
  setVault(on: boolean): void {
    this.vaultEscolha = on;
    this.emit();
  }

  setEffort(effort: string): void {
    this.effort = effort;
    this.plugin.settings.defaultEffort = effort;
    void this.plugin.saveSettings();
    this.emit();
  }

  // ── Conversa ────────────────────────────────────────────────────────────

  /** Envia uma mensagem no modo ativo (chat / vault-qa / agent). */
  /**
   * Envia a mensagem. Devolve `false` quando a rodada NEM COMEÇOU (texto vazio,
   * outra rodada em curso, provider sem key no 1º envio) — nesses casos a
   * mensagem do usuário não chega a existir em lugar nenhum, e quem chamou
   * precisa saber pra devolver o texto ao campo em vez de perdê-lo.
   */
  async send(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed) return false;
    let st = useChatStore.getState();
    if (st.isLoading) return false;
    // O aviso do pre-flight (sem chave, sem modelo) não é conversa: quem
    // seguiu o aviso e mandou de novo está mandando a PRIMEIRA mensagem. Com
    // o aviso na lista, a conversa nova nunca ganhava id, trava nem gravação.
    if (
      !st.currentChatId &&
      st.messages.length > 0 &&
      st.messages.every((m) => m.type === "ai-response" && m.isError === true)
    ) {
      st.setMessages([]);
      st = useChatStore.getState(); // o retrato anterior ainda tem o aviso
    }
    const cfg = this.config;
    const provider = getProvider(cfg.provider);

    // Pre-flight de key ANTES de criar o chat — senão o 1º envio sem key
    // persistia um chat-fantasma (só a pergunta). O Ollama entra também: o
    // que falta nele é o endereço.
    // Sem modelo também para aqui: mandar `model: ""` dava erro do servidor
    // E travava a conversa nova num modelo vazio (o Ollama recém-configurado,
    // antes da primeira busca, não tem nenhum).
    const falta =
      st.messages.length === 0
        ? (semCredencial(cfg.provider, this.apiKeyFor(cfg.provider), this.t, provider.name) ??
          (cfg.model.trim() ? null : this.t.ai.err.noModel(provider.name)))
        : null;
    if (falta) {
      st.addMessage({
        type: "ai-response",
        content: `${this.t.ai.errorPrefix} ${falta}`,
        isError: true,
        errorCode: "no-key",
      });
      return false;
    }

    // 1ª mensagem: id + título + lock da sessão (+ associação ao projeto).
    if (st.messages.length === 0) {
      const id = makeId();
      st.setCurrentChatId(id);
      st.setCurrentChatTitle(generateTitle(trimmed));
      st.lockSession(cfg.provider, cfg.model, cfg.mode);
      if (this.pendingProjectId) {
        const pid = this.pendingProjectId;
        this.pendingProjectId = null;
        await this.updateProjects((prev) =>
          prev.map((p) =>
            p.id === pid && !p.chatIds.includes(id)
              ? { ...p, chatIds: [id, ...p.chatIds] }
              : p
          )
        );
      }
    }

    // Anexos escolhidos no composer (nota, imagem, texto colado) — o store é
    // quem guarda, porque é ele que a tela observa pra desenhar os chips.
    const pendentes = st.attachments;
    const attachments = pendentes.length > 0 ? [...pendentes] : undefined;
    if (pendentes.length > 0) st.setAttachments([]);

    // Imagem e PDF ficam NA mensagem (e vão de novo em todo turno, no lugar
    // onde foram mandados); as notas viram o contexto dela no motor (ver
    // contextoDoTurno).
    const midia = (attachments ?? []).filter((a) => a.type !== "note");
    st.addMessage(
      midia.length > 0
        ? { type: "user", content: trimmed, anexos: midia }
        : { type: "user", content: trimmed }
    );
    // Carimba de quem é este turno ANTES de começar. É por este id que a tela
    // sabe se quem está respondendo é a conversa que ela mostra, e é ele que
    // vai junto se a conversa sair de cena no meio.
    st.setTurnChatId(useChatStore.getState().currentChatId);
    this.emit();

    const ctx: EngineCtx = {
      plugin: this.plugin,
      t: this.t,
      abortRef: this.abortRef,
      activeProviderId: cfg.provider,
      activeProvider: provider,
      activeModel: cfg.model,
      activeMode: cfg.mode,
      apiKeyFor: (p) => this.apiKeyFor(p),
      effort: this.effort,
      useVault: cfg.vault,
      resolveStyleInstruction: () => "",
    };
    try {
      if (cfg.mode === "agent") {
        await runAgentTurn(
          { ...ctx, agentApproveAllRef: this.approveAllRef },
          trimmed,
          attachments
        );
      } else {
        await streamReply(ctx, trimmed, attachments);
      }
    } finally {
      // A conversa saiu da tela durante a resposta? Então é ela que grava o
      // próprio arquivo — o store agora é de outra pessoa.
      await this.gravarFundo();
      useChatStore.getState().setTurnChatId(null);
      this.emit();
    }

    // Quem escreveu enquanto a resposta chegava entra agora. Fica AQUI, e não
    // na tela, porque a tela pode ter sido desmontada no meio (Projects,
    // Skills, gaveta fechada) — e a mensagem não pode evaporar por isso.
    const fila = useChatStore.getState().queued;
    if (fila.length > 0) {
      const [proxima, ...resto] = fila;
      useChatStore.getState().setAttachments([]);
      useChatStore.setState({ queued: resto });
      // A recursão esvazia o resto da fila, uma rodada de cada vez.
      await this.send(proxima);
    }
    return true;
  }

  /**
   * Tira o turno da tela sem matá-lo: a conversa que está respondendo vira um
   * `BackgroundRun` e o motor passa a escrever LÁ.
   *
   * Chamado quando a pessoa abre outra conversa (ou uma nova) no meio de uma
   * resposta. Antes disto, o caminho era `abort()` — e como o motor só morre
   * um tique depois, a mensagem de "Interrompido", os passos do agente e os
   * tokens caíam no arquivo da conversa recém-aberta.
   *
   * A fila NÃO vai junto: ela volta a ser rascunho da conversa de onde saiu.
   * Mandar sozinha numa conversa que não está na tela seria escrever no nome
   * de alguém que não está olhando.
   */
  private destacarTurno(): boolean {
    const st = useChatStore.getState();
    if (!st.isLoading || st.background) return false;
    const dono = st.turnChatId ?? st.currentChatId;
    if (!dono) return false;
    const cfg = this.config;
    if (st.queued.length > 0) {
      const antes = st.drafts[dono] ?? "";
      const texto = [antes, ...st.queued].filter((t) => t.trim()).join("\n\n");
      st.setDraft(dono, texto);
      st.clearQueued();
    }
    st.detachTurn({
      chatId: dono,
      scrollTop: st.viewScrollTop,
      title: st.currentChatTitle,
      mode: cfg.mode,
      provider: cfg.provider,
      model: cfg.model,
      effort: cfg.effort,
      messages: st.messages,
      tokensIn: st.tokensIn,
      tokensOut: st.tokensOut,
      tokensCached: st.tokensCached,
      tokensCacheWrite: st.tokensCacheWrite,
      persona: st.sessionPersona || undefined,
      instructions: st.sessionInstructions || undefined,
      starred: st.currentChatStarred || undefined,
      vault: this.vaultEscolha ?? undefined,
    });
    return true;
  }

  /** Grava o arquivo da conversa que respondeu fora da tela e a esquece. */
  /** O que a conversa tem gravado agora (null: ainda não tem arquivo). */
  private async lerDoArquivo(id: string, mode: string): Promise<ChatData | null> {
    try {
      return await loadChat(this.plugin.app, this.plugin.settings.chatsPath, mode, id);
    } catch {
      return null;
    }
  }

  private async gravarFundo(): Promise<void> {
    const st = useChatStore.getState();
    const run = st.background;
    if (!run) return;
    st.clearBackground();
    // Mesmo filtro e mapa do save normal (ver mensagensParaGravar).
    const guardadas = mensagensParaGravar(run.messages);
    if (guardadas.length === 0) return;
    // Enquanto o turno rodava fora da tela, a lista pode ter mudado a estrela
    // ou as instruções DESTA conversa — e isso foi pro arquivo. O retrato do
    // turno é de antes: gravar por cima apagava a mudança. O arquivo vale.
    const noArquivo = await this.lerDoArquivo(run.chatId, run.mode);
    const chat: ChatData = {
      id: run.chatId,
      title: run.title || generateTitle(guardadas[0].content),
      date: new Date().toISOString(),
      mode: run.mode,
      provider: run.provider,
      model: run.model,
      effort: run.effort,
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      tokensCached: run.tokensCached,
      tokensCacheWrite: run.tokensCacheWrite,
      persona: noArquivo ? noArquivo.persona : run.persona,
      instructions: noArquivo ? noArquivo.instructions : run.instructions,
      starred: noArquivo ? noArquivo.starred : run.starred,
      vault: run.vault,
      messages: guardadas,
    };
    const ultima = chat.messages[chat.messages.length - 1];
    try {
      const path = await saveChat(
        this.plugin.app,
        this.plugin.settings.chatsPath,
        chat
      );
      this.plugin.upsertChatSummary({
        id: chat.id,
        title: chat.title,
        date: chat.date,
        mode: chat.mode,
        provider: chat.provider,
        model: chat.model,
        effort: chat.effort,
        tokensIn: chat.tokensIn,
        tokensOut: chat.tokensOut,
        tokensCached: chat.tokensCached,
        tokensCacheWrite: chat.tokensCacheWrite,
        messageCount: chat.messages.length,
        toolCount: chat.messages.reduce(
          (n, m) => n + (m.agentSteps?.length ?? 0),
          0
        ),
        filePath: path,
        starred: chat.starred === true,
        // Da última fala que já está aqui: reler do disco o arquivo que
        // acabamos de escrever seria trabalho por nada, e deixar vazio
        // APAGARIA a linha do cartão a cada gravação.
        preview: previewFromText(ultima?.content ?? ""),
      });
      // Respondeu com você em outro lugar: fica marcada até você abrir.
      this.plugin.markChatUnread(chat.id);
      this.avisoDeGravacaoDado = false;
    } catch (err) {
      this.avisarFalhaDeGravacao(err);
    }
  }

  /** Interrompe o stream / o turno do agente em andamento. */
  stop(): void {
    this.abortRef.current?.abort();
    // Parar é parar: o que estava na fila não pode disparar sozinho depois.
    useChatStore.getState().clearQueued();
  }

  /** Traz de volta pra tela a conversa que estava respondendo em segundo plano. */
  private reanexarTurno(): void {
    const st = useChatStore.getState();
    const run = st.attachTurn();
    if (!run) return;
    this.skipNextSave = true;
    st.setAttachments([]);
    st.setMessages(run.messages);
    st.setCurrentChatId(run.chatId);
    st.setCurrentChatTitle(run.title);
    st.lockSession(run.provider, run.model, run.mode);
    st.resetUsage();
    st.restaurarUso(run);
    st.setSessionPersona(run.persona ?? "");
    st.setSessionInstructions(run.instructions ?? "");
    st.setCurrentChatStarred(run.starred === true);
    this.vaultEscolha = run.vault ?? null;
    if (run.effort) this.effort = run.effort;
    // Volta exatamente onde a leitura parou: o que chegou enquanto você não
    // estava olhando fica logo abaixo, em vez de você cair no fim e ter que
    // subir pra procurar onde a resposta começou.
    st.setResume({ scroll: run.scrollTop });
    this.emit();
  }

  /** Nova conversa (destrava a sessão). `mode` opcional já fixa o modo. */
  newChat(mode?: ChatMode): void {
    // Mesmo trato do `load`: o turno em andamento sai de cena, não morre.
    if (!this.destacarTurno()) this.abortRef.current?.abort();
    this.flushSave();
    this.pendingProjectId = null;
    // Conversa nova começa sem escolha: o interruptor das notas volta a
    // seguir o modo. Herdar a escolha da conversa anterior faria um Chat
    // nascer vasculhando o vault porque a sessão de Agent de ontem fazia.
    this.vaultEscolha = null;
    useChatStore.getState().newChat();
    if (mode) {
      this.mode = mode;
      this.plugin.settings.defaultMode = mode;
      void this.plugin.saveSettings();
    }
    this.emit();
  }

  /** Nova conversa DENTRO de um projeto: fontes viram contexto no 1º envio. */
  async newChatInProject(project: Project): Promise<void> {
    this.newChat();
    this.pendingProjectId = project.id;
    // As instruções do projeto entram AGORA, e ficam gravadas nesta conversa.
    // Não são lidas do projeto na hora de responder: mudar as instruções
    // amanhã não pode reescrever o que já foi combinado ontem.
    useChatStore.getState().setSessionInstructions(project.instructions ?? "");
    const notes: NoteAttachment[] = [];
    const missing: string[] = [];
    for (const src of project.sources) {
      const file = this.plugin.app.vault.getAbstractFileByPath(src);
      if (!(file instanceof TFile)) {
        missing.push(src.split("/").pop() ?? src);
        continue;
      }
      try {
        const content = await this.plugin.app.vault.cachedRead(file);
        notes.push({ type: "note", path: src, content });
      } catch {
        missing.push(src.split("/").pop() ?? src);
      }
    }
    useChatStore.getState().setAttachments(notes);
    if (missing.length > 0) {
      new Notice(tr("Project sources not found: {names}", { names: missing.join(", ") }));
    }
    this.emit();
  }

  /** Abre uma conversa salva (.md) — reidrata o store e trava a sessão. */
  async load(ref: ChatRef): Promise<void> {
    const store = useChatStore.getState();
    if (store.currentChatId === ref.id) return;
    // Voltando pra conversa que está respondendo em segundo plano: ela não vem
    // do disco — o que vale é o que o turno já escreveu, que está na memória.
    if (store.background?.chatId === ref.id) {
      this.reanexarTurno();
      this.plugin.clearChatUnread(ref.id);
      return;
    }
    // Saber ANTES de limpar: `clearChatUnread` roda no fim deste método.
    const naoLida = this.plugin.unreadSet().has(ref.id);
    // Turno em andamento continua rodando, agora escrevendo fora da tela.
    if (!this.destacarTurno()) this.abortRef.current?.abort();
    this.flushSave();
    store.setLoadingChat(true);
    try {
      const chat = await loadChat(
        this.plugin.app,
        this.plugin.settings.chatsPath,
        ref.mode,
        ref.id
      );
      const restored: ChatMessage[] = chat.messages.map((m) => ({
        id: makeId(),
        type: m.type,
        content: m.content,
        timestamp: m.timestamp,
        ...(m.type === "ai-response" && m.reaction
          ? { reaction: m.reaction }
          : {}),
        ...(m.type === "ai-response" && m.agentSteps
          ? { agentSteps: m.agentSteps }
          : {}),
        ...(m.type === "user" && m.contexto ? { contexto: m.contexto } : {}),
        ...(m.type === "user" && m.resumo ? { resumo: m.resumo } : {}),
        ...(m.type === "ai-response" && m.isError ? { isError: true } : {}),
      }));

      const st = useChatStore.getState();
      // Abrir um chat NÃO é atividade: pula o próximo ciclo do auto-save.
      this.skipNextSave = true;
      this.pendingProjectId = null;
      st.setAttachments([]);
      st.setMessages(restored);
      st.setCurrentChatId(chat.id);
      st.setCurrentChatTitle(chat.title);
      st.lockSession(chat.provider, chat.model, chat.mode);
      st.resetUsage();
      st.restaurarUso(chat);
      st.setSessionPersona(chat.persona ?? "");
      st.setSessionInstructions(chat.instructions ?? "");
      st.setCurrentChatStarred(chat.starred === true);
      // Conversa que respondeu sem você ver abre NA RESPOSTA, não no fim dela:
      // aqui não há px guardados (a conversa veio do disco), então o ponto é a
      // última fala do modelo — que é justamente o que chegou sem você.
      if (naoLida) {
        const nova = [...restored]
          .reverse()
          .find((m) => m.type === "ai-response");
        if (nova) st.setResume({ messageId: nova.id });
      }
      // Abrir É ler.
      this.plugin.clearChatUnread(chat.id);
      if (chat.effort) this.effort = chat.effort;
      // Sem campo no arquivo, volta a valer o padrão do modo.
      this.vaultEscolha = chat.vault ?? null;
    } catch (err) {
      console.error("[axxa] loadChat falhou:", err);
      new Notice(
        `${this.t.ai.errorPrefix} ${err instanceof Error ? err.message : this.t.ai.unknownError}`
      );
    } finally {
      useChatStore.getState().setLoadingChat(false);
      this.emit();
    }
  }

  /** Apaga uma conversa (vai pra lixeira do sistema, recuperável). */
  async delete(ref: ChatRef): Promise<void> {
    try {
      await deleteChat(
        this.plugin.app,
        this.plugin.settings.chatsPath,
        ref.mode,
        ref.id
      );
      this.plugin.removeChatSummary(ref.id);
      // Tira a referência dos projetos (sem chatId órfão).
      await this.updateProjects((prev) =>
        prev.map((p) =>
          p.chatIds.includes(ref.id)
            ? { ...p, chatIds: p.chatIds.filter((id) => id !== ref.id) }
            : p
        )
      );
      if (useChatStore.getState().currentChatId === ref.id) this.newChat();
      new Notice(this.t.chat.deletedToTrash);
    } catch (err) {
      console.error("[axxa] deleteChat falhou:", err);
      new Notice(
        `${this.t.ai.errorPrefix} ${err instanceof Error ? err.message : ""}`
      );
    }
  }

  /** Renomeia o título (frontmatter + H1) sem mudar id/arquivo. */
  async rename(ref: ChatRef, newTitle: string): Promise<void> {
    const clean = newTitle.trim();
    if (!clean) return;
    try {
      await renameChat(
        this.plugin.app,
        this.plugin.settings.chatsPath,
        ref.mode,
        ref.id,
        clean
      );
      if (useChatStore.getState().currentChatId === ref.id) {
        useChatStore.getState().setCurrentChatTitle(clean);
      }
      const cur = this.plugin.chatSummaries?.find((c) => c.id === ref.id);
      if (cur) this.plugin.upsertChatSummary({ ...cur, title: clean });
      new Notice(this.t.conversations.renameSuccess(clean));
    } catch (err) {
      const msg = err instanceof Error ? err.message : this.t.ai.unknownError;
      new Notice(this.t.conversations.renameFailed(msg));
    }
  }

  // ── Projetos (persistidos em settings.projects) ─────────────────────────

  async updateProjects(
    update: (prev: Project[]) => Project[]
  ): Promise<void> {
    this.plugin.settings.projects = update(this.plugin.settings.projects ?? []);
    await this.plugin.saveSettings();
  }

  // ── Auto-save ───────────────────────────────────────────────────────────

  private scheduleSave(): void {
    const st = useChatStore.getState();
    if (st.messages.length === 0 || !st.currentChatId) return;
    if (this.skipNextSave) {
      this.skipNextSave = false;
      return;
    }
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.pendingSave = () => void this.saveNow();
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.pendingSave = null;
      void this.saveNow();
    }, 500);
  }

  /** Grava AGORA um save agendado (fechar a view, trocar de chat). */
  flushSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const pending = this.pendingSave;
    this.pendingSave = null;
    pending?.();
  }

  /**
   * A gravação da conversa falhou — e quem está conversando precisa saber.
   *
   * As mensagens ficam na tela mesmo quando o arquivo não foi escrito, então
   * sem isto a pessoa continua digitando por cima de uma conversa que não
   * existe em disco e só descobre ao reabrir o Obsidian. Um `console.error`
   * não é aviso: ninguém conversa com o devtools aberto.
   *
   * Uma vez por sequência de falhas (disco cheio avisa uma vez, não a cada
   * mensagem); volta a avisar depois que uma gravação dá certo.
   */
  private avisarFalhaDeGravacao(err: unknown): void {
    console.error("[axxa] não consegui gravar a conversa:", err);
    if (this.avisoDeGravacaoDado) return;
    this.avisoDeGravacaoDado = true;
    new Notice(
      tr(
        "AXXA could not save this chat to your vault — what you see here is not on disk yet. Check the vault's disk space and permissions."
      ),
      12000
    );
  }

  private async saveNow(): Promise<void> {
    const st = useChatStore.getState();
    if (!st.currentChatId) return;
    const userOrAi = mensagensParaGravar(st.messages);
    if (userOrAi.length === 0) return;
    const cfg = this.config;
    const chat: ChatData = {
      id: st.currentChatId,
      title: st.currentChatTitle || generateTitle(userOrAi[0].content),
      date: new Date().toISOString(),
      mode: cfg.mode,
      provider: cfg.provider,
      model: cfg.model,
      effort: cfg.effort,
      tokensIn: st.tokensIn,
      tokensOut: st.tokensOut,
      tokensCached: st.tokensCached,
      tokensCacheWrite: st.tokensCacheWrite,
      persona: st.sessionPersona || undefined,
      instructions: st.sessionInstructions || undefined,
      starred: st.currentChatStarred || undefined,
      // `?? undefined` e não `?? false`: gravar um false de nascença faria a
      // conversa reabrir com o interruptor travado em desligado, mesmo num
      // modo cujo padrão é ligado.
      vault: this.vaultEscolha ?? undefined,
      messages: userOrAi,
    };
    const ultima = chat.messages[chat.messages.length - 1];
    try {
      const path = await saveChat(
        this.plugin.app,
        this.plugin.settings.chatsPath,
        chat
      );
      this.plugin.upsertChatSummary({
        id: chat.id,
        title: chat.title,
        date: chat.date,
        mode: chat.mode,
        provider: chat.provider,
        model: chat.model,
        effort: chat.effort,
        tokensIn: chat.tokensIn,
        tokensOut: chat.tokensOut,
        tokensCached: chat.tokensCached,
        tokensCacheWrite: chat.tokensCacheWrite,
        messageCount: chat.messages.length,
        toolCount: chat.messages.reduce(
          (n, m) => n + (m.agentSteps?.length ?? 0),
          0
        ),
        filePath: path,
        starred: chat.starred === true,
        preview: previewFromText(ultima?.content ?? ""),
      });
      this.avisoDeGravacaoDado = false;
    } catch (err) {
      this.avisarFalhaDeGravacao(err);
    }
  }
}

// src/main.ts
// Entry point do plugin. O Obsidian instancia AxxaPlugin ao carregar o plugin.
// É como o "componente raiz" no Figma — todo o resto é montado a partir daqui.

import { Plugin, WorkspaceLeaf, Platform, Notice, type TAbstractFile } from "obsidian";
import { settingsReadLooksBroken } from "./core/settingsGuard";
import { AXXA_HIDDEN, HIDDEN_MOVES, shouldMigrate } from "./core/vaultPaths";
import { getProvider } from "./providers";
import { AxxaView, VIEW_TYPE_AXXA } from "./ui/AxxaView";
import { FONTE_DO_HOVER } from "./ui/linksDaResposta";
import { registerBrandLogos } from "./ui/brandLogos";
import { AxxaSettingsTab } from "./ui/SettingsTab";
import { VectorIndex, loadIndex, RAG_SHARD_SIZE } from "./rag/vectorIndex";
import { indexVault } from "./rag/indexer";
import {
  inferEmbeddingSpec,
  pareceEmbeddingDoOllama,
  registerDiscoveredEmbeddings,
  type EmbeddingModelSpec,
  type EmbeddingProvider,
} from "./rag/types";
import { registerLocalUsage } from "./providers/dataCollect";
import { listAllChats, type ChatSummary } from "./core/chatPersistence";
import {
  hydrateModelInfoCache,
  getModelInfoCache,
  fetchAndCacheModelInfo,
  type EnrichedModelInfo,
} from "./providers/modelInfoStore";
import {
  loadSkills,
  seedExampleSkills,
  isSkillFilePath,
  type Skill,
} from "./skills/skills";
import type { Project } from "./projects";
import type {
  EffortConfig,
  EffortLevel,
} from "./core/effort";
import { limparCamposMortos } from "./core/settingsLegado";
import { EMBEDDING_PROVIDERS, somarDescobertos } from "./rag/descobertos";
import { chatIndexSignature } from "./core/chatIndex";
import {
  FABRICA_ATE_0923,
  alinharAoInstalado,
  listaDeFabrica,
  revisarOllamaPadrao,
} from "./core/ollamaPadrao";
import { definirGratisConhecidos } from "./usage/pricing";
import { lancar, podar, type LivroDoDia } from "./usage/livroDoDia";
import { definirAnotadorDeUso, definirGuardaDeGasto } from "./usage/anotador";
import { ehPago, gastoDeHoje, marcosCruzados, usd } from "./usage/gastoDoDia";
import { ProviderError } from "./providers/base";
import { esquecerDesfazeres } from "./agent/undo";
import { registrarComandosDoEditor } from "./editor/comandos";
import { esquecerPedidos } from "./editor/ponte";
import { LOCALES, resolverIdioma } from "./i18n";
import { definirIdiomaDaInterface, tr } from "./i18n/tr";

/** Resultado do último teste de credencial de um provider. */
export interface ProviderStatus {
  ok: boolean;
  /** Epoch ms do teste — mostrado como "testado há X". */
  at: number;
  /** Contagem de modelos (ok) ou a mensagem de erro (falha). */
  detail?: string;
}

export interface AxxaSettings {
  // ---- Providers (BYOK). As chaves vivem no SecretStorage do SO; aqui só em
  // memória (persistableSettings() zera antes de gravar o data.json).
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  openrouterApiKey: string;
  nimApiKey: string;
  /** Endereço do servidor Ollama. Vazio = Ollama desligado (ver core/ollamaPadrao.ts). */
  ollamaEndpoint: string;
  /** A migração única do endereço de fábrica do Ollama já rodou. */
  ollamaPadraoRevisto?: boolean;
  /** Provider pré-selecionado num chat novo. */
  defaultProvider: string;
  /** Modelo por provider (o que a casca usa ao selecionar o provider). */
  defaultModel: string;
  anthropicModel: string;
  geminiModel: string;
  openrouterModel: string;
  nimModel: string;
  ollamaModel: string;
  /** O que o Ollama tinha instalado na última busca — o que vier além disso
   *  é modelo novo e entra na lista (ver core/ollamaPadrao.ts). */
  ollamaVistos?: string[];
  /** Modelos conhecidos por provider — opções do seletor de modelo. */
  activeModels: Record<string, string[]>;
  /** Modelos FAVORITOS por provider — aparecem na tela inicial. Máx. 5. */
  favoriteModels: Record<string, string[]>;
  /**
   * Quais modelos são GRÁTIS, por provider — descoberto no SCAN, pelo PREÇO
   * que o catálogo publica.
   *
   * Até aqui free era adivinhado pelo NOME (o sufixo `:free` do OpenRouter).
   * Isso acerta a maioria e perde os outros — e quem paga por essa perda é
   * justamente quem não quer pagar nada. Vazio = ainda não escaneou, e aí o
   * sufixo volta a ser o palpite (ver assistant/model.ts: ehFree).
   */
  freeModels: Record<string, string[]>;
  /** A cota diária dos grátis por provider (OpenRouter), de quando o fetch
   *  rodou: a etiqueta "free" mostra o número ("free · 50/day"). */
  freeQuota: Record<string, { limit: number; remaining?: number; at: number }>;
  /** O livro do dia: pedidos e tokens por modelo, hora a hora, nas últimas
   *  ~48h (ver usage/livroDoDia.ts). Sai daqui o "quanto sobra hoje". */
  usoDoDia: LivroDoDia;
  /** Limites diários que a PESSOA informou ("provider\u0001modelo" → pedidos
   *  por dia) — o Gemini não publica os do tier grátis: eles moram no AI
   *  Studio de cada projeto. */
  limitesDiarios: Record<string, number>;
  /** Limite de gasto do dia em USD (0 = sem limite) — ver usage/gastoDoDia. */
  limiteGastoDiario: number;
  /** No limite, os modelos pagos param até a meia-noite (os grátis e os
   *  locais seguem). Desligado, o limite só avisa. */
  travarNoLimite: boolean;
  // ---- A assistente de criação (skills e projetos)
  /**
   * Onde a ASSISTENTE roda — separada do modelo do chat de propósito.
   *
   * Escrever um skill é trabalho de formulário: texto curto, estruturado,
   * revisado por quem pediu antes de virar qualquer coisa. Não é a tarefa que
   * justifica o modelo caro da conversa. Vazio = a gente descobre sozinha o
   * favorito free do OpenRouter (ver assistant/model.ts): id de modelo free
   * muda de nome, e um id fixo aqui viraria um 404 num dia qualquer.
   */
  assistantProvider: string;
  assistantModel: string;
  /**
   * A assistente de PROJETO pode ver os NOMES das notas do vault, pra sugerir
   * quais anexar como fonte. Só os caminhos, nunca o conteúdo — mas caminho de
   * nota já é assunto de quem escreveu, então isto é uma escolha explícita e
   * nasce DESLIGADA. Sem ela, a assistente é instruída a não sugerir nota
   * nenhuma (ver prompt.ts).
   */
  assistantSeesVault: boolean;
  /** O "Data controls" da OpenAI está ligado na conta? Ligando lá, ela dá uma
   *  cota diária de tokens sem custo. É um interruptor DELES — aqui a gente só
   *  registra, pra poder mostrar a cota certa em vez de prometer desconto que
   *  a conta não tem. */
  openaiDataSharing: boolean;
  /** Usage tier da conta OpenAI (1–5). A cota diária dobra e quadruplica com
   *  ele (250k/2.5M nos tiers 1–2; 1M/10M do 3 em diante). */
  openaiTier: number;
  /** Último teste de conexão por provider (Settings → Test). Persiste porque
   *  quem precisa do resultado é o CHAT: ele não vai testar sozinho na hora de
   *  abrir a folha de modelos. */
  providerStatus: Record<string, ProviderStatus>;
  // ---- Voz (as duas direções passam pela OpenAI)
  /** Ditado: o microfone do composer. Desligado, o botão nem aparece. */
  voiceEnabled: boolean;
  /** Modelo de transcrição (fala → texto). */
  voiceModel: string;
  /** Idioma da fala em ISO-639-1. Vazio = o modelo detecta. */
  voiceLanguage: string;
  /** Leitura em voz alta: o botão de ouvir a resposta. */
  ttsEnabled: boolean;
  /** Quem fala: "openai" ou "eleven". */
  ttsProvider: string;
  /** Modelo de TTS da OpenAI (texto → fala). */
  ttsModel: string;
  /** Voz da OpenAI (alloy, nova, …). */
  ttsVoice: string;
  /** Key da ElevenLabs — é ela que dá acesso à VOZ CLONADA do usuário. */
  elevenApiKey: string;
  elevenModel: string;
  /** voice_id escolhido na conta ElevenLabs. */
  elevenVoice: string;
  /** Vozes lidas da conta (id + nome), pra não pedir a lista toda hora. */
  elevenVoices: { id: string; name: string; category?: string }[];
  /** Feedback tátil nos toques (só no celular, e só onde o aparelho suporta). */
  hapticsEnabled: boolean;
  /** Modelos de embedding descobertos via API, por provider (RAG). O "Fetch
   *  models" de cada provider grava aqui (ver plugin.scanEmbeddings). */
  discoveredEmbeddings: Record<string, string[]>;
  // ---- Sessão
  /**
   * Conversas que responderam SEM você ver — o ponto de "não lida".
   *
   * Mora aqui, e não no frontmatter nem no chatIndex.json, por dois motivos:
   * o índice é reconstruído do disco a cada varredura e apagaria a marca, e
   * "eu já li" é uma verdade DESTE aparelho — a mesma conversa sincronizada
   * pra outro celular não foi lida lá. É o mesmo lugar onde os projetos já
   * guardam a associação chat↔projeto, pela mesma razão.
   */
  unreadChats: string[];
  /** chat | vault-qa | agent */
  defaultMode: string;
  /** low | med | high | xhigh | max */
  defaultEffort: string;
  /** Overrides do usuário por nível de effort (ausente = DEFAULT_EFFORT_CONFIGS). */
  effortConfigs: Partial<Record<EffortLevel, Partial<EffortConfig>>>;
  /** Só "en-us" por enquanto. */
  language: string;
  // ---- Vault
  chatsPath: string;
  skillsPath: string;
  /** Projetos (agrupam chats + notas-fonte). */
  projects: Project[];
  // ---- RAG (Vault Q&A)
  ragIndexPath: string;
  ragEmbeddingProvider: string;
  ragEmbeddingModel: string;
  /** precision | balanced | light | minimal */
  ragQuantProfile: string;
  /** Índice em shards (memória limitada; busca lê do disco). */
  ragStreamShards: boolean;
  /** Reindexa sozinho quando notas mudam (opt-in — custa tokens). */
  ragAutoReindex: boolean;
  /** Já avisamos uma vez que o índice é grande demais pro mobile. */
  ragMobileSkipNoticeShown?: boolean;
  // ---- Agent
  /** ask | vault | yolo */
  agentPermissionLevel: string;
  /** Preview/diff antes de gravar qualquer escrita do agente. */
  agentDiffApproval: boolean;
  /** O agente pode buscar na web e abrir páginas (agent/web.ts). */
  agentWeb: boolean;
  /** Chave da busca na web (Tavily). Vai pro keychain, como as outras. */
  tavilyApiKey: string;
  // ---- Mobile
  /** Tela cheia no mobile: esconde o chrome da gaveta e a navbar global. */
  mobileFullscreen: boolean;
}

const DEFAULT_SETTINGS: AxxaSettings = {
  openaiApiKey: "",
  anthropicApiKey: "",
  geminiApiKey: "",
  openrouterApiKey: "",
  nimApiKey: "",
  // Vazio: o Ollama começa desligado, e quem usa coloca o endereço (o campo
  // sugere http://localhost:11434). Ver core/ollamaPadrao.ts.
  ollamaEndpoint: "",
  defaultProvider: "openai",
  defaultModel: "gpt-4o",
  anthropicModel: "claude-sonnet-4-6",
  geminiModel: "gemini-2.5-flash",
  openrouterModel: "anthropic/claude-3.5-sonnet",
  nimModel: "meta/llama-3.3-70b-instruct",
  // Vazio de fábrica: o modelo e a lista do Ollama saem do que ele tem
  // instalado, na primeira busca (ver core/ollamaPadrao.ts).
  ollamaModel: "",
  activeModels: {
    openai: ["gpt-4o", "gpt-4o-mini", "o1", "o3", "gpt-5"],
    anthropic: [
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
    gemini: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
    ],
    openrouter: [
      "openrouter/auto",
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "meta-llama/llama-3.3-70b-instruct",
      "google/gemini-2.0-flash-001",
    ],
    nim: [
      "meta/llama-3.3-70b-instruct",
      "meta/llama-3.1-70b-instruct",
      "meta/llama-3.1-8b-instruct",
      "nvidia/llama-3.1-nemotron-70b-instruct",
      "mistralai/mixtral-8x22b-instruct-v0.1",
      "deepseek-ai/deepseek-r1",
      "qwen/qwen2.5-72b-instruct",
      "microsoft/phi-4",
    ],
    ollama: [],
  },
  favoriteModels: {},
  freeModels: {},
  freeQuota: {},
  usoDoDia: {},
  limitesDiarios: {},
  limiteGastoDiario: 0,
  travarNoLimite: false,
  assistantProvider: "",
  assistantModel: "",
  // Desligada: mandar o nome das suas notas pra fora é escolha, não padrão.
  assistantSeesVault: false,
  // Desligado e tier 1: o padrão é o que a conta nova TEM, não o melhor caso.
  openaiDataSharing: false,
  openaiTier: 1,
  providerStatus: {},
  voiceEnabled: true,
  voiceModel: "gpt-4o-mini-transcribe",
  voiceLanguage: "",
  ttsEnabled: false,
  ttsProvider: "openai",
  ttsModel: "gpt-4o-mini-tts",
  ttsVoice: "alloy",
  elevenApiKey: "",
  elevenModel: "eleven_multilingual_v2",
  elevenVoice: "",
  elevenVoices: [],
  hapticsEnabled: true,
  discoveredEmbeddings: {},
  unreadChats: [],
  defaultMode: "chat",
  defaultEffort: "med",
  effortConfigs: {},
  // Quem instala agora começa no idioma do Obsidian; quem já tinha o
  // data.json fica com o que estava gravado.
  language: "auto",
  // Dado do app vai pra pasta OCULTA (ver core/vaultPaths.ts): o Obsidian
  // ignora pasta com ponto, então conversa some da busca, do explorador e do
  // grafo. Skills NÃO vão: skill é nota que a pessoa escreve, e escondida ela
  // não abre pra ser editada.
  chatsPath: `${AXXA_HIDDEN}/chats`,
  skillsPath: "axxa-ai/skills",
  projects: [],
  ragIndexPath: `${AXXA_HIDDEN}/index`,
  ragEmbeddingProvider: "openai",
  ragEmbeddingModel: "text-embedding-3-small",
  ragQuantProfile: "balanced",
  ragStreamShards: false,
  ragAutoReindex: false,
  ragMobileSkipNoticeShown: false,
  agentPermissionLevel: "ask",
  agentDiffApproval: true,
  agentWeb: true,
  tavilyApiKey: "",
  mobileFullscreen: false,
};

export default class AxxaPlugin extends Plugin {
  settings!: AxxaSettings;
  /** Índice vetorial RAG carregado em memória — compartilhado entre Settings
   *  (indexação) e AxxaApp (busca). null = ainda não foi carregado/indexado. */
  vectorIndex: VectorIndex | null = null;
  /** Indexação em curso (o mesmo botão cancela). */
  indexing: AbortController | null = null;
  /** (P1-69) Ref da settings tab — permite abrir numa aba específica. */
  settingsTab: AxxaSettingsTab | null = null;
  /** Listeners avisados a cada saveSettings — usados pra re-renderizar o
   *  React tree quando o user troca idioma ou outro setting reativo. */
  private settingsListeners = new Set<() => void>();
  /** Debounce + cancelamento do auto-reindex do RAG (opt-in). */
  private autoReindexTimer: number | null = null;
  private autoReindexController: AbortController | null = null;

  /** Skills carregados da pasta (settings.skillsPath) — viram slash-commands. */
  skills: Skill[] = [];
  /** Debounce do hot reload das skills (watcher do vault). v0.1.247 */
  private skillsReloadTimer: number | null = null;

  // ============================================================
  // Cache ÚNICO de summaries de conversa (v0.1.175) — UMA fonte da verdade
  // pra TODOS os consumidores (StarterScreen, Sidebar, ConversationsList,
  // Statistics, Usage, hot). Antes cada um fazia seu próprio listAllChats
  // (disk-walk) → várias passadas no abrir = lento. Agora: 1 walk, cacheado,
  // reusado, atualizado INCREMENTAL no save/rename/delete (sem re-walk).
  // ============================================================
  chatSummaries: ChatSummary[] | null = null;
  private chatSummariesPromise: Promise<ChatSummary[]> | null = null;
  private chatsListeners = new Set<() => void>();
  private reconcilingChats = false;
  private chatIndexWriteTimer: number | null = null;

  /**
   * Marca uma conversa como não lida — a resposta chegou sem ninguém olhando.
   *
   * Passa pelo mesmo aviso do cache de conversas (`notifyChats`) porque quem
   * desenha a marca é a mesma lista: um aviso só, uma re-renderização só.
   */
  markChatUnread(id: string): void {
    if (!id || this.settings.unreadChats.includes(id)) return;
    this.settings.unreadChats = [...this.settings.unreadChats, id];
    void this.saveSettings();
    this.notifyUnread();
  }

  /** Abriu a conversa: a marca sai. */
  clearChatUnread(id: string): void {
    if (!id || !this.settings.unreadChats.includes(id)) return;
    this.settings.unreadChats = this.settings.unreadChats.filter(
      (x) => x !== id
    );
    void this.saveSettings();
    this.notifyUnread();
  }

  /** As não lidas, prontas pra consulta rápida na lista. */
  unreadSet(): Set<string> {
    return new Set(this.settings.unreadChats);
  }

  private unreadListeners = new Set<() => void>();

  /**
   * Canal PRÓPRIO — não dá pra pegar carona no aviso do cache de conversas.
   *
   * Aquele aviso reentrega o MESMO array de summaries (nada mudou nele), o
   * React compara a identidade, não vê diferença e não redesenha: a marca
   * saía do disco e continuava na tela.
   */
  onUnreadChange(cb: () => void): () => void {
    this.unreadListeners.add(cb);
    return () => this.unreadListeners.delete(cb);
  }

  private notifyUnread(): void {
    this.unreadListeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error("[axxa] listener de não lidas falhou:", err);
      }
    });
  }

  /** Inscreve um callback chamado quando o cache de conversas muda. */
  onChatsChange(cb: () => void): () => void {
    this.chatsListeners.add(cb);
    return () => this.chatsListeners.delete(cb);
  }
  private notifyChats(): void {
    this.chatsListeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error("[axxa] chats listener falhou:", err);
      }
    });
  }

  /** Índice persistido (JSON no diretório do plugin, fora do vault content). */
  private chatIndexPath(): string {
    // A pasta de configuração NÃO é necessariamente `.obsidian` — quem usa
    // pode renomear. `vault.configDir` devolve a de verdade.
    const dir =
      this.manifest.dir ??
      `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    return `${dir}/chatIndex.json`;
  }
  /** Versão do schema do índice persistido. Caches de versão desconhecida são
   *  descartados (cai pro walk, que reescreve no formato atual). v0.1.228
   *
   *  2 (0.6.16): entrou o `preview` — a última fala que o cartão do Agent
   *  mostra. Sem subir a versão, o índice antigo continuava valendo e a linha
   *  simplesmente não existia pra quem já usava o app. */
  private static readonly CHAT_INDEX_VERSION = 2;
  private async readChatIndex(): Promise<ChatSummary[] | null> {
    try {
      const p = this.chatIndexPath();
      if (!(await this.app.vault.adapter.exists(p))) return null;
      // `JSON.parse` devolve `any` e `any` desliga a checagem de tudo que
      // encosta nele; o envelope é lido como forma aberta e validado abaixo.
      const parsed = JSON.parse(await this.app.vault.adapter.read(p)) as
        | { v?: unknown; items?: unknown }
        | unknown[]
        | null;
      // Aceita o envelope versionado { v, items } e, por retrocompat, o array
      // cru de versões antigas. Versão desconhecida → descarta (volta pro walk).
      let items: unknown;
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (
        parsed &&
        typeof parsed === "object" &&
        parsed.v === AxxaPlugin.CHAT_INDEX_VERSION
      ) {
        items = parsed.items;
      } else {
        return null;
      }
      if (!Array.isArray(items)) return null;
      // Valida o shape mínimo de cada item — descarta o cache se algo destoar
      // (JSON corrompido / formato antigo) e força o walk pra reconstruir.
      const valid = items.every(
        (it): it is ChatSummary =>
          !!it &&
          typeof it === "object" &&
          typeof (it as ChatSummary).id === "string" &&
          typeof (it as ChatSummary).date === "string"
      );
      if (!valid) return null;
      // Normaliza o `starred` — caches gravados antes do campo existir não o
      // trazem, e um undefined vazaria pro tipo (que promete boolean).
      return (items as ChatSummary[]).map((it) => ({
        ...it,
        starred: it.starred === true,
      }));
    } catch (err) {
      console.error("[axxa] readChatIndex falhou:", err);
      return null;
    }
  }
  private async writeChatIndex(arr: ChatSummary[]): Promise<void> {
    // Toda escrita do índice passa por aqui — cancela um write debounced ainda
    // pendente pra não disparar dois adapter.write concorrentes no mesmo path
    // (o snapshot que escrevemos agora já é o mais fresco). v0.1.228
    if (this.chatIndexWriteTimer !== null) {
      window.clearTimeout(this.chatIndexWriteTimer);
      this.chatIndexWriteTimer = null;
    }
    try {
      // Envelope versionado pra detectar/descartar caches de schema antigo.
      const envelope = { v: AxxaPlugin.CHAT_INDEX_VERSION, items: arr };
      await this.app.vault.adapter.write(
        this.chatIndexPath(),
        JSON.stringify(envelope)
      );
    } catch (err) {
      console.error("[axxa] writeChatIndex falhou:", err);
    }
  }
  /** Persiste o índice debounced (após upsert/remove). */
  private scheduleChatIndexWrite(): void {
    if (this.chatIndexWriteTimer != null) {
      window.clearTimeout(this.chatIndexWriteTimer);
    }
    this.chatIndexWriteTimer = window.setTimeout(() => {
      this.chatIndexWriteTimer = null;
      if (this.chatSummaries) void this.writeChatIndex(this.chatSummaries);
    }, 800);
  }

  /**
   * Carrega os summaries com PINTURA INSTANTÂNEA (v0.1.176):
   *   1. Índice JSON persistido → cache na hora (sem disk-walk, sem cache frio).
   *   2. Reconcilia em BACKGROUND (walk) pra pegar mudanças externas.
   * Sem índice (1ª vez) ou `force` → walk completo + grava o índice.
   * Concorrentes compartilham a mesma Promise.
   */
  async loadChatSummaries(force = false): Promise<ChatSummary[]> {
    if (!force && this.chatSummaries) return this.chatSummaries;
    if (!force && this.chatSummariesPromise) return this.chatSummariesPromise;
    this.chatSummariesPromise = (async () => {
      try {
        if (!force) {
          const cached = await this.readChatIndex();
          if (cached) {
            this.chatSummaries = cached;
            this.notifyChats();
            void this.reconcileChatSummaries(); // background, não bloqueia
            return cached;
          }
        }
        const all = await listAllChats(this.app, this.settings.chatsPath, 100_000);
        this.chatSummaries = all;
        this.notifyChats();
        void this.writeChatIndex(all);
        return all;
      } catch (err) {
        console.error("[axxa] loadChatSummaries falhou:", err);
        return this.chatSummaries ?? [];
      } finally {
        this.chatSummariesPromise = null;
      }
    })();
    return this.chatSummariesPromise;
  }

  /** Walk em background: se o disco divergir do cache, atualiza + reescreve. */
  private async reconcileChatSummaries(): Promise<void> {
    if (this.reconcilingChats) return;
    this.reconcilingChats = true;
    try {
      const fresh = await listAllChats(this.app, this.settings.chatsPath, 100_000);
      // A assinatura mora em core/chatIndex.ts, testada: campo que aparece num
      // cartão e falta nela é uma diferença INVISÍVEL — a varredura acha tudo
      // igual e joga fora o resultado novo.
      const sig = chatIndexSignature;
      if (!this.chatSummaries || sig(fresh) !== sig(this.chatSummaries)) {
        this.chatSummaries = fresh;
        this.notifyChats();
        void this.writeChatIndex(fresh);
      }
    } catch (err) {
      console.error("[axxa] reconcileChatSummaries falhou:", err);
    } finally {
      this.reconcilingChats = false;
    }
  }

  /** Upsert INCREMENTAL após salvar um chat — evita re-walk do disco. */
  upsertChatSummary(s: ChatSummary): void {
    if (!this.chatSummaries) return;
    // IMUTÁVEL (auditoria jul/2026): mutar in place mantinha a MESMA referência
    // de array — consumidores React que comparam referência (useEffect deps,
    // memo) nunca viam a mudança e as listas ficavam stale a sessão inteira.
    this.chatSummaries = [
      ...this.chatSummaries.filter((c) => c.id !== s.id),
      s,
    ].sort((a, b) => b.date.localeCompare(a.date));
    this.notifyChats();
    this.scheduleChatIndexWrite();
  }

  /** Remove um chat do cache (após delete). */
  removeChatSummary(id: string): void {
    // A marca de não lida sai junto: conversa apagada não pode continuar
    // pedindo atenção do fundo do data.json pelo resto da vida.
    this.clearChatUnread(id);
    if (!this.chatSummaries) return;
    this.chatSummaries = this.chatSummaries.filter((c) => c.id !== id);
    this.notifyChats();
    this.scheduleChatIndexWrite();
  }

  /** Credencial (key/endpoint) do provider — pro SCAN do seletor de modelo. */
  providerCredential(id: string): string {
    const s = this.settings;
    switch (id) {
      case "anthropic":
        return s.anthropicApiKey ?? "";
      case "gemini":
        return s.geminiApiKey ?? "";
      case "openrouter":
        return s.openrouterApiKey ?? "";
      case "nim":
        return s.nimApiKey ?? "";
      case "ollama":
        return s.ollamaEndpoint ?? "";
      default:
        return s.openaiApiKey ?? "";
    }
  }
  /** "SCAN" — lista os modelos do catálogo do provider (pode lançar). v0.1.223 */
  async scanModels(providerId: string): Promise<string[]> {
    const p = getProvider(providerId);
    if (!p.listModels) return [];
    const desde = this.settings.ollamaEndpoint;
    const lista = await p.listModels(this.providerCredential(providerId));
    // No Ollama a resposta é o que está INSTALADO: a lista do chat passa a
    // ser ela (sem os palpites de fábrica nem o que saiu com `ollama rm`).
    // Se o endereço mudou enquanto ela vinha, é a lista de OUTRO servidor.
    if (
      providerId === "ollama" &&
      this.settings.ollamaEndpoint === desde &&
      this.alinharOllama(lista)
    ) {
      await this.saveSettings();
    }
    // Aproveita a volta pra saber quais são GRÁTIS. O preço vem no mesmo
    // `/models`, então isto não custa uma chamada a mais — e sem isto o app
    // continuaria adivinhando free pelo nome.
    await this.scanFreeModels(providerId);
    return lista;
  }

  /**
   * Acerta as listas do Ollama (ativos, favoritos, modelo de conversa nova)
   * com o que ele tem instalado — a regra mora em core/ollamaPadrao.ts.
   * Devolve se mudou alguma coisa; quem chama decide gravar.
   */
  alinharOllama(instalados: readonly string[]): boolean {
    const s = this.settings;
    const antes = {
      ativos: s.activeModels.ollama ?? [],
      favoritos: s.favoriteModels?.ollama ?? [],
      modelo: s.ollamaModel ?? "",
      vistos: s.ollamaVistos ?? null,
    };
    const depois = alinharAoInstalado(antes, instalados, pareceEmbeddingDoOllama);
    if (JSON.stringify(antes) === JSON.stringify(depois)) return false;
    s.activeModels = { ...s.activeModels, ollama: [...depois.ativos] };
    s.favoriteModels = { ...(s.favoriteModels ?? {}), ollama: [...depois.favoritos] };
    s.ollamaModel = depois.modelo;
    s.ollamaVistos = [...depois.vistos];
    return true;
  }

  /**
   * A mesma conferência sem a pessoa pedir. Só age quando o Ollama RESPONDE
   * — fora de alcance (o celular longe de casa), tudo fica como estava.
   * Devolve o que ele tem instalado (null quando não perguntou ou não ouviu).
   *
   * `soDeFabrica` (a de quando o Obsidian abre) só troca lista que ninguém
   * escolheu: os palpites de fábrica, ou vazia. Lista escolhida é da pessoa,
   * e o data.json viaja entre aparelhos — num notebook com outro Ollama, a
   * poda sozinha apagaria os favoritos do desktop. Lá, quem poda é o "Fetch
   * models" ou o "Test", que a pessoa aperta NAQUELE aparelho.
   */
  async conferirOllama(opts: { soDeFabrica: boolean }): Promise<string[] | null> {
    const s = this.settings;
    if (!s.ollamaEndpoint) return null;
    if (
      opts.soDeFabrica &&
      !(
        listaDeFabrica(s.activeModels.ollama ?? []) &&
        (s.favoriteModels?.ollama ?? []).length === 0 &&
        s.ollamaVistos === undefined
      )
    ) {
      return null;
    }
    const p = getProvider("ollama");
    if (!p.listModels) return null;
    const desde = s.ollamaEndpoint;
    let instalados: string[];
    try {
      instalados = await p.listModels(this.providerCredential("ollama"));
    } catch {
      return null; // Ollama desligado ou longe: a lista de antes vale.
    }
    // O endereço mudou enquanto a resposta vinha: ela é de outro servidor.
    if (s.ollamaEndpoint !== desde) return null;
    // Uma resposta vazia, sem ninguém ter pedido, não apaga nada.
    if (opts.soDeFabrica && instalados.length === 0) return null;
    if (this.alinharOllama(instalados)) await this.saveSettings();
    return instalados;
  }

  /**
   * Os modelos de EMBEDDING que a conta do provider oferece — o "Fetch models"
   * de cada provider traz junto, como era até a 0.3.x. O redesign da 0.4.0
   * perdeu esse caminho: o registro dos descobertos ficou só com o que versões
   * antigas tinham salvo, e um modelo de embedding novo de um provider não
   * aparecia no Q&A. Grava em `discoveredEmbeddings` (somando ao que já havia;
   * no Ollama, trocando — é a lista do que está instalado) e reconstrói o
   * registro. Só os providers que o RAG usa; nunca lança —
   * embedding é o extra da busca, não o motivo dela.
   */
  async scanEmbeddings(providerId: string): Promise<string[]> {
    if (!EMBEDDING_PROVIDERS.includes(providerId)) return [];
    const p = getProvider(providerId) as {
      listEmbeddingModels?: (credential: string) => Promise<string[]>;
    };
    if (!p.listEmbeddingModels) return [];
    const desde = this.settings.ollamaEndpoint;
    let ids: string[] = [];
    try {
      ids = await p.listEmbeddingModels(this.providerCredential(providerId));
    } catch {
      return [];
    }
    // Ollama: uma resposta do endereço de antes não troca a lista deste.
    if (providerId === "ollama" && this.settings.ollamaEndpoint !== desde) return [];
    const map = this.settings.discoveredEmbeddings ?? {};
    if (providerId === "ollama") {
      // O Ollama responde com o que está INSTALADO: o que saiu dele sai
      // daqui também (somar deixaria um embedding apagado na lista do Q&A).
      // Menos o que o Q&A está USANDO: sem o registro dele, o modelo vira
      // desconhecido, e um id desconhecido cai no embedding padrão — que é
      // da OpenAI. As notas iriam pra nuvem sem ninguém ter pedido.
      const emUso = [
        this.settings.ragEmbeddingProvider === "ollama" ? this.settings.ragEmbeddingModel : "",
        this.vectorIndex?.provider === "ollama" ? this.vectorIndex.model : "",
      ].filter((m) => m && !ids.includes(m));
      const novo = [...ids, ...new Set(emUso)];
      const antes = map.ollama ?? [];
      if (antes.length === novo.length && antes.every((m) => novo.includes(m))) return ids;
      map.ollama = novo;
    } else {
      // Dos de nuvem, soma: um modelo some do /models por um dia e volta.
      if (ids.length === 0) return [];
      map[providerId] = somarDescobertos(map[providerId], ids);
    }
    this.settings.discoveredEmbeddings = map;
    this.refreshDiscoveredEmbeddings();
    await this.saveSettings();
    return ids;
  }

  /** Atualiza a lista de grátis do provider. Silencioso: não saber quais são
   *  é pior que a lista velha, mas não é motivo pra derrubar o SCAN. */
  async scanFreeModels(providerId: string): Promise<void> {
    const p = getProvider(providerId);
    if (!p.listFreeModels) return;
    try {
      const livres = await p.listFreeModels(
        this.providerCredential(providerId)
      );
      const cota = p.freeQuota
        ? await p.freeQuota(this.providerCredential(providerId))
        : null;
      if (cota) (this.settings.freeQuota ??= {})[providerId] = { ...cota, at: Date.now() };
      if (livres.length) {
        (this.settings.freeModels ??= {})[providerId] = livres;
        definirGratisConhecidos(providerId, livres);
      }
      if (cota || livres.length) await this.saveSettings();
    } catch (err) {
      console.error("[axxa] não consegui listar os modelos grátis:", err);
    }
  }

  /**
   * Indexa (ou reindexa) o vault pro RAG. É INCREMENTAL: só re-embeda o que
   * mudou desde a última vez, que é o que faz "atualizar" caber num botão.
   *
   * Mora aqui, e não na aba de settings onde nasceu, porque agora tem dois
   * chamadores — a linha do índice na home e o botão das settings — e a
   * segunda cópia divergiria na primeira mudança de opção de embedding.
   *
   * Chamar de novo enquanto roda CANCELA: é o mesmo botão, e um segundo
   * índice rodando por cima do primeiro gastaria tokens duas vezes pelo mesmo
   * resultado.
   */
  async runVaultIndex(): Promise<void> {
    if (this.indexing) {
      this.indexing.abort();
      return;
    }
    const s = this.settings;
    this.indexing = new AbortController();
    this.notifyListeners();
    const notice = new Notice(tr("Indexing vault…"), 0);
    try {
      this.vectorIndex = await indexVault(this.vectorIndex, {
        app: this.app,
        openaiApiKey: s.openaiApiKey,
        openrouterApiKey: s.openrouterApiKey,
        geminiApiKey: s.geminiApiKey,
        nimApiKey: s.nimApiKey,
        ollamaEndpoint: s.ollamaEndpoint,
        model: s.ragEmbeddingModel,
        profile: s.ragQuantProfile,
        indexPath: s.ragIndexPath,
        // O índice e as conversas ficam de fora: indexar o que o app escreve
        // faria o vault responder com as próprias respostas.
        excludePaths: [s.ragIndexPath, s.chatsPath],
        shardSize: s.ragStreamShards ? RAG_SHARD_SIZE : 0,
        signal: this.indexing.signal,
        onProgress: (p) => {
          const n = {
            done: p.filesEmbedded,
            total: p.filesToEmbed,
            chunks: p.chunksEmbedded,
          };
          notice.setMessage(
            p.phase === "scanning"
              ? tr("Indexing (scanning): {done}/{total} files · {chunks} chunks", n)
              : p.phase === "embedding"
                ? tr("Indexing (embedding): {done}/{total} files · {chunks} chunks", n)
                : tr("Indexing (done): {done}/{total} files · {chunks} chunks", n)
          );
        },
      });
      notice.hide();
      const trechos = this.vectorIndex.size;
      new Notice(
        trechos === 1
          ? tr("Index ready: 1 chunk.")
          : tr("Index ready: {n} chunks.", { n: trechos })
      );
    } catch (err) {
      notice.hide();
      if (err instanceof DOMException && err.name === "AbortError") {
        new Notice(tr("Indexing cancelled."));
      } else {
        console.error("[axxa] indexVault falhou:", err);
        new Notice(
          tr("Indexing failed: {error}", {
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    } finally {
      this.indexing = null;
      // Avisa a tela: o número de trechos mudou, e quem o mostra precisa
      // saber. Indexar não mexe em settings, então não há saveSettings pra
      // disparar isso sozinho.
      this.notifyListeners();
    }
  }

  /**
   * `axxa-has-navbar` no body enquanto a navbar global do celular estiver NO
   * DOM. Substitui um `body:has(.mobile-navbar)` no CSS — a regra que dá ao
   * composer a folga acima dessa barra — e tem o mesmo valor de verdade que
   * ele tinha: presença no DOM, não visibilidade.
   *
   * O Obsidian tira a navbar de três jeitos, e só um passa por aqui:
   *   - teclado aberto / toolbar de edição: ele a DESANEXA (`detach()`) e
   *     depois a põe de volta no `.app-container`. Esse é o que o observador
   *     vê — e o `:has` antigo também só via esse;
   *   - tela cheia automática ao rolar (celular): ele NÃO desanexa, põe
   *     `is-hidden-nav` no body e a esconde por CSS. Quem trata esse caso é o
   *     `:not(.is-hidden-nav)` do seletor, não esta classe;
   *   - tablet: ela fica no DOM com `display: none` pelo app.css.
   * Ela é filha direta do `.app-container`, então observar só a lista de
   * filhos dele basta; o MutationObserver roda antes da próxima pintura.
   *
   * Chamado no onload, e não no onLayoutReady: o Obsidian cria a navbar e o
   * `.app-container` ANTES de carregar qualquer plugin, então a classe já
   * existe quando a nossa view for restaurada — como o `:has` existia. No
   * onLayoutReady ela chegaria alguns ticks depois da primeira pintura.
   *
   * No nível do plugin, e não da view: o body é um só, e com duas views
   * abertas o onClose de uma tiraria a classe da outra.
   */
  private observarNavbar(): void {
    if (!Platform.isMobile) return;
    const doc = activeDocument;
    const sync = () =>
      doc.body.toggleClass(
        "axxa-has-navbar",
        doc.body.querySelector(".mobile-navbar") !== null
      );
    const obs = new MutationObserver(sync);
    const host = doc.body.querySelector(".app-container");
    if (host) obs.observe(host, { childList: true });
    sync();
    this.register(() => {
      obs.disconnect();
      doc.body.removeClass("axxa-has-navbar");
    });
  }

  /**
   * O que o plugin lê do disco depois que a interface já está de pé.
   *
   * Separado do `onload` de propósito: ali dentro, cada `await` é atraso na
   * abertura do Obsidian inteiro — e isto aqui abre cache de modelos, varre a
   * pasta de skills e parseia o índice RAG.
   */
  private async carregarEmSegundoPlano(): Promise<void> {
    // Cache de specs dos modelos (Fetch info / OpenRouter) — hidrata o store.
    await this.loadModelInfoCache();

    // Embeddings descobertos (fetch anterior) → registro global do RAG.
    this.refreshDiscoveredEmbeddings();

    // Os grátis de verdade do último fetch → o painel de uso: custo zero só
    // pra eles (o NIM, por exemplo, não é grátis no resto).
    for (const [provider, ids] of Object.entries(this.settings.freeModels ?? {})) {
      definirGratisConhecidos(provider, ids);
    }

    // "Hot" dos modelos a partir do uso local — fire-and-forget (não bloqueia).
    void this.refreshLocalUsageHot();

    // A lista do Ollama que ainda é a de fábrica vira a do que ele tem
    // instalado — fire-and-forget: um Ollama fora de alcance não segura nada.
    void this.conferirOllama({ soDeFabrica: true });

    // Skills (.md na pasta de skills) → slash-commands no composer.
    await this.reloadSkills();

    await this.loadVectorIndex();
  }

  /**
   * Carrega o índice RAG da pasta das settings — no load e quando a pasta muda
   * nas settings. Sem índice lá, fica null: o Q&A cai na busca por palavra até
   * alguém indexar. Falhas são silenciosas — só significa que o user ainda não
   * rodou "Indexar vault".
   * No MOBILE, gateia por tamanho: um índice grande estoura o heap do WebView
   * e derruba o Obsidian no parse (OOM). Acima do teto, pula → keyword. v0.1.198
   */
  async loadVectorIndex(): Promise<void> {
    this.vectorIndex = null;
    try {
      const mobileGuard = Platform.isMobile
        ? {
            maxBytes: 16 * 1024 * 1024,
            onSkip: (mb: number) => {
              // Só avisa UMA vez por dispositivo — senão o Notice volta a cada
              // onload enquanto o índice continuar grande. v0.1.228
              if (this.settings.ragMobileSkipNoticeShown) return;
              new Notice(
                tr(
                  "RAG index too large for mobile ({mb} MB) — semantic search is off here to avoid a crash. Use desktop or shrink the index.",
                  { mb: mb.toFixed(0) }
                )
              );
              this.settings.ragMobileSkipNoticeShown = true;
              void this.saveSettings().catch((err) =>
                console.error("[axxa] não consegui persistir o flag do Notice RAG mobile:", err)
              );
            },
          }
        : undefined;
      this.vectorIndex = await loadIndex(
        this.app.vault.adapter,
        this.settings.ragIndexPath,
        mobileGuard
      );
    } catch (err) {
      console.error("[axxa] falha ao carregar índice RAG:", err);
    }
  }

  /** Inscreve um callback chamado a cada saveSettings. Retorna unsubscribe. */
  onSettingsChange(cb: () => void): () => void {
    this.settingsListeners.add(cb);
    return () => this.settingsListeners.delete(cb);
  }

  /** Notifica os listeners (re-render do React tree). */
  private notifyListeners(): void {
    this.settingsListeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error("[axxa] settings listener falhou:", err);
      }
    });
  }

  /**
   * Reconstrói o registro global de embeddings descobertos a partir dos ids
   * salvos em settings.discoveredEmbeddings (infere spec de cada um). Chamado
   * no load e após cada "Buscar da API". v0.1.151
   */
  refreshDiscoveredEmbeddings(): void {
    const specs: EmbeddingModelSpec[] = [];
    const map = this.settings.discoveredEmbeddings ?? {};
    for (const [provider, ids] of Object.entries(map)) {
      // Só providers que o RAG suporta como fonte de embedding.
      if (!EMBEDDING_PROVIDERS.includes(provider)) continue;
      for (const id of ids) {
        specs.push(inferEmbeddingSpec(provider as EmbeddingProvider, id));
      }
    }
    registerDiscoveredEmbeddings(specs);
  }

  /**
   * Coleta o uso LOCAL (nº de chats por modelo) e alimenta o "hot" do
   * dataCollect. Best-effort — nunca quebra o load. Sem telemetria: é só o
   * seu próprio histórico, no device. v0.1.152
   */
  async refreshLocalUsageHot(): Promise<void> {
    try {
      const chats = await this.loadChatSummaries();
      const byModel: Record<string, number> = {};
      for (const c of chats) {
        if (c.model) byModel[c.model] = (byModel[c.model] ?? 0) + 1;
      }
      registerLocalUsage(byModel);
    } catch (err) {
      console.error("[axxa] refreshLocalUsageHot falhou:", err);
    }
  }

  /** (Re)carrega os skills da pasta e re-renderiza. v0.1.139 */
  async reloadSkills(): Promise<void> {
    try {
      this.skills = await loadSkills(this.app, this.settings.skillsPath);
    } catch (err) {
      console.error("[axxa] reloadSkills falhou:", err);
      this.skills = [];
    }
    this.notifyListeners();
  }

  /** Cria os skills de exemplo (se faltarem) + recarrega. Retorna nº criados. */
  async seedExampleSkills(): Promise<number> {
    const n = await seedExampleSkills(this.app, this.settings.skillsPath);
    await this.reloadSkills();
    return n;
  }

  /** Caminho do cache de specs dos modelos (JSON no diretório do plugin). */
  private modelInfoCachePath(): string {
    // A pasta de configuração NÃO é necessariamente `.obsidian` — quem usa
    // pode renomear. `vault.configDir` devolve a de verdade.
    const dir =
      this.manifest.dir ??
      `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    return `${dir}/modelInfoCache.json`;
  }

  /** Lê o cache de specs do disco e hidrata o store em memória. v0.1.130 */
  private async loadModelInfoCache(): Promise<void> {
    try {
      const path = this.modelInfoCachePath();
      if (await this.app.vault.adapter.exists(path)) {
        const raw = await this.app.vault.adapter.read(path);
        hydrateModelInfoCache(
          JSON.parse(raw) as Parameters<typeof hydrateModelInfoCache>[0]
        );
      }
    } catch (err) {
      console.error("[axxa] falha ao carregar modelInfoCache:", err);
    }
  }

  /** Persiste o cache de specs no disco (chamado após Fetch info). */
  async saveModelInfoCache(): Promise<void> {
    try {
      await this.app.vault.adapter.write(
        this.modelInfoCachePath(),
        JSON.stringify(getModelInfoCache(), null, 2)
      );
    } catch (err) {
      console.error("[axxa] falha ao salvar modelInfoCache:", err);
    }
  }

  /**
   * Busca specs do modelo via OpenRouter (Fetch info) e persiste no cache.
   * Retorna a info enriquecida ou null se não houve correspondência.
   */
  async fetchModelInfo(
    provider: string,
    model: string
  ): Promise<EnrichedModelInfo | null> {
    const info = await fetchAndCacheModelInfo(provider, model);
    if (info) await this.saveModelInfoCache();
    return info;
  }

  async onload() {
    await this.loadSettings();

    // Antes de QUALQUER coisa ler conversa: se os arquivos ainda estão na
    // pasta antiga, é aqui que eles mudam de lugar. Depois disso o resto do
    // app já encontra tudo no caminho novo.
    await this.migrarParaPastaOculta();

    // ── REGISTRO: o que o Obsidian precisa saber agora ──────────────────
    // Nada aqui toca o disco. O que lê arquivo foi pro onLayoutReady, lá
    // embaixo: `onload` roda ANTES do Obsidian montar a interface, então tudo
    // que espera aqui é tempo que todo mundo passa olhando tela vazia — e o
    // índice RAG sozinho pode ser dezesseis megabytes de JSON pra parsear.

    // Registra a view na sidebar direita.
    // É como registrar um componente custom no design system — depois pode ser instanciado.
    this.registerView(
      VIEW_TYPE_AXXA,
      (leaf) => new AxxaView(leaf, this)
    );

    // Os [[links]] das respostas mostram a prévia da nota ao passar o mouse,
    // como os de uma nota (o "Page preview" lista a fonte e o atalho).
    this.registerHoverLinkSource(FONTE_DO_HOVER, {
      display: "AXXA Agent",
      defaultMod: true,
    });

    // Ícone na ribbon (sidebar esquerda do Obsidian).
    this.addRibbonIcon("bot", "AXXA Agent", () => {
      void this.activateView();
    });

    // Comando para abrir via Command Palette (Ctrl/Cmd + P).
    // Logos dos providers como ícones do Obsidian (setIcon("logo-openai")…).
    registerBrandLogos();

    // O Obsidian já prefixa o comando com o nome do plugin na paleta, então
    // "Open AXXA Agent" viraria "AXXA Agent: Open AXXA Agent".
    this.addCommand({
      id: "open-panel",
      name: tr("Open panel"),
      callback: () => this.activateView(),
    });

    // O AXXA a partir da nota: comandos (perguntar, resumir, reescrever,
    // corrigir, traduzir, continuar) e o clique direito no texto e na nota.
    registrarComandosDoEditor(this);

    // Settings tab — aparece em Settings -> Community Plugins -> AXXA Agent.
    this.settingsTab = new AxxaSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    // Auto-reindex do RAG (opt-in) — re-embeda notas modificadas em background
    this.setupAutoReindex();

    // Skills editadas no vault recarregam sozinhas (SKL-03)
    this.setupSkillsWatcher();

    // A navbar do celular já existe a esta altura (o Obsidian a cria antes dos
    // plugins), e a classe que ela liga tem de estar lá antes da view pintar.
    this.observarNavbar();

    // ── CARGA: o que pode chegar depois ─────────────────────────────────
    // `onLayoutReady` dispara quando a interface do Obsidian já está de pé.
    // A UI não perde nada por esperar: ela assina `onSettingsChange`, e
    // `reloadSkills` notifica ao terminar; o índice é lido na hora da busca,
    // e até chegar a busca cai em keyword, que é o comportamento de quem
    // ainda não indexou.
    this.app.workspace.onLayoutReady(() => {
      void this.carregarEmSegundoPlano();
    });

    // O livro do dia: todo pedido de chat a um provider soma ali (ver
    // providers/index.ts). Grava agrupado — um gravar por resposta seria
    // um data.json reescrito a cada mensagem.
    definirAnotadorDeUso((provider, model, delta) => this.anotarUso(provider, model, delta));
    definirGuardaDeGasto((provider, model) => this.conferirLimiteDeGasto(provider, model));

    // NÃO auto-abrimos o painel no startup — o Obsidian abre "normal". O AI
    // Agent abre sob demanda pela ribbon (ícone do robô) ou pelo comando
    // "Abrir AI Agent". Se o painel estava aberto ao fechar o Obsidian, o
    // próprio Obsidian restaura o layout — respeitando o que o usuário deixou.
  }

  /** Soma um pedido (ou os tokens dele) no livro do dia e agenda a gravação. */
  anotarUso(provider: string, model: string, delta: { r?: number; i?: number; o?: number }): void {
    const agora = new Date();
    const livro = (this.settings.usoDoDia ??= {});
    const limite = this.settings.limiteGastoDiario ?? 0;
    // O gasto só anda com tokens; pedido sem token (o "aceito" do começo do
    // stream) não muda a conta, e não precisa recalcular nada.
    const conta = limite > 0 && ((delta.i ?? 0) > 0 || (delta.o ?? 0) > 0);
    const antes = conta ? gastoDeHoje(livro, agora).total : 0;
    lancar(livro, agora, provider, model, delta);
    podar(livro, agora);
    if (conta) {
      const depois = gastoDeHoje(livro, agora).total;
      for (const marco of marcosCruzados(antes, depois, limite)) this.avisarGasto(marco, depois, limite);
    }
    if (this.usoTimer !== null) return;
    this.usoTimer = window.setTimeout(() => {
      this.usoTimer = null;
      void this.saveSettings();
    }, 5000);
  }

  private usoTimer: number | null = null;

  /** O aviso de quando o gasto do dia cruza 80% e 100% do limite. */
  private avisarGasto(marco: 80 | 100, gasto: number, limite: number): void {
    const valores = { limit: usd(limite), spent: usd(gasto) };
    if (marco === 80) {
      new Notice(tr("You've used 80% of today's {limit} spending limit ({spent}).", valores), 8000);
      return;
    }
    new Notice(
      this.settings.travarNoLimite
        ? tr(
            "Today's {limit} spending limit is reached ({spent}). Paid models pause until midnight; free and local ones still work.",
            valores
          )
        : tr(
            "Today's {limit} spending limit is reached ({spent}). Turn on “Stop paid models at the limit” in settings to pause them.",
            valores
          ),
      12000
    );
  }

  /**
   * A guarda dos pedidos (ver usage/anotador.ts): com o limite batido e a
   * trava ligada, modelo PAGO não sai. Grátis, local e sem preço público
   * passam — do último, o plugin não sabe o custo, e barrar às cegas seria
   * pior que avisar.
   */
  conferirLimiteDeGasto(provider: string, model: string): void {
    const s = this.settings;
    const limite = s.limiteGastoDiario ?? 0;
    if (!(limite > 0) || !s.travarNoLimite || !ehPago(provider, model)) return;
    const { total } = gastoDeHoje(s.usoDoDia ?? {}, new Date());
    if (total < limite) return;
    throw new ProviderError(
      tr(
        "Today's {limit} spending limit is reached ({spent} spent), so paid models are paused until midnight. Free and local models still work, or raise the limit in Settings › Chat › Daily spending.",
        { limit: usd(limite), spent: usd(total) }
      ),
      "unknown"
    );
  }

  onunload() {
    definirAnotadorDeUso(null);
    definirGuardaDeGasto(null);
    // As cópias do Undo do agente não sobrevivem ao plugin (ver agent/undo.ts).
    esquecerDesfazeres();
    esquecerPedidos();
    // O que o livro anotou e ainda não gravou não se perde ao sair.
    if (this.usoTimer !== null) {
      window.clearTimeout(this.usoTimer);
      this.usoTimer = null;
      void this.saveSettings();
    }
    // Cancela timers/abort pendentes pra não vazar entre reloads (v0.1.228)
    if (this.autoReindexTimer !== null) {
      window.clearTimeout(this.autoReindexTimer);
      this.autoReindexTimer = null;
    }
    if (this.chatIndexWriteTimer !== null) {
      window.clearTimeout(this.chatIndexWriteTimer);
      this.chatIndexWriteTimer = null;
    }
    if (this.skillsReloadTimer !== null) {
      window.clearTimeout(this.skillsReloadTimer);
      this.skillsReloadTimer = null;
    }
    this.autoReindexController?.abort();
    this.autoReindexController = null;
  }

  /**
   * Auto-reindex do RAG (opt-in via settings.ragAutoReindex). Quando uma nota
   * .md muda / é criada / deletada / renomeada, agenda um reindex incremental
   * debounced (4s — só re-embeda o que mudou via hash). Só roda se JÁ existe
   * índice (não cria do nada). Desligado por padrão porque re-embed custa $.
   */
  private setupAutoReindex() {
    // Listeners ficam sempre registrados (leves — só checam um if); o `schedule`
    // consulta o setting em runtime → o toggle nas Settings vale na hora, sem
    // precisar reativar o plugin.
    const schedule = (file: TAbstractFile) => {
      if (!this.settings.ragAutoReindex) return;
      if (!this.vectorIndex || this.vectorIndex.size === 0) return;
      if (!file?.path || !file.path.endsWith(".md")) return;
      if (this.autoReindexTimer !== null) {
        window.clearTimeout(this.autoReindexTimer);
      }
      this.autoReindexTimer = window.setTimeout(
        () => void this.runAutoReindex(),
        4000
      );
    };

    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.vault.on("rename", schedule));
  }

  /**
   * Hot reload das skills (SKL-03). Criar/editar/renomear/apagar um .md dentro
   * de settings.skillsPath recarrega a lista sozinho — antes o autor editava a
   * skill e o /comando continuava com o corpo velho até reabrir o Obsidian.
   *
   * Debounce de 600ms: salvar no Obsidian dispara `modify` em rajada, e ler a
   * pasta inteira a cada tecla seria desperdício. O rename entrega o caminho
   * ANTIGO no 2º argumento — checa os dois pra pegar a saída da pasta também.
   */
  private setupSkillsWatcher() {
    const schedule = (file: TAbstractFile, oldPath?: string) => {
      const path = file?.path ?? "";
      const inFolder =
        isSkillFilePath(path, this.settings.skillsPath) ||
        (!!oldPath && isSkillFilePath(oldPath, this.settings.skillsPath));
      if (!inFolder) return;
      if (this.skillsReloadTimer !== null) {
        window.clearTimeout(this.skillsReloadTimer);
      }
      this.skillsReloadTimer = window.setTimeout(() => {
        this.skillsReloadTimer = null;
        void this.reloadSkills();
      }, 600);
    };

    this.registerEvent(this.app.vault.on("modify", (f) => schedule(f)));
    this.registerEvent(this.app.vault.on("create", (f) => schedule(f)));
    this.registerEvent(this.app.vault.on("delete", (f) => schedule(f)));
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => schedule(f, oldPath))
    );
  }

  /** Reindex incremental em background (re-embeda só o que mudou via hash). */
  private async runAutoReindex() {
    this.autoReindexTimer = null;
    if (!this.settings.ragAutoReindex) return;
    if (!this.vectorIndex || this.vectorIndex.size === 0) return;

    // Cancela um reindex anterior ainda em andamento
    this.autoReindexController?.abort();
    this.autoReindexController = new AbortController();

    try {
      this.vectorIndex = await indexVault(this.vectorIndex, {
        app: this.app,
        openaiApiKey: this.settings.openaiApiKey,
        openrouterApiKey: this.settings.openrouterApiKey,
        geminiApiKey: this.settings.geminiApiKey,
        nimApiKey: this.settings.nimApiKey,
        ollamaEndpoint: this.settings.ollamaEndpoint,
        model: this.settings.ragEmbeddingModel,
        profile: this.settings.ragQuantProfile,
        indexPath: this.settings.ragIndexPath,
        excludePaths: [
          this.settings.ragIndexPath,
          this.settings.chatsPath,
        ],
        shardSize: this.settings.ragStreamShards ? RAG_SHARD_SIZE : 0,
        signal: this.autoReindexController.signal,
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("[axxa] auto-reindex falhou:", err);
      }
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_AXXA);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      // getRightLeaf(false) pode retornar null (sem split direito disponível);
      // força a criação como fallback pra view não falhar em silêncio. v0.1.228
      leaf = workspace.getRightLeaf(false) ?? workspace.getRightLeaf(true);
      await leaf?.setViewState({ type: VIEW_TYPE_AXXA, active: true });
    }

    if (leaf) void workspace.revealLeaf(leaf);
    else {
      new Notice(tr("Couldn't open the AXXA panel — try toggling the right sidebar."));
    }
  }

  /** Campos de chave de API que NÃO ficam em plaintext no data.json — vão pro
   *  SecretStorage do SO (keychain), conforme guideline do Obsidian (1.11.4+).
   *  `ollamaEndpoint` NÃO entra aqui: é uma URL local, não um segredo. */
  private static readonly SECRET_FIELDS = [
    "openaiApiKey",
    "anthropicApiKey",
    "geminiApiKey",
    "openrouterApiKey",
    "nimApiKey",
    // A da ElevenLabs faltava aqui até a 0.9.13: ia em texto puro pro
    // data.json, que mora dentro do vault — e o vault sincroniza (Sync,
    // iCloud, git). Entrando na lista, o loadSecrets a migra pro keychain no
    // próximo carregamento, pelo mesmo caminho das outras. O teste
    // tests/secretFields.test.ts impede uma chave nova de ficar de fora.
    "elevenApiKey",
    "tavilyApiKey",
  ] as const;

  /** ID do segredo no SecretStorage (lowercase + dashes). Ex: axxa-openai-key. */
  private secretId(field: string): string {
    return `axxa-${field.replace(/ApiKey$/, "")}-key`;
  }

  /**
   * True quando o `data.json` EXISTE mas veio ilegível. Enquanto isso valer,
   * `saveSettings` se recusa a gravar: o que está na memória são os PADRÕES, e
   * gravá-los por cima transforma uma leitura falha numa perda permanente.
   */
  private settingsUnsafe = false;
  /** Já avisei que a gravação das settings está falhando? Zera quando volta a
   *  gravar — senão o aviso vira parede numa falha que persiste. */
  private avisoDeSaveDado = false;

  /** Caminho do arquivo de settings do plugin. */
  private dataPath(nome = "data.json"): string {
    // A pasta de configuração NÃO é necessariamente `.obsidian` — quem usa
    // pode renomear. `vault.configDir` devolve a de verdade.
    const dir =
      this.manifest.dir ??
      `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    return `${dir}/${nome}`;
  }

  /**
   * Cópia de segurança das settings, reescrita a cada carga bem-sucedida.
   *
   * É uma linha de código contra um estrago que não tem volta: quem perde o
   * `data.json` perde chaves, modelos, providers e projetos, e não há de onde
   * tirar isso de novo — as conversas sobrevivem (são .md no vault), as
   * configurações não.
   */
  private async backupSettings(bruto: string): Promise<void> {
    try {
      if (bruto.trim().length > 2) {
        await this.app.vault.adapter.write(this.dataPath("data.backup.json"), bruto);
      }
    } catch (err) {
      console.error("[axxa] backup das settings falhou:", err);
    }
  }

  async loadSettings() {
    // loadData() lê do arquivo do plugin no vault — substitui localStorage.
    // loadData() devolve `any`; o arquivo é do usuário e pode estar em
    // qualquer estado, então a forma declarada é "pedaço de AxxaSettings".
    const saved = ((await this.loadData()) ?? {}) as Partial<AxxaSettings>;

    // `loadData` devolve null tanto pra "primeira instalação" quanto pra
    // "o arquivo está lá e não deu pra ler" (JSON quebrado, escrita
    // interrompida). São coisas MUITO diferentes: no primeiro caso os padrões
    // são a resposta certa; no segundo, gravar os padrões apaga tudo que a
    // pessoa configurou. Então a diferença é checada, não presumida.
    if (Object.keys(saved).length === 0) {
      try {
        const caminho = this.dataPath();
        const existe = await this.app.vault.adapter.exists(caminho);
        const bruto = existe
          ? (await this.app.vault.adapter.read(caminho)).trim()
          : "";
        {
          if (
            settingsReadLooksBroken({
              chavesLidas: 0,
              arquivoExiste: existe,
              tamanhoBruto: bruto.length,
            })
          ) {
            this.settingsUnsafe = true;
            console.error(
              "[axxa] data.json existe mas não foi lido — settings NÃO serão gravadas até reiniciar."
            );
            // O idioma escolhido mora justamente no arquivo que não deu pra
            // ler: o aviso sai no do Obsidian ("auto"), o melhor palpite.
            definirIdiomaDaInterface(resolverIdioma(DEFAULT_SETTINGS.language));
            new Notice(
              tr(
                "AXXA: couldn't read your settings file. Nothing will be overwritten — restart Obsidian, and check data.backup.json next to it if needed."
              ),
              15000
            );
          }
        }
      } catch (err) {
        console.error("[axxa] checagem do data.json falhou:", err);
      }
    } else {
      void this.backupSettings(JSON.stringify(saved, null, 2));
    }

    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    // O idioma volta a ser escolha (0.7.14): a linha que forçava "en-us" aqui
    // era de quando o PT-BR tinha saído do dicionário. Com os dois de volta,
    // ela apagava a escolha da pessoa a cada carregamento — e nada na tela
    // explicaria por quê. Um valor que não conhecemos cai no inglês na hora de
    // traduzir (ver i18n/index.ts), então não precisa ser consertado aqui.
    if (!LOCALES.some((l) => l.id === this.settings.language))
      this.settings.language = "auto";
    definirIdiomaDaInterface(resolverIdioma(this.settings.language));
    // O Ollama não vem mais ligado de fábrica. Quem herdou o endereço padrão
    // gravado e nunca usou o Ollama volta pro vazio — uma vez só: a marca vai
    // pro disco na próxima gravação, e daí um localhost digitado de propósito
    // fica.
    // Compara com a fábrica ANTIGA: é ela que está gravada em quem herdou.
    const ollama = revisarOllamaPadrao(saved, FABRICA_ATE_0923);
    if (ollama !== null) this.settings.ollamaEndpoint = ollama;
    this.settings.ollamaPadraoRevisto = true;
    // Object.assign é shallow — pra activeModels (Record por provider),
    // mescla por provider: providers não tocados pelo user mantêm defaults.
    this.settings.activeModels = {
      ...DEFAULT_SETTINGS.activeModels,
      ...(saved.activeModels ?? {}),
    };
    this.settings.discoveredEmbeddings = saved.discoveredEmbeddings ?? {};
    // ★ por papel e provider preferido: da casca antiga, nada lê (ver
    // core/settingsLegado.ts). A revisão do Ollama acima já leu o `saved`.
    limparCamposMortos(this.settings);
    // Same pra effortConfigs — preserva overrides salvos do usuário.
    this.settings.effortConfigs = saved.effortConfigs ?? {};

    // Chaves de API: carrega do SecretStorage do SO (keychain), não do
    // data.json. Migra chaves legadas que ainda estejam em plaintext.
    this.loadSecrets(saved);
  }

  /**
   * Leva o que o app criou pra dentro da pasta oculta, UMA vez.
   *
   * Move de verdade — copia, confere e só então apaga a origem. O contrário
   * (apagar antes) transforma qualquer falha de escrita em conversa perdida,
   * e conversa é a única coisa aqui que não se refaz.
   *
   * Roda em silêncio quando não há nada a fazer, que é o caso de toda
   * instalação nova.
   */
  private async migrarParaPastaOculta(): Promise<void> {
    if (this.settingsUnsafe) return;
    const ad = this.app.vault.adapter;
    let mudou = false;
    for (const mv of HIDDEN_MOVES) {
      const atual =
        mv.legado === "axxa-ai/chats"
          ? this.settings.chatsPath
          : this.settings.ragIndexPath;
      const podeIr = shouldMigrate({
        caminhoAtual: atual,
        legado: mv.legado,
        novo: mv.novo,
        origemExiste: await ad.exists(mv.legado),
        destinoExiste: await ad.exists(mv.novo),
      });
      // O caminho pode já ser o novo (instalação nova) — nada a fazer, e
      // também nada a avisar.
      if (!podeIr) continue;
      try {
        await this.moverPasta(mv.legado, mv.novo);
        if (mv.legado === "axxa-ai/chats") this.settings.chatsPath = mv.novo;
        else this.settings.ragIndexPath = mv.novo;
        mudou = true;
      } catch (err) {
        // Falhou? A origem continua lá, intacta, e o caminho não muda: o app
        // segue lendo de onde sempre leu.
        console.error(`[axxa] migração de ${mv.legado} falhou:`, err);
      }
    }
    if (mudou) {
      await this.saveSettings();
      new Notice(
        tr(
          "AXXA moved its files into a hidden .axxa folder — your chats are out of the vault's search and file list now."
        ),
        10000
      );
    }
  }

  /** Copia recursivamente de → para, conferindo cada arquivo antes de apagar
   *  o original. Devolve quantos arquivos foram. */
  private async moverPasta(de: string, para: string): Promise<number> {
    const ad = this.app.vault.adapter;
    if (!(await ad.exists(para))) await ad.mkdir(para);
    const listing = await ad.list(de);
    let n = 0;
    for (const sub of listing.folders) {
      n += await this.moverPasta(sub, `${para}/${sub.split("/").pop()}`);
    }
    for (const arq of listing.files) {
      const nome = arq.split("/").pop() as string;
      const destino = `${para}/${nome}`;
      // Binário serve pra tudo: o .md passa intacto e o shard do índice
      // também, sem depender de encoding.
      const dados = await ad.readBinary(arq);
      await ad.writeBinary(destino, dados);
      if (!(await ad.exists(destino))) {
        throw new Error(`não consegui escrever ${destino}`);
      }
      await ad.remove(arq);
      n += 1;
    }
    // A pasta vazia sai por último, e só se esvaziou mesmo.
    const sobrou = await ad.list(de);
    if (sobrou.files.length === 0 && sobrou.folders.length === 0) {
      await ad.rmdir(de, false);
    }
    return n;
  }

  /** Popula as chaves em memória a partir do SecretStorage e migra o legado
   *  (chaves que ainda estavam em plaintext no data.json de versões antigas). */
  private loadSecrets(saved: Record<string, unknown>) {
    const ss = this.app.secretStorage;
    if (!ss) return; // runtime < 1.11.4 (sideload): mantém fallback no data.json
    let migrated = false;
    for (const f of AxxaPlugin.SECRET_FIELDS) {
      const id = this.secretId(f);
      const stored = ss.getSecret(id);
      if (stored) {
        this.settings[f] = stored;
      } else if (typeof saved[f] === "string" && saved[f]) {
        // Legado: chave em plaintext no data.json → move pro keychain do SO.
        ss.setSecret(id, saved[f]);
        this.settings[f] = saved[f];
        migrated = true;
      }
    }
    // Reescreve o data.json já sem as chaves em plaintext. Fire-and-forget
    // (não dá pra await aqui — loadSecrets é chamado no fim do loadSettings),
    // mas encadeia um .catch pra não engolir falha de IO em silêncio. v0.1.228
    // Mesma trava do saveSettings: a migração também grava o arquivo inteiro,
    // e com a leitura falha o "arquivo inteiro" é o padrão de fábrica.
    if (migrated && !this.settingsUnsafe) {
      void this.saveData(this.persistableSettings()).catch((err) =>
        console.error("[axxa] migração de secrets (saveData) falhou:", err)
      );
    }
  }

  /** Cópia das settings com as chaves zeradas — é isso que vai pro data.json
   *  (os valores reais vivem só em memória + no SecretStorage do SO). */
  private persistableSettings(): AxxaSettings {
    const copy = { ...this.settings };
    for (const f of AxxaPlugin.SECRET_FIELDS) copy[f] = "";
    return copy;
  }

  /**
   * Grava as settings — e, se a gravação falhar, DIZ.
   *
   * A maior parte das chamadas é `void this.saveSettings()`: quem mexeu num
   * interruptor não espera o disco. Sete desses pontos não tinham `catch`
   * nenhum, então disco cheio, pasta sincronizada travada ou permissão negada
   * davam no mesmo: a configuração não gravava, a tela não mudava, e na
   * abertura seguinte a mudança tinha sumido. Perda silenciosa de dado — a
   * mesma doença que a lixeira do agente resolveu, num lugar mais barato.
   *
   * O tratamento fica AQUI, e não espalhado em sete `.catch`, porque a decisão
   * é uma só: avisar. Um catch por chamador seria a mesma frase escrita sete
   * vezes, e a oitava esqueceria.
   */
  async saveSettings() {
    // Leitura falhou: o que está na memória é o padrão de fábrica, não o que a
    // pessoa configurou. Gravar aqui é apagar de verdade.
    if (this.settingsUnsafe) {
      console.error("[axxa] saveSettings bloqueado: as settings não foram lidas.");
      return;
    }
    try {
      const ss = this.app.secretStorage;
      if (ss) {
        // Chaves vão pro SecretStorage; data.json é salvo sem elas.
        for (const f of AxxaPlugin.SECRET_FIELDS) {
          ss.setSecret(this.secretId(f), this.settings[f] ?? "");
        }
        await this.saveData(this.persistableSettings());
      } else {
        // Fallback (runtime sem SecretStorage): salva tudo no data.json.
        await this.saveData(this.settings);
      }
      this.avisoDeSaveDado = false;
    } catch (err) {
      console.error("[axxa] não consegui gravar as settings:", err);
      // UMA vez por sequência de falhas: se o disco está cheio, cada
      // interruptor tocado dispararia um aviso e a tela viraria uma parede de
      // avisos sobre o mesmo problema. Volta a avisar depois de uma gravação
      // que deu certo — aí é um problema novo.
      if (!this.avisoDeSaveDado) {
        this.avisoDeSaveDado = true;
        new Notice(
          tr(
            "AXXA could not save your settings — the change is active now but will be lost when you reopen Obsidian. Check the vault's disk space and permissions."
          ),
          12000
        );
      }
      return;
    }
    // O idioma da interface muda ANTES de avisar: quem re-renderiza já pega
    // o texto novo.
    definirIdiomaDaInterface(resolverIdioma(this.settings.language));
    // Avisa quem tá escutando (ex.: AxxaApp pra re-renderizar com novo idioma)
    this.settingsListeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error("[axxa] settings listener falhou:", err);
      }
    });
  }
}

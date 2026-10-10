// src/ui/SettingsTab.ts
// Settings em ABAS, por classe de configuração — a lista corrida ficava longa
// demais no mobile e misturava coisas de natureza diferente (credencial,
// default de sessão, pasta do vault, índice, permissão).
//
//   Providers  → uma SUB-ABA por provider (chave/endpoint + modelo). São seis;
//                é o único lugar onde a segunda camada se paga.
//   Chat       → o que vale pra toda conversa nova.
//   Vault      → onde as coisas são gravadas.
//   Vault Q&A  → o índice e o que o alimenta.
//   Agent      → o que o agente pode fazer sem perguntar.
//   Mobile     → só aparece no celular.
//
// DUAS maneiras de chegar na tela, UMA árvore (ui/settings/tree.ts):
//
//   • Obsidian 1.13+: `getSettingDefinitions()` devolve a árvore e o Obsidian
//     desenha — cartões nativos, e toda linha entra na busca das settings.
//   • 1.11.4–1.12.x: não existe `getSettingDefinitions`; o `display()` desenha
//     a mesma árvore (ui/settings/legacy.ts).
//
// A barra de abas e o trilho de providers NÃO são páginas do Obsidian: trocar
// de aba só troca um atributo do container (`data-axxa-tab`), e o CSS esconde
// os grupos das outras abas. Nada é redesenhado, nada perde o foco — e a busca
// continua achando tudo, porque pra ela nenhuma linha está escondida.
//
// O que muda de texto ou de opções (a bolinha da conexão, o catálogo, a lista
// de vozes…) é uma linha VIVA (`slot`): ela guarda o próprio Setting e se
// redesenha no lugar. É o que troca o `update()` do 1.13 — que redesenharia a
// aba inteira e roubaria o foco do campo em que a pessoa está digitando.

import {
  App,
  getLanguage,
  Notice,
  Platform,
  PluginSettingTab,
  requireApiVersion,
  Setting,
  setIcon,
} from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type AxxaPlugin from "../main";
import {
  PROVIDERS,
  providerConfigured,
  providerHealth,
  type ProviderHealth,
} from "../core/providersMeta";
import { escolherAssistente, ehFree } from "../assistant/model";
import { getAllEmbeddingModels } from "../rag/types";
import { deleteIndex } from "../rag/vectorIndex";
import { getModelCapabilities } from "../providers/modelCapabilities";
import { freeTag, geminiTemTierGratis, gratisDeVerdade, type FreeTag } from "../usage/freeTag";
import { definirGeminiSemCobranca } from "../usage/pricing";
import { openaiFreeTierForModel } from "../usage/freeTokens";
import { buildModelCatalog, porFabricante, soltosPorFabricante } from "./modelCatalog";
import { PROVIDERS_MULTI_FABRICANTE } from "../providers/vendors";
import { prettyModelName } from "../providers/modelDescriptions";
import { speak, stopSpeaking, TTS_PROVIDERS, ttsReady } from "./readAloud";
import { fraseDaAmostra, idiomaDaAmostra } from "./settings/amostra";
import { elevenVoices } from "../providers/elevenlabs";
import { hapticsOn, setHapticsEnabled, tap } from "./haptics";
import { marcarPerigoso } from "./modals";
import {
  buildSettingsTree,
  nomeProprio,
  PROVIDER_FIELDS,
  tabsFor,
  type PickItem,
  type Place,
  type RowRender,
  type SettingsUi,
  type TabId,
} from "./settings/tree";
import { drawLegacyTree, type LegacyTree } from "./settings/legacy";
import {
  isControlKey,
  readControl,
  writeControl,
  type TextKey,
} from "./settings/values";
import { openActions } from "./menu";
import { modelLogo } from "../providers/modelLogo";
import { putThumb, seedThumb, thumbOf, type Thumb } from "./settings/thumb";
import { pendenciaDoIndice } from "./settings/indice";
import {
  EffortLevelModal,
  nivelEditado,
  resumoDoNivel,
} from "./settings/effortEditor";
import { EFFORT_ICONS, type EffortLevel } from "../core/effort";
import { localeDaInterface, marca, tr } from "../i18n/tr";

/** Favoritos aparecem na tela inicial; mais que isso vira lista, não atalho. */
export const FAVORITE_LIMIT = 5;

/** O que a bolinha do trilho quer dizer (vai no tooltip do item). Marcado
 *  aqui, traduzido no syncReady. */
const HEALTH_TEXT: Record<ProviderHealth, string> = {
  off: marca("no credential"),
  unknown: marca("not tested"),
  ok: marca("connected"),
  fail: marca("last test failed"),
};

/** O que a linha de conexão diz em cada estado (o tr() roda ao pintar). */
const CONN_TEXT: Record<string, (detail?: string) => string> = {
  unknown: () => tr("Not tested yet — hit Test to check the credential."),
  testing: () => tr("Talking to the provider…"),
  ok: (d) => tr("Connected. {detail}", { detail: d ?? "" }).trim(),
  fail: (d) => tr("Failed. {detail}", { detail: d ?? "" }).trim(),
};

/** Estado do teste de conexão. "unknown" = ainda não testou nesta sessão. */
interface ConnState {
  state: "unknown" | "testing" | "ok" | "fail";
  /** Quantos modelos o provider respondeu (ok) ou o erro (fail). */
  detail?: string;
}

/** Uma linha VIVA: guarda o próprio Setting e sabe se redesenhar no lugar. */
interface Slot {
  row: Setting;
  paint: (row: Setting) => void;
  /** A aba onde mora — trocar pra ela redesenha as linhas dela. */
  tab: TabId;
}

/** O método interno do 1.13 que acha a linha de um resultado da busca. */
interface DefinitionLookup {
  getElementForDefinition?: (def: unknown) => HTMLElement | null | undefined;
}

export class AxxaSettingsTab extends PluginSettingTab {
  /** Sobrevivem ao redesenho: reabrir as settings volta pra mesma aba. */
  private tab: TabId = "providers";
  private provider = "openai";
  /** Catálogo buscado no provider (não persiste — é sempre "o que há hoje"). */
  private catalog: Record<string, string[]> = {};
  /** Papel selecionado no filtro da lista de modelos ("all" = sem filtro). */
  private kind = "all";
  /** A ÚNICA seção de família aberta (`provider:papel:família`). Nascem todas
   *  fechadas: com sete classes abertas a lista volta a ser a rolagem sem fim
   *  que o agrupamento veio resolver. */
  private openFam: string | null = null;
  /** O fabricante aberto na lista (OpenRouter, NIM) — um por vez. */
  private openVendor: string | null = null;
  /** Resultado do último teste de conexão de cada provider (só na sessão). */
  private conn: Record<string, ConnState> = {};
  /** Provider cujo catálogo está sendo buscado agora (um de cada vez). */
  private fetchingFor: string | null = null;
  private fetchingVoices = false;
  /** O ▶ da voz que está tocando a amostra agora (ver tocarAmostra). */
  private amostra: HTMLButtonElement | null = null;
  /** O recarregamento do índice espera a digitação da pasta parar. */
  private timerDoIndice = 0;
  /** A busca do Ollama espera a digitação do endereço parar. */
  private timerDoOllama: number | null = null;
  private hapticsOff: (() => void) | null = null;

  /** As linhas vivas, por nome (ver `slot`). */
  private slots = new Map<string, Slot>();
  /** Linha/grupo da árvore → aba e provider: o pouso da busca. */
  private places = new WeakMap<object, Place>();
  /** O desenho do caminho antigo, quando é ele que está na tela. */
  private legacy: LegacyTree | null = null;

  // NÃO chamar de `navEl`: esse nome é do Obsidian — é o item da barra lateral
  // das settings que ele guarda em cada aba (openTab faz navEl.addClass
  // ("is-active"), e a lista lateral é remontada com os navEl). Até a 0.9.13
  // este campo se chamava assim e sobrescrevia o dele; no 1.13, zerado na
  // limpeza, reabrir as settings quebrava. tests/settingsTabFields.test.ts
  // impede a volta.
  private tabBarEl: HTMLElement | null = null;
  private blurbEl: HTMLElement | null = null;
  private railEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly plugin: AxxaPlugin
  ) {
    super(app, plugin);
    // Aparece nos resultados da busca das settings, ao lado de cada linha.
    this.icon = "bot";
    this.prepareRoot();
  }

  // ── os dois caminhos ──────────────────────────────────────────────────────

  /** 1.13+: a árvore, pro Obsidian desenhar e indexar. Lida uma vez, no
   *  `addSettingTab`; quem muda depois são as linhas vivas, não a árvore. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    try {
      return this.buildTree();
    } catch (err) {
      // Sem try/catch, um erro aqui derrubaria o `onload` do plugin inteiro
      // (o addSettingTab chama isto). Com a lista vazia, o 1.13 volta a
      // chamar o `display()`.
      console.error("[axxa] settings: a árvore falhou — a aba cai no display()", err);
      return [];
    }
  }

  /** 1.11.4–1.12.x (e o 1.13, se a árvore falhar): a MESMA árvore, por nós. */
  display(): void {
    this.desenharLegado();
  }

  /** O desenho do `display()`, chamável de dentro (a troca de idioma) sem
   *  passar pelo método que o 1.13 marca como obsoleto. */
  private desenharLegado(): void {
    this.legacy?.dispose();
    this.slots.clear();
    this.containerEl.empty();
    this.prepareRoot();
    this.legacy = drawLegacyTree(this.containerEl, this.buildTree(), {
      get: (key) => this.readValue(key),
      set: (key, value) => this.writeValue(key, value),
    });
  }

  /** A aba saiu da tela (fechou as settings, trocou de página, o "voltar" do
   *  Android): a amostra de uma voz para junto — o balão do ▶ some com o
   *  modal sem passar pelo `fechar` dele. */
  hide(): void {
    this.pararAmostra();
    super.hide();
  }

  /** O Obsidian lê um `control` por aqui. */
  getControlValue(key: string): unknown {
    return this.readValue(key);
  }

  /**
   * O Obsidian grava um `control` por aqui. O padrão dele grava com
   * `saveData(settings)` e mandaria as chaves de API em texto puro pro
   * data.json — ver ui/settings/values.ts.
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    await this.writeValue(key, value);
  }

  /**
   * O POUSO DA BUSCA (1.13). Clicar num resultado abre a aba e chama este
   * método — interno, não está nas tipagens — pra achar a linha e rolar até
   * ela. A linha pode estar numa aba ou num provider escondidos por CSS, então
   * primeiro mostramos a aba dela e depois devolvemos o que o Obsidian
   * devolveria. Se um dia o método mudar de nome, a busca continua achando e
   * abrindo a aba; só o pouso numa aba escondida deixa de acontecer.
   */
  getElementForDefinition(def: unknown): HTMLElement | null | undefined {
    const place = def && typeof def === "object" ? this.places.get(def) : undefined;
    if (place) {
      this.setTab(place.tab);
      if (place.provider) this.setProvider(place.provider);
    }
    const base = (PluginSettingTab.prototype as unknown as DefinitionLookup)
      .getElementForDefinition;
    // Sem asserção: o `.call` tem tipo porque o tsconfig liga o
    // `strictBindCallApply` — como a revisão do Obsidian, que acusou a
    // asserção da 0.9.14 como desnecessária.
    return base?.call(this, def);
  }

  private buildTree(): SettingDefinitionItem[] {
    const tree = buildSettingsTree(this.ui());
    this.places = tree.places;
    return tree.items;
  }

  private readValue(key: string): unknown {
    return isControlKey(key) ? readControl(this.s, key) : undefined;
  }

  private async writeValue(key: string, value: unknown): Promise<void> {
    // O tato espelha a setting ANTES de gravar: o pulso de confirmação abaixo
    // já sai (ou não) conforme o que acabou de ser escolhido.
    if (key === "hapticsEnabled") setHapticsEnabled(value === true);
    // O preço do Gemini segue a chave já na próxima conta (ver usage/pricing.ts).
    if (key === "geminiFreeTier") definirGeminiSemCobranca(value === true);
    if (!(await writeControl(this.plugin, key, value))) return;
    switch (key) {
      case "chatsPath":
        void this.plugin.loadChatSummaries(true);
        break;
      case "skillsPath":
        await this.plugin.reloadSkills();
        break;
      case "hapticsEnabled":
        // Sente na hora o que acabou de ligar.
        if (value === true) tap();
        break;
      case "language":
        this.retraduzir();
        break;
      case "geminiFreeTier":
        // A etiqueta "free tier" dos modelos do Gemini passa de oferta a fato.
        this.repaint("catalog:gemini");
        break;
      case "openaiDataSharing":
      case "openaiTier":
        // Os dois mudam a etiqueta de cota de cada modelo da OpenAI.
        this.repaint("catalog:openai");
        this.repaint("freeOffer");
        break;
      case "ragQuantProfile":
      case "ragStreamShards":
        // A linha do índice avisa que falta atualizar pra valer.
        this.repaint("index");
        break;
      case "ragIndexPath":
        // O campo grava a cada tecla, e carregar um índice é ler megabytes:
        // o índice da pasta nova só é lido quando a digitação para.
        this.repaint("index");
        window.clearTimeout(this.timerDoIndice);
        this.timerDoIndice = window.setTimeout(() => {
          void this.plugin.loadVectorIndex().then(() => this.repaint("index"));
        }, 800);
        break;
    }
  }

  /**
   * O idioma mudou: a árvore é montada de novo, com os textos no idioma novo.
   * No 1.13 o Obsidian só lê a árvore no `addSettingTab` (o `update()` relê e
   * redesenha a aba aberta); antes do 1.13 é o desenho do `display()`. É o
   * único redesenho inteiro da aba: a escolha do idioma é um menu, então não
   * há campo com foco pra perder.
   */
  private retraduzir(): void {
    if (requireApiVersion("1.13.0")) this.update();
    else this.desenharLegado();
  }

  /** Reavalia os `visible` da árvore depois de uma mudança feita à mão. */
  private refreshVisibility(): void {
    this.legacy?.refresh();
    if (requireApiVersion("1.13.0")) this.refreshDomState();
  }

  /** O que a árvore pede: estado e os desenhos de cada linha. */
  private ui(): SettingsUi {
    return {
      isMobile: Platform.isMobile,
      settings: () => this.plugin.settings,
      hasCredential: (id) => !!this.plugin.providerCredential(id),
      freeOfferCount: () => this.freeOfferCount(),
      nav: (row) => this.renderNav(row),
      rail: (row) => this.renderRail(row),
      credential: (id) =>
        this.slot(`cred:${id}`, "providers", (row) => this.paintCredential(row, id)),
      connection: (id) =>
        this.slot(`conn:${id}`, "providers", (row) => this.paintConnection(row, id)),
      // Um slot, pra redesenhar quando a busca do Ollama troca o modelo que
      // não está mais instalado.
      newChatModel: (id) =>
        this.slot(`model:${id}`, "providers", (row) => this.paintNewChatModel(row, id)),
      fetchModels: (id) =>
        this.slot(`fetch:${id}`, "providers", (row) => this.paintFetch(row, id)),
      catalog: (id) =>
        this.slot(`catalog:${id}`, "providers", (row) => this.paintCatalog(row, id)),
      freeOffer: this.slot("freeOffer", "providers", (row) =>
        this.paintHint(row, this.freeOfferText())
      ),
      pick: (key, items, tab) =>
        this.slot(`pick:${key}`, tab, (row) => this.paintPick(row, key, items)),
      effortLevel: (level) =>
        this.slot(`effort:${level}`, "chat", (row) => this.paintEffortLevel(row, level)),
      assistantModel: this.slot("assistant", "chat", (row) =>
        this.paintAssistantModel(row)
      ),
      ttsProvider: this.slot("ttsWho", "chat", (row) => this.paintTtsProvider(row)),
      elevenKey: (row) => this.paintElevenKey(row),
      tavilyKey: (row) => this.paintTavilyKey(row),
      spendLimit: (row) => this.paintSpendLimit(row),
      elevenFetch: this.slot("elevenFetch", "chat", (row) => this.paintElevenFetch(row)),
      elevenVoice: this.slot("elevenVoice", "chat", (row) => this.paintElevenVoice(row)),
      testVoice: (row) => this.paintTestVoice(row),
      embeddingModel: this.slot("embedding", "rag", (row) =>
        this.paintEmbeddingModel(row)
      ),
      index: this.slot("index", "rag", (row) => this.paintIndex(row)),
      hint: (text) => (row) => this.paintHint(row, text),
    };
  }

  /**
   * Uma linha VIVA. O render guarda o Setting que recebeu; `repaint(id)` o
   * limpa e pinta de novo, no lugar. A limpeza devolvida roda quando o
   * Obsidian desmonta a linha (sair da aba, fechar as settings).
   */
  private slot(id: string, tab: TabId, paint: (row: Setting) => void): RowRender {
    return (row) => {
      const entry: Slot = { row, paint, tab };
      this.slots.set(id, entry);
      paint(row);
      return () => {
        if (this.slots.get(id) === entry) this.slots.delete(id);
      };
    };
  }

  private repaint(id: string): void {
    const entry = this.slots.get(id);
    if (!entry) return;
    entry.row.clear();
    entry.paint(entry.row);
  }

  // ── a casca: container, barra de abas, trilho ─────────────────────────────

  /** A classe e os atributos de que o CSS das abas depende. */
  private prepareRoot(): void {
    const el = this.containerEl;
    el.addClass("axxa-settings-root");
    const tabs = tabsFor(Platform.isMobile);
    if (!tabs.some((t) => t.id === this.tab)) this.tab = tabs[0].id;
    if (!PROVIDER_FIELDS[this.provider]) this.provider = PROVIDERS[0].id;
    el.dataset.axxaTab = this.tab;
    el.dataset.axxaProv = this.provider;
  }

  private blurbOf(id: TabId): string {
    const blurb = tabsFor(Platform.isMobile).find((t) => t.id === id)?.blurb;
    return blurb ? tr(blurb) : "";
  }

  /** Segmented control, igual ao da tela inicial: trilho + thumb que desliza
   *  até o item ativo. Colunas do tamanho do conteúdo, nada de quebrar linha. */
  private renderNav(row: Setting): () => void {
    this.prepareRoot();
    // Tato em tudo que se toca aqui dentro, sem precisar lembrar botão a botão.
    this.hapticsOff?.();
    const off = hapticsOn(this.containerEl);
    this.hapticsOff = off;

    const el = row.settingEl;
    el.empty();
    el.addClass("axxa-set-block", "axxa-set-navrow");
    const nav = el.createDiv({ cls: "axxa-seg axxa-settings-nav" });
    for (const t of tabsFor(Platform.isMobile)) {
      const active = t.id === this.tab;
      const btn = nav.createEl("button", {
        text: tr(t.label),
        cls: active ? "axxa-seg-item is-active" : "axxa-seg-item",
        attr: { type: "button", "aria-pressed": String(active), "data-tab": t.id },
      });
      btn.onclick = () => this.setTab(t.id);
    }
    const blurb = el.createEl("p", {
      cls: "axxa-settings-blurb",
      text: this.blurbOf(this.tab),
    });
    this.tabBarEl = nav;
    this.blurbEl = blurb;
    this.placeThumb(nav);

    return () => {
      off();
      if (this.hapticsOff === off) this.hapticsOff = null;
      if (this.tabBarEl === nav) this.tabBarEl = null;
      if (this.blurbEl === blurb) this.blurbEl = null;
    };
  }

  /** Troca de aba mexendo SÓ no atributo do container e na barra. */
  private setTab(id: TabId): void {
    if (!tabsFor(Platform.isMobile).some((t) => t.id === id)) return;
    const changed = id !== this.tab;
    this.tab = id;
    this.containerEl.dataset.axxaTab = id;
    if (this.tabBarEl) {
      for (const btn of Array.from(
        this.tabBarEl.querySelectorAll<HTMLElement>(".axxa-seg-item")
      )) {
        const active = btn.dataset.tab === id;
        btn.toggleClass("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
      }
      this.placeThumb(this.tabBarEl);
    }
    this.blurbEl?.setText(this.blurbOf(id));
    // Escondido, o trilho mede zero: o thumb só acha o lugar quando aparece.
    if (id === "providers" && this.railEl) this.placeThumb(this.railEl);
    if (!changed) return;
    // O que uma aba mostra pode ter mudado em outra (uma chave digitada em
    // Providers muda o "Who reads"). Antes o corpo inteiro era redesenhado a
    // cada troca; agora só as linhas vivas da aba que entrou.
    for (const [slotId, slot] of this.slots) {
      if (slot.tab === id) this.repaint(slotId);
    }
    this.refreshVisibility();
  }

  /**
   * Posiciona o thumb do segmented sobre o item ativo. As colunas são do
   * tamanho do CONTEÚDO (colunas iguais cortavam "OpenRouter" e "Anthropic"
   * num painel de 375px), então o thumb não dá pra calcular só em CSS. Quando
   * ele desliza e quando aparece direto: ver settings/thumb.ts.
   */
  private placeThumb(row: HTMLElement): void {
    const put = () => putThumb(row);
    put();
    // De novo no frame seguinte: na primeira passada a linha pode nem estar
    // no documento ainda, ou as fontes não assentaram. A janela é a da linha —
    // no 1.13 as settings do desktop abrem em janela própria.
    row.win.requestAnimationFrame(put);
  }

  /** O trilho de providers: quem já tem credencial aparece aceso, quem não
   *  tem fica apagado — dá pra ver o estado dos seis sem abrir um por um. */
  private renderRail(row: Setting): () => void {
    const el = row.settingEl;
    el.empty();
    el.addClass("axxa-set-block", "axxa-set-railrow");
    const sub = el.createDiv({ cls: "axxa-seg axxa-settings-subnav" });
    for (const p of PROVIDERS) {
      const active = p.id === this.provider;
      const btn = sub.createEl("button", {
        cls: "axxa-seg-item" + (active ? " is-active" : ""),
        // O LOGO no lugar do nome: com seis providers, nome + logo não cabem
        // em uma linha, e o logo identifica mais rápido. O nome fica no
        // aria-label, no tooltip e no título do cartão logo abaixo.
        attr: {
          type: "button",
          "aria-pressed": String(active),
          "aria-label": p.name,
          title: p.name,
          "data-provider": p.id,
        },
      });
      const mark = btn.createSpan({ cls: "axxa-seg-logo" });
      setIcon(mark, p.icon);
      // Bolinha de conexão: vazada = sem credencial, cinza cheio = tem mas
      // nunca testou, verde = testou e respondeu, vermelho = recusou.
      mark.createSpan({ cls: "axxa-seg-dot" });
      btn.onclick = () => this.setProvider(p.id);
    }
    this.railEl = sub;
    this.syncReady();
    this.placeThumb(sub);
    return () => {
      if (this.railEl === sub) this.railEl = null;
    };
  }

  /** Troca de provider mexendo só no atributo, no trilho e no catálogo. */
  private setProvider(id: string): void {
    if (!PROVIDER_FIELDS[id]) return;
    const old = this.provider;
    this.provider = id;
    this.containerEl.dataset.axxaProv = id;
    if (this.railEl) {
      for (const btn of Array.from(
        this.railEl.querySelectorAll<HTMLElement>(".axxa-seg-item")
      )) {
        const active = btn.dataset.provider === id;
        btn.toggleClass("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
      }
      this.placeThumb(this.railEl);
    }
    if (old === id) return;
    // Outro provider, outros papéis: um filtro herdado mostraria uma lista
    // vazia sem explicar por quê.
    this.kind = "all";
    // Só o catálogo do provider à vista existe desenhado: seis catálogos de
    // dezenas de linhas, escondidos, seriam DOM à toa.
    this.repaint(`catalog:${old}`);
    this.repaint(`catalog:${id}`);
  }

  /** Estado da conexão: o desta sessão, senão o último teste gravado. */
  private connOf(id: string): ConnState {
    const live = this.conn[id];
    if (live) return live;
    const saved = this.s.providerStatus?.[id];
    if (!saved) return { state: "unknown" };
    return { state: saved.ok ? "ok" : "fail", detail: saved.detail };
  }

  /** Saúde mostrada na bolinha — o teste desta sessão manda na frente do
   *  gravado (acabou de testar e ainda não fechou as settings). */
  private healthOf(id: string): ProviderHealth {
    if (!providerConfigured(this.plugin, id)) return "off";
    const live = this.conn[id];
    if (live?.state === "ok") return "ok";
    if (live?.state === "fail") return "fail";
    return providerHealth(this.plugin, id);
  }

  /** Reacende os logos do trilho conforme quem tem credencial. */
  private syncReady(): void {
    if (!this.railEl) return;
    for (const btn of Array.from(
      this.railEl.querySelectorAll<HTMLElement>(".axxa-seg-item")
    )) {
      const id = btn.dataset.provider;
      if (!id) continue;
      btn.toggleClass("is-ready", providerConfigured(this.plugin, id));
      const health = this.healthOf(id);
      const dot = btn.querySelector<HTMLElement>(".axxa-seg-dot");
      if (dot) {
        dot.className = `axxa-seg-dot is-${health}`;
        dot.setAttribute("aria-hidden", "true");
      }
      btn.setAttribute(
        "title",
        `${PROVIDERS.find((x) => x.id === id)?.name ?? id} · ${tr(HEALTH_TEXT[health])}`
      );
    }
  }

  private get s() {
    return this.plugin.settings;
  }
  private save = () => this.plugin.saveSettings();

  // ── Providers ─────────────────────────────────────────────────────────────

  private paintCredential(row: Setting, providerId: string): void {
    const f = PROVIDER_FIELDS[providerId];
    if (!f) return;
    const s = this.s;
    // Depois de cada tecla: o trilho acende, o botão Test destrava e os
    // recados que dependem da chave (o ditado, a leitura) se reavaliam.
    const changed = () => {
      this.syncReady();
      this.repaint(`conn:${providerId}`);
      this.refreshVisibility();
    };
    if (f.key) {
      const key = f.key;
      row.addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder(tr("key…"))
          .setValue(s[key])
          .onChange(async (v) => {
            s[key] = v.trim();
            await this.save();
            changed();
          });
      });
    } else {
      row.addText((t) =>
        t
          .setPlaceholder("http://localhost:11434")
          .setValue(s.ollamaEndpoint)
          .onChange(async (v) => {
            s.ollamaEndpoint = v.trim();
            await this.save();
            changed();
            this.conferirOllamaDepois();
          })
      );
    }
  }

  /**
   * Um endereço novo do Ollama já traz a lista do que ele tem instalado — sem
   * isto, quem acabou de configurar ficava sem modelo nenhum até apertar Test
   * (a fábrica do Ollama é vazia). Espera a digitação parar; um endereço pela
   * metade só não responde, e a lista fica como estava.
   */
  private conferirOllamaDepois(): void {
    // O catálogo buscado era de OUTRO endereço: sai na hora, senão os modelos
    // do servidor antigo seguiam na lista como se este os tivesse.
    if (this.catalog.ollama) {
      delete this.catalog.ollama;
      this.repaint("catalog:ollama");
    }
    if (this.timerDoOllama !== null) window.clearTimeout(this.timerDoOllama);
    this.timerDoOllama = window.setTimeout(() => {
      this.timerDoOllama = null;
      void (async () => {
        const instalados = await this.plugin.conferirOllama({ soDeFabrica: false });
        if (instalados === null) return;
        this.catalog.ollama = instalados;
        this.repaint("catalog:ollama");
        this.repaint("model:ollama");
        // E a lista de embeddings do Q&A, que também é deste servidor.
        await this.plugin.scanEmbeddings("ollama");
        this.repaint("embedding");
      })();
    }, 900);
  }

  // "Tem chave" e "a chave funciona" são coisas diferentes; o trilho mostra a
  // primeira, esta linha mostra a segunda. O teste é o listModels do próprio
  // provider (o motor já tem) — se ele responde, a credencial vale.
  private paintConnection(row: Setting, providerId: string): void {
    const st = this.connOf(providerId);
    row.setDesc(CONN_TEXT[st.state](st.detail));
    row.addButton((b) => {
      b.setButtonText(st.state === "testing" ? tr("Testing…") : tr("Test"))
        .setDisabled(
          st.state === "testing" || !providerConfigured(this.plugin, providerId)
        )
        .onClick(() => void this.testConnection(providerId));
    });
    row.nameEl.addClass("axxa-conn-name");
    row.nameEl.querySelector(".axxa-conn-dot")?.remove();
    row.nameEl.prepend(row.nameEl.createSpan({ cls: `axxa-conn-dot is-${st.state}` }));
    row.descEl.removeClass("is-unknown", "is-testing", "is-ok", "is-fail");
    row.descEl.addClass("axxa-conn-desc", `is-${st.state}`);
  }

  /**
   * Testa a credencial pedindo a lista de modelos ao provider. É o mesmo
   * caminho do "Fetch models" — e como a resposta JÁ é o catálogo, guardar ele
   * aqui evita uma segunda ida à rede pra pedir o que acabou de chegar.
   */
  private async testConnection(providerId: string): Promise<void> {
    if (this.conn[providerId]?.state === "testing") return;
    this.conn[providerId] = { state: "testing" };
    this.repaint(`conn:${providerId}`);
    try {
      const desde = this.s.ollamaEndpoint;
      const models = await this.plugin.scanModels(providerId);
      // No Ollama, zero modelos é resposta (nada instalado), não falta dela —
      // desde que seja do endereço de agora.
      const doEnderecoAtual = providerId !== "ollama" || this.s.ollamaEndpoint === desde;
      if (doEnderecoAtual && (models.length > 0 || providerId === "ollama")) {
        this.catalog[providerId] = models;
      }
      this.conn[providerId] = {
        state: "ok",
        detail:
          models.length === 0
            ? tr("The provider answered, but listed no models.")
            : models.length === 1
              ? tr("1 model available.")
              : tr("{n} models available.", { n: models.length }),
      };
    } catch (err) {
      this.conn[providerId] = {
        state: "fail",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    // Grava: quem mais precisa do resultado é o CHAT, que não vai testar
    // sozinho na hora de abrir a folha de modelos.
    const now = this.conn[providerId];
    (this.s.providerStatus ??= {})[providerId] = {
      ok: now.state === "ok",
      at: Date.now(),
      detail: now.detail,
    };
    await this.save();
    this.repaint(`conn:${providerId}`);
    this.repaint(`catalog:${providerId}`);
    this.repaint(`model:${providerId}`);
    this.syncReady();
    if (providerId === "openai") this.freeOfferChanged();
  }

  private paintNewChatModel(row: Setting, providerId: string): void {
    const f = PROVIDER_FIELDS[providerId];
    if (!f) return;
    const field = f.model;
    row.addText((t) =>
      t.setValue(this.s[field]).onChange(async (v) => {
        const m = v.trim();
        if (!m) return;
        this.s[field] = m;
        this.addToList("activeModels", providerId, m);
        await this.save();
      })
    );
  }

  private paintFetch(row: Setting, providerId: string): void {
    const busy = this.fetchingFor === providerId;
    row.addButton((b) =>
      b
        .setButtonText(busy ? tr("Fetching…") : tr("Fetch models"))
        .setCta()
        .setDisabled(this.fetchingFor !== null)
        .onClick(() => void this.fetchModels(providerId))
    );
  }

  /** Busca o catálogo do provider (o motor já tem: plugin.scanModels). */
  private async fetchModels(providerId: string): Promise<void> {
    if (this.fetchingFor) return;
    this.fetchingFor = providerId;
    this.repaint(`fetch:${providerId}`);
    this.repaint(`catalog:${providerId}`);
    try {
      // Os de EMBEDDING vêm na mesma ida (ver plugin.scanEmbeddings): eles
      // alimentam a lista de modelos do Q&A. Nunca lançam.
      const desde = this.s.ollamaEndpoint;
      const [models, embeds] = await Promise.all([
        this.plugin.scanModels(providerId),
        this.plugin.scanEmbeddings(providerId),
      ]);
      // Ollama: o endereço mudou no meio da busca — a resposta é do servidor
      // de antes, e a conferência do endereço novo já cuida da lista.
      if (providerId === "ollama" && this.s.ollamaEndpoint !== desde) return;
      this.catalog[providerId] = models;
      // No Ollama a lista do Q&A também ENCOLHE (o que saiu com `ollama rm`).
      if (embeds.length > 0 || providerId === "ollama") this.repaint("embedding");
      // Os grátis contados pela regra de verdade (preço no OpenRouter, marca
      // "Free Endpoint" no NIM) — o número que a lista vai mostrar.
      const gratis = models.filter((m) => this.tagGratis(providerId, m) !== null).length;
      const partes = [
        models.length === 1
          ? tr("1 model found")
          : tr("{n} models found", { n: models.length }),
        ...(gratis > 0 ? [tr("{n} free", { n: gratis })] : []),
        ...(embeds.length > 0
          ? [tr("{n} for Vault Q&A embeddings", { n: embeds.length })]
          : []),
      ];
      new Notice(
        models.length > 0
          ? `${partes.join(" · ")}.`
          : tr("No models returned — check the key or the endpoint.")
      );
    } catch (err) {
      console.error("[axxa] scanModels falhou:", err);
      new Notice(
        tr("Fetch failed: {error}", {
          error: err instanceof Error ? err.message : String(err),
        })
      );
    } finally {
      this.fetchingFor = null;
      this.repaint(`fetch:${providerId}`);
      this.repaint(`catalog:${providerId}`);
      this.repaint(`model:${providerId}`);
      if (providerId === "openai") this.freeOfferChanged();
    }
  }

  // ── a cota diária da OpenAI ───────────────────────────────────────────────
  // Isto não LIGA nada: o interruptor é da OpenAI, e mora na conta. O que a
  // gente guarda é se ele está ligado e em que tier a conta está — as duas
  // coisas que decidem o NÚMERO. Sem elas, a lista de modelos teria que
  // escolher entre mostrar uma cota que talvez não exista ou não mostrar
  // nenhuma; as duas mentem pra metade das contas.

  /** Com o programa desligado, a lista marca com "+" o que ele DARIA. A conta
   *  diz de quantos modelos se está falando — sem ela, o "+" seria um sinal
   *  sem tamanho. */
  private freeOfferCount(): number {
    return (this.catalog.openai ?? this.s.activeModels.openai ?? []).filter(
      (m) => openaiFreeTierForModel(m) !== null
    ).length;
  }

  private freeOfferText(): string {
    const n = this.freeOfferCount();
    return n === 1
      ? tr("1 model in this list would get a daily quota — it is the one marked with a \"+\".")
      : tr(
          "{n} models in this list would get a daily quota — they are the ones marked with a \"+\".",
          { n }
        );
  }

  private freeOfferChanged(): void {
    this.repaint("freeOffer");
    this.refreshVisibility();
  }

  /** Recado curto entre linhas: o que falta pra linha de cima funcionar. */
  private paintHint(row: Setting, text: string): void {
    const el = row.settingEl;
    el.empty();
    el.addClass("axxa-set-block", "axxa-set-hint");
    el.createEl("p", { cls: "axxa-settings-hint", text });
  }

  // ── o catálogo ────────────────────────────────────────────────────────────

  private paintCatalog(row: Setting, providerId: string): void {
    const el = row.settingEl;
    // O filtro é remontado junto com a lista (a cada toque nele e a cada
    // modelo marcado). O novo nasce onde o thumb do velho estava, e desliza
    // de lá — não do primeiro item.
    const velho = el.querySelector<HTMLElement>(".axxa-models-filter");
    const thumb = velho ? thumbOf(velho) : null;
    el.empty();
    el.addClass("axxa-set-block", "axxa-set-catalog");
    if (providerId !== this.provider) return;
    this.drawModels(el.createDiv({ cls: "axxa-models" }), providerId, thumb);
  }

  /** A lista de modelos — o único pedaço que os toggles e o filtro remontam. */
  private drawModels(
    list: HTMLElement,
    providerId: string,
    thumb?: Thumb | null
  ): void {
    const redraw = () => this.repaint(`catalog:${providerId}`);

    // A lista é o catálogo buscado UNIDO ao que já está marcado — sem fetch,
    // o usuário ainda vê e desmarca o que configurou antes.
    const shown = this.s.activeModels[providerId] ?? [];
    const favs = this.s.favoriteModels?.[providerId] ?? [];
    const models = Array.from(
      new Set([...(this.catalog[providerId] ?? []), ...shown, ...favs])
    ).sort();

    if (models.length === 0) {
      list.createEl("p", {
        cls: "axxa-models-empty",
        text:
          this.fetchingFor === providerId
            ? tr("Fetching…")
            : tr("No models yet — fetch the catalog, or type one in the field above."),
      });
      return;
    }

    const head = list.createDiv({ cls: "axxa-models-head" });
    head.createSpan({
      text: models.length === 1 ? tr("1 model") : tr("{n} models", { n: models.length }),
    });
    head.createSpan({
      cls: "axxa-models-legend",
      text: tr("Show · Favorite ({n}/{max})", { n: favs.length, max: FAVORITE_LIMIT }),
    });

    // PAPEL no filtro, FAMÍLIA nas seções — as duas coisas o motor já sabe
    // (ver src/ui/modelCatalog.ts). Um catálogo de provider vem com dezenas de
    // ids embaralhados; sem isso a lista é indigerível.
    const groups = buildModelCatalog(providerId, models);
    if (
      this.kind !== "all" &&
      this.kind !== "free" &&
      !groups.some((g) => g.id === this.kind)
    ) {
      this.kind = "all";
    }

    // FAVORITOS em cima, sempre abertos. É o mesmo arranjo da folha de
    // modelos do chat — e a razão é a mesma: quem já escolheu os seus cinco
    // não devia caçá-los dentro de um catálogo de oitenta a cada visita.
    if (favs.length > 0) {
      const sec = list.createDiv({ cls: "axxa-models-fav" });
      const cab = sec.createDiv({ cls: "axxa-models-fav-head" });
      const ico = cab.createSpan({ cls: "axxa-models-fav-ico" });
      setIcon(ico, "star");
      cab.createSpan({ text: tr("Favorites") });
      cab.createSpan({
        cls: "axxa-model-section-count",
        text: `${favs.length}/${FAVORITE_LIMIT}`,
      });
      for (const m of [...favs].sort()) this.modelRow(sec, providerId, m, redraw);
    }

    // Quantos modelos são de graça DE VERDADE (ver usage/freeTag.ts) — o
    // número decide se o filtro "Free" aparece. Filtro que leva a uma lista
    // vazia é um toque perdido.
    const gratis = models.filter((m) => this.tagGratis(providerId, m) !== null);
    if (gratis.length > 0) {
      head.firstElementChild?.setText(
        models.length === 1
          ? tr("1 model · {free} free", { free: gratis.length })
          : tr("{n} models · {free} free", { n: models.length, free: gratis.length })
      );
    }

    if (groups.length > 1 || gratis.length > 0) {
      const filter = list.createDiv({ cls: "axxa-seg axxa-models-filter" });
      seedThumb(filter, thumb);
      const items = [
        { id: "all", label: tr("All"), icon: "layers" },
        ...(gratis.length > 0
          ? [{ id: "free", label: tr("Free"), icon: "gift" }]
          : []),
        ...groups.map((g) => ({ id: g.id, label: g.label, icon: g.icon })),
      ];
      for (const it of items) {
        const active = it.id === this.kind;
        const btn = filter.createEl("button", {
          cls: "axxa-seg-item" + (active ? " is-active" : ""),
          attr: {
            type: "button",
            "aria-pressed": String(active),
            "aria-label": it.label,
            title: it.label,
          },
        });
        const mark = btn.createSpan({ cls: "axxa-seg-ico" });
        setIcon(mark, it.icon);
        // Só o ATIVO mostra o rótulo: sete papéis com nome não cabem numa
        // linha, e a regra do segmented aqui é nunca quebrar em duas.
        if (active) btn.createSpan({ cls: "axxa-seg-label", text: it.label });
        btn.onclick = () => {
          this.kind = it.id;
          redraw();
        };
      }
      this.placeThumb(filter);
    }

    const multi = PROVIDERS_MULTI_FABRICANTE.has(providerId);
    // Acordeões: um fabricante aberto por vez e, dentro dele, uma classe.
    // Guardo os pares pra abrir/fechar só trocando classe — remontar a lista
    // seria o piscar que já tiramos daqui.
    const panes: { key: string; sec: HTMLElement; wrap: HTMLElement }[] = [];
    const vendors: { key: string; sec: HTMLElement; body: HTMLElement }[] = [];
    const applyOpen = () => {
      for (const pane of panes) {
        const closed = pane.key !== this.openFam;
        pane.sec.toggleClass("is-closed", closed);
        pane.wrap.toggleClass("is-closed", closed);
        pane.sec.setAttribute("aria-expanded", String(!closed));
      }
      for (const v of vendors) {
        const closed = v.key !== this.openVendor;
        v.sec.toggleClass("is-closed", closed);
        v.body.toggleClass("is-closed", closed);
        v.sec.setAttribute("aria-expanded", String(!closed));
      }
    };

    /** O cabeçalho de um fabricante (OpenRouter, NIM): logo, nome, quantos. */
    const fabricanteSec = (chave: string, nome: string, total: number, exemplo: string) => {
      const key = `${providerId}:v:${chave}`;
      const closed = key !== this.openVendor;
      const sec = list.createEl("button", {
        cls: closed ? "axxa-model-vendor is-closed" : "axxa-model-vendor",
        attr: { type: "button", "aria-expanded": String(!closed) },
      });
      setIcon(sec.createSpan({ cls: "axxa-model-vendor-ico" }), modelLogo(exemplo));
      sec.createSpan({ cls: "axxa-model-vendor-name", text: nome });
      sec.createSpan({ cls: "axxa-model-section-count", text: String(total) });
      setIcon(sec.createSpan({ cls: "axxa-model-section-chev" }), "chevron-down");
      const body = list.createDiv({
        cls: closed ? "axxa-model-vendor-body is-closed" : "axxa-model-vendor-body",
      });
      vendors.push({ key, sec, body });
      sec.onclick = () => {
        this.openVendor = this.openVendor === key ? null : key;
        applyOpen();
      };
      return body;
    };

    /** Uma seção de classe (família) com as linhas dela. */
    const classeSec = (
      host: HTMLElement,
      key: string,
      g: { id: string; label: string; icon: string },
      fam: { id: string; label: string; icon: string; models: string[] }
    ) => {
      // Família sem linhagem conhecida ("Other") vira o próprio papel: uma
      // seção "OTHER · Text embedding" não informa nada.
      const orfa = fam.id === "other";
      const closed = key !== this.openFam;
      const sec = host.createEl("button", {
        cls: closed ? "axxa-model-section is-closed" : "axxa-model-section",
        attr: { type: "button", "aria-expanded": String(!closed) },
      });
      const mark = sec.createSpan({ cls: "axxa-model-section-ico" });
      setIcon(mark, orfa ? g.icon : fam.icon);
      sec.createSpan({
        cls: "axxa-model-section-name",
        text: orfa ? g.label : fam.label,
      });
      // Em "All" a família sozinha é ambígua (GPT-5 em chat e em reasoning),
      // então o papel vem junto.
      if (this.kind === "all" && !orfa) {
        sec.createSpan({ cls: "axxa-model-section-role", text: g.label });
      }
      sec.createSpan({
        cls: "axxa-model-section-count",
        text: String(fam.models.length),
      });
      const chev = sec.createSpan({ cls: "axxa-model-section-chev" });
      setIcon(chev, "chevron-down");

      const wrap = host.createDiv({
        cls: closed ? "axxa-model-fam is-closed" : "axxa-model-fam",
      });
      for (const m of fam.models) this.modelRow(wrap, providerId, m, redraw);

      panes.push({ key, sec, wrap });
      sec.onclick = () => {
        this.openFam = this.openFam === key ? null : key;
        applyOpen();
      };
    };

    // "Free" é um recorte que atravessa os papéis (tem chat, tem reasoning,
    // tem mini), então ele não é um grupo do catálogo: é uma lista chapada —
    // por fabricante, nos providers de muitos.
    if (this.kind === "free") {
      const nota = this.notaGratis(providerId);
      if (nota) list.createEl("p", { cls: "axxa-models-free-note", text: nota });
      if (gratis.length === 0) {
        list.createEl("p", {
          cls: "axxa-models-empty",
          text: tr("Nothing free in this catalog."),
        });
        return;
      }
      if (!multi) {
        const wrap = list.createDiv({ cls: "axxa-model-fam" });
        for (const m of gratis) this.modelRow(wrap, providerId, m, redraw);
        return;
      }
      for (const v of soltosPorFabricante(gratis)) {
        const body = fabricanteSec(v.fabricante.chave, v.fabricante.nome, v.models.length, v.models[0]);
        const wrap = body.createDiv({ cls: "axxa-model-fam" });
        for (const m of v.models) this.modelRow(wrap, providerId, m, redraw);
      }
      return;
    }

    const visible =
      this.kind === "all" ? groups : groups.filter((g) => g.id === this.kind);

    // Uma casa só (OpenAI, Anthropic, Gemini…): as classes direto.
    if (!multi) {
      for (const g of visible) {
        for (const fam of g.families) {
          classeSec(list, `${providerId}:${g.id}:${fam.id}`, g, fam);
        }
      }
      return;
    }

    // Muitas casas (OpenRouter, NIM): um nível a mais — o fabricante, e as
    // classes dele dentro. Com uma classe só, os modelos vêm direto: abrir o
    // fabricante pra depois abrir a única classe dele seria um toque à toa.
    for (const v of porFabricante(visible)) {
      const body = fabricanteSec(
        v.fabricante.chave,
        v.fabricante.nome,
        v.total,
        v.secoes[0].family.models[0]
      );
      if (v.secoes.length === 1) {
        const wrap = body.createDiv({ cls: "axxa-model-fam" });
        for (const m of v.secoes[0].family.models) this.modelRow(wrap, providerId, m, redraw);
        continue;
      }
      for (const s of v.secoes) {
        classeSec(
          body,
          `${providerId}:${v.fabricante.chave}:${s.roleId}:${s.family.id}`,
          { id: s.roleId, label: s.roleLabel, icon: s.roleIcon },
          s.family
        );
      }
    }
  }

  /** A etiqueta de grátis de um modelo — de verdade (a lista do fetch vale
   *  sobre o palpite pelo nome; ver usage/freeTag.ts) e com a regra da casa. */
  private tagGratis(providerId: string, m: string): FreeTag | null {
    return freeTag(providerId, m, {
      free: gratisDeVerdade(
        m,
        this.s.freeModels?.[providerId],
        getModelCapabilities(providerId, m).free === true
      ),
      dataSharing: this.s.openaiDataSharing === true,
      tier: this.s.openaiTier ?? 1,
      cota: this.s.freeQuota?.[providerId],
      geminiFreeTier: this.s.geminiFreeTier === true,
    });
  }

  /** O que "free" quer dizer neste provider — em cima da lista do filtro
   *  Free, porque o detalhe da etiqueta (o `title`) não aparece no toque. */
  private notaGratis(providerId: string): string | null {
    if (providerId === "openrouter") {
      // Três frases inteiras (a cota da chave conhecida ou não, e se já passou
      // dos US$ 10) em vez de pedaços colados: cada uma se traduz sozinha.
      const c = this.s.freeQuota?.[providerId];
      if (!c) {
        return tr(
          "No cost, checked by price, not by the \":free\" in the name. They share 20 requests a minute and 50 a day (1,000 once you've bought $10 in credits)."
        );
      }
      const n = c.limit.toLocaleString(localeDaInterface());
      return c.limit >= 1000
        ? tr(
            "No cost, checked by price, not by the \":free\" in the name. They share 20 requests a minute and {n} a day on this key.",
            { n }
          )
        : tr(
            "No cost, checked by price, not by the \":free\" in the name. They share 20 requests a minute and {n} a day on this key (1,000 once you've bought $10 in credits).",
            { n }
          );
    }
    if (providerId === "nim") {
      return tr(
        "No cost: the models NVIDIA marks as Free Endpoint, for development and testing, 40 requests a minute. The rest of NIM isn't part of the free tier."
      );
    }
    return null;
  }

  /** Uma linha da lista de modelos: nome, tag free, id e os dois toggles. */
  private modelRow(
    host: HTMLElement,
    providerId: string,
    m: string,
    redraw: () => void
  ): void {
    const shown = this.s.activeModels[providerId] ?? [];
    const favs = this.s.favoriteModels?.[providerId] ?? [];

    const row = host.createDiv({ cls: "axxa-model-row" });
    const info = row.createDiv({ cls: "axxa-model-info" });
    const title = info.createDiv({ cls: "axxa-model-name" });
    title.createSpan({ text: prettyModelName(m) });
    // A etiqueta separa DE GRAÇA SEMPRE de DE GRAÇA ATÉ UM LIMITE (ver
    // usage/freeTag.ts). Chamar as duas de "free" faz a segunda parecer a
    // primeira — e a conta chega.
    const tag = this.tagGratis(providerId, m);
    if (tag) {
      title.createSpan({
        cls: `axxa-tag is-free is-${tag.kind}`,
        text: tag.label,
        attr: { title: tag.detail },
      });
    }
    info.createDiv({ cls: "axxa-model-id", text: m });

    const actions = row.createDiv({ cls: "axxa-model-actions" });

    const isShown = shown.includes(m);
    const showBtn = actions.createEl("button", {
      cls: isShown ? "axxa-model-toggle is-on" : "axxa-model-toggle",
      text: tr("Show"),
      attr: {
        type: "button",
        "aria-pressed": String(isShown),
        title: tr("Appears in this provider's model list"),
      },
    });
    showBtn.onclick = async () => {
      this.toggleInList("activeModels", providerId, m);
      await this.save();
      redraw();
    };

    const isFav = favs.includes(m);
    const favBtn = actions.createEl("button", {
      cls: isFav ? "axxa-model-toggle is-fav" : "axxa-model-toggle",
      attr: {
        type: "button",
        "aria-pressed": String(isFav),
        title: tr("Appears on the new-chat screen (max {n})", { n: FAVORITE_LIMIT }),
      },
    });
    setIcon(favBtn, isFav ? "star" : "star-off");
    favBtn.onclick = async () => {
      const list = this.s.favoriteModels?.[providerId] ?? [];
      if (!list.includes(m) && list.length >= FAVORITE_LIMIT) {
        new Notice(
          tr("{n} favorites per provider is the limit — unstar one first.", {
            n: FAVORITE_LIMIT,
          })
        );
        return;
      }
      this.toggleInList("favoriteModels", providerId, m);
      // Favoritar implica aparecer na lista: senão o atalho existiria sem o
      // modelo estar disponível pra escolher.
      if (this.s.favoriteModels[providerId]?.includes(m)) {
        this.addToList("activeModels", providerId, m);
      }
      await this.save();
      redraw();
    };
  }

  private addToList(
    field: "activeModels" | "favoriteModels",
    providerId: string,
    model: string
  ): void {
    const map = (this.s[field] ??= {});
    const list = map[providerId] ?? [];
    if (!list.includes(model)) map[providerId] = [model, ...list];
  }

  private toggleInList(
    field: "activeModels" | "favoriteModels",
    providerId: string,
    model: string
  ): void {
    const map = (this.s[field] ??= {});
    const list = map[providerId] ?? [];
    map[providerId] = list.includes(model)
      ? list.filter((x) => x !== model)
      : [model, ...list];
  }

  // ── Menus de ESCOLHA ──────────────────────────────────────────────────────
  // No lugar do <select>. No Android ele abre a caixa do sistema — rádio,
  // letra enorme, nenhum ícone, no meio da tela, longe do que foi tocado. Aqui
  // é um botão com a cara do select do Obsidian e o ícone da opção, que abre
  // o MESMO balão do ⋯ das conversas, ancorado nele e com a opção de agora
  // marcada.

  /** O botão e o balão. Quem grava é `onPick`; o botão não guarda estado. */
  private pickButton(
    row: Setting,
    opts: {
      items: PickItem[];
      value: string;
      onPick: (value: string) => void | Promise<void>;
      /** Com isto, cada opção ganha um ▶ que toca a amostra dela (as vozes).
       *  Recebe o valor e devolve o nome que a voz fala. */
      ouvir?: (value: string) => string;
    }
  ): void {
    const { items, value, ouvir } = opts;
    const atual = items.find((i) => i.value === value);
    const btn = row.controlEl.createEl("button", {
      cls: "axxa-pick",
      attr: {
        type: "button",
        "aria-haspopup": "menu",
        "aria-label": `${row.nameEl.textContent ?? ""}: ${atual?.label ?? value}`,
      },
    });
    const ico = btn.createSpan({ cls: "axxa-pick-ico" });
    if (atual?.glyph) {
      ico.addClass("is-glyph");
      ico.setText(atual.glyph);
    } else if (atual?.icon) {
      setIcon(ico, atual.icon);
    }
    // Um valor que a lista não conhece (gravado por uma versão antiga, ou um
    // modelo que saiu do catálogo) aparece cru em vez de sumir.
    btn.createSpan({ cls: "axxa-pick-label", text: atual?.label ?? value });
    setIcon(btn.createSpan({ cls: "axxa-pick-chev" }), "chevrons-up-down");
    btn.onclick = (ev) =>
      openActions(
        ev,
        items.map((i) => ({
          label: i.label,
          icon: i.icon,
          glyph: i.glyph,
          checked: i.value === value,
          extra: ouvir && {
            icon: "play",
            label: tr("Play {name}", { name: i.label }),
            run: (b: HTMLButtonElement) => this.tocarAmostra(b, i.value, ouvir(i.value)),
          },
          run: () => {
            if (i.value !== value) void opts.onPick(i.value);
          },
        })),
        { escolha: true, aoFechar: ouvir && (() => this.pararAmostra()) }
      );
  }

  /** Um `control` de texto desenhado como menu de escolha. Grava pelo MESMO
   *  caminho dos controles do Obsidian (writeValue), com os mesmos efeitos. */
  private paintPick(row: Setting, key: TextKey, items: () => PickItem[]): void {
    const atual = this.readValue(key);
    this.pickButton(row, {
      items: items(),
      // Controle de texto lê string; qualquer outra coisa é "nada escolhido".
      value: typeof atual === "string" ? atual : "",
      onPick: async (v) => {
        await this.writeValue(key, v);
        this.repaint(`pick:${key}`);
        // Escolher pode mostrar ou esconder linhas (quem lê decide as vozes).
        this.refreshVisibility();
      },
      // As vozes da OpenAI: o valor é o nome ("coral" → "Coral").
      ouvir: key === "ttsVoice" ? nomeProprio : undefined,
    });
  }

  // ── Os níveis de esforço ──────────────────────────────────────────────────

  /** Uma linha por nível: o desenho dele, os números que valem agora e o
   *  botão que abre o editor (settings/effortEditor.ts). */
  private paintEffortLevel(row: Setting, level: EffortLevel): void {
    const s = this.s;
    // O repaint do slot só limpa os controles: sem tirar o ícone da vez
    // anterior, cada edição somaria mais um na frente do nome. E o ícone nasce
    // DENTRO do nome (createSpan do próprio elemento) — o global criaria no
    // documento da janela principal, e no desktop as settings são outra janela.
    row.nameEl.querySelector(".axxa-effort-ico")?.remove();
    const ico = row.nameEl.createSpan({ cls: "axxa-effort-ico" });
    setIcon(ico, EFFORT_ICONS[level]);
    row.nameEl.prepend(ico);
    const editado = nivelEditado(s.effortConfigs, level);
    row.setDesc(resumoDoNivel(s.effortConfigs, level) + (editado ? ` · ${tr("edited")}` : ""));
    row.addButton((b) =>
      b.setButtonText(tr("Edit")).onClick(() => {
        new EffortLevelModal(this.app, this.plugin, level, () =>
          this.repaint(`effort:${level}`)
        ).open();
      })
    );
  }

  // ── A assistente de criação ───────────────────────────────────────────────
  // Ela escreve skills e projetos por você. Mora no Chat, e não junto dos
  // providers, porque não é sobre com quem você conversa — é sobre quem te
  // ajuda a montar as coisas. E tem modelo PRÓPRIO de propósito: preencher um
  // formulário não justifica o modelo caro da conversa.

  private paintAssistantModel(row: Setting): void {
    const s = this.s;
    const alvo = escolherAssistente({
      assistantProvider: s.assistantProvider,
      assistantModel: s.assistantModel,
      favoriteModels: s.favoriteModels,
      activeModels: s.activeModels,
      freeModels: s.freeModels,
    });
    const livres = s.freeModels?.openrouter ?? [];

    row.setDesc(
      alvo
        ? tr("Writes skills and projects for you. Now: {model}", {
            model:
              prettyModelName(alvo.model) +
              (ehFree(alvo.model, livres) ? ` · ${tr("free")}` : ""),
          })
        : tr("Nothing free found yet — run SCAN on OpenRouter, or pick a model here.")
    );
    // O nome é o NOSSO (prettyModelName), como em toda parte do app — o id
    // cru do catálogo só aparece onde ele É o dado (a chave, o debug).
    const todos = [
      ...new Set([...(s.activeModels?.openrouter ?? []), ...livres]),
    ].sort();
    this.pickButton(row, {
      items: [
        // "Automático" primeiro, e é o padrão: id de modelo free muda de nome
        // e some do catálogo, então deixar a gente procurar sozinha envelhece
        // melhor que fixar um.
        {
          value: "",
          // Curto pra caber na largura do botão: a lista embaixo dele é toda
          // do OpenRouter, e a descrição da linha diz quando falta modelo.
          label: tr("Automatic — first free model"),
          icon: "wand-sparkles",
        },
        ...todos.map((id) => ({
          value: id,
          label: ehFree(id, livres)
            ? `${prettyModelName(id)} · ${tr("free")}`
            : prettyModelName(id),
          icon: modelLogo(id),
        })),
      ],
      value: s.assistantModel ?? "",
      onPick: async (v) => {
        s.assistantModel = v;
        s.assistantProvider = v ? "openrouter" : "";
        await this.save();
        this.repaint("assistant");
      },
    });
  }

  // ── Voz ───────────────────────────────────────────────────────────────────

  private paintTtsProvider(row: Setting): void {
    const s = this.s;
    this.pickButton(row, {
      items: TTS_PROVIDERS.map((p) => ({
        value: p.id,
        label: ttsReady(this.plugin, p.id)
          ? p.label
          : tr("{provider} (needs {what})", { provider: p.label, what: tr(p.needs) }),
        // A ElevenLabs não tem logo no nosso set; a onda diz "voz".
        icon: p.id === "openai" ? "logo-openai" : "audio-waveform",
      })),
      value: s.ttsProvider,
      onPick: async (v) => {
        s.ttsProvider = v;
        await this.save();
        this.repaint("ttsWho");
        this.refreshVisibility();
      },
    });
  }

  private paintElevenKey(row: Setting): void {
    const s = this.s;
    row.addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder(tr("key…"))
        .setValue(s.elevenApiKey)
        .onChange(async (v) => {
          s.elevenApiKey = v.trim();
          await this.save();
          // "Who reads" diz se falta a chave; "no voices yet" só aparece com
          // chave. Os dois mudam com a digitação.
          this.repaint("ttsWho");
          this.refreshVisibility();
        });
    });
  }

  private paintSpendLimit(row: Setting): void {
    const s = this.s;
    row.addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.min = "0";
      t.inputEl.step = "0.5";
      t.inputEl.inputMode = "decimal";
      t.setPlaceholder(tr("No limit"))
        .setValue(s.limiteGastoDiario > 0 ? String(s.limiteGastoDiario) : "")
        .onChange(async (v) => {
          const n = Number(v.replace(",", "."));
          s.limiteGastoDiario = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
          await this.save();
        });
    });
  }

  private paintTavilyKey(row: Setting): void {
    const s = this.s;
    row.addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder(tr("Starts with tvly"))
        .setValue(s.tavilyApiKey ?? "")
        .onChange(async (v) => {
          s.tavilyApiKey = v.trim();
          await this.save();
        });
    });
  }

  private paintElevenFetch(row: Setting): void {
    row.addButton((b) =>
      b
        .setButtonText(this.fetchingVoices ? tr("Fetching…") : tr("Fetch voices"))
        .setCta()
        // Sem trava por key vazia: sem key, a própria chamada avisa.
        .setDisabled(this.fetchingVoices)
        .onClick(() => void this.fetchVoices())
    );
  }

  private paintElevenVoice(row: Setting): void {
    const s = this.s;
    if (s.elevenVoices.length === 0) return;
    this.pickButton(row, {
      items: s.elevenVoices.map((v) => {
        // A voz clonada é a que soa como você — ela ganha o desenho de pessoa.
        const own = v.category === "cloned" || v.category === "professional";
        return {
          value: v.id,
          label: own ? `${v.name} · ${tr("yours")}` : v.name,
          icon: own ? "user-round" : "audio-lines",
        };
      }),
      value: s.elevenVoice || s.elevenVoices[0].id,
      onPick: async (v) => {
        s.elevenVoice = v;
        await this.save();
        this.repaint("elevenVoice");
      },
      ouvir: (id) => s.elevenVoices.find((v) => v.id === id)?.name ?? "ElevenLabs",
    });
  }

  /** O botão que prova que a voz escolhida funciona. */
  private paintTestVoice(row: Setting): void {
    row.addButton((b) =>
      b.setButtonText(tr("Play sample")).onClick(async () => {
        b.setButtonText(tr("Playing…")).setDisabled(true);
        // `speak` precisa começar DENTRO do clique: é lá que ele destrava o
        // áudio (o navegador recusa tocar fora do gesto).
        await speak(this.plugin, fraseDaAmostra(this.nomeDaVozAtual(), this.idiomaDaAmostra()), {
          guardar: true,
        });
        b.setButtonText(tr("Play sample")).setDisabled(false);
      })
    );
  }

  // ── A amostra das vozes ───────────────────────────────────────────────────
  // O ▶ de cada voz da lista toca a frase de amostra NELA, sem escolher. Uma
  // por vez: tocar outra para a de antes, e tocar de novo a mesma para.

  private tocarAmostra(botao: HTMLButtonElement, voz: string, nome: string): void {
    if (this.amostra === botao) {
      stopSpeaking();
      return;
    }
    const rotulo = botao.getAttribute("aria-label") ?? tr("Play");
    const desenhar = (estado: "parado" | "buscando" | "tocando") => {
      botao.toggleClass("is-loading", estado === "buscando");
      botao.toggleClass("is-playing", estado === "tocando");
      setIcon(botao, estado === "parado" ? "play" : estado === "buscando" ? "loader" : "square");
      botao.setAttribute("aria-label", estado === "parado" ? rotulo : tr("Stop"));
    };
    this.amostra = botao;
    desenhar("buscando");
    // `speak` começa DENTRO do toque: é lá que ele destrava o áudio (fora do
    // gesto, o navegador recusa tocar quando a rede responder).
    void speak(this.plugin, fraseDaAmostra(nome, this.idiomaDaAmostra()), {
      voice: voz,
      guardar: true,
      onPlaying: () => desenhar("tocando"),
    }).finally(() => {
      desenhar("parado");
      if (this.amostra === botao) this.amostra = null;
    });
  }

  /** Para a amostra que estiver tocando (e só ela — a leitura do chat não). */
  private pararAmostra(): void {
    if (this.amostra) stopSpeaking();
  }

  /** O idioma em que as vozes se apresentam (ver settings/amostra.ts). */
  private idiomaDaAmostra(): string {
    return idiomaDaAmostra(this.s.voiceLanguage, getLanguage());
  }

  /** O nome da voz que lê hoje — o do botão Test. */
  private nomeDaVozAtual(): string {
    const s = this.s;
    if (s.ttsProvider === "eleven") {
      return s.elevenVoices.find((v) => v.id === s.elevenVoice)?.name ?? "ElevenLabs";
    }
    return nomeProprio(s.ttsVoice);
  }

  private async fetchVoices(): Promise<void> {
    if (this.fetchingVoices) return;
    this.fetchingVoices = true;
    this.repaint("elevenFetch");
    try {
      const voices = await elevenVoices(this.s.elevenApiKey);
      this.s.elevenVoices = voices.map((v) => ({
        id: v.id,
        name: v.name,
        category: v.category,
      }));
      if (!this.s.elevenVoice && voices[0]) this.s.elevenVoice = voices[0].id;
      await this.save();
      const minhas = voices.filter(
        (v) => v.category === "cloned" || v.category === "professional"
      ).length;
      new Notice(
        (voices.length === 1 ? tr("1 voice") : tr("{n} voices", { n: voices.length })) +
          (minhas > 0
            ? " · " + (minhas === 1 ? tr("1 yours") : tr("{n} yours", { n: minhas }))
            : "") +
          "."
      );
    } catch (err) {
      new Notice(
        tr("Could not load voices: {error}", {
          error: err instanceof Error ? err.message : String(err),
        })
      );
    } finally {
      this.fetchingVoices = false;
      this.repaint("elevenFetch");
      this.repaint("elevenVoice");
      this.refreshVisibility();
    }
  }

  // ── Vault Q&A ─────────────────────────────────────────────────────────────

  /** Linha viva: a lista cresce com os modelos de embedding descobertos. */
  /** O modelo de embedding do Q&A — o último menu nativo das settings, agora
   *  de escolha: o logo do provider (é a chave dele que o modelo usa), o nome
   *  do jeito do app, e os avisos que decidem a escolha (grátis, falta a
   *  chave). Os descobertos pelo Fetch entram aqui (getAllEmbeddingModels). */
  private paintEmbeddingModel(row: Setting): void {
    const s = this.s;
    const specs = getAllEmbeddingModels();
    this.pickButton(row, {
      items: specs.map((spec) => {
        // O mesmo "grátis de verdade" da lista de modelos: a lista do fetch
        // (NIM, OpenRouter) e o tier da conta no Gemini.
        // Local (Ollama) não é "grátis de um provider": é a máquina de quem
        // usa, e a etiqueta diz isso — nada sai dela.
        const gratis = spec.local
          ? tr("local")
          : spec.provider === "gemini"
            ? geminiTemTierGratis(spec.model)
              ? tr("free tier")
              : ""
            : gratisDeVerdade(spec.model, s.freeModels?.[spec.provider], spec.free === true)
              ? tr("free")
              : "";
        const extras = [
          gratis,
          providerConfigured(this.plugin, spec.provider)
            ? ""
            : spec.provider === "ollama"
              ? tr("needs Ollama")
              : tr("needs key"),
        ].filter(Boolean);
        return {
          value: spec.model,
          label: [prettyModelName(spec.model), ...extras].join(" · "),
          icon:
            PROVIDERS.find((p) => p.id === spec.provider)?.icon ?? "box",
        };
      }),
      value: s.ragEmbeddingModel,
      onPick: async (v) => {
        const spec = specs.find((m) => m.model === v);
        s.ragEmbeddingModel = v;
        if (spec) s.ragEmbeddingProvider = spec.provider;
        await this.save();
        this.repaint("embedding");
        // Modelo novo = vetores de outro tamanho: a linha do índice avisa.
        this.repaint("index");
      },
    });
  }

  private paintIndex(row: Setting): void {
    const s = this.s;
    const size = this.plugin.vectorIndex?.size ?? 0;
    // Precisão e pedaços só valem na próxima atualização: a linha diz quando
    // o índice carregado ainda é o do jeito antigo.
    const pendente = pendenciaDoIndice(this.plugin.vectorIndex ?? null, s);
    const folder = s.ragIndexPath;
    row.setDesc(
      (size === 0
        ? tr("No index yet (folder: {folder}).", { folder })
        : size === 1
          ? tr("Index loaded: 1 chunk (folder: {folder}).", { folder })
          : tr("Index loaded: {n} chunks (folder: {folder}).", { n: size, folder })) +
        (pendente ? ` ${pendente}` : "")
    );
    row
      .addButton((b) =>
        b
          .setButtonText(this.plugin.indexing ? tr("Cancel indexing") : tr("Index vault"))
          .setCta()
          .onClick(() => void this.runIndex())
      )
      .addButton((b) =>
        // marcarPerigoso e não setWarning: ver a nota em ui/modals.ts.
        marcarPerigoso(b.setButtonText(tr("Delete index")))
          .setDisabled(size === 0 && !this.plugin.vectorIndex)
          .onClick(async () => {
            await deleteIndex(this.app.vault.adapter, s.ragIndexPath);
            this.plugin.vectorIndex = null;
            new Notice(tr("Index deleted."));
            this.repaint("index");
          })
      );
  }

  /** A indexação mora no plugin (dois chamadores: aqui e a linha da home). */
  private async runIndex(): Promise<void> {
    const run = this.plugin.runVaultIndex();
    // O plugin marca `indexing` antes do primeiro await: o botão já vira
    // "Cancel indexing" enquanto roda (e um toque nele cancela).
    this.repaint("index");
    await run;
    this.repaint("index");
  }
}

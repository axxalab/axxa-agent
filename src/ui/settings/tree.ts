// src/ui/settings/tree.ts
// A ÁRVORE das settings: todas as linhas, a aba de cada uma e como cada uma se
// desenha. É a fonte única dos dois caminhos:
//
//   • Obsidian 1.13+ → `getSettingDefinitions()` devolve isto e o Obsidian
//                      desenha (cartões nativos + busca global das settings);
//   • 1.11.4–1.12.x  → o `display()` desenha a MESMA árvore (ver legacy.ts).
//
// As abas (Providers, Chat, …) e os providers NÃO são páginas do Obsidian:
// cada grupo leva a classe da sua aba (`axxa-set-tab-chat`) e do seu provider
// (`axxa-set-prov-openai`), e o CSS esconde o que não é a aba ativa pelos
// atributos `data-axxa-tab`/`data-axxa-prov` do container. Esconder por CSS, e
// não pelo `visible` da API, é o que deixa TODA linha na busca: no 1.13
// `visible: false` tira a linha da busca junto.
//
// Sem DOM aqui: a árvore é montada no `onload` (addSettingTab → update()) e
// nos testes, em node. Quem desenha são as funções `render` que a aba entrega
// (SettingsUi).
//
// Regras que o desenhista do 1.13 cobra (app.js 1.13.7):
//   • `name` sempre string — um nome que não é string quebra a busca inteira;
//   • título de grupo único, e dentro do grupo linhas com chave única
//     (`ctrl:<key>` pra control, `name:<nome>` pro resto) — repetido vira
//     "duplicate setting key" e reaproveita a linha errada no redesenho;
//   • a busca mostra SÓ o nome. Por isso as linhas `render` levam o nome longo
//     ("OpenAI API key") e o render troca pro curto na tela ("API key").

import type {
  Setting,
  SettingDefinition,
  SettingDefinitionGroup,
  SettingDefinitionItem,
  SettingGroup,
  SettingGroupItem,
} from "obsidian";
import type { AxxaSettings } from "../../main";
import { PROVIDERS } from "../../core/providersMeta";
import {
  EFFORT_ICONS,
  EFFORT_LABELS,
  EFFORT_LEVELS,
  type EffortLevel,
} from "../../core/effort";
import { CHAT_MODES } from "../../core/session";
import { MODULES } from "../modules";
import { QUANT_ITENS } from "./indice";
import { LOCALES } from "../../i18n";
import { marca, tr } from "../../i18n/tr";
import { PERMISSION_ICONS, PERMISSION_LABELS } from "../../agent/permissions";
import type { PermissionLevel } from "../../agent/types";
import { ELEVEN_MODELS } from "../../providers/elevenlabs";
import { prettyModelName } from "../../providers/modelDescriptions";
import { FREE_TOKENS_AS_OF } from "../../usage/freeTokens";
import { OPENAI_TTS_MODELS, OPENAI_VOICES, STT_MODELS } from "../readAloud";
import type { BoolKey, TextKey } from "./values";

export type TabId = "providers" | "chat" | "vault" | "rag" | "agent" | "mobile";

export interface TabDef {
  id: TabId;
  label: string;
  /** Uma linha explicando o que mora aqui. */
  blurb: string;
  mobileOnly?: boolean;
}

// Rótulo e linha só MARCADOS (marca): a barra de abas traduz na hora de
// desenhar (tr), porque o idioma pode mudar com o app aberto.
export const TABS: TabDef[] = [
  {
    id: "providers",
    label: marca("Providers"),
    blurb: marca("Your keys and the model each provider uses. Keys stay on this device."),
  },
  {
    id: "chat",
    label: marca("Chat"),
    blurb: marca("What every new conversation starts with."),
  },
  { id: "vault", label: marca("Vault"), blurb: marca("Where the plugin writes in your vault.") },
  {
    id: "rag",
    label: marca("Q&A"),
    blurb: marca("Vault Q&A: the local index that grounds answers in your notes."),
  },
  {
    id: "agent",
    label: marca("Agent"),
    blurb: marca("What the agent may do to your notes without asking."),
  },
  {
    id: "mobile",
    label: marca("Mobile"),
    blurb: marca("Options that only exist on the phone."),
    mobileOnly: true,
  },
];

export function tabsFor(isMobile: boolean): TabDef[] {
  return TABS.filter((t) => !t.mobileOnly || isMobile);
}

export type KeyField =
  | "openaiApiKey"
  | "anthropicApiKey"
  | "geminiApiKey"
  | "openrouterApiKey"
  | "nimApiKey";
export type ModelField =
  | "defaultModel"
  | "anthropicModel"
  | "geminiModel"
  | "openrouterModel"
  | "nimModel"
  | "ollamaModel";

export const PROVIDER_FIELDS: Record<string, { key?: KeyField; model: ModelField }> = {
  openai: { key: "openaiApiKey", model: "defaultModel" },
  anthropic: { key: "anthropicApiKey", model: "anthropicModel" },
  gemini: { key: "geminiApiKey", model: "geminiModel" },
  openrouter: { key: "openrouterApiKey", model: "openrouterModel" },
  nim: { key: "nimApiKey", model: "nimModel" },
  ollama: { model: "ollamaModel" },
};

/** Idiomas oferecidos pro ditado. Vazio = deixa o modelo detectar. */
export const SPEECH_LANGS: [string, string][] = [
  // Só o Auto se traduz: cada idioma aparece no nome dele mesmo.
  ["", marca("Auto (detect)")],
  ["pt", "Português"],
  ["en", "English"],
  ["es", "Español"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["it", "Italiano"],
  ["ja", "日本語"],
];

/** Uma opção de um menu de ESCOLHA (ver `escolha` abaixo e SettingsTab.paintPick). */
export interface PickItem {
  value: string;
  label: string;
  icon?: string;
  /** Texto curto no lugar do ícone (o código de um idioma). */
  glyph?: string;
}

/** Os modelos de ditado — o que os separa é rapidez contra precisão. */
const STT_ICONS: Record<string, string> = {
  "gpt-4o-mini-transcribe": "zap",
  "gpt-4o-transcribe": "sparkles",
  "whisper-1": "history",
};

/** As qualidades de leitura da OpenAI: com intenção, limpa, barata. */
const TTS_ICONS: Record<string, string> = {
  "gpt-4o-mini-tts": "sparkles",
  "tts-1-hd": "gem",
  "tts-1": "zap",
};

/** As da ElevenLabs: a melhor, a mais rápida, a mais rápida de todas. */
const ELEVEN_ICONS: Record<string, string> = {
  eleven_multilingual_v2: "sparkles",
  eleven_turbo_v2_5: "fast-forward",
  eleven_flash_v2_5: "zap",
};

/** "alloy" → "Alloy": o nome de uma voz é nome próprio. */
export function nomeProprio(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A linha desenhada à mão. Pode devolver a limpeza (roda antes de redesenhar). */
export type RowRender = (row: Setting, group: SettingGroup) => void | (() => void);

/** Onde uma linha mora — o que a busca precisa pra abrir a aba certa. */
export interface Place {
  tab: TabId;
  provider?: string;
}

/** O que a árvore pede à aba: estado pra decidir visibilidade e os desenhos. */
export interface SettingsUi {
  readonly isMobile: boolean;
  settings(): AxxaSettings;
  hasCredential(providerId: string): boolean;
  /** Quantos modelos do catálogo da OpenAI ganhariam cota com o data-sharing. */
  freeOfferCount(): number;
  nav: RowRender;
  rail: RowRender;
  /** Chave de API — ou o endpoint, no Ollama. */
  credential(providerId: string): RowRender;
  connection(providerId: string): RowRender;
  newChatModel(providerId: string): RowRender;
  fetchModels(providerId: string): RowRender;
  catalog(providerId: string): RowRender;
  freeOffer: RowRender;
  /** Menu de escolha com ícone, no lugar de um <select>. `items` é chamado a
   *  cada desenho — listas que mudam (vozes, modelos) chegam frescas. */
  pick(key: TextKey, items: () => PickItem[], tab: TabId): RowRender;
  /** A linha de um nível de esforço, que abre o editor dele. */
  effortLevel(level: EffortLevel): RowRender;
  assistantModel: RowRender;
  ttsProvider: RowRender;
  elevenKey: RowRender;
  tavilyKey: RowRender;
  spendLimit: RowRender;
  elevenFetch: RowRender;
  elevenVoice: RowRender;
  testVoice: RowRender;
  embeddingModel: RowRender;
  index: RowRender;
  hint(text: string): RowRender;
}

export interface SettingsTree {
  items: SettingDefinitionItem[];
  /** Linha/grupo → aba (e provider). Por identidade: é o objeto que a busca devolve. */
  places: WeakMap<object, Place>;
}

interface RowExtras {
  visible?: () => boolean;
  searchable?: boolean;
  aliases?: string[];
}

const KEY_ALIASES = ["key", "token", "chave", "credential", "credencial"];

/** O rótulo curto na tela, o longo na busca (o 1.13 escreve o nome ANTES do render). */
function shownAs(name: string, render: RowRender): RowRender {
  return (row, group) => {
    row.setName(name);
    return render(row, group);
  };
}

function toggle(
  name: string,
  desc: string,
  key: BoolKey,
  more: RowExtras = {}
): SettingDefinition {
  return { name, desc, control: { type: "toggle", key }, ...more };
}

// Não há mais `dropdown`: todo menu das settings é de ESCOLHA (o balão com
// ícone — ver `escolha` e SettingsTab.pickButton). O <select> nativo abre, no
// Android, a caixa do sistema, sem ícone e longe do que foi tocado.

function text(
  name: string,
  desc: string,
  key: TextKey,
  more: RowExtras = {}
): SettingDefinition {
  return { name, desc, control: { type: "text", key }, ...more };
}

/** Linha `render`. `shown` = o nome curto da tela (null = o mesmo da busca). */
function custom(
  name: string,
  shown: string | null,
  desc: string,
  render: RowRender,
  more: RowExtras = {}
): SettingDefinition {
  return {
    name,
    ...(desc ? { desc } : {}),
    render: shown ? shownAs(shown, render) : render,
    ...more,
  };
}

/**
 * Um render que explode não derruba a aba: no 1.13 o desenhista chama o render
 * sem try/catch, e um erro numa linha pararia o desenho de todas as de baixo.
 */
function guarded(render: RowRender): RowRender {
  return (row, group) => {
    try {
      return render(row, group);
    } catch (err) {
      console.error("[axxa] settings: uma linha falhou ao desenhar", err);
      row.setDesc(tr("This setting failed to draw — see the developer console."));
    }
  };
}

/** Recado curto — o que falta pra linha de cima funcionar. Fora da busca. */
function hintRow(render: RowRender, visible?: () => boolean): SettingDefinition {
  return { name: "", render, searchable: false, ...(visible ? { visible } : {}) };
}

// Os textos da árvore passam pelo tr() AQUI, na montagem: ela é montada em
// tempo de execução (no addSettingTab e a cada troca de idioma — ver
// SettingsTab.retraduzir), nunca no import.
export function buildSettingsTree(ui: SettingsUi): SettingsTree {
  const items: SettingDefinitionItem[] = [];
  const places = new WeakMap<object, Place>();
  const s = () => ui.settings();

  function group(
    place: Place | null,
    opts: { heading?: string; cls?: string },
    rows: SettingGroupItem[]
  ): void {
    const cls = [
      "axxa-set-group",
      place ? `axxa-set-tab-${place.tab}` : "",
      place?.provider ? `axxa-set-prov-${place.provider}` : "",
      opts.cls ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    for (const r of rows) {
      const withRender = r as { render?: RowRender };
      if (withRender.render) withRender.render = guarded(withRender.render);
    }
    const g: SettingDefinitionGroup = { type: "group", cls, items: rows };
    if (opts.heading) g.heading = opts.heading;
    if (place) {
      places.set(g, place);
      for (const r of rows) places.set(r, place);
    }
    items.push(g);
  }

  /**
   * Menu de ESCOLHA com ícone — o balão do ⋯ das conversas no lugar do
   * <select> nativo, que no Android abre a caixa do sistema (rádio, sem ícone,
   * longe do que foi tocado). É uma linha `render`, então o nome precisa ser
   * único no grupo (o 1.13 chaveia por ele): `shown` é o curto da tela.
   */
  function escolha(
    at: Place,
    name: string,
    shown: string | null,
    desc: string,
    key: TextKey,
    itens: () => PickItem[],
    more: RowExtras = {}
  ): SettingDefinition {
    return custom(name, shown, desc, ui.pick(key, itens, at.tab), more);
  }

  // ── a barra de abas: sempre à vista, sem cartão ──────────────────────────
  group(null, { cls: "axxa-set-flat axxa-set-navgroup" }, [
    { name: "", render: ui.nav, searchable: false },
  ]);

  // ── Providers ────────────────────────────────────────────────────────────
  group({ tab: "providers" }, { cls: "axxa-set-flat axxa-set-railgroup" }, [
    { name: "", render: ui.rail, searchable: false },
  ]);

  for (const p of PROVIDERS) {
    const f = PROVIDER_FIELDS[p.id];
    if (!f) continue;
    const at: Place = { tab: "providers", provider: p.id };

    group(at, { heading: p.name }, [
      f.key
        ? custom(
            tr("{provider} API key", { provider: p.name }),
            tr("API key"),
            tr("Stored in the OS keychain (not in data.json)."),
            ui.credential(p.id),
            { aliases: KEY_ALIASES }
          )
        : custom(
            tr("{provider} endpoint", { provider: p.name }),
            tr("Endpoint"),
            tr("Local server address. Ollama needs no key."),
            ui.credential(p.id),
            { aliases: ["url", "server", "servidor", "endereço"] }
          ),
      custom(
        tr("{provider} connection", { provider: p.name }),
        tr("Connection"),
        "",
        ui.connection(p.id),
        { aliases: ["test", "testar", "conexão"] }
      ),
      custom(
        tr("{provider} model for new chats", { provider: p.name }),
        tr("Model for new chats"),
        tr("Used when this provider is selected and nothing else was picked."),
        ui.newChatModel(p.id),
        { aliases: ["modelo", "default model"] }
      ),
    ]);

    // A cota diária é um programa DA OPENAI; prometê-la nos outros seria
    // inventar desconto.
    if (p.id === "openai") {
      group(at, { heading: tr("Free daily tokens") }, [
        toggle(
          tr("I share API data with OpenAI"),
          tr(
            "Their switch, in Data controls on platform.openai.com. Turning it on there gives your account a daily quota at no cost; telling us here is what makes this list show the real numbers."
          ),
          "openaiDataSharing",
          // "tier" também: com o interruptor desligado a linha do tier some da
          // busca (no 1.13 `visible` falso tira dela), e quem procura "tier"
          // precisa cair aqui, no que faz ela aparecer.
          { aliases: ["free", "grátis", "quota", "cota", "data controls", "tier"] }
        ),
        // O tier só muda a cota de quem COMPARTILHA: com o interruptor
        // desligado não há cota nenhuma, e um seletor de tier ali seria uma
        // escolha que não faz nada. Aparece quando o interruptor liga.
        escolha(
          at,
          tr("Usage tier"),
          null,
          tr(
            "Tiers 1–2 get 250k tokens/day on the big models and 2.5M/day on mini and nano. Tier 3 and up get 1M and 10M."
          ),
          "openaiTier",
          // O número do tier no lugar do ícone, e a cota dele no rótulo: é o
          // que decide a escolha.
          () =>
            [1, 2, 3, 4, 5].map((n) => ({
              value: String(n),
              label:
                n <= 2
                  ? tr("Tier {n} — 250k / 2.5M a day", { n })
                  : tr("Tier {n} — 1M / 10M a day", { n }),
              glyph: String(n),
            })),
          {
            visible: () => s().openaiDataSharing === true,
            aliases: ["tier", "quota", "cota"],
          }
        ),
        hintRow(
          ui.freeOffer,
          () => !s().openaiDataSharing && ui.freeOfferCount() > 0
        ),
        hintRow(
          ui.hint(
            tr(
              "The quota counts ALL your OpenAI API use, not just this vault — so anything the app says you have left is optimistic. Image models are never covered. Program terms as of {date}.",
              { date: FREE_TOKENS_AS_OF }
            )
          )
        ),
      ]);
    }

    // O plano da chave do Gemini: a API não conta se o projeto tem cobrança,
    // e sem isso o gasto do dia conta o grátis pelo preço pago (ver
    // usage/pricing.ts).
    if (p.id === "gemini") {
      group(at, { heading: tr("Free tier") }, [
        toggle(
          tr("My Gemini key is on the free tier"),
          tr(
            "Turn this on if the Google Cloud project behind your key has no billing. Gemini models with a free tier then count as $0 in the daily spending and Usage, and keep working when paid models pause at the limit. Leave it off if billing is on: those requests are charged."
          ),
          "geminiFreeTier",
          { aliases: ["free", "grátis", "billing", "cobrança", "tier", "budget", "orçamento"] }
        ),
      ]);
    }

    // Sem título: um "Models" por provider repetiria a chave do grupo. A
    // primeira linha já diz o que é o cartão.
    group(at, {}, [
      custom(
        tr("{provider} models", { provider: p.name }),
        tr("Models"),
        tr("Fetch what this provider offers today, then choose what shows up where."),
        ui.fetchModels(p.id),
        { aliases: ["modelos", "catalog", "catálogo", "favorites", "favoritos"] }
      ),
      { name: "", render: ui.catalog(p.id), searchable: false },
    ]);
  }

  // ── Chat ─────────────────────────────────────────────────────────────────
  const chat: Place = { tab: "chat" };
  // Os menus desta aba são todos de ESCOLHA com ícone (ver `escolha`).
  group(chat, {}, [
    escolha(
      chat,
      tr("Provider"),
      null,
      tr("Which provider a new chat opens with."),
      "defaultProvider",
      () => PROVIDERS.map((p) => ({ value: p.id, label: p.name, icon: p.icon })),
      { aliases: ["default provider"] }
    ),
    escolha(
      chat,
      tr("Mode"),
      null,
      tr("Chat, Vault Q&A or Agent. Locks on the first message."),
      "defaultMode",
      () =>
        CHAT_MODES.map((m) => ({
          value: m,
          label: tr(MODULES[m].label),
          icon: MODULES[m].icon,
        })),
      { aliases: ["modo"] }
    ),
    escolha(
      chat,
      tr("Effort"),
      null,
      tr("How hard the model works: length, agent turns, temperature."),
      "defaultEffort",
      () =>
        EFFORT_LEVELS.map((l) => ({
          value: l,
          label: tr(EFFORT_LABELS[l]),
          icon: EFFORT_ICONS[l],
        })),
      { aliases: ["esforço", "reasoning"] }
    ),
    escolha(
      chat,
      tr("Language"),
      null,
      tr(
        "Interface, chat errors — and the language the model answers in. The creation assistant follows it too. \"Same as Obsidian\" follows the language Obsidian is set to. A few things, like command names, only switch after you reload Obsidian."
      ),
      "language",
      () =>
        LOCALES.map((l) =>
          // O Auto não é um idioma: ganha o desenho de "idiomas", e os de
          // verdade o código (EN, PT). Só ele se traduz — cada idioma
          // aparece no nome dele mesmo.
          l.id === "auto"
            ? { value: l.id, label: tr(l.label), icon: "languages" }
            : { value: l.id, label: l.label, glyph: l.id.slice(0, 2).toUpperCase() }
        ),
      { aliases: ["idioma", "língua", "portuguese", "português"] }
    ),
  ]);

  // O que cada nível de esforço FAZ — tokens, voltas do agente, temperatura,
  // quanto do vault entra. O motor sempre leu isto (effortConfigs); a tela
  // sumiu na 0.4.0 e voltou: uma linha por nível, que abre o editor dele.
  group(
    chat,
    { heading: tr("Effort levels") },
    EFFORT_LEVELS.map((l) =>
      custom(
        tr("{level} effort level", { level: tr(EFFORT_LABELS[l]) }),
        tr(EFFORT_LABELS[l]),
        "",
        ui.effortLevel(l),
        {
          aliases: [
            "effort",
            "esforço",
            "tokens",
            "temperature",
            "temperatura",
            "turns",
            "agent",
          ],
        }
      )
    )
  );

  // O orçamento do dia: o limite em dólar e o que acontece quando ele chega.
  // A conta sai dos preços públicos (ver usage/gastoDoDia.ts), e o Left today
  // da tela de Uso mostra o quanto sobra.
  group(chat, { heading: tr("Daily spending") }, [
    custom(
      tr("Daily limit"),
      null,
      tr(
        "In dollars, for paid models, counted from public token prices. You get a heads-up at 80% and at 100%. Empty means no limit."
      ),
      ui.spendLimit,
      { aliases: ["budget", "orçamento", "gasto", "limite", "spending", "cost", "custo"] }
    ),
    toggle(
      tr("Stop paid models at the limit"),
      tr(
        "When today's spending reaches the limit, paid models pause until midnight. Free and local models keep working, and so do models without a public price. Gemini counts as paid unless you mark your key as free tier in Providers › Gemini."
      ),
      "travarNoLimite",
      { aliases: ["budget", "orçamento", "travar", "pause", "block"] }
    ),
  ]);

  group(chat, { heading: tr("Assistant") }, [
    custom(tr("Assistant model"), tr("Model"), "", ui.assistantModel, {
      aliases: ["modelo", "assistente", "skills", "projects"],
    }),
    toggle(
      tr("Let it see your note names"),
      tr(
        "So it can suggest which notes to attach to a project. Only the paths are sent — never what is inside them. Off by default."
      ),
      "assistantSeesVault",
      { aliases: ["notes", "notas", "privacy", "privacidade"] }
    ),
  ]);

  // Voz: duas coisas diferentes, na ordem em que a pessoa decide — FALAR COM
  // o chat (ditado) e OUVIR o chat (leitura). Ligo? por quem? com que voz?
  const voiceOn = () => s().voiceEnabled;
  const ttsOn = () => s().ttsEnabled;
  // Tudo que não é "eleven" lê pela OpenAI — o mesmo critério de sempre.
  const openaiReads = () => s().ttsEnabled && s().ttsProvider !== "eleven";
  const elevenReads = () => s().ttsEnabled && s().ttsProvider === "eleven";

  group(chat, { heading: tr("Voice") }, [
    toggle(
      tr("Talk instead of typing"),
      tr(
        "Puts a microphone in the composer: you speak, the words land in the box, and you send when you are happy with them."
      ),
      "voiceEnabled",
      // "voice" tem de achar os DOIS interruptores de voz: as linhas com
      // "Voice" no nome só existem com a leitura ligada (e escondida, a busca
      // do 1.13 não vê a linha).
      {
        aliases: [
          "voice",
          "speech to text",
          "dictation",
          "ditado",
          "microphone",
          "microfone",
          "voz",
        ],
      }
    ),
    hintRow(
      ui.hint(tr("Dictation runs on OpenAI — add that key in Providers.")),
      () => voiceOn() && !ui.hasCredential("openai")
    ),
    escolha(
      chat,
      tr("Ears"),
      null,
      tr(
        "Mini is quick, cheap and gets normal speech right; the full one is better with names, accents and noise."
      ),
      "voiceModel",
      () =>
        STT_MODELS.map((m) => ({
          value: m,
          label: prettyModelName(m),
          icon: STT_ICONS[m] ?? "ear",
        })),
      { visible: voiceOn, aliases: ["transcription", "transcrição", "whisper"] }
    ),
    escolha(
      chat,
      tr("What you speak"),
      null,
      tr(
        "Naming your language beats letting it guess — short takes are where guessing goes wrong."
      ),
      "voiceLanguage",
      // Vazio = deixa o modelo detectar: esse ganha um desenho, os idiomas
      // ganham o código.
      () =>
        SPEECH_LANGS.map(([value, label]) =>
          value
            ? { value, label, glyph: value.toUpperCase() }
            : { value, label: tr(label), icon: "wand-sparkles" }
        ),
      { visible: voiceOn, aliases: ["idioma", "language"] }
    ),
    toggle(
      tr("Read answers out loud"),
      tr("Adds a Listen button under every answer."),
      "ttsEnabled",
      {
        aliases: ["voice", "text to speech", "tts", "listen", "ouvir", "voz", "read aloud"],
      }
    ),
    custom(
      tr("Who reads"),
      null,
      tr(
        "OpenAI voices are ready to use. ElevenLabs sounds better and is the only one that can read in YOUR voice — clone it in their app and it shows up in the list below."
      ),
      ui.ttsProvider,
      { visible: ttsOn, aliases: ["elevenlabs", "voz", "tts"] }
    ),
    hintRow(
      ui.hint(tr("Add your OpenAI key in Providers to hear anything.")),
      () => openaiReads() && !ui.hasCredential("openai")
    ),
    escolha(
      chat,
      tr("Voice"),
      null,
      tr("Eleven of them — tap ▶ in the list to hear one before you pick it."),
      "ttsVoice",
      () =>
        OPENAI_VOICES.map((v) => ({
          value: v,
          label: nomeProprio(v),
          icon: "audio-lines",
        })),
      { visible: openaiReads, aliases: ["voz"] }
    ),
    // Duas "Quality" no mesmo grupo (OpenAI e ElevenLabs): linha `render` é
    // chaveada pelo nome, então o nome da busca é o longo e a tela mostra o
    // curto. De quebra, a busca deixou de achar duas linhas iguais.
    escolha(
      chat,
      tr("OpenAI voice quality"),
      tr("Quality"),
      tr(
        "gpt-4o-mini-tts reads with intention; tts-1 is the cheap classic; the HD one is the same voice, cleaner."
      ),
      "ttsModel",
      () =>
        OPENAI_TTS_MODELS.map((m) => ({
          value: m,
          label: m,
          icon: TTS_ICONS[m] ?? "audio-lines",
        })),
      { visible: openaiReads, aliases: ["quality", "qualidade"] }
    ),
    custom(
      tr("Test OpenAI voice"),
      tr("Test"),
      tr("Plays one short line with the settings above."),
      ui.testVoice,
      { visible: openaiReads, aliases: ["play sample", "testar voz"] }
    ),
    // A marca entra como variável: "ElevenLabs key" sozinha já é a chave do
    // "(needs …)" de ui/readAloud.ts, que no meio da frase vai em minúscula.
    custom(
      tr("{provider} key", { provider: "ElevenLabs" }),
      null,
      tr(
        "From elevenlabs.io › Profile › API key. Stored in the OS keychain (not in data.json)."
      ),
      ui.elevenKey,
      { visible: elevenReads, aliases: KEY_ALIASES }
    ),
    custom(
      tr("Your voices"),
      null,
      tr(
        "Fetch what your account has — the stock voices and any you cloned, including your own."
      ),
      ui.elevenFetch,
      { visible: elevenReads, aliases: ["clone", "cloned", "vozes", "elevenlabs"] }
    ),
    custom(
      tr("ElevenLabs voice"),
      tr("Voice"),
      tr(
        "Cloned ones are marked — that is the one that sounds like you. Tap ▶ in the list to hear any of them."
      ),
      ui.elevenVoice,
      { visible: () => elevenReads() && s().elevenVoices.length > 0, aliases: ["voz"] }
    ),
    hintRow(
      ui.hint(tr("No voices loaded yet — hit Fetch voices.")),
      () => elevenReads() && s().elevenVoices.length === 0 && !!s().elevenApiKey
    ),
    escolha(
      chat,
      tr("ElevenLabs voice quality"),
      tr("Quality"),
      tr("Multilingual sounds best; the faster ones answer sooner."),
      "elevenModel",
      () =>
        ELEVEN_MODELS.map((m) => ({
          value: m.id,
          label: tr(m.label),
          icon: ELEVEN_ICONS[m.id] ?? "audio-lines",
        })),
      { visible: elevenReads, aliases: ["quality", "qualidade"] }
    ),
    custom(
      tr("Test ElevenLabs voice"),
      tr("Test"),
      tr("Plays one short line with the settings above."),
      ui.testVoice,
      { visible: elevenReads, aliases: ["play sample", "testar voz"] }
    ),
  ]);

  // ── Vault ────────────────────────────────────────────────────────────────
  group({ tab: "vault" }, {}, [
    text(
      tr("Chats folder"),
      tr(
        "Each chat is a .md file under <folder>/<mode>/. A folder starting with a dot is hidden from the file explorer, search and graph — which is why the default is .axxa/chats."
      ),
      "chatsPath",
      { aliases: ["pasta", "conversas", "path"] }
    ),
    text(
      tr("Skills folder"),
      tr("Each skill is a .md note (frontmatter + prompt body)."),
      "skillsPath",
      { aliases: ["pasta", "path"] }
    ),
    // Era a única pasta do plugin sem campo: aparecia só como texto na linha
    // do índice. Trocar não MOVE o índice (seria copiar megabytes no meio de
    // uma digitação): a pasta nova começa vazia e a antiga fica onde estava.
    text(
      tr("Index folder"),
      tr(
        "Where the Vault Q&A index lives. Changing it starts a fresh index there — the current one stays in the old folder, and switching back loads it again."
      ),
      "ragIndexPath",
      { aliases: ["pasta", "path", "index", "índice", "rag", "embeddings"] }
    ),
  ]);

  // ── Vault Q&A ────────────────────────────────────────────────────────────
  const rag: Place = { tab: "rag" };
  group(rag, {}, [
    custom(
      tr("Embedding model"),
      null,
      tr(
        "Needs the key of that model's provider. Without an index, Vault Q&A falls back to keyword search. Fetch models on a provider to list the embedding models your account has."
      ),
      ui.embeddingModel,
      { aliases: ["embeddings", "rag", "modelo"] }
    ),
    // As duas voltaram pra tela (sumiram na 0.4.0; o motor continuou lendo).
    escolha(
      rag,
      tr("Index precision"),
      null,
      tr(
        "How much detail each note keeps in the index. Lighter takes less space and memory; Light and Minimal also shrink the vectors on OpenAI's text-embedding-3. Applies on the next index update, which rebuilds it from scratch."
      ),
      "ragQuantProfile",
      () => QUANT_ITENS.map((i) => ({ ...i, label: tr(i.label) })),
      { aliases: ["quantization", "quantização", "precisão", "int8", "memory", "memória"] }
    ),
    toggle(
      tr("Search the index in pieces"),
      tr(
        "Reads the index about 4 MB at a time instead of all at once — keeps memory low on big vaults, which matters on the phone. The catch: every index update then rebuilds it whole and re-embeds the vault, which costs tokens."
      ),
      "ragStreamShards",
      { aliases: ["shards", "pedaços", "memory", "memória", "streamed"] }
    ),
    toggle(
      tr("Auto re-index on note changes"),
      tr("Re-embeds only changed notes (costs tokens). Only runs once an index exists."),
      "ragAutoReindex",
      { aliases: ["reindex", "índice", "indice"] }
    ),
    custom(tr("Index"), null, "", ui.index, {
      aliases: ["índice", "indice", "index vault", "rag"],
    }),
  ]);

  // ── Agent ────────────────────────────────────────────────────────────────
  group({ tab: "agent" }, {}, [
    escolha(
      { tab: "agent" },
      tr("Permission level"),
      null,
      tr(
        "When the agent stops to ask before changing the vault. In YOLO, deletes run on their own too when Obsidian sends deleted files to a trash (set to delete permanently, they still ask). Every change can be undone from the chat while Obsidian is open."
      ),
      "agentPermissionLevel",
      () =>
        (Object.keys(PERMISSION_LABELS) as PermissionLevel[]).map((l) => ({
          value: l,
          label: tr(PERMISSION_LABELS[l]),
          icon: PERMISSION_ICONS[l],
        })),
      { aliases: ["permissão", "permissions", "yolo", "confirm", "confirmar"] }
    ),
    toggle(
      tr("Show diff before applying edits"),
      tr("Preview every change the agent wants to write."),
      "agentDiffApproval",
      { aliases: ["diff", "preview", "aprovação"] }
    ),
    toggle(
      tr("Web access"),
      tr(
        "Let the agent search the web and open public pages when a task needs it. In Ask and Vault, each request shows you the address or the search first; local addresses are always refused."
      ),
      "agentWeb",
      { aliases: ["web", "internet", "search", "busca", "url", "fetch"] }
    ),
    custom(
      tr("{provider} key", { provider: "Tavily" }),
      null,
      tr(
        "For web search, from tavily.com › API keys: 1,000 free searches a month, no card needed. Without it the agent can still open pages. Stored in the OS keychain (not in data.json)."
      ),
      ui.tavilyKey,
      { visible: () => s().agentWeb !== false, aliases: [...KEY_ALIASES, "tavily", "web search"] }
    ),
  ]);

  // ── Mobile (só no celular) ───────────────────────────────────────────────
  if (ui.isMobile) {
    group({ tab: "mobile" }, {}, [
      toggle(
        tr("Fullscreen"),
        tr(
          "Hides the drawer chrome and the global navbar while AXXA is the active tab. The menu button stays, so you are never stuck."
        ),
        "mobileFullscreen",
        { aliases: ["tela cheia", "full screen"] }
      ),
      toggle(
        tr("Haptics"),
        tr(
          "A short buzz on every tap. Android only — iPhone doesn't let a plugin touch the Taptic Engine."
        ),
        "hapticsEnabled",
        { aliases: ["vibration", "vibração", "vibrate"] }
      ),
    ]);
  }

  return { items, places };
}

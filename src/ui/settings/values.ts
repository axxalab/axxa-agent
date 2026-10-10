// src/ui/settings/values.ts
// O que as linhas `control` das settings leem e gravam — e o ÚNICO caminho de
// gravação delas.
//
// Por que isto existe: no Obsidian 1.13 quem desenha uma linha `control` é o
// próprio Obsidian, e sem override ele grava assim (app.js 1.13.7, na
// PluginSettingTab):
//
//   setControlValue(k, v) { settings[k] = v; return plugin.saveData(settings) }
//
// Isso pula o `saveSettings()` — que é quem manda as chaves de API pro keychain
// e grava o data.json SEM elas. Ficar com o padrão seria mandar as chaves em
// texto puro pro data.json, que mora no vault e sincroniza junto. Por isso a
// aba sobrescreve get/setControlValue, e os dois passam por aqui.
//
// Chave de API NUNCA é `control`: ela mora numa linha `render` (campo de
// senha), e `writeControl` recusa qualquer chave fora das listas abaixo — um
// `control` novo com a chave errada falha calado em vez de vazar.

import type { AxxaSettings } from "../../main";
import { AXXA_HIDDEN } from "../../core/vaultPaths";

/** Interruptores. */
const BOOL_KEYS = [
  "assistantSeesVault",
  "voiceEnabled",
  "ttsEnabled",
  "openaiDataSharing",
  "geminiFreeTier",
  "agentDiffApproval",
  "agentWeb",
  "travarNoLimite",
  "ragAutoReindex",
  "mobileFullscreen",
  "hapticsEnabled",
  "ragStreamShards",
] as const;

/** Menus e campos de texto — sempre string do lado do controle. */
const TEXT_KEYS = [
  "defaultProvider",
  "defaultMode",
  "defaultEffort",
  "language",
  "voiceModel",
  "voiceLanguage",
  "ttsVoice",
  "ttsModel",
  "elevenModel",
  "openaiTier",
  "chatsPath",
  "skillsPath",
  "agentPermissionLevel",
  "ragQuantProfile",
  "ragIndexPath",
] as const;

export type BoolKey = (typeof BOOL_KEYS)[number];
export type TextKey = (typeof TEXT_KEYS)[number];
export type ControlKey = BoolKey | TextKey;

const BOOLS: ReadonlySet<string> = new Set(BOOL_KEYS);
const TEXTS: ReadonlySet<string> = new Set(TEXT_KEYS);

export function isControlKey(key: string): key is ControlKey {
  return BOOLS.has(key) || TEXTS.has(key);
}

/** Pasta das conversas quando o campo fica vazio. */
export const DEFAULT_CHATS_PATH = `${AXXA_HIDDEN}/chats`;
/** Pasta dos skills quando o campo fica vazio. */
export const DEFAULT_SKILLS_PATH = "axxa-ai/skills";
/** Pasta do índice do Vault Q&A quando o campo fica vazio. */
export const DEFAULT_INDEX_PATH = `${AXXA_HIDDEN}/index`;

/** O valor que o CONTROLE mostra — nem sempre é o que está gravado. */
export function readControl(s: AxxaSettings, key: ControlKey): boolean | string {
  switch (key) {
    // Os três que nasceram depois do data.json de muita gente: ausente tem
    // que ler como o padrão, não como `undefined`.
    case "assistantSeesVault":
      return !!s.assistantSeesVault;
    case "openaiDataSharing":
      return s.openaiDataSharing === true;
    case "mobileFullscreen":
      return s.mobileFullscreen === true;
    case "hapticsEnabled":
      return s.hapticsEnabled !== false;
    // Nasceu ligada (0.9.23): quem já tinha data.json lê o padrão.
    case "agentWeb":
      return s.agentWeb !== false;
    case "travarNoLimite":
      return s.travarNoLimite === true;
    case "geminiFreeTier":
      return s.geminiFreeTier === true;
    case "language":
      return s.language || "en-us";
    // O menu fala string; o tier é número.
    case "openaiTier":
      return String(s.openaiTier ?? 1);
    default:
      return s[key];
  }
}

/** Grava na memória com as conversões de cada campo. Não salva em disco. */
export function applyControl(
  s: AxxaSettings,
  key: ControlKey,
  value: unknown
): void {
  if (BOOLS.has(key)) {
    s[key as BoolKey] = value === true;
    return;
  }
  const v =
    typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : "";
  switch (key) {
    case "openaiTier":
      s.openaiTier = Number(v) || 1;
      return;
    // Pasta vazia é pasta nenhuma: volta pro padrão em vez de gravar na raiz.
    case "chatsPath":
      s.chatsPath = v.trim() || DEFAULT_CHATS_PATH;
      return;
    case "skillsPath":
      s.skillsPath = v.trim() || DEFAULT_SKILLS_PATH;
      return;
    // A do índice vira caminho de arquivo (`<pasta>/embeddings.json`): uma
    // barra na ponta faria `pasta//embeddings.json`.
    case "ragIndexPath":
      s.ragIndexPath = v.trim().replace(/^\/+|\/+$/g, "") || DEFAULT_INDEX_PATH;
      return;
    default:
      s[key as Exclude<TextKey, "openaiTier">] = v;
  }
}

/** O mínimo do plugin que a gravação precisa (e que o teste consegue fingir). */
export interface SettingsSaver {
  settings: AxxaSettings;
  saveSettings(): Promise<void>;
}

/**
 * Grava um `control` e salva pelo `saveSettings()` — nunca pelo `saveData()`.
 * Devolve `false` (sem tocar em nada) quando a chave não é de `control`.
 */
export async function writeControl(
  plugin: SettingsSaver,
  key: string,
  value: unknown
): Promise<boolean> {
  if (!isControlKey(key)) {
    console.warn(`[axxa] settings: "${key}" não é um control — ignorado.`);
    return false;
  }
  applyControl(plugin.settings, key, value);
  await plugin.saveSettings();
  return true;
}

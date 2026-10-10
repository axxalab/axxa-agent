// src/components/_shared/chatPersistence.ts
// Persistência de chats no Vault — Módulo 4.1+4.2
//
// Cada conversa vira um arquivo .md em `.axxa/chats/chat/[id].md` com:
//   - Frontmatter YAML com metadata (id, title, date, provider, model, effort, tokens)
//   - Body markdown legível: `## You` / `## Assistant` blocks
//
// Funções:
//   saveChat()   — escreve/atualiza o arquivo do chat
//   loadChat()   — lê + parsa um chat
//   listChats()  — lista summary de todos os chats (frontmatter only)
//   ensureFolder() — cria pasta recursiva

import type { App, DataAdapter } from "obsidian";
import type { AIToolStep } from "../agent/types";
import { previewFromMarkdown } from "./chatPreview";
import { texto } from "./texto";
import { tr } from "../i18n/tr";

export interface ChatMessageStored {
  type: "user" | "ai-response";
  content: string;
  timestamp: number;
  /** Reaction do user no ai-response (persiste like/dislike entre reloads). */
  reaction?: "like" | "dislike" | null;
  /** Ações de tool do agent (Agent mode) — persistidas pra continuidade de
   *  contexto ao reabrir o chat. v0.1.160 */
  agentSteps?: AIToolStep[];
  /** Mensagem do usuário: o contexto que foi junto pro modelo (trechos do
   *  vault + notas anexadas). Gravado pra a conversa reaberta lembrar dele. */
  contexto?: string;
  /** Resposta: a rodada do agente que caiu com erro (o texto é o erro; os
   *  passos são o que ela fez antes de cair). */
  isError?: boolean;
  /** Mensagem do usuário: o resumo do que veio antes dela (o modelo recebe o
   *  resumo no lugar das mensagens anteriores). */
  resumo?: string;
  /** As chaves da linha de meta que ESTA versão não conhece, como vieram
   *  ("chave=valor"). Voltam iguais ao gravar: o que uma versão mais nova pôs
   *  ali não some quando esta salva a conversa. */
  metaDesconhecida?: string[];
  /** Resposta: quando o pedido que a gerou saiu (o ritmo do cache conta dele). */
  pedidoEm?: number;
}

/** As chaves da linha de meta que esta versão lê (o resto volta como veio). */
const CHAVES_DA_META = new Set(["ts", "reaction", "err", "ctx", "sum", "req"]);

/** Uma linha que é EXATAMENTE um cabeçalho de seção do arquivo. Dentro de uma
 *  mensagem ela vai escapada (\## You), senão ao reabrir partia a mensagem. */
const LINHA_DE_SECAO = /^(\\*)## (You|Assistant)([^\S\r\n]*)$/gm;

/** Escapa (uma barra a mais) as linhas que pareceriam cabeçalho de seção. */
function escaparSecoes(texto: string): string {
  return texto.replace(
    LINHA_DE_SECAO,
    (_, barras: string, rotulo: string, fim: string) => `\\${barras}## ${rotulo}${fim}`
  );
}

/** Desfaz o escape (uma barra a menos) ao ler. */
function desescaparSecoes(texto: string): string {
  return texto.replace(LINHA_DE_SECAO, (linha: string, barras: string, rotulo: string, fim: string) =>
    barras.length > 0 ? `${barras.slice(1)}## ${rotulo}${fim}` : linha
  );
}

/** Argumento mais significativo de uma tool (path/from/query) pro resumo. */
function stepLabel(step: AIToolStep): string {
  const a = step.arguments ?? {};
  const key = (a.path ?? a.from ?? a.folder ?? a.query) as string | undefined;
  return key ? `${step.name} ${key}` : step.name;
}

export interface ChatData {
  id: string;
  title: string;
  date: string; // ISO 8601
  mode: string;
  provider: string;
  model: string;
  effort: string;
  tokensIn: number;
  tokensOut: number;
  /** Do tokensIn, quanto veio do cache de prompt e quanto foi gravado nele.
   *  Conversa antiga não tem: ausente é 0. */
  tokensCached?: number;
  tokensCacheWrite?: number;
  /** Do gravado, o de 1 hora (custa mais). Ausente é 0. */
  tokensCacheWrite1h?: number;
  /** Persona / system prompt custom do chat ("" ou ausente = prompt padrão). */
  persona?: string;
  /** Instruções do projeto onde a conversa nasceu. Ficam GRAVADAS na conversa,
   *  e não são lidas do projeto na hora de responder: mudar as instruções do
   *  projeto amanhã não pode reescrever o que já foi combinado ontem. */
  instructions?: string;
  /** Favoritada (item "Star" do menu ⋮). Ausente = não favoritada. */
  starred?: boolean;
  /** As notas entram como contexto nesta conversa? AUSENTE é diferente de
   *  `false`: ausente significa "ninguém mexeu no interruptor", e aí vale o
   *  padrão do modo (ver core/vaultContext.ts). */
  vault?: boolean;
  messages: ChatMessageStored[];
}

/** Lê um booleano do frontmatter tolerando as DUAS origens: o metadataCache do
 *  Obsidian entrega `true` (boolean), o nosso parseSimpleYaml entrega "true"
 *  (string). Qualquer outra coisa = false. */
function yamlBool(v: unknown): boolean {
  return v === true || v === "true";
}

export interface ChatSummary {
  id: string;
  title: string;
  date: string;
  /** Modo da conversa (chat / vault-qa / agent). Usado pra carregar do disco. */
  mode: string;
  provider: string;
  model: string;
  effort: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached?: number;
  tokensCacheWrite?: number;
  tokensCacheWrite1h?: number;
  messageCount: number;
  /** Quantas ações de tool a conversa rodou (o `tools_used` do frontmatter).
   *  É o que a home do Agent mostra em cada cartão — sem isto a lista de lá
   *  não teria como dizer o que cada sessão FEZ. */
  toolCount: number;
  filePath: string;
  /** Favoritada — sobe pro topo dos recentes e ganha estrela na lista. */
  starred: boolean;
  /** A última fala, em uma linha — é o que o cartão de sessão do Agent mostra
   *  embaixo do título (ver core/chatPreview.ts).
   *
   *  Vem vazia quando o frontmatter veio do metadataCache do Obsidian, que
   *  não guarda corpo. Na prática ela quase sempre existe: as conversas moram
   *  numa pasta oculta, que o Obsidian não indexa, então a listagem já lê o
   *  arquivo — o preview sai dessa mesma leitura, sem abrir nada a mais. */
  preview: string;
}

const TAG_LIST = ["axxa-chat"];

/** Cria a pasta (e ancestrais) se não existir. */
export async function ensureFolder(adapter: DataAdapter, path: string): Promise<void> {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const partial = parts.slice(0, i + 1).join("/");
    if (!(await adapter.exists(partial))) {
      try {
        await adapter.mkdir(partial);
      } catch {
        // pode falhar se outro processo criou ao mesmo tempo — ignora
      }
    }
  }
}

/** Caminho da pasta de um modo específico (ex: "chat") */
function modeFolder(chatsPath: string, mode: string): string {
  return `${chatsPath}/${mode}`;
}

/** Caminho completo do arquivo do chat */
function chatFilePath(chatsPath: string, mode: string, chatId: string): string {
  return `${modeFolder(chatsPath, mode)}/${chatId}.md`;
}

/** Gera título auto-baseado na primeira mensagem do user */
export function generateTitle(firstUserMessage: string): string {
  const cleaned = firstUserMessage.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 60).trim() + "…";
}

// ============================================================
// Render: ChatData → Markdown
// ============================================================

function yamlString(s: string): string {
  // JSON.stringify produz string YAML-segura (com aspas + escapes)
  return JSON.stringify(s);
}

// Base64 UTF-8-safe (funciona no plugin Electron E no node dos testes). Usado
// pra embutir os agentSteps num comentário sem risco de "-->" no result quebrar.
//
// Era `btoa(unescape(encodeURIComponent(s)))`. `escape`/`unescape` são legado
// depreciado — a ponte pra bytes agora é TextEncoder/TextDecoder, que dá
// exatamente os mesmos bytes UTF-8. O que já está gravado continua sendo lido.
function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(s: string): string {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function renderFrontmatter(chat: ChatData): string {
  const tags = TAG_LIST.concat([`axxa-mode-${chat.mode}`])
    .map((t) => `  - ${t}`)
    .join("\n");
  // tools_used: resumo legível das ações do agent (RAG indexa frontmatter →
  // dá pra achar "qual chat criou notes/projeto.md"). v0.1.160
  const allSteps = chat.messages.flatMap((m) => m.agentSteps ?? []);
  const toolsBlock =
    allSteps.length > 0
      ? `tools_used:\n${allSteps
          .map((s) => `  - ${yamlString(stepLabel(s))}`)
          .join("\n")}\n`
      : "";
  return `---
id: ${yamlString(chat.id)}
title: ${yamlString(chat.title)}
date: ${yamlString(chat.date)}
mode: ${yamlString(chat.mode)}
provider: ${yamlString(chat.provider)}
model: ${yamlString(chat.model)}
effort: ${yamlString(chat.effort)}
${chat.persona ? `persona: ${yamlString(chat.persona)}\n` : ""}${chat.instructions ? `instructions: ${yamlString(chat.instructions)}\n` : ""}${chat.starred ? "starred: true\n" : ""}${chat.vault === undefined ? "" : `vault: ${chat.vault}\n`}tokens_in: ${chat.tokensIn}
tokens_out: ${chat.tokensOut}
${chat.tokensCached ? `tokens_cached: ${chat.tokensCached}\n` : ""}${chat.tokensCacheWrite ? `tokens_cache_write: ${chat.tokensCacheWrite}\n` : ""}${chat.tokensCacheWrite1h ? `tokens_cache_write_1h: ${chat.tokensCacheWrite1h}\n` : ""}message_count: ${chat.messages.length}
${toolsBlock}tags:
${tags}
---`;
}

function renderBody(chat: ChatData): string {
  const heading = `# ${chat.title}\n`;
  const sections = chat.messages
    .map((m) => {
      const label = m.type === "user" ? "You" : "Assistant";
      // Marca de reaction como linha HTML comment invisível no markdown
      // (sobrevive ao parse manual + invisivel em qualquer render)
      const meta: string[] = [];
      if (m.timestamp) meta.push(`ts=${m.timestamp}`);
      if (m.pedidoEm) meta.push(`req=${m.pedidoEm}`);
      if (m.reaction) meta.push(`reaction=${m.reaction}`);
      if (m.isError) meta.push("err=1");
      // O contexto da mensagem (vault + notas), em base64: invisível no
      // preview e imune a "## You" lá dentro. A 0.9.23 e as anteriores
      // escondem a linha, mas ignoram a chave que não conhecem — e, ao gravar
      // a conversa de novo, ela SOME do arquivo (desta versão em diante, chave
      // desconhecida volta como veio: metaDesconhecida).
      if (m.contexto) meta.push(`ctx=${b64encode(m.contexto)}`);
      // O resumo do que veio antes — mesmo jeito do contexto.
      if (m.resumo) meta.push(`sum=${b64encode(m.resumo)}`);
      if (m.metaDesconhecida) meta.push(...m.metaDesconhecida);
      const metaLine = meta.length > 0 ? `<!-- axxa: ${meta.join(" ")} -->\n` : "";
      // Ações do agent — base64 num comentário (precisão pro replay; invisível
      // no preview). O resumo legível vai no frontmatter tools_used.
      const stepsLine =
        m.agentSteps && m.agentSteps.length > 0
          ? `\n\n<!-- axxa-steps: ${b64encode(JSON.stringify(m.agentSteps))} -->`
          : "";
      return `## ${label}\n\n${metaLine}${escaparSecoes(m.content.trim())}${stepsLine}\n`;
    })
    .join("\n");
  return `${heading}\n${sections}`;
}

/** Extrai metadata da linha HTML comment + retorna content limpo. */
function parseMessageMeta(content: string): {
  cleanContent: string;
  timestamp?: number;
  reaction?: "like" | "dislike" | null;
  erro?: boolean;
  contexto?: string;
  resumo?: string;
  metaDesconhecida?: string[];
  pedidoEm?: number;
} {
  const match = content.match(/^\s*<!--\s*axxa:\s*([^>]+?)\s*-->\s*\n?/);
  if (!match) return { cleanContent: content };
  const meta = match[1];
  const cleanContent = content.slice(match[0].length);
  let timestamp: number | undefined;
  let pedidoEm: number | undefined;
  let reaction: "like" | "dislike" | null | undefined;
  let erro: boolean | undefined;
  let contexto: string | undefined;
  let resumo: string | undefined;
  const desconhecida: string[] = [];
  for (const part of meta.split(/\s+/)) {
    const corte = part.indexOf("=");
    const k = corte < 0 ? part : part.slice(0, corte);
    const v = corte < 0 ? "" : part.slice(corte + 1);
    if (k === "ts" && v) timestamp = parseInt(v, 10);
    else if (k === "req" && v) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) pedidoEm = n;
    }
    else if (k === "reaction" && (v === "like" || v === "dislike")) {
      reaction = v;
    } else if (k === "err" && v === "1") erro = true;
    else if (k === "ctx" && v) {
      try {
        contexto = b64decode(v);
      } catch {
        /* base64 estragado: a mensagem fica sem contexto, não some */
      }
    } else if (k === "sum" && v) {
      try {
        resumo = b64decode(v);
      } catch {
        /* base64 estragado: sem resumo, o modelo recebe a conversa inteira */
      }
    } else if (part && !CHAVES_DA_META.has(k)) {
      // De uma versão mais nova: guarda pra gravar de volta igual.
      desconhecida.push(part);
    }
  }
  return {
    cleanContent,
    timestamp,
    reaction,
    erro,
    contexto,
    resumo,
    ...(pedidoEm !== undefined ? { pedidoEm } : {}),
    ...(desconhecida.length > 0 ? { metaDesconhecida: desconhecida } : {}),
  };
}

// Exportadas pra teste de round-trip (integridade de dados). v0.1.149
export function renderChatMarkdown(chat: ChatData): string {
  return `${renderFrontmatter(chat)}\n\n${renderBody(chat)}`;
}

// ============================================================
// Parse: Markdown → ChatData
// ============================================================

// Chaves do frontmatter que devem virar Number. Demais valores (id, title…)
// ficam string — evita coagir um id numérico e perder zeros à esquerda. v0.1.228
const NUMERIC_KEYS = new Set([
  "tokens_in",
  "tokens_out",
  "tokens_cached",
  "tokens_cache_write",
  "tokens_cache_write_1h",
  "message_count",
]);

function parseSimpleYaml(text: string): Record<string, string | number | string[]> {
  const result: Record<string, string | number | string[]> = {};
  const lines = text.split("\n");
  let currentArrayKey: string | null = null;
  let currentArray: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine;
    // Item de array (- value)
    const arrayItemMatch = line.match(/^\s*-\s+(.+)$/);
    if (currentArrayKey && arrayItemMatch) {
      let value = arrayItemMatch[1].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        try {
          value = JSON.parse(value) as string;
        } catch {
          /* keep */
        }
      }
      currentArray.push(value);
      continue;
    }
    // Se tinha array em progresso e a linha não é mais item, salva
    if (currentArrayKey && !arrayItemMatch) {
      result[currentArrayKey] = currentArray;
      currentArrayKey = null;
      currentArray = [];
    }
    // Key: value
    const kvMatch = line.match(/^([\w_-]+):\s*(.*)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();
    if (!rawValue) {
      // Pode ser início de array (linhas seguintes começam com `- `)
      currentArrayKey = key;
      currentArray = [];
      continue;
    }
    let value: string | number = rawValue;
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        /* keep */
      }
    } else if (NUMERIC_KEYS.has(key) && /^-?\d+(\.\d+)?$/.test(value)) {
      // v0.1.228: só coage chaves sabidamente numéricas. Antes coagia QUALQUER
      // valor numérico → um `id` puramente numérico (hand-edit) perdia zeros à
      // esquerda/precisão. id/title/etc ficam string (consumidos via String()).
      value = Number(value);
    }
    result[key] = value;
  }
  // Fecha array pendente
  if (currentArrayKey) {
    result[currentArrayKey] = currentArray;
  }
  return result;
}

/** Extrai os agentSteps (comentário base64 no fim) e devolve o content limpo. */
function extractAgentSteps(content: string): {
  content: string;
  agentSteps?: AIToolStep[];
} {
  // v0.1.228: sem âncora `$` — o marcador `axxa-steps:` é único das nossas
  // escritas, então achá-lo em qualquer posição é seguro e mais robusto a
  // hand-edits (texto após o comentário não impede mais a detecção). Remove
  // só o trecho do comentário, preservando o resto do content.
  const re = /\n*<!--\s*axxa-steps:\s*([A-Za-z0-9+/=]+)\s*-->/;
  const m = content.match(re);
  if (!m || m.index === undefined) return { content };
  try {
    const steps = JSON.parse(b64decode(m[1])) as AIToolStep[];
    const cleaned = (content.slice(0, m.index) + content.slice(m.index + m[0].length)).trim();
    return { content: cleaned, agentSteps: steps };
  } catch {
    return { content };
  }
}

function parseBody(body: string): ChatMessageStored[] {
  // Pula até a primeira heading `## You` ou `## Assistant`
  // depois alterna entre elas até o final ou outra heading desconhecida.
  const messages: ChatMessageStored[] = [];
  const sectionRegex = /^## (You|Assistant)\s*$/gm;
  let match: RegExpExecArray | null;
  // Guarda o início do HEADING (match.index) E o início do CONTEÚDO
  // (após o match). O fim de cada conteúdo é o heading do próximo.
  // v0.1.149: antes o fim era calculado subtraindo o tamanho fixo do label
  // de next.start — mas `\s*$` engole um \n, então match[0] tinha 1 char a
  // mais e vazava o "#" do próximo heading pro fim da mensagem anterior.
  const starts: {
    type: "user" | "ai-response";
    headingStart: number;
    contentStart: number;
  }[] = [];
  while ((match = sectionRegex.exec(body)) !== null) {
    const type = match[1] === "You" ? "user" : "ai-response";
    starts.push({
      type,
      headingStart: match.index,
      contentStart: match.index + match[0].length,
    });
  }
  for (let i = 0; i < starts.length; i++) {
    const cur = starts[i];
    const next = starts[i + 1];
    const rawContent = body.slice(
      cur.contentStart,
      next ? next.headingStart : body.length
    );
    // Extrai metadata (timestamp + reaction) da linha HTML comment
    const { cleanContent, timestamp, reaction, erro, contexto: ctxDaMeta, resumo, metaDesconhecida, pedidoEm } = parseMessageMeta(
      rawContent.trim()
    );
    // Extrai as ações do agent (comentário base64) e tira do conteúdo visível.
    const { content: semPassos, agentSteps } = extractAgentSteps(
      cleanContent.trim()
    );
    const { content: finalContent, contexto: ctxAntigo } =
      cur.type === "user" ? extrairContexto(semPassos) : { content: semPassos, contexto: undefined };
    const contexto = ctxDaMeta ?? ctxAntigo;
    messages.push({
      type: cur.type,
      content: desescaparSecoes(finalContent),
      // Restaura timestamp original se salvo; fallback now()
      timestamp: timestamp ?? Date.now(),
      ...(reaction != null ? { reaction } : {}),
      ...(agentSteps ? { agentSteps } : {}),
      ...(contexto && cur.type === "user" ? { contexto } : {}),
      ...(resumo && cur.type === "user" ? { resumo } : {}),
      ...(erro && cur.type === "ai-response" ? { isError: true } : {}),
      ...(pedidoEm !== undefined && cur.type === "ai-response" ? { pedidoEm } : {}),
      ...(metaDesconhecida ? { metaDesconhecida } : {}),
    });
  }
  return messages;
}

/** Extrai o contexto da mensagem (comentário base64) e tira do conteúdo. */
function extrairContexto(content: string): { content: string; contexto?: string } {
  // Só no FIM (onde o escritor punha): um comentário igual colado no meio do
  // texto é texto.
  const re = /\n*<!--\s*axxa-ctx:\s*([A-Za-z0-9+/=]+)\s*-->\s*$/;
  const m = content.match(re);
  if (!m || m.index === undefined) return { content };
  try {
    const contexto = b64decode(m[1]);
    const limpo = (content.slice(0, m.index) + content.slice(m.index + m[0].length)).trim();
    return { content: limpo, contexto };
  } catch {
    return { content };
  }
}

export function parseChatMarkdown(content: string): ChatData {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error(tr("Invalid frontmatter — no `---` delimiters found."));
  }
  const fm = parseSimpleYaml(match[1]);
  const messages = parseBody(match[2]);
  return {
    id: texto(fm.id),
    title: texto(fm.title, "Sem título"),
    date: String(fm.date ?? new Date().toISOString()),
    mode: String(fm.mode ?? "chat"),
    provider: String(fm.provider ?? "openai"),
    model: texto(fm.model),
    effort: String(fm.effort ?? "med"),
    persona: fm.persona ? String(fm.persona) : undefined,
    instructions: fm.instructions ? String(fm.instructions) : undefined,
    // Ausente fica undefined (não `false`) — mantém o round-trip exato, igual
    // à persona: o que não foi escrito não volta como campo.
    starred: yamlBool(fm.starred) ? true : undefined,
    // Mesma regra: ausente volta undefined, que é "nunca mexeram nisto".
    vault: fm.vault === undefined ? undefined : yamlBool(fm.vault),
    tokensIn: Number(fm.tokens_in ?? 0),
    tokensOut: Number(fm.tokens_out ?? 0),
    tokensCached: fm.tokens_cached === undefined ? undefined : Number(fm.tokens_cached),
    tokensCacheWrite: fm.tokens_cache_write === undefined ? undefined : Number(fm.tokens_cache_write),
    tokensCacheWrite1h:
      fm.tokens_cache_write_1h === undefined ? undefined : Number(fm.tokens_cache_write_1h),
    messages,
  };
}

// ============================================================
// Public API
// ============================================================

export async function saveChat(
  app: App,
  chatsPath: string,
  chat: ChatData
): Promise<string> {
  const folder = modeFolder(chatsPath, chat.mode);
  await ensureFolder(app.vault.adapter, folder);
  const path = chatFilePath(chatsPath, chat.mode, chat.id);
  await app.vault.adapter.write(path, renderChatMarkdown(chat));
  return path;
}

export async function loadChat(
  app: App,
  chatsPath: string,
  mode: string,
  chatId: string
): Promise<ChatData> {
  const path = chatFilePath(chatsPath, mode, chatId);
  const content = await app.vault.adapter.read(path);
  return parseChatMarkdown(content);
}

/** Monta um ChatSummary a partir do frontmatter (do cache OU parseado). */
export function summaryFromFrontmatter(
  fm: Record<string, unknown>,
  fallbackMode: string,
  filePath: string,
  preview: string = ""
): ChatSummary {
  return {
    id: texto(fm.id),
    title: texto(fm.title, "Sem título"),
    date: texto(fm.date),
    mode: texto(fm.mode, fallbackMode),
    provider: texto(fm.provider),
    model: texto(fm.model),
    effort: texto(fm.effort),
    tokensIn: Number(fm.tokens_in ?? 0),
    tokensOut: Number(fm.tokens_out ?? 0),
    tokensCached: fm.tokens_cached === undefined ? undefined : Number(fm.tokens_cached),
    tokensCacheWrite: fm.tokens_cache_write === undefined ? undefined : Number(fm.tokens_cache_write),
    tokensCacheWrite1h:
      fm.tokens_cache_write_1h === undefined ? undefined : Number(fm.tokens_cache_write_1h),
    messageCount: Number(fm.message_count ?? 0),
    toolCount: Array.isArray(fm.tools_used) ? fm.tools_used.length : 0,
    filePath,
    starred: yamlBool(fm.starred),
    preview,
  };
}

export async function listChats(
  app: App,
  chatsPath: string,
  mode: string,
  limit: number = 10
): Promise<ChatSummary[]> {
  const folder = modeFolder(chatsPath, mode);
  if (!(await app.vault.adapter.exists(folder))) return [];
  const listing = await app.vault.adapter.list(folder);
  const summaries: ChatSummary[] = [];
  for (const file of listing.files) {
    if (!file.endsWith(".md")) continue;
    // CACHE-FIRST (v0.1.159): o Obsidian já parseou o frontmatter no
    // metadataCache → pega de lá sem LER o arquivo (antes lia o .md INTEIRO
    // só pro frontmatter, pesado em vault com muitos chats). Cache frio
    // (arquivo recém-criado) cai no fallback de leitura.
    const cached = app.metadataCache.getCache(file)?.frontmatter;
    if (cached && cached.id) {
      summaries.push(summaryFromFrontmatter(cached, mode, file));
      continue;
    }
    try {
      const content = await app.vault.adapter.read(file);
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) continue;
      // O conteúdo já está aqui — o preview sai dele de graça.
      summaries.push(
        summaryFromFrontmatter(
          parseSimpleYaml(match[1]),
          mode,
          file,
          previewFromMarkdown(content)
        )
      );
    } catch {
      // skip arquivos quebrados
    }
  }
  return summaries
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

/**
 * Lista chats de TODOS os modos (chat / vault-qa / agent / etc).
 * Walk em todas as subpastas de chatsPath e agrega. Usado pela
 * ConversationsList (que mostra tudo) e pela StarterScreen (recent).
 */
export async function listAllChats(
  app: App,
  chatsPath: string,
  limit: number = 1000
): Promise<ChatSummary[]> {
  if (!(await app.vault.adapter.exists(chatsPath))) return [];
  // Cada subpasta do chatsPath é um "modo" (chat, vault-qa, agent, ...)
  const root = await app.vault.adapter.list(chatsPath);
  // v0.1.228: lista os modos em paralelo (antes era sequencial por subpasta —
  // lento em vault com muitos chats). A ordenação/limite final é idempotente.
  const perMode = await Promise.all(
    root.folders.map((subfolder) => {
      // O último segmento do path é o nome do modo
      const mode = subfolder.split("/").pop() ?? "chat";
      return listChats(app, chatsPath, mode, 10_000);
    })
  );
  const all: ChatSummary[] = perMode.flat();
  return all
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

/**
 * Renomeia o título de um chat (sem mudar o id / file path).
 * Reescreve frontmatter `title:` e o `# Heading` do body.
 */
/**
 * Deleta o .md de um chat — manda pra LIXEIRA do sistema (recuperável), com
 * fallback pro adapter.remove se a Vault API não conhecer o arquivo. #3
 */
export async function deleteChat(
  app: App,
  chatsPath: string,
  mode: string,
  chatId: string
): Promise<void> {
  const path = chatFilePath(chatsPath, mode, chatId);
  const file = app.vault.getAbstractFileByPath(path);
  if (file) {
    // `trashFile` respeita a preferência "Deleted files" de quem usa (lixeira
    // do Obsidian, do sistema, ou apagar de vez); `vault.trash` decide sozinho.
    await app.fileManager.trashFile(file);
    return;
  }
  if (!(await app.vault.adapter.exists(path))) return;
  // Numa pasta OCULTA o arquivo não está no índice, então `getAbstractFileByPath`
  // devolve null e o caminho acima nem roda. Antes daí ia direto pro `remove`,
  // que apaga de vez — enquanto a tela promete "vai pra lixeira (recuperável)".
  // O adapter tem lixeira; a promessa passa a ser verdade nos dois casos.
  const ad = app.vault.adapter;
  try {
    if (await ad.trashSystem(path)) return;
  } catch {
    // Sem lixeira do sistema (alguns Android): cai na do vault, logo abaixo.
  }
  try {
    await ad.trashLocal(path);
    return;
  } catch {
    // Nem uma nem outra: aí sim, apagar é o que sobrou.
  }
  await ad.remove(path);
}

export async function renameChat(
  app: App,
  chatsPath: string,
  mode: string,
  chatId: string,
  newTitle: string
): Promise<void> {
  const clean = newTitle.trim();
  if (!clean) throw new Error(tr("Title is empty."));
  const path = chatFilePath(chatsPath, mode, chatId);
  const content = await app.vault.adapter.read(path);
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(tr("Invalid frontmatter in this chat file."));
  // Atualiza só a linha `title:` (mantém resto do frontmatter)
  const updatedFm = match[1].replace(
    /^title:\s*.*$/m,
    `title: ${yamlString(clean)}`
  );
  // Atualiza o `# ...` do TÍTULO — que é sempre a 1ª linha do body (renderBody
  // emite `# title` no topo). v0.1.228: ancora só na primeira linha pra não
  // atingir um H1 dentro do conteúdo da conversa; replacement via função pra
  // não interpretar `$` (ex: título com "$1").
  let body = match[2];
  body = body.replace(/^# .+(?=\n|$)/, () => `# ${clean}`);
  const updated = `---\n${updatedFm}\n---\n${body}`;
  await app.vault.adapter.write(path, updated);
}

/**
 * Liga/desliga o `starred` de um chat (item "Star" do menu ⋮). Mexe SÓ na linha
 * do frontmatter — não toca no body, então é seguro em conversa longa.
 *
 * Estratégia: tira qualquer `starred:` que exista (idempotente, tolera arquivo
 * hand-editado com o campo em outra posição) e, se for pra favoritar, reinsere
 * antes de `tokens_in:` — a mesma posição que o renderFrontmatter usa, pra um
 * arquivo reescrito depois sair byte-idêntico ao de um save normal.
 */
/**
 * Grava (ou apaga, com texto vazio) as INSTRUÇÕES de uma conversa, no
 * frontmatter dela. São as mesmas `instructions` que a conversa herda do
 * projeto ao nascer: elas SOMAM ao prompt do app nos três modos (ver
 * agent/conversation.ts) — diferente da `persona`, que substitui e levaria
 * junto as regras do app (idioma, como citar nota, o que o agente pode
 * mexer). Reescreve só o frontmatter; o corpo da conversa fica intacto.
 */
export async function setChatInstructions(
  app: App,
  chatsPath: string,
  mode: string,
  chatId: string,
  instructions: string
): Promise<void> {
  const path = chatFilePath(chatsPath, mode, chatId);
  const content = await app.vault.adapter.read(path);
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(tr("Invalid frontmatter in this chat file."));
  let fm = match[1].replace(/^instructions:\s*.*$\n?/m, "");
  const texto = instructions.trim();
  if (texto) {
    const linha = `instructions: ${yamlString(texto)}`;
    // Substituição por FUNÇÃO: com string, um "$&" ou "$1" escrito nas
    // instruções seria lido como padrão do replace e gravado trocado.
    fm = /^tokens_in:/m.test(fm)
      ? fm.replace(/^tokens_in:/m, () => `${linha}\ntokens_in:`)
      : `${fm.replace(/\n+$/, "")}\n${linha}`;
  }
  await app.vault.adapter.write(path, `---\n${fm}\n---\n${match[2]}`);
}

export async function setChatStarred(
  app: App,
  chatsPath: string,
  mode: string,
  chatId: string,
  starred: boolean
): Promise<void> {
  const path = chatFilePath(chatsPath, mode, chatId);
  const content = await app.vault.adapter.read(path);
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(tr("Invalid frontmatter in this chat file."));
  let fm = match[1].replace(/^starred:\s*.*$\n?/m, "");
  if (starred) {
    // Reinsere antes de tokens_in. Se o arquivo não tiver tokens_in (formato
    // antigo/quebrado), cai pro fim do frontmatter em vez de perder a marca.
    fm = /^tokens_in:/m.test(fm)
      ? fm.replace(/^tokens_in:/m, "starred: true\ntokens_in:")
      : `${fm.replace(/\n+$/, "")}\nstarred: true`;
  }
  await app.vault.adapter.write(path, `---\n${fm}\n---\n${match[2]}`);
}

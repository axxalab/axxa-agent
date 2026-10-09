// src/agent/conversation.ts
// Montagem do SYSTEM PROMPT e do history — antes copiada em 4 lugares do
// AxxaApp (streamReply / runAgentTurn / regenerate / continue). Centralizado
// aqui, puro e testável.

import type { ProviderMessage, MessageAttachment } from "../providers/base";
import type { AIToolStep } from "./types";

// ── System prompt ──────────────────────────────────────────

export interface ChatSystemParts {
  /** Persona custom do chat (sessionPersona). Se truthy, SUBSTITUI o base. */
  persona?: string;
  /** System prompt padrão (t.systemPrompt.base). */
  base: string;
  /** A explicação das notas do vault (t.systemPrompt.vaultQaSuffix) — entra
   *  quando o interruptor das notas está ligado. Os TRECHOS não vêm aqui: vão
   *  na mensagem de cada turno (ver montarContexto). */
  vaultSuffix?: string;
  /** Instrução de estilo de resposta (Conciso/Explicativo/etc). Anexada ao
   *  head sem substituir a persona/base. Vazio = sem efeito. */
  styleInstruction?: string;
  /**
   * Instruções do PROJETO em que a conversa nasceu.
   *
   * Somam, não substituem — ao contrário da persona. A diferença não é
   * detalhe: persona é "seja outro assistente"; instrução de projeto é "neste
   * assunto, faça assim". Trocar o prompt base por ela levaria junto as regras
   * do app (o que o agente pode mexer, como citar nota, o idioma) — e ninguém
   * que escreveu "responda em tópicos curtos" pediu isso.
   */
  instructions?: string;
}

/**
 * O que as instruções de um projeto SOMAM ao system prompt.
 *
 * Função própria, e não uma linha dentro do montador, porque tem mais alguém
 * que precisa do texto exato: o cartão de projeto, que mostra quantos tokens
 * de entrada o projeto custa ao abrir uma conversa. Duas contas pro mesmo
 * texto é como o número do cartão passaria a mentir sem ninguém ver.
 */
export function blocoDeInstrucoes(instrucoes?: string): string {
  return instrucoes && instrucoes.trim() ? "\n\n" + instrucoes.trim() : "";
}

/**
 * O bloco das NOTAS anexadas, como ele vai pro modelo. UM montador só: o
 * envio e o cartão de projeto (que conta os tokens de entrada) usam este —
 * pelo mesmo motivo de `blocoDeInstrucoes`.
 */
export function blocoDeNotasAnexadas(
  notas: readonly { path: string; content: string }[]
): string {
  if (!notas.length) return "";
  return (
    "<attached_notes>\n" +
    notas.map((n) => `### ${n.path}\n\n${aparar(n.content)}`).join("\n\n---\n\n") +
    "\n</attached_notes>"
  );
}

/** O teto de UMA nota anexada (o mesmo do vault_read do agente). Uma nota
 *  enorme estourava o contexto — e, gravada na mensagem, em todo turno. */
export const TETO_DA_NOTA = 200_000;

function aparar(texto: string): string {
  if (texto.length <= TETO_DA_NOTA) return texto;
  const fora = texto.length - TETO_DA_NOTA;
  return `${texto.slice(0, TETO_DA_NOTA)}\n\n[… note truncated: ${fora} characters omitted]`;
}

/** O texto que fecha, no histórico, uma rodada do agente que caiu com erro
 *  antes de terminar — o modelo vê o que foi feito e que a rodada parou. */
export const RODADA_COM_ERRO = "(The previous run stopped with an error before finishing.)";

/**
 * Os trechos do vault que ainda NÃO estão no histórico. A busca de uma
 * pergunta de seguimento acha as mesmas notas de novo; sem isto, o mesmo
 * trecho entrava gravado em mensagem atrás de mensagem.
 */
export function trechosNovos(bloco: string, contextosAnteriores: readonly string[]): string {
  if (!bloco.trim() || contextosAnteriores.length === 0) return bloco;
  const ja = contextosAnteriores.join("\n");
  return bloco
    .split("\n\n---\n\n")
    .filter((trecho) => !ja.includes(trecho.trim()))
    .join("\n\n---\n\n");
}

/**
 * O CONTEXTO de uma mensagem: os trechos do vault que a busca achou pra ela
 * e as notas que foram anexadas. Vai DENTRO da mensagem do usuário — não no
 * system prompt — e fica gravado nela, por dois motivos:
 *   · memória: o modelo continua vendo nos turnos seguintes o que viu neste
 *     (antes via uma vez e esquecia; no Agent, nem via as notas anexadas);
 *   · cache: o começo do pedido (ferramentas + system) fica igual de um turno
 *     pro outro, e o histórico só cresce no fim — é o que o cache de prompt
 *     de todo provider exige pra reaproveitar o que já foi lido.
 */
export function montarContexto(p: {
  vault?: string;
  notas?: readonly { path: string; content: string }[];
}): string {
  const partes: string[] = [];
  if (p.vault && p.vault.trim()) partes.push(`<vault_notes>\n${p.vault.trim()}\n</vault_notes>`);
  const anexadas = blocoDeNotasAnexadas(p.notas ?? []);
  if (anexadas) partes.push(anexadas);
  return partes.join("\n\n");
}

/** Monta o system prompt do CHAT/Vault-QA: (persona || base) + projeto + estilo
 *  + a explicação das notas do vault. Só o que é ESTÁVEL na conversa. */
export function buildChatSystemPrompt(p: ChatSystemParts): string {
  const head = (p.persona && p.persona.trim()) || p.base;
  const proj = blocoDeInstrucoes(p.instructions);
  const style =
    p.styleInstruction && p.styleInstruction.trim()
      ? "\n\n" + p.styleInstruction.trim()
      : "";
  return head + proj + style + (p.vaultSuffix ?? "");
}

/**
 * Monta o system prompt do AGENT: persona é PREPENDIDA (não substitui).
 *
 * A explicação das notas do vault entra no fim, a MESMA que o chat usa — é o
 * texto que diz ao modelo o que são os trechos que chegam nas mensagens. Dois
 * jeitos de apresentar a mesma coisa dariam ao agente uma leitura diferente
 * do vault sem ninguém ter decidido isso.
 */
export function buildAgentSystemPrompt(
  persona: string | undefined,
  agentPrompt: string,
  vaultSuffix?: string,
  /** Instruções do projeto — depois do prompt do agente: as regras da casa
   *  continuam valendo, e o que o projeto pede vem por cima. */
  instructions?: string
): string {
  const p = persona && persona.trim();
  const proj = instructions && instructions.trim();
  return (
    (p ? p + "\n\n" : "") +
    agentPrompt +
    (proj ? "\n\n" + proj : "") +
    (vaultSuffix ?? "")
  );
}

// ── History (store → provider) ─────────────────────────────

/** Forma mínima de uma mensagem do store que vira mensagem de provider.
 *  content é opcional pois o store tem variantes sem ele (ai-options) — elas
 *  são filtradas fora de qualquer jeito. */
export interface StoreMessageLike {
  type: string;
  content?: string;
  isError?: boolean;
  /** Ações do agent (Agent mode) — reconstruídas no history pra continuidade. */
  agentSteps?: AIToolStep[];
  /** Mensagem do usuário: o contexto (vault + notas) que foi junto com ela. */
  contexto?: string;
  /** Mensagem do usuário: imagens e PDFs que foram junto com ela. */
  anexos?: MessageAttachment[];
  /** Mensagem do usuário: o resumo do que veio antes dela (ver
   *  core/compactacao). O modelo recebe o resumo no lugar do que veio antes. */
  resumo?: string;
}

/**
 * Onde começa o que o modelo vê: a última mensagem do usuário que leva um
 * resumo (o que veio antes dela está no resumo), ou o começo da conversa.
 */
export function inicioVisivel(messages: readonly StoreMessageLike[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type === "user" && m.resumo) return i;
  }
  return 0;
}

/** O resumo como ele vai pro modelo, no começo da mensagem do corte. */
export function blocoDoResumo(resumo: string): string {
  return (
    "<conversation_summary>\n" +
    "The earlier part of this conversation was summarized to fit the context window. " +
    "The messages before this point are not shown; this summary replaces them.\n\n" +
    resumo.trim() +
    "\n</conversation_summary>"
  );
}

// ── Flatten de agentSteps → texto (modos SEM tools) ────────
// Mandar `tool_calls`/`tool` num request que NÃO declara `tools` quebra em
// vários providers: Anthropic responde 400 ("tool_use/tool_result exigem tools
// definidas"); Gemini-compat / OpenRouter / NIM podem rejeitar. Então, fora do
// Agent mode, as ações do agent viram um BLOCO DE TEXTO no assistant — o modelo
// mantém a MEMÓRIA do que fez e funciona em TODO provider e modo. v0.1.161

function truncateInline(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + "…" : flat;
}

/** Arg mais significativo de um step pra rotular a ação no texto. */
function stepKeyArg(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  for (const k of ["path", "from", "to", "folder", "query", "note", "title"]) {
    const v = args[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

function summarizeStepLine(s: AIToolStep, i: number): string {
  const arg = stepKeyArg(s.arguments);
  const head = arg ? `${s.name}(${truncateInline(arg, 80)})` : s.name;
  const status = s.ok ? "ok" : "ERRO";
  const excerpt = s.result ? ` — ${truncateInline(s.result, 160)}` : "";
  return `${i + 1}. ${head} → ${status}${excerpt}`;
}

/**
 * ai-response COM agentSteps → um único assistant em TEXTO que preserva a
 * memória do que o agent fez. Usado fora do Agent mode (request sem `tools`),
 * onde mandar tool_calls wire-level quebraria o provider. Puro/testável.
 */
export function flattenAgentResponse(
  finalText: string,
  steps: AIToolStep[]
): string {
  const lines = steps.map((s, i) => summarizeStepLine(s, i));
  const block =
    "〔agent memory — actions already taken in this conversation:\n" +
    lines.join("\n") +
    "〕";
  const t = (finalText ?? "").trim();
  return t ? `${t}\n\n${block}` : block;
}

/**
 * Converte mensagens do store em ProviderMessage[] mandadas ao LLM:
 *   - mantém `user` e `ai-response` SEM erro (isError não polui o contexto) —
 *     menos a resposta de erro de uma rodada do agente que FEZ coisas: os
 *     passos ficam (sem o texto do erro), senão o modelo esquecia as notas
 *     que já criou ou editou antes de a rodada cair
 *   - cada mensagem do usuário leva SEMPRE o seu contexto (vault + notas) e
 *     os seus anexos (imagem, PDF) — não só a última. É memória (o modelo
 *     não esquece o que viu) e é cache (o histórico só cresce no fim)
 *   - ai-response COM agentSteps (Agent mode) recupera a memória do agent:
 *       · `toolMode=true`  (Agent mode — request declara tools): EXPANDE pro
 *         shape wire — assistant(tool_calls) + tool(results) + assistant(texto)
 *         — replay PRECISO, cross-provider. v0.1.160
 *       · `toolMode=false` (chat / vault-qa / regenerate / continue, ou
 *         qualquer provider sem tools na request): ACHATA num assistant de
 *         TEXTO. Portável em todo provider — não há tool_calls num request sem
 *         `tools` pra quebrar Anthropic/Gemini-compat. v0.1.161
 */
/** O que o histórico precisa saber do modelo que vai receber. */
export interface OpcoesDoHistorico {
  /** Agent mode: passos do agente no formato de ferramentas. */
  toolMode?: boolean;
  /** O modelo vê imagem? lê PDF? O que ele não lê vira uma linha de texto —
   *  mandar dava 400, e com a mídia ficando na mensagem, em TODO turno. */
  imagem?: boolean;
  pdf?: boolean;
  /** Mídia só nas N mensagens mais recentes que têm mídia (padrão 3); as
   *  mais antigas viram uma menção em texto — o pedido não cresce sem fim
   *  (a Anthropic recusa acima de 32 MB / 100 páginas de PDF). */
  midiaRecente?: number;
}

/** A mídia de uma mensagem que não vai mais como arquivo, dita em texto. */
function mencaoDaMidia(a: MessageAttachment, porque: "antiga" | "nao-le"): string {
  const nome = a.type === "image" ? a.name : a.type === "pdf" ? a.name : undefined;
  const oQue = a.type === "pdf" ? "PDF" : a.type === "image" ? "image" : a.type;
  const rotulo = nome ? `${oQue} "${nome}"` : oQue;
  return porque === "antiga"
    ? `[${rotulo} attached earlier — not resent]`
    : `[${rotulo} attached — this model can't read it]`;
}

export function storeMessagesToProvider(
  messages: StoreMessageLike[],
  opcoes: boolean | OpcoesDoHistorico = false
): ProviderMessage[] {
  const op: OpcoesDoHistorico = typeof opcoes === "boolean" ? { toolMode: opcoes } : opcoes;
  const toolMode = op.toolMode === true;
  // O que veio antes do último resumo não vai: o resumo vai no lugar.
  const usable = messages.slice(inicioVisivel(messages)).filter(
    (m) =>
      m.type === "user" ||
      (m.type === "ai-response" && (!m.isError || (m.agentSteps?.length ?? 0) > 0))
  );
  // Quais mensagens do usuário ainda levam a mídia como arquivo.
  const comMidia = usable.filter((m) => m.type === "user" && (m.anexos?.length ?? 0) > 0);
  const recentes = new Set(comMidia.slice(-(op.midiaRecente ?? 3)));
  const out: ProviderMessage[] = [];
  usable.forEach((m) => {
    if (m.type === "ai-response" && m.agentSteps && m.agentSteps.length > 0) {
      // Rodada que caiu com erro: os passos são memória; o erro, não — no
      // lugar dele, uma linha que diz que a rodada parou.
      const texto = m.isError ? RODADA_COM_ERRO : (m.content ?? "");
      if (toolMode) {
        // Agent mode: assistant(tool_calls) + tool results + resposta final.
        out.push({
          role: "assistant",
          content: "",
          toolCalls: m.agentSteps.map((s) => ({
            id: s.id,
            name: s.name,
            arguments: s.arguments,
          })),
        });
        for (const s of m.agentSteps) {
          // v0.1.228: garante content não-vazio (providers como Anthropic
          // rejeitam tool_result vazio) e sinaliza falha no próprio texto —
          // o shape do provider não tem flag isError pra role="tool".
          const body = s.result?.trim() ? s.result : "(sem saída)";
          out.push({
            role: "tool",
            toolCallId: s.id,
            content: s.ok ? body : `ERRO: ${body}`,
          });
        }
        if (texto) out.push({ role: "assistant", content: texto });
      } else {
        // Qualquer outro modo/provider: ações viram texto (memória portável).
        out.push({
          role: "assistant",
          content: flattenAgentResponse(texto, m.agentSteps),
        });
      }
      return;
    }
    if (m.type === "user") {
      const vao: MessageAttachment[] = [];
      const ditos: string[] = [];
      for (const a of m.anexos ?? []) {
        const naoLe = (a.type === "image" && op.imagem === false) || (a.type === "pdf" && op.pdf === false);
        if (naoLe) ditos.push(mencaoDaMidia(a, "nao-le"));
        else if (!recentes.has(m)) ditos.push(mencaoDaMidia(a, "antiga"));
        else vao.push(a);
      }
      const texto = [m.content ?? "", ...ditos].filter(Boolean).join("\n\n");
      const content = [m.resumo ? blocoDoResumo(m.resumo) : "", m.contexto ?? "", texto]
        .filter(Boolean)
        .join("\n\n");
      out.push(vao.length > 0 ? { role: "user", content, attachments: vao } : { role: "user", content });
      return;
    }
    out.push({ role: "assistant", content: m.content ?? "" });
  });
  return out;
}

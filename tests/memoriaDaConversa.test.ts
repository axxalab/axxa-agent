import { afterEach, describe, expect, it } from "vitest";
import { parseChatMarkdown, renderChatMarkdown, type ChatData } from "../src/core/chatPersistence";
import { mensagensParaGravar } from "../src/core/session";
import { estadoDoTurno, gravarContextoDoTurno } from "../src/core/contextoDoTurno";
import { useChatStore, type ChatMessage } from "../src/store/chat";
import type { AIToolStep } from "../src/agent/types";

// A conversa lembra do que foi dito: o contexto de cada mensagem (trechos do
// vault + notas anexadas) fica nela — na sessão e no arquivo —, a rodada do
// agente que caiu com erro não some, e o que é da conversa (instruções do
// projeto, persona…) vai junto com o turno em segundo plano.

const chat = (messages: ChatData["messages"]): ChatData => ({
  id: "c1",
  title: "T",
  date: "2026-10-09T12:00:00.000Z",
  mode: "chat",
  provider: "openai",
  model: "gpt-5.4",
  effort: "med",
  tokensIn: 1,
  tokensOut: 1,
  messages,
});

afterEach(() => {
  useChatStore.getState().newChat();
  useChatStore.getState().clearBackground();
});

describe("o arquivo da conversa guarda o contexto de cada mensagem", () => {
  it("round-trip exato do contexto (com acento, tags e linhas que parecem seção)", () => {
    const contexto =
      "<vault_notes>\n### [[Reunião de março]]\n_(Reuniões/Reunião de março.md)_\n\n## You\nação: lançar\n</vault_notes>";
    const original = chat([
      { type: "user", content: "o que ficou decidido?", timestamp: 1, contexto },
      { type: "ai-response", content: "Lançar em março [[Reunião de março]].", timestamp: 2 },
    ]);
    const volta = parseChatMarkdown(renderChatMarkdown(original));
    expect(volta.messages).toEqual(original.messages);
  });

  it("uma linha '## You' DENTRO de uma mensagem não parte a conversa ao reabrir", () => {
    const original = chat([
      { type: "user", content: "cola isso:\n\n## You\n\ne isso\n## Assistant", timestamp: 1 },
      { type: "ai-response", content: "Ok:\n\n\\## You (com barra de verdade)", timestamp: 2 },
    ]);
    const volta = parseChatMarkdown(renderChatMarkdown(original));
    expect(volta.messages).toHaveLength(2);
    expect(volta.messages).toEqual(original.messages);
  });
});

describe("o que vai pro arquivo", () => {
  const passos: AIToolStep[] = [
    { id: "c1", name: "vault_create", arguments: { path: "a.md" }, result: "criado", ok: true },
  ];
  const m = (x: Record<string, unknown>) => ({ id: "x", timestamp: 1, ...x }) as unknown as ChatMessage;

  it("rodada do agente que caiu com erro: vai, com o texto do erro e a marca", () => {
    const out = mensagensParaGravar([
      m({ type: "user", content: "cria", contexto: "<attached_notes>…</attached_notes>" }),
      m({ type: "ai-response", content: "[Erro] 429", isError: true, agentSteps: passos }),
      m({ type: "ai-response", content: "[Erro] rede", isError: true }),
      m({ type: "ai-comment", content: "pensando", activity: {} }),
    ]);
    expect(out).toEqual([
      { type: "user", content: "cria", timestamp: 1, contexto: "<attached_notes>…</attached_notes>" },
      { type: "ai-response", content: "[Erro] 429", timestamp: 1, isError: true, agentSteps: passos },
    ]);
  });
});

describe("o turno lê e grava na conversa DELE (tela ou segundo plano)", () => {
  it("com a conversa em segundo plano: mensagens, instruções e o contexto vão pra ela", () => {
    const st = useChatStore.getState();
    // a conversa da tela é OUTRA
    st.setMessages([{ id: "t1", type: "user", content: "outra conversa", timestamp: 1 }]);
    st.setSessionInstructions("instruções da conversa da tela");
    st.detachTurn({
      chatId: "fundo",
      scrollTop: 0,
      title: "Fundo",
      mode: "chat",
      provider: "openai",
      model: "gpt-5.4",
      effort: "med",
      messages: [{ id: "u1", type: "user", content: "pergunta do fundo", timestamp: 1 }],
      tokensIn: 0,
      tokensOut: 0,
      tokensCached: 0,
      tokensCacheWrite: 0,
      instructions: "instruções do projeto do fundo",
    });
    const turno = estadoDoTurno();
    expect(turno.mensagens.map((x) => x.id)).toEqual(["u1"]);
    expect(turno.instrucoes).toBe("instruções do projeto do fundo");

    gravarContextoDoTurno("### [[Nota]]\n_(Nota.md)_\n\ntrecho", [
      { type: "note", path: "Anexada.md", content: "conteúdo" },
    ]);
    const bg = useChatStore.getState().background!;
    const u = bg.messages[0] as Extract<ChatMessage, { type: "user" }>;
    expect(u.contexto).toContain("<vault_notes>");
    expect(u.contexto).toContain("<attached_notes>");
    // e a conversa da tela não foi tocada
    const tela = useChatStore.getState().messages[0] as Extract<ChatMessage, { type: "user" }>;
    expect(tela.contexto).toBeUndefined();
  });

  it("sem nada pra juntar, a mensagem fica como está", () => {
    const st = useChatStore.getState();
    st.setMessages([{ id: "u1", type: "user", content: "oi", timestamp: 1 }]);
    gravarContextoDoTurno("", undefined);
    const u = useChatStore.getState().messages[0] as Extract<ChatMessage, { type: "user" }>;
    expect(u.contexto).toBeUndefined();
  });
});

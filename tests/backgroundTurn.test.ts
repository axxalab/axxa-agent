import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore, type BackgroundRun } from "../src/store/chat";

/**
 * O DESVIO de escrita do turno.
 *
 * O motor não sabe de conversa nenhuma: ele pega as ações do store uma vez, no
 * topo, e escreve. Quem decide se aquilo cai na conversa da tela ou na que
 * saiu de cena é o store. Estes testes são o contrato desse desvio — e cada um
 * deles é um jeito que a versão anterior tinha de escrever na conversa errada.
 */

const inicial = useChatStore.getState();

const run = (over: Partial<BackgroundRun> = {}): BackgroundRun => ({
  chatId: "chat-A",
  title: "A que está respondendo",
  mode: "chat",
  provider: "openai",
  model: "gpt-5",
  effort: "medium",
  messages: [],
  tokensIn: 0,
  tokensOut: 0,
  ...over,
});

beforeEach(() => {
  useChatStore.setState({
    ...inicial,
    messages: [],
    background: null,
    turnChatId: null,
    tokensIn: 0,
    tokensOut: 0,
    queued: [],
    currentChatId: null,
  });
});

describe("escrita do turno com a conversa na tela", () => {
  it("vai pras mensagens visíveis, como sempre foi", () => {
    const st = useChatStore.getState();
    const id = st.addMessage({ type: "ai-response", content: "oi" });
    st.appendToMessage(id, " mundo");
    const s = useChatStore.getState();
    expect(s.background).toBeNull();
    expect(s.messages).toHaveLength(1);
    expect((s.messages[0] as { content: string }).content).toBe("oi mundo");
  });
});

describe("escrita do turno com a conversa FORA da tela", () => {
  beforeEach(() => {
    const st = useChatStore.getState();
    const id = st.addMessage({ type: "user", content: "pergunta" });
    expect(id).toBeTruthy();
    st.detachTurn(run({ messages: useChatStore.getState().messages }));
    // a tela agora é de OUTRA conversa
    useChatStore.getState().setMessages([]);
    useChatStore.getState().setCurrentChatId("chat-B");
  });

  it("mensagem nova NÃO aparece na conversa aberta", () => {
    useChatStore.getState().addMessage({
      type: "ai-response",
      content: "resposta da A",
    });
    const s = useChatStore.getState();
    expect(s.messages).toHaveLength(0);
    expect(s.background?.messages).toHaveLength(2);
  });

  it("o texto que chega token a token também vai pro lugar certo", () => {
    const id = useChatStore
      .getState()
      .addMessage({ type: "ai-response", content: "" });
    useChatStore.getState().appendToMessage(id, "abc");
    useChatStore.getState().appendToMessage(id, "def");
    const s = useChatStore.getState();
    expect(s.messages).toHaveLength(0);
    const ultima = s.background?.messages.at(-1) as { content: string };
    expect(ultima.content).toBe("abcdef");
  });

  it("os passos do agente não vazam pra conversa aberta", () => {
    // Era isto que acontecia: o turno morria DEPOIS da troca e pendurava os
    // passos da conversa A numa mensagem da conversa B.
    const id = useChatStore
      .getState()
      .addMessage({ type: "ai-response", content: "Interrompido" });
    useChatStore
      .getState()
      .setAgentSteps(id, [
        { id: "t1", name: "vault_list", arguments: {}, result: "7", ok: true },
      ]);
    const s = useChatStore.getState();
    expect(s.messages).toHaveLength(0);
    const ultima = s.background?.messages.at(-1) as {
      agentSteps?: unknown[];
    };
    expect(ultima.agentSteps).toHaveLength(1);
  });

  it("os tokens entram na conta de quem gastou", () => {
    useChatStore.getState().addUsage({ input: 120, output: 340 });
    const s = useChatStore.getState();
    expect(s.tokensIn).toBe(0);
    expect(s.tokensOut).toBe(0);
    expect(s.background?.tokensIn).toBe(120);
    expect(s.background?.tokensOut).toBe(340);
  });

  it("reagir e apagar continuam mexendo na conversa DA TELA", () => {
    // O desvio é só das escritas do turno. Um toque da pessoa numa conversa
    // não pode mexer em outra.
    const visivel = useChatStore
      .getState()
      .background;
    expect(visivel).toBeTruthy();
    useChatStore.getState().setMessages([
      { id: "m1", type: "ai-response", content: "da B", timestamp: 1 },
    ] as never);
    useChatStore.getState().setReaction("m1", "like");
    const s = useChatStore.getState();
    expect((s.messages[0] as { reaction?: string }).reaction).toBe("like");
    expect(s.background?.messages.some((m) => m.id === "m1")).toBe(false);
  });

  it("limpar a tela não desliga o turno que roda fora dela", () => {
    // `clearMessages` zera `isLoading`; com um turno vivo em segundo plano
    // isso liberaria o guarda de envio e deixaria dois turnos disputando o
    // mesmo AbortController.
    useChatStore.setState({ isLoading: true, streamingMessageId: "m9" });
    useChatStore.getState().clearMessages();
    const s = useChatStore.getState();
    expect(s.isLoading).toBe(true);
    expect(s.streamingMessageId).toBe("m9");
    expect(s.background).not.toBeNull();
  });

  it("abrir uma conversa NOVA também não desliga o turno de fundo", () => {
    // `newChat` tem o próprio reset — e ele zerava `isLoading` do mesmo jeito.
    useChatStore.setState({ isLoading: true, streamingMessageId: "m9" });
    useChatStore.getState().newChat();
    const s = useChatStore.getState();
    expect(s.isLoading).toBe(true);
    expect(s.currentChatId).toBeNull();
    expect(s.background).not.toBeNull();
  });

  it("sem turno em segundo plano, limpar a tela zera tudo como antes", () => {
    useChatStore.getState().clearBackground();
    useChatStore.setState({ isLoading: true, streamingMessageId: "m9" });
    useChatStore.getState().clearMessages();
    const s = useChatStore.getState();
    expect(s.isLoading).toBe(false);
    expect(s.streamingMessageId).toBeNull();
  });
});

describe("voltar pra conversa que está respondendo", () => {
  it("devolve o turno e some com o segundo plano", () => {
    const st = useChatStore.getState();
    st.detachTurn(
      run({
        messages: [
          { id: "m1", type: "user", content: "oi", timestamp: 1 },
        ] as never,
        tokensIn: 7,
      })
    );
    const devolvido = useChatStore.getState().attachTurn();
    expect(devolvido?.chatId).toBe("chat-A");
    expect(devolvido?.messages).toHaveLength(1);
    expect(devolvido?.tokensIn).toBe(7);
    expect(useChatStore.getState().background).toBeNull();
  });

  it("sem nada em segundo plano devolve null e não quebra", () => {
    expect(useChatStore.getState().attachTurn()).toBeNull();
  });
});

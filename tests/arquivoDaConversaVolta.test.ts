import { afterEach, describe, expect, it, vi } from "vitest";
import { parseChatMarkdown, renderChatMarkdown } from "../src/core/chatPersistence";
import { ChatSession, mensagensParaGravar } from "../src/core/session";
import { useChatStore, type ChatMessage } from "../src/store/chat";
import type { AxxaSettings } from "../src/main";

// Quem volta pra uma versão anterior e salva a conversa perdia do arquivo o
// que uma versão mais nova tinha posto na linha de meta (a 0.9.23 apaga o
// contexto, o resumo e a marca de erro da 0.9.24). Daqui em diante, a chave
// que esta versão não conhece volta igual. E a 1ª mudança depois de abrir uma
// conversa pela tela inicial voltou a ser gravada.

const MD =
  "---\nid: c1\ntitle: T\nmode: chat\nprovider: openai\nmodel: gpt-5.4\n---\n\n# T\n\n" +
  "## You\n\n<!-- axxa: ts=1 foo=bar ctx=Y3R4 novidade=1 -->\noi\n\n" +
  "## Assistant\n\n<!-- axxa: ts=2 zzz=9 -->\nolá\n";

afterEach(() => {
  useChatStore.getState().newChat();
  vi.unstubAllGlobals();
});

describe("a chave de meta que esta versão não conhece", () => {
  it("volta igual ao gravar (e as conhecidas continuam lidas)", () => {
    const chat = parseChatMarkdown(MD);
    expect(chat.messages[0]).toMatchObject({ contexto: "ctx", metaDesconhecida: ["foo=bar", "novidade=1"] });
    expect(chat.messages[1].metaDesconhecida).toEqual(["zzz=9"]);
    const md = renderChatMarkdown(chat);
    expect(md).toContain("<!-- axxa: ts=1 ctx=Y3R4 foo=bar novidade=1 -->");
    expect(md).toContain("<!-- axxa: ts=2 zzz=9 -->");
    expect(parseChatMarkdown(md).messages).toEqual(chat.messages);
  });

  it("passa pela sessão: o que vai pro arquivo leva as chaves de volta", () => {
    const msgs = [
      { id: "a", type: "user", content: "oi", timestamp: 1, metaDesconhecida: ["foo=bar"] },
      { id: "b", type: "ai-response", content: "olá", timestamp: 2, metaDesconhecida: ["zzz=9"] },
    ] as ChatMessage[];
    expect(mensagensParaGravar(msgs).map((m) => m.metaDesconhecida)).toEqual([["foo=bar"], ["zzz=9"]]);
  });
});

describe("abrir uma conversa pela tela inicial", () => {
  it("a 1ª mudança depois de abrir (um like) agenda a gravação", async () => {
    const agendados: Array<() => void> = [];
    vi.stubGlobal("window", {
      setTimeout: (fn: () => void) => {
        agendados.push(fn);
        return agendados.length;
      },
      clearTimeout: () => undefined,
    });
    const settings = {
      defaultProvider: "openai",
      defaultMode: "chat",
      defaultEffort: "med",
      chatsPath: ".axxa/chats",
      activeModels: { openai: ["gpt-5.4"] },
      favoriteModels: {},
    } as unknown as AxxaSettings;
    const plugin = {
      settings,
      onSettingsChange: () => () => undefined,
      loadChatSummaries: async () => [],
      saveSettings: async () => undefined,
      providerCredential: () => "k",
      unreadSet: () => new Set<string>(),
      clearChatUnread: () => undefined,
      upsertChatSummary: () => undefined,
      app: { vault: { adapter: { read: async () => MD } } },
    };
    const sessao = new ChatSession(plugin as never);
    // a tela inicial: nenhuma conversa aberta
    useChatStore.getState().newChat();
    await sessao.load({ id: "c1", mode: "chat" } as never);
    expect(useChatStore.getState().currentChatId).toBe("c1");
    // abrir não grava
    expect(agendados).toHaveLength(0);
    // um like logo depois: grava
    const resposta = useChatStore.getState().messages.find((m) => m.type === "ai-response")!;
    useChatStore.getState().setReaction(resposta.id, "like");
    expect(agendados).toHaveLength(1);
    sessao.dispose();
  });
});

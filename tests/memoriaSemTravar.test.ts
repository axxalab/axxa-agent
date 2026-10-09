import { afterEach, describe, expect, it } from "vitest";
import { parseChatMarkdown, renderChatMarkdown, type ChatData } from "../src/core/chatPersistence";
import {
  TETO_DA_NOTA,
  blocoDeNotasAnexadas,
  storeMessagesToProvider,
  trechosNovos,
} from "../src/agent/conversation";
import { descartarDoTurnoQueFalhou, gravarContextoDoTurno } from "../src/core/contextoDoTurno";
import { useChatStore, type ChatMessage } from "../src/store/chat";

// Lembrar de tudo não pode virar travar pra sempre: o que o modelo não lê não
// vai como arquivo, a mídia antiga vira menção, o turno que falhou por causa
// do que foi junto descarta isso, e o mesmo trecho do vault não entra duas
// vezes. E o arquivo continua legível pra versão antiga do plugin.

const IMG = (n: string) => ({ type: "image" as const, dataUrl: "data:image/png;base64,AA", name: n });
const PDF = { type: "pdf" as const, dataUrl: "data:application/pdf;base64,AA", name: "contrato.pdf" };

afterEach(() => {
  useChatStore.getState().newChat();
  useChatStore.getState().clearBackground();
});

describe("a mídia no histórico", () => {
  it("PDF num modelo que não lê PDF vira uma linha de texto (não um 400 em todo turno)", () => {
    const out = storeMessagesToProvider([{ type: "user", content: "lê isso", anexos: [PDF] }], {
      imagem: true,
      pdf: false,
    });
    expect(out[0].attachments).toBeUndefined();
    expect(out[0].content).toContain('[PDF "contrato.pdf" attached — this model can\'t read it]');
  });

  it("só as 3 mensagens mais recentes com mídia levam o arquivo; as antigas viram menção", () => {
    const msgs = [1, 2, 3, 4].map((n) => ({ type: "user", content: `foto ${n}`, anexos: [IMG(`f${n}.png`)] }));
    const out = storeMessagesToProvider(msgs, { imagem: true, pdf: true });
    expect(out[0].attachments).toBeUndefined();
    expect(out[0].content).toContain('[image "f1.png" attached earlier — not resent]');
    expect(out.slice(1).every((m) => m.attachments?.length === 1)).toBe(true);
  });

  it("nota enorme é aparada no teto (não estoura o contexto em todo turno)", () => {
    const bloco = blocoDeNotasAnexadas([{ path: "grande.md", content: "x".repeat(TETO_DA_NOTA + 500) }]);
    expect(bloco.length).toBeLessThan(TETO_DA_NOTA + 200);
    expect(bloco).toContain("500 characters omitted");
  });
});

describe("o turno que falhou por causa do que foi junto", () => {
  const ultima = () =>
    useChatStore.getState().messages.filter((m) => m.type === "user").pop() as Extract<ChatMessage, { type: "user" }>;

  it("contexto estourado: sai o contexto e os anexos da mensagem", () => {
    useChatStore.getState().setMessages([
      { id: "u1", type: "user", content: "resume", timestamp: 1, contexto: "<attached_notes>…</attached_notes>", anexos: [IMG("a.png")] },
    ]);
    descartarDoTurnoQueFalhou("context-overflow", true);
    expect(ultima().contexto).toBeUndefined();
    expect(ultima().anexos).toBeUndefined();
  });

  it("pedido recusado antes de responder: saem os anexos; rede/cota não mexe em nada", () => {
    const comTudo = { id: "u1", type: "user" as const, content: "vê", timestamp: 1, contexto: "ctx", anexos: [PDF] };
    useChatStore.getState().setMessages([comTudo]);
    descartarDoTurnoQueFalhou("rate-limit", true);
    expect(ultima().anexos).toHaveLength(1);
    descartarDoTurnoQueFalhou("unknown", true);
    expect(ultima().anexos).toBeUndefined();
    expect(ultima().contexto).toBe("ctx");
  });
});

describe("o mesmo trecho do vault não entra duas vezes", () => {
  it("trechosNovos tira o que já está no histórico", () => {
    const a = "### [[A]]\n_(A.md)_\n\ntexto A";
    const b = "### [[B]]\n_(B.md)_\n\ntexto B";
    expect(trechosNovos(`${a}\n\n---\n\n${b}`, [`<vault_notes>\n${a}\n</vault_notes>`])).toBe(b);
  });

  it("no turno: a pergunta de seguimento não regrava o trecho que já foi", () => {
    const a = "### [[A]]\n_(A.md)_\n\ntexto A";
    useChatStore.getState().setMessages([
      { id: "u1", type: "user", content: "1", timestamp: 1, contexto: `<vault_notes>\n${a}\n</vault_notes>` },
      { id: "r1", type: "ai-response", content: "r", timestamp: 2 },
      { id: "u2", type: "user", content: "2", timestamp: 3 },
    ]);
    gravarContextoDoTurno(a, undefined);
    const u2 = useChatStore.getState().messages[2] as Extract<ChatMessage, { type: "user" }>;
    expect(u2.contexto).toBeUndefined();
  });
});

describe("o arquivo", () => {
  const chat = (messages: ChatData["messages"]): ChatData => ({
    id: "c1", title: "T", date: "2026-10-09T12:00:00.000Z", mode: "agent", provider: "openai",
    model: "gpt-5.4", effort: "med", tokensIn: 1, tokensOut: 1, messages,
  });

  it("o contexto vai NA linha de meta (a versão antiga do plugin esconde a linha inteira)", () => {
    const md = renderChatMarkdown(chat([{ type: "user", content: "oi", timestamp: 1, contexto: "<attached_notes>ação</attached_notes>" }]));
    expect(md).toMatch(/<!-- axxa: ts=1 ctx=[A-Za-z0-9+/=]+ -->/);
    expect(md).not.toContain("axxa-ctx");
  });

  it("a rodada que caiu com erro volta como erro, com os passos", () => {
    const passos = [{ id: "c1", name: "vault_create", arguments: { path: "a.md" }, result: "ok", ok: true }];
    const original = chat([
      { type: "user", content: "cria", timestamp: 1 },
      { type: "ai-response", content: "[Erro] 429", timestamp: 2, isError: true, agentSteps: passos },
    ]);
    expect(parseChatMarkdown(renderChatMarkdown(original)).messages).toEqual(original.messages);
  });

  it("'## You' seguido de espaço especial (NBSP) também é escapado", () => {
    const original = chat([{ type: "user", content: `a\n## You \nb`, timestamp: 1 }]);
    const volta = parseChatMarkdown(renderChatMarkdown(original));
    expect(volta.messages).toEqual(original.messages);
  });

  it("um 'axxa-ctx' colado no MEIO do texto é texto (só o do fim é contexto)", () => {
    const md =
      "---\nid: c1\ntitle: T\nmode: agent\n---\n\n# T\n\n## You\n\n<!-- axxa: ts=1 -->\nolha: <!-- axxa-ctx: QUJD --> fim\n";
    const volta = parseChatMarkdown(md);
    expect(volta.messages[0].content).toContain("axxa-ctx");
    expect(volta.messages[0].contexto).toBeUndefined();
  });
});

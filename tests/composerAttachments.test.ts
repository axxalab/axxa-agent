// tests/composerAttachments.test.ts
// O caminho do anexo escolhido no composer até o payload do provider.
//
// O que o `+` faz é só escrever no store; quem consome é o envio. Este teste
// segue esse trilho inteiro sem UI: store → storeMessagesToProvider → payload
// da OpenAI. Sem ele, dava pra "anexar" uma imagem que nunca sairia do
// aparelho e o chip continuaria bonitinho na tela.

import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "../src/store/chat";
import { montarContexto, storeMessagesToProvider } from "../src/agent/conversation";
import { toOpenAIMessages } from "../src/providers/_shared";
import type { ImageAttachment, NoteAttachment } from "../src/providers/base";

const st = () => useChatStore.getState();

const NOTA: NoteAttachment = {
  type: "note",
  path: "PROJECTS/FRAMEWORKS.md",
  content: "# Frameworks\n\nconteúdo da nota",
};
const IMAGEM: ImageAttachment = {
  type: "image",
  dataUrl: "data:image/png;base64,AAAA",
  mimeType: "image/png",
  name: "print.png",
};

describe("anexos pendentes no store", () => {
  beforeEach(() => {
    useChatStore.setState({ attachments: [], messages: [] });
  });

  it("acumulam na ordem em que foram escolhidos", () => {
    st().addAttachment(NOTA);
    st().addAttachment(IMAGEM);
    expect(st().attachments.map((a) => a.type)).toEqual(["note", "image"]);
  });

  it("o X remove só aquele", () => {
    st().addAttachment(NOTA);
    st().addAttachment(IMAGEM);
    st().removeAttachment(0);
    expect(st().attachments).toEqual([IMAGEM]);
  });

  it("conversa nova não herda anexo da anterior", () => {
    st().addAttachment(IMAGEM);
    st().newChat();
    expect(st().attachments).toEqual([]);
  });
});

describe("do store até o payload", () => {
  it("imagem vira content part image_url na mensagem em que foi mandada", () => {
    const msgs = [
      { type: "user" as const, content: "antiga" },
      { type: "ai-response" as const, content: "resposta" },
      { type: "user" as const, content: "olha esse print", anexos: [IMAGEM] },
    ];
    const provider = storeMessagesToProvider(msgs);
    const payload = toOpenAIMessages(provider) as Array<{
      role: string;
      content: unknown;
    }>;
    const ultima = payload[payload.length - 1];
    expect(ultima.role).toBe("user");
    expect(ultima.content).toEqual([
      { type: "text", text: "olha esse print" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
    // e a mensagem ANTIGA continua texto puro
    expect(payload[0].content).toBe("antiga");
  });

  it("nota não vira content part — ela entra como contexto de texto da mensagem", () => {
    const contexto = montarContexto({ notas: [NOTA] });
    const provider = storeMessagesToProvider([{ type: "user" as const, content: "resume", contexto }]);
    const payload = toOpenAIMessages(provider) as Array<{ content: unknown }>;
    expect(payload[0].content).toBe(`${contexto}\n\nresume`);
    expect(String(payload[0].content)).toContain("<attached_notes>");
  });

  it("imagem + nota juntas: a imagem vai como parte, a nota como texto", () => {
    const contexto = montarContexto({ notas: [NOTA] });
    const provider = storeMessagesToProvider([
      { type: "user" as const, content: "compara", contexto, anexos: [IMAGEM] },
    ]);
    const payload = toOpenAIMessages(provider) as Array<{ content: unknown }>;
    expect(payload[0].content).toEqual([
      { type: "text", text: `${contexto}\n\ncompara` },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
  });
});

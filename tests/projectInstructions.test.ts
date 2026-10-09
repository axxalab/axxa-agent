import { describe, it, expect } from "vitest";
import {
  buildChatSystemPrompt,
  buildAgentSystemPrompt,
} from "../src/agent/conversation";

// As instruções de um PROJETO: o que o modelo deve saber em toda conversa
// daquele assunto. A regra que este arquivo protege é uma só — elas SOMAM ao
// prompt do app, nunca substituem. Persona é "seja outro assistente";
// instrução de projeto é "neste assunto, faça assim". Trocar o base por ela
// levaria junto as regras da casa, que ninguém pediu pra perder.

describe("instruções de projeto no chat", () => {
  it("entram depois do head, sem apagar o base", () => {
    expect(
      buildChatSystemPrompt({ base: "BASE", instructions: "Em tópicos." })
    ).toBe("BASE\n\nEm tópicos.");
  });

  it("convivem com a persona — as duas aparecem", () => {
    expect(
      buildChatSystemPrompt({
        persona: "PIRATA",
        base: "BASE",
        instructions: "Em tópicos.",
      })
    ).toBe("PIRATA\n\nEm tópicos.");
  });

  it("vazio ou só espaços não muda nada", () => {
    expect(buildChatSystemPrompt({ base: "BASE", instructions: "   " })).toBe(
      "BASE"
    );
    expect(buildChatSystemPrompt({ base: "BASE" })).toBe("BASE");
  });

  it("a ordem inteira: head · projeto · estilo · explicação do vault", () => {
    const r = buildChatSystemPrompt({
      base: "BASE",
      instructions: "P",
      styleInstruction: "S",
      vaultSuffix: "\n\nV",
    });
    expect(r).toBe("BASE\n\nP\n\nS\n\nV");
  });
});

describe("instruções de projeto no agente", () => {
  it("vêm depois do prompt do agente e antes da explicação das notas", () => {
    const r = buildAgentSystemPrompt(undefined, "AGENTE", "\n\nNOTAS", "Nunca apague nada.");
    expect(r).toBe("AGENTE\n\nNunca apague nada.\n\nNOTAS");
  });

  it("não atropela a persona, que continua na frente", () => {
    const r = buildAgentSystemPrompt(undefined, "AGENTE", undefined, "REGRA");
    expect(r).toBe("AGENTE\n\nREGRA");
    expect(buildAgentSystemPrompt("P", "AGENTE", undefined, "REGRA")).toBe(
      "P\n\nAGENTE\n\nREGRA"
    );
  });

  it("sem instrução, o prompt é o de sempre", () => {
    expect(buildAgentSystemPrompt(undefined, "AGENTE", undefined, "  ")).toBe(
      "AGENTE"
    );
  });
});

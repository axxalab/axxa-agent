import { describe, expect, it } from "vitest";
import { aprenderJanela, custoDaMensagem, janelaConhecida, ocupacaoEstimada } from "../src/core/compactacao";
import type { ChatMessage } from "../src/store/chat";

// O medidor no topo da conversa: quanto da janela do modelo ela ocupa. A
// janela vem do que já se sabe (sem ir ao servidor); na conversa recém-
// reaberta, a ocupação é estimada do que o modelo vê dela.

const u = (id: string, content: string, x: Record<string, unknown> = {}) =>
  ({ id, type: "user", content, timestamp: 1, ...x }) as ChatMessage;
const r = (id: string, content: string) => ({ id, type: "ai-response", content, timestamp: 1 }) as ChatMessage;

describe("a janela que já se sabe", () => {
  it("Ollama sem o /api/show ainda: os 32k que o pedido usaria", () => {
    expect(janelaConhecida("ollama", "modelo-nunca-visto")).toBe(32768);
  });

  it("a janela dita num erro vale primeiro", () => {
    aprenderJanela("openrouter", "x/pequeno", new Error("maximum context length is 16384 tokens"));
    expect(janelaConhecida("openrouter", "x/pequeno")).toBe(16384);
  });
});

describe("a ocupação estimada", () => {
  it("conta só do último resumo em diante (o que o modelo vê)", () => {
    const msgs = [u("u1", "x".repeat(3000)), r("r1", "y".repeat(3000)), u("u2", "oi", { resumo: "resumo curto" }), r("r2", "ok")];
    expect(ocupacaoEstimada(msgs)).toBe(custoDaMensagem(msgs[2]) + custoDaMensagem(msgs[3]));
    expect(ocupacaoEstimada(msgs)).toBeLessThan(20);
  });
});

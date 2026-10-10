import { describe, expect, it } from "vitest";
import { conferirJanelaDoOllama } from "../src/core/compactacao";
import type { ProviderMessage } from "../src/providers/base";

// O Ollama não avisa quando o pedido passa da janela: corta o começo em
// silêncio. Numa rodada longa do agente, a janela é conferida antes de cada
// passo e os resultados de ferramenta antigos encolhem antes de chegar lá.

const resultado = (n: number): ProviderMessage => ({ role: "tool", toolCallId: `c${n}`, content: "x".repeat(6000) });
const rodada = (): ProviderMessage[] => [
  { role: "system", content: "Você é o agente." },
  { role: "user", content: "lê as notas" },
  { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "vault_read", arguments: {} }] },
  resultado(1),
  { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "vault_read", arguments: {} }] },
  resultado(2),
  { role: "assistant", content: "", toolCalls: [{ id: "c3", name: "vault_read", arguments: {} }] },
  resultado(3),
  { role: "assistant", content: "", toolCalls: [{ id: "c4", name: "vault_read", arguments: {} }] },
  resultado(4),
];
const base = { model: "qwen3:8b", resposta: 2048, janela: 8192, inicioDaRodada: 2 };

describe("Ollama: a janela conferida a cada passo da rodada", () => {
  it("passou do limiar: os resultados antigos encolhem, os 2 últimos ficam inteiros", () => {
    const h = rodada();
    expect(conferirJanelaDoOllama({ ...base, providerId: "ollama", history: h })).toBe(2);
    expect(h[3].content.length).toBeLessThan(1200);
    expect(h[5].content.length).toBeLessThan(1200);
    expect(h[7].content).toHaveLength(6000);
    expect(h[9].content).toHaveLength(6000);
  });

  it("cabe: nada muda", () => {
    const h = rodada();
    expect(conferirJanelaDoOllama({ ...base, providerId: "ollama", history: h, janela: 131072 })).toBe(0);
    expect(h[3].content).toHaveLength(6000);
  });

  it("outros providers avisam com erro (a recuperação do motor cuida): nada muda aqui", () => {
    const h = rodada();
    expect(conferirJanelaDoOllama({ ...base, providerId: "openai", history: h })).toBe(0);
  });

  it("sem passo da rodada ainda (só a conversa): nada muda — o começo do turno já resumiu", () => {
    const h = rodada().slice(0, 2);
    expect(conferirJanelaDoOllama({ ...base, providerId: "ollama", history: h, janela: 10 })).toBe(0);
  });
});

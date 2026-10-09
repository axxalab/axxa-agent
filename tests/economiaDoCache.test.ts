import { describe, expect, it } from "vitest";
import { aggregateFromSummaries } from "../src/usage/aggregate";
import type { ChatSummary } from "../src/core/chatPersistence";

// A página de uso diz quanto do que foi mandado saiu do cache e quanto isso
// poupou: o custo do mesmo pedido todo pelo preço cheio − o custo de verdade.

const chat = (x: Partial<ChatSummary>): ChatSummary =>
  ({
    id: "c", title: "T", date: "2026-10-09T12:00:00.000Z", mode: "chat",
    provider: "openai", model: "gpt-5.4", tokensIn: 0, tokensOut: 0, messageCount: 2, filePath: "c.md",
    ...x,
  }) as ChatSummary;

describe("o que o cache poupou", () => {
  it("lido do cache: a diferença pro preço cheio (GPT-5.4: 2,50 → 0,25 por milhão)", () => {
    const agg = aggregateFromSummaries([chat({ tokensIn: 1_000_000, tokensCached: 800_000 })]);
    expect(agg.total.economia).toBeCloseTo(0.8 * (2.5 - 0.25), 6);
    expect(agg.chats[0].economia).toBeCloseTo(1.8, 6);
  });

  it("gravar custa mais (Anthropic 1,25×): sem leitura, a economia sai negativa", () => {
    const agg = aggregateFromSummaries([
      chat({ provider: "anthropic", model: "claude-sonnet-5-5", tokensIn: 1_000_000, tokensCacheWrite: 1_000_000 }),
    ]);
    expect(agg.total.economia).toBeCloseTo(-(2.5 - 2), 6);
  });

  it("sem cache, ou sem preço conhecido: zero", () => {
    const agg = aggregateFromSummaries([
      chat({ tokensIn: 5000, tokensOut: 100 }),
      chat({ id: "d", provider: "ollama", model: "qwen3:8b", tokensIn: 5000, tokensCached: 4000 }),
    ]);
    expect(agg.total.economia).toBe(0);
  });
});

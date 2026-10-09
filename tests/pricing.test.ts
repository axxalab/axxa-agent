import { describe, it, expect } from "vitest";
import { getPricing } from "../src/usage/pricing";

// O tier (free/paid/unknown) é o que a UI usa pra mostrar o badge FREE/PAID
// na lista de modelos. Esses testes travam o sinal de "é grátis ou não".

describe("getPricing — tier free/paid", () => {
  it("modelos cloud de chat são paid", () => {
    expect(getPricing("openai", "gpt-4o").tier).toBe("paid");
    expect(getPricing("anthropic", "claude-opus-4-8").tier).toBe("paid");
  });

  it("claude-fable-5 tem preço (sem ele, escapava do teto de gasto)", () => {
    const p = getPricing("anthropic", "claude-fable-5");
    expect(p.tier).toBe("paid");
    expect(p).toMatchObject({ inputPerMillion: 10, outputPerMillion: 50, cachedInputPerMillion: 1 });
    // o 5.1 lê o cache bem mais barato, e o prefixo dele vem antes
    expect(getPricing("anthropic", "claude-fable-5-1").cachedInputPerMillion).toBe(0.25);
  });

  it("os específicos ganham do prefixo curto (gpt-5.4 não cai no gpt-5)", () => {
    expect(getPricing("openai", "gpt-5.4")).toMatchObject({ inputPerMillion: 2.5, outputPerMillion: 15 });
    expect(getPricing("openai", "gpt-5.4-mini")).toMatchObject({ inputPerMillion: 0.75 });
    expect(getPricing("openai", "gpt-5")).toMatchObject({ inputPerMillion: 1.25 });
    expect(getPricing("anthropic", "claude-opus-4-8")).toMatchObject({ inputPerMillion: 5, outputPerMillion: 25 });
    expect(getPricing("anthropic", "claude-opus-4-1-20250805")).toMatchObject({ inputPerMillion: 15 });
    expect(getPricing("gemini", "gemini-3.5-flash-lite")).toMatchObject({ inputPerMillion: 0.3 });
    expect(getPricing("openrouter", "anthropic/claude-opus-4.5")).toMatchObject({ inputPerMillion: 5 });
  });

  it("Ollama (local) é sempre free", () => {
    expect(getPricing("ollama", "llama3.2").tier).toBe("free");
    expect(getPricing("ollama", "qualquer-modelo").tier).toBe("free");
  });

  it("OpenRouter :free é free, mesmo modelo sem :free é tratado pelo upstream", () => {
    expect(getPricing("openrouter", "meta-llama/llama-3.1-8b:free").tier).toBe(
      "free"
    );
    expect(getPricing("openrouter", "anthropic/claude-sonnet-4").tier).toBe(
      "paid"
    );
  });

  it("provider/modelo desconhecido → unknown (UI esconde o badge)", () => {
    expect(getPricing("provider-fake", "x").tier).toBe("unknown");
    expect(getPricing("openai", "").tier).toBe("unknown");
  });
});

import { describe, expect, it, vi } from "vitest";
import { usageFrom, parseOpenAICompatSSE } from "../src/providers/_shared";
import { lancar, somarDesde, type LivroDoDia } from "../src/usage/livroDoDia";
import { custoDoLancamento } from "../src/usage/gastoDoDia";
import { calculateCost, getPricing } from "../src/usage/pricing";
import { useChatStore } from "../src/store/chat";
import { AnthropicProvider } from "../src/providers/anthropic";
import { __setRequestUrl } from "obsidian";

// Os tokens lidos do cache de prompt custam bem menos (0,1× na maioria), e os
// gravados nele custam mais (1,25× na Anthropic e no GPT-5.6+). O app não
// media nenhum dos dois: cobrava tudo pela entrada cheia. E o Gemini, que
// manda o uso em todo pedaço do stream, tinha os tokens multiplicados.

describe("o uso que o provider manda", () => {
  it("OpenAI-compatível: o cache lido e o gravado são pedaços do prompt", () => {
    expect(
      usageFrom({
        usage: {
          prompt_tokens: 1566,
          completion_tokens: 10,
          prompt_tokens_details: { cached_tokens: 1408 },
        },
      })
    ).toEqual({ input: 1566, output: 10, cacheRead: 1408 });
    expect(
      usageFrom({
        usage: {
          prompt_tokens: 2000,
          completion_tokens: 5,
          prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 1800 },
        },
      })
    ).toEqual({ input: 2000, output: 5, cacheRead: 0, cacheWrite: 1800 });
    expect(usageFrom({ usage: { prompt_tokens: 7, completion_tokens: 3 } })).toEqual({ input: 7, output: 3 });
  });

  it("o stream guarda o ÚLTIMO uso (o Gemini manda em todo pedaço)", async () => {
    const enc = new TextEncoder();
    const pedacos = [1, 2, 3].map(
      (n) =>
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: { content: `t${n}` } }],
          usage: { prompt_tokens: 100, completion_tokens: n, prompt_tokens_details: { cached_tokens: 64 } },
        })}\n\n`
    );
    const corpo = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of [...pedacos, "data: [DONE]\n\n"]) c.enqueue(enc.encode(p));
        c.close();
      },
    });
    const vistos: unknown[] = [];
    const r = await parseOpenAICompatSSE(corpo, () => undefined, (u) => vistos.push(u), "gemini_call");
    expect(vistos).toHaveLength(3);
    expect(r.usage).toEqual({ input: 100, output: 3, cacheRead: 64 });
  });
});

describe("Anthropic: o input_tokens é só a ponta que não veio do cache", () => {
  it("o prompt inteiro é input + lido + gravado (sem somar, contava só a ponta)", async () => {
    __setRequestUrl(async () => ({
      status: 200,
      json: {
        content: [{ type: "text", text: "oi" }],
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 50,
          output_tokens: 20,
        },
      },
    }));
    try {
      const r = await new AnthropicProvider().chat(
        { model: "claude-sonnet-5-5", messages: [{ role: "user", content: "oi" }] } as never,
        "sk-ant-teste"
      );
      expect(r.usage).toEqual({ input: 1050, output: 20, cacheRead: 900, cacheWrite: 50 });
    } finally {
      __setRequestUrl(null);
    }
  });

  it("no stream: o message_start traz o cache, o message_delta a saída", async () => {
    const enc = new TextEncoder();
    const ev = (o: unknown) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
    const corpo = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of [
          ev({ type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, output_tokens: 1 } } }),
          ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }),
          ev({ type: "message_delta", usage: { output_tokens: 33 } }),
          ev({ type: "message_stop" }),
        ])
          c.enqueue(enc.encode(p));
        c.close();
      },
    });
    const falso = vi.fn(async () => new Response(corpo, { status: 200 }));
    vi.stubGlobal("fetch", falso);
    vi.stubGlobal("window", { fetch: falso });
    try {
      const vistos: unknown[] = [];
      const r = await new AnthropicProvider().streamChat(
        { model: "claude-sonnet-5-5", messages: [{ role: "user", content: "oi" }] } as never,
        "sk-ant-teste",
        () => undefined,
        (u) => vistos.push(u)
      );
      expect(r.usage).toEqual({ input: 4010, output: 33, cacheRead: 4000 });
      // Avisa já no message_start (um Stop no meio não perde o prompt
      // cobrado) e de novo a cada atualização; quem ouve fica com o último.
      expect(vistos[0]).toEqual({ input: 4010, output: 0, cacheRead: 4000 });
      expect(vistos[vistos.length - 1]).toEqual({ input: 4010, output: 33, cacheRead: 4000 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("a conversa soma UM uso por pedido", () => {
  it("entrada, saída e o que veio/foi pro cache", () => {
    const st = useChatStore.getState();
    st.newChat();
    st.addUsage({ input: 1000, output: 50, cacheRead: 800 });
    st.addUsage({ input: 1200, output: 40, cacheWrite: 300 });
    const s = useChatStore.getState();
    expect([s.tokensIn, s.tokensOut, s.tokensCached, s.tokensCacheWrite]).toEqual([2200, 90, 800, 300]);
    st.restaurarUso({ tokensIn: 5, tokensOut: 6 });
    expect(useChatStore.getState().tokensCached).toBe(0);
    st.newChat();
  });

  it("o uso vai pra conversa DO pedido — e some se ela não está mais aqui", () => {
    const st = useChatStore.getState();
    st.newChat();
    st.setCurrentChatId("a");
    st.addUsage({ input: 10, output: 1 }, "a");
    expect(useChatStore.getState().tokensIn).toBe(10);
    // o pedido era da conversa "b", que já não está nem na tela nem no fundo
    st.addUsage({ input: 999, output: 9 }, "b");
    expect(useChatStore.getState().tokensIn).toBe(10);
    st.newChat();
  });
});

describe("OpenRouter usa o preço do fabricante (com as variantes)", () => {
  it("-pro, -mini, -lite e versões com ponto da Anthropic", () => {
    const or = (m: string) => getPricing("openrouter", m);
    expect(or("openai/gpt-5.4-pro")).toMatchObject({ inputPerMillion: 30, outputPerMillion: 180 });
    expect(or("openai/o1-pro")).toMatchObject({ inputPerMillion: 150 });
    expect(or("openai/gpt-4.1-mini")).toMatchObject({ inputPerMillion: 0.4 });
    expect(or("google/gemini-3.5-flash-lite")).toMatchObject({ inputPerMillion: 0.3 });
    expect(or("anthropic/claude-opus-4.5")).toMatchObject({ inputPerMillion: 5, cachedInputPerMillion: 0.5 });
    expect(or("anthropic/claude-opus-4.1")).toMatchObject({ inputPerMillion: 15 });
    expect(or("meta-llama/llama-3.3-70b-instruct")).toMatchObject({ inputPerMillion: 0.13 });
    expect(or("x-ai/grok-4").inputPerMillion).toBeNull();
    expect(or("openai/gpt-5.4:free")).toMatchObject({ inputPerMillion: 0, tier: "free" });
  });
});

describe("o livro do dia e o dinheiro", () => {
  it("o livro soma o cache, e livro antigo (sem os campos) continua valendo", () => {
    const livro: LivroDoDia = { "2026-10-09T10": { "openai\u0001gpt-5.4": { r: 2, i: 500, o: 10 } } };
    const agora = new Date("2026-10-09T10:30:00Z");
    lancar(livro, agora, "openai", "gpt-5.4", { r: 1, i: 1000, o: 20, c: 900 });
    lancar(livro, agora, "anthropic", "claude-sonnet-5-5", { r: 1, i: 2000, o: 30, c: 1500, w: 400 });
    const tudo = somarDesde(livro, new Date("2026-10-09T00:00:00Z"), () => true);
    expect(tudo).toEqual({ r: 4, i: 3500, o: 60, c: 2400, w: 400 });
  });

  it("o lido do cache sai pelo preço de cache, o gravado pelo de escrita", () => {
    const p = { entrada: 2, saida: 10, cache: 0.1, escrita: 2.5 };
    // 1M de entrada: 600k do cache, 100k gravados, 300k cheios; 100k de saída
    const c = custoDoLancamento({ i: 1_000_000, o: 100_000, c: 600_000, w: 100_000 }, p);
    expect(c).toBeCloseTo(0.3 * 2 + 0.6 * 0.1 + 0.1 * 2.5 + 0.1 * 10, 10);
    // sem preço de cache publicado: a entrada cheia (contar a mais é o seguro)
    expect(custoDoLancamento({ i: 1000, o: 0, c: 1000 }, { entrada: 3, saida: 15 })).toBeCloseTo(0.003, 10);
  });

  it("o custo da conversa também desconta o cache", () => {
    const sonnet = getPricing("anthropic", "claude-sonnet-5-5");
    const semCache = calculateCost(sonnet, 1_000_000, 0);
    const comCache = calculateCost(sonnet, 1_000_000, 0, 0, 0, { lido: 900_000 });
    expect(semCache).toBeCloseTo(2, 10);
    expect(comCache).toBeCloseTo(0.1 * 2 + 0.9 * 0.1, 10);
  });
});

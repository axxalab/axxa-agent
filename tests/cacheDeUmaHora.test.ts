import { afterEach, describe, expect, it, vi } from "vitest";
import { __setRequestUrl } from "obsidian";
import { anotarPedido, esquecerRitmos, ttlDoTurno, ttlParaOTurno, VIVE_1H } from "../src/core/cacheDoTurno";
import { AnthropicProvider } from "../src/providers/anthropic";
import { OpenRouterProvider } from "../src/providers/openrouter";
import { custoDoLancamento } from "../src/usage/gastoDoDia";
import { calculateCost, getPricing } from "../src/usage/pricing";
import { aggregateFromSummaries } from "../src/usage/aggregate";
import { lancar, type LivroDoDia } from "../src/usage/livroDoDia";
import { parseChatMarkdown, renderChatMarkdown, type ChatData, type ChatSummary } from "../src/core/chatPersistence";
import { streamReply } from "../src/core/chatEngine";
import { getTranslations } from "../src/i18n";
import { useChatStore } from "../src/store/chat";
import type { ProviderRequest } from "../src/providers/base";

// O cache de 5 min da Anthropic custa 1,25× pra gravar. Com pausas maiores
// que isso ele expira antes de ser lido, e cada turno gravava tudo de novo —
// mais caro que sem cache. Agora o turno escolhe a duração pelo ritmo da
// conversa (1 h com pausas; nada depois de 1 h parada), e a gravação de 1 h
// (2× a entrada) é contada e cobrada certo em todo lugar.

const MIN = 60_000;

afterEach(() => {
  esquecerRitmos();
  useChatStore.getState().newChat();
});

describe("a duração do cache pelo ritmo da conversa", () => {
  const t = (provider: string, modo: "chat" | "agent", desde: number | null, anterior: "5m" | "1h" | "off" | null = null) =>
    ttlDoTurno({ provider, modo, desde, anterior });

  it("Anthropic: rápido = 5 min; pausa de 5 a 55 min = 1 h; parada há mais = nada no chat, 5 min no Agent", () => {
    expect(t("anthropic", "chat", null)).toBe("5m");
    expect(t("anthropic", "chat", 2 * MIN)).toBe("5m");
    expect(t("anthropic", "chat", 10 * MIN)).toBe("1h");
    expect(t("anthropic", "chat", 54 * MIN)).toBe("1h");
    expect(t("anthropic", "chat", 56 * MIN)).toBe("off");
    expect(t("anthropic", "agent", 56 * MIN)).toBe("5m");
  });

  it("com o cache ainda vivo, segue a duração que ele tem (não lê com outra)", () => {
    expect(t("anthropic", "chat", 2 * MIN, "1h")).toBe("1h");
    expect(t("anthropic", "chat", 2 * MIN, "off")).toBe("5m");
  });

  it("OpenRouter: sem 1 h (lá a conversa só fica no mesmo provedor por 10 min parada)", () => {
    expect(t("openrouter", "chat", 10 * MIN)).toBe("off");
    expect(t("openrouter", "agent", 10 * MIN)).toBe("5m");
    expect(t("openrouter", "chat", 2 * MIN, "5m")).toBe("5m");
  });

  it("os outros providers não usam a duração", () => {
    expect(t("openai", "chat", 30 * MIN)).toBe("5m");
  });

  it("conversa reaberta: o ritmo sai da última resposta; depois, do pedido anotado", () => {
    const agora = 1_000 * MIN;
    const msgs = [
      { type: "user", timestamp: agora - 11 * MIN },
      { type: "ai-response", timestamp: agora - 10 * MIN },
      { type: "user", timestamp: agora },
    ];
    expect(ttlParaOTurno({ chatId: "c", provider: "anthropic", modo: "chat", agora, mensagens: msgs })).toBe("1h");
    anotarPedido("c", "1h", agora);
    expect(ttlParaOTurno({ chatId: "c", provider: "anthropic", modo: "chat", agora: agora + 2 * MIN, mensagens: msgs })).toBe("1h");
    expect(ttlParaOTurno({ chatId: "c", provider: "anthropic", modo: "chat", agora: agora + VIVE_1H + MIN, mensagens: msgs })).toBe("off");
  });
});

/** O corpo que o provider mandou (requestUrl). */
async function corpoMandado(pedir: () => Promise<unknown>, resposta: unknown): Promise<Record<string, unknown>> {
  let corpo: Record<string, unknown> = {};
  __setRequestUrl(async (o) => {
    corpo = JSON.parse((o as { body: string }).body) as Record<string, unknown>;
    return { status: 200, json: resposta };
  });
  try {
    await pedir();
  } finally {
    __setRequestUrl(null);
  }
  return corpo;
}

const msgs = [
  { role: "system" as const, content: "Você é o AXXA." },
  { role: "user" as const, content: "oi" },
];

describe("o que vai no pedido", () => {
  const respAnthropic = { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } };
  const anthropic = (req: Partial<ProviderRequest>) => () =>
    new AnthropicProvider().chat({ model: "claude-sonnet-5-5", messages: msgs, cacheKey: "axxa-c", ...req }, "sk");

  it("Anthropic 1 h: as DUAS marcas com 1 h (iguais, nunca dá 400)", async () => {
    const b = await corpoMandado(anthropic({ cacheTtl: "1h" }), respAnthropic);
    expect(b.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(b.system).toEqual([{ type: "text", text: "Você é o AXXA.", cache_control: { type: "ephemeral", ttl: "1h" } }]);
  });

  it("Anthropic off: nenhuma marca (o system volta a ser texto)", async () => {
    const b = await corpoMandado(anthropic({ cacheTtl: "off" }), respAnthropic);
    expect(b.cache_control).toBeUndefined();
    expect(b.system).toBe("Você é o AXXA.");
  });

  it("OpenRouter: off mantém o session_id (o roteamento ajuda os outros caches); 1 h nos Claude", async () => {
    const or = new OpenRouterProvider();
    const resp = { choices: [{ message: { content: "ok" } }] };
    const desligado = await corpoMandado(
      () => or.chat({ model: "anthropic/claude-sonnet-5.5", messages: msgs, cacheKey: "axxa-c", cacheTtl: "off" }, "sk"),
      resp
    );
    expect(desligado.session_id).toBe("axxa-c");
    expect(desligado.cache_control).toBeUndefined();
    const umaHora = await corpoMandado(
      () => or.chat({ model: "anthropic/claude-sonnet-5.5", messages: msgs, cacheKey: "axxa-c", cacheTtl: "1h" }, "sk"),
      resp
    );
    expect(umaHora.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });
});

describe("a gravação de 1 h no uso que o provider conta", () => {
  it("Anthropic: o detalhe por duração vira o pedaço de 1 h", async () => {
    __setRequestUrl(async () => ({
      status: 200,
      json: {
        content: [{ type: "text", text: "oi" }],
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 50,
          cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 30 },
          output_tokens: 5,
        },
      },
    }));
    try {
      const r = await new AnthropicProvider().chat({ model: "claude-sonnet-5-5", messages: msgs }, "sk");
      expect(r.usage).toEqual({ input: 60, output: 5, cacheRead: 0, cacheWrite: 50, cacheWrite1h: 30 });
    } finally {
      __setRequestUrl(null);
    }
  });

  it("Anthropic sem o detalhe: o pedido que mandou 1 h gravou tudo em 1 h", async () => {
    __setRequestUrl(async () => ({
      status: 200,
      json: { content: [{ type: "text", text: "oi" }], usage: { input_tokens: 10, cache_creation_input_tokens: 40, output_tokens: 5 } },
    }));
    try {
      const r = await new AnthropicProvider().chat(
        { model: "claude-sonnet-5-5", messages: msgs, cacheKey: "axxa-c", cacheTtl: "1h" },
        "sk"
      );
      expect(r.usage).toMatchObject({ cacheWrite: 40, cacheWrite1h: 40 });
    } finally {
      __setRequestUrl(null);
    }
  });

  it("no stream: o detalhe do message_start sobrevive ao message_delta (trocado, não somado)", async () => {
    const enc = new TextEncoder();
    const ev = (o: unknown) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
    const corpo = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of [
          ev({ type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 300 }, output_tokens: 1 } } }),
          ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }),
          ev({ type: "message_delta", usage: { output_tokens: 9 } }),
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
      const r = await new AnthropicProvider().streamChat({ model: "claude-sonnet-5-5", messages: msgs }, "sk", () => undefined);
      expect(r.usage).toEqual({ input: 310, output: 9, cacheRead: 0, cacheWrite: 300, cacheWrite1h: 300 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("OpenRouter não diz a duração: com a marca de 1 h, o gravado todo foi de 1 h", async () => {
    __setRequestUrl(async () => ({
      status: 200,
      json: {
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 900 } },
      },
    }));
    try {
      const r = await new OpenRouterProvider().chat(
        { model: "anthropic/claude-sonnet-5.5", messages: msgs, cacheKey: "axxa-c", cacheTtl: "1h" },
        "sk"
      );
      expect(r.usage).toMatchObject({ cacheWrite: 900, cacheWrite1h: 900 });
    } finally {
      __setRequestUrl(null);
    }
  });
});

describe("o preço da gravação de 1 h (2× a entrada; a de 5 min, 1,25×)", () => {
  it("o livro do dia: o pedaço de 1 h cobrado uma vez só, pelo preço dele", () => {
    const p = { entrada: 2, saida: 10, escrita: 2.5 };
    expect(custoDoLancamento({ i: 1e6, o: 0, w: 3e5, w1h: 2e5 }, p)).toBeCloseTo(0.7 * 2 + 0.1 * 2.5 + 0.2 * 4, 9);
    // 1 h maior que o gravado não cobra a mais
    expect(custoDoLancamento({ i: 1e6, o: 0, w: 1e5, w1h: 5e5 }, p)).toBeCloseTo(0.9 * 2 + 0.1 * 4, 9);
  });

  it("o livro soma o de 1 h", () => {
    const livro: LivroDoDia = {};
    const quando = new Date("2026-10-10T10:00:00Z");
    lancar(livro, quando, "anthropic", "claude-sonnet-5-5", { r: 1, i: 100, o: 1, w: 80, w1h: 80 });
    lancar(livro, quando, "anthropic", "claude-sonnet-5-5", { r: 1, i: 100, o: 1, w: 50, w1h: 20 });
    expect(Object.values(Object.values(livro)[0])[0]).toMatchObject({ w: 130, w1h: 100 });
  });

  it("a conversa e a página de uso: 1M gravado em 1 h no Sonnet 5.5 = US$ 4 (economia −2)", () => {
    const pricing = getPricing("anthropic", "claude-sonnet-5-5");
    expect(calculateCost(pricing, 1e6, 0, 0, 0, { gravado: 1e6, gravado1h: 1e6 })).toBeCloseTo(4, 9);
    const agg = aggregateFromSummaries([
      {
        id: "c", title: "T", date: "2026-10-10T12:00:00.000Z", mode: "chat", provider: "anthropic",
        model: "claude-sonnet-5-5", tokensIn: 1e6, tokensOut: 0, tokensCacheWrite: 1e6, tokensCacheWrite1h: 1e6,
        messageCount: 2, filePath: "c.md",
      } as ChatSummary,
    ]);
    expect(agg.total.economia).toBeCloseTo(-2, 9);
  });

  it("os totais da conversa e o arquivo levam o de 1 h", () => {
    const st = useChatStore.getState();
    st.addUsage({ input: 1000, output: 10, cacheWrite: 900, cacheWrite1h: 600 });
    const s = useChatStore.getState();
    expect([s.tokensIn, s.tokensCacheWrite, s.tokensCacheWrite1h]).toEqual([1000, 900, 600]);
    const chat: ChatData = {
      id: "c1", title: "T", date: "2026-10-10T12:00:00.000Z", mode: "chat", provider: "anthropic",
      model: "claude-sonnet-5-5", effort: "med", tokensIn: 1000, tokensOut: 10, tokensCacheWrite: 900,
      tokensCacheWrite1h: 600, messages: [{ type: "user", content: "oi", timestamp: 1 }],
    };
    const md = renderChatMarkdown(chat);
    expect(md).toContain("tokens_cache_write_1h: 600");
    expect(parseChatMarkdown(md).tokensCacheWrite1h).toBe(600);
    // conversa antiga, sem o campo: 0 (tudo era de 5 min)
    expect(parseChatMarkdown(renderChatMarkdown({ ...chat, tokensCacheWrite1h: undefined })).tokensCacheWrite1h).toBeUndefined();
  });
});

describe("o turno escolhe a duração", () => {
  it("chat no Claude depois de 10 min parado: o pedido vai com 1 h", async () => {
    const agora = Date.now();
    const st = useChatStore.getState();
    st.setCurrentChatId("conversa-lenta");
    st.setMessages([
      { id: "u1", type: "user", content: "oi", timestamp: agora - 11 * MIN },
      { id: "r1", type: "ai-response", content: "olá", timestamp: agora - 10 * MIN },
      { id: "u2", type: "user", content: "e aí?", timestamp: agora },
    ]);
    const vistos: ProviderRequest[] = [];
    const provider = {
      id: "anthropic",
      name: "Anthropic",
      supportsTools: true,
      chat: async () => ({ content: "" }),
      streamChat: async (req: ProviderRequest, _k: string, onToken: (t: string) => void) => {
        vistos.push(req);
        onToken("ok");
        return { content: "ok" };
      },
    };
    const ctx = {
      plugin: { settings: { effortConfigs: undefined } } as never,
      t: getTranslations("pt-br"),
      abortRef: { current: null },
      activeProviderId: "anthropic",
      activeProvider: provider as never,
      activeModel: "claude-sonnet-5-5",
      activeMode: "chat",
      useVault: false,
      apiKeyFor: () => "k",
      effort: "low",
      resolveStyleInstruction: () => "",
    };
    await streamReply(ctx as never, "e aí?");
    expect(vistos[0].cacheTtl).toBe("1h");
    // o turno seguinte, logo depois: o cache de 1 h está vivo — segue 1 h
    useChatStore.getState().addMessage({ type: "user", content: "mais uma" });
    await streamReply(ctx as never, "mais uma");
    expect(vistos[1].cacheTtl).toBe("1h");
  });
});

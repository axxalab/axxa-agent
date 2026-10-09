import { afterEach, describe, expect, it } from "vitest";
import { __setRequestUrl } from "obsidian";
import { AnthropicProvider } from "../src/providers/anthropic";
import { OpenAIProvider } from "../src/providers/openai";
import { OpenRouterProvider } from "../src/providers/openrouter";
import { janelaDoPedido } from "../src/providers/ollama";
import { streamReply } from "../src/core/chatEngine";
import { chaveDeCache } from "../src/core/contextoDoTurno";
import { getTranslations } from "../src/i18n";
import { useChatStore } from "../src/store/chat";
import type { ProviderRequest } from "../src/providers/base";

// O histórico da conversa vai inteiro em todo pedido. Com o cache de prompt,
// o turno seguinte relê o começo do cache (0,1× do preço, ou menos) em vez de
// pagar tudo de novo. A Anthropic só guarda se a gente pedir; a OpenAI guarda
// sozinha, mas só acerta se o pedido cair na mesma máquina; o OpenRouter
// precisa do pedido no mesmo provedor. E o Ollama joga o cache fora toda vez
// que o num_ctx muda.

/** O corpo que o provider mandou (requestUrl). */
async function corpoMandado(
  pedir: (req: ProviderRequest) => Promise<unknown>,
  req: ProviderRequest,
  resposta: unknown
): Promise<Record<string, unknown>> {
  let corpo: Record<string, unknown> = {};
  __setRequestUrl(async (o) => {
    corpo = JSON.parse((o as { body: string }).body) as Record<string, unknown>;
    return { status: 200, json: resposta };
  });
  try {
    await pedir(req);
  } finally {
    __setRequestUrl(null);
  }
  return corpo;
}

const msgs = [
  { role: "system" as const, content: "Você é o AXXA." },
  { role: "user" as const, content: "oi" },
];
const CHAVE = chaveDeCache("c0ffee00-0000-4000-8000-000000000000")!;

afterEach(() => {
  useChatStore.getState().newChat();
});

describe("Anthropic: a conversa pede o cache", () => {
  const anthropic = new AnthropicProvider();
  const pedir = (req: ProviderRequest) => anthropic.chat(req, "sk-ant-teste");
  const resposta = { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } };

  it("com a chave: o automático no topo + uma marca no fim do system", async () => {
    const b = await corpoMandado(pedir, { model: "claude-sonnet-5-5", messages: msgs, cacheKey: CHAVE }, resposta);
    expect(b.cache_control).toEqual({ type: "ephemeral" });
    expect(b.system).toEqual([{ type: "text", text: "Você é o AXXA.", cache_control: { type: "ephemeral" } }]);
  });

  it("sem a chave (título, assistente): nada é gravado — gravar custa 1,25×", async () => {
    const b = await corpoMandado(pedir, { model: "claude-sonnet-5-5", messages: msgs }, resposta);
    expect(b.cache_control).toBeUndefined();
    expect(b.system).toBe("Você é o AXXA.");
  });
});

describe("OpenAI: a chave da conversa entra no roteamento", () => {
  const openai = new OpenAIProvider();
  const pedir = (req: ProviderRequest) => openai.chat(req, "sk-teste");
  const resposta = { choices: [{ message: { content: "ok" } }] };

  it("com a chave: prompt_cache_key", async () => {
    const b = await corpoMandado(pedir, { model: "gpt-5.4", messages: msgs, cacheKey: CHAVE }, resposta);
    expect(b.prompt_cache_key).toBe(CHAVE);
  });

  it("sem a chave: o campo não vai", async () => {
    const b = await corpoMandado(pedir, { model: "gpt-5.4", messages: msgs }, resposta);
    expect("prompt_cache_key" in b).toBe(false);
  });
});

describe("OpenRouter: o mesmo provedor, e o cache dos Claude", () => {
  const or = new OpenRouterProvider();
  const pedir = (req: ProviderRequest) => or.chat(req, "sk-or-teste");
  const resposta = { choices: [{ message: { content: "ok" } }] };

  it("Claude: session_id + cache_control no topo", async () => {
    const b = await corpoMandado(pedir, { model: "anthropic/claude-sonnet-5.5", messages: msgs, cacheKey: CHAVE }, resposta);
    expect(b.session_id).toBe(CHAVE);
    expect(b.cache_control).toEqual({ type: "ephemeral" });
  });

  it("os outros guardam sozinhos: só o session_id", async () => {
    const b = await corpoMandado(pedir, { model: "openai/gpt-5.4", messages: msgs, cacheKey: CHAVE }, resposta);
    expect(b.session_id).toBe(CHAVE);
    expect(b.cache_control).toBeUndefined();
  });

  it("sem a chave: nenhum dos dois", async () => {
    const b = await corpoMandado(pedir, { model: "anthropic/claude-sonnet-5.5", messages: msgs }, resposta);
    expect(b.session_id).toBeUndefined();
    expect(b.cache_control).toBeUndefined();
  });
});

describe("Ollama: o num_ctx não desce com o modelo carregado", () => {
  const MIN = 60 * 1000;

  it("pedido menor logo depois usa a janela que já está lá (não recarrega)", () => {
    const k = "http://x|qwen";
    expect(janelaDoPedido(k, 32768, 0)).toBe(32768);
    expect(janelaDoPedido(k, 8192, 1 * MIN)).toBe(32768);
    // e a janela segue "em uso" a partir do último pedido
    expect(janelaDoPedido(k, 8192, 5.5 * MIN)).toBe(32768);
  });

  it("parado mais que o keep_alive (5 min): o Ollama já descarregou, volta ao que precisa", () => {
    const k = "http://x|llama";
    janelaDoPedido(k, 65536, 0);
    expect(janelaDoPedido(k, 8192, 6 * MIN)).toBe(8192);
  });

  it("subir sempre pode; e cada modelo tem a sua", () => {
    const k = "http://x|mistral";
    janelaDoPedido(k, 8192, 0);
    expect(janelaDoPedido(k, 16384, 1000)).toBe(16384);
    expect(janelaDoPedido("http://x|outro", 8192, 2000)).toBe(8192);
  });

  it("nunca passa do que o modelo aguenta", () => {
    const k = "http://x|gemma";
    janelaDoPedido(k, 131072, 0);
    expect(janelaDoPedido(k, 8192, 1000, 32768)).toBe(32768);
  });
});

describe("o turno manda a chave da conversa DELE", () => {
  it("chat: cacheKey = a conversa do pedido", async () => {
    const st = useChatStore.getState();
    st.setCurrentChatId("conversa-1");
    st.setMessages([{ id: "u1", type: "user", content: "oi", timestamp: 1 }]);
    let visto: ProviderRequest | null = null;
    const provider = {
      id: "falso",
      name: "Falso",
      supportsTools: false,
      chat: async () => ({ content: "" }),
      streamChat: async (req: ProviderRequest, _k: string, onToken: (t: string) => void) => {
        visto = req;
        onToken("olá");
        return { content: "olá" };
      },
    };
    await streamReply(
      {
        plugin: { settings: { effortConfigs: undefined } } as never,
        t: getTranslations("pt-br"),
        abortRef: { current: null },
        activeProviderId: "falso",
        activeProvider: provider as never,
        activeModel: "m",
        activeMode: "chat",
        useVault: false,
        apiKeyFor: () => "k",
        effort: "med",
        resolveStyleInstruction: () => "",
      },
      "oi"
    );
    expect(visto).not.toBeNull();
    expect(visto!.cacheKey).toBe("axxa-conversa-1");
  });

  it("sem conversa, sem chave", () => {
    expect(chaveDeCache(null)).toBeUndefined();
    expect(chaveDeCache("")).toBeUndefined();
  });
});

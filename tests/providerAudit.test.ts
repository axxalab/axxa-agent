// tests/providerAudit.test.ts
// Auditoria de conexão de providers (v0.1.225) — regressões dos bugs achados:
//   1. OpenRouter: vendor desconhecido caía em tools:false → Agent bloqueado.
//   2. OpenRouter: google/gemini-3 casava com o prefixo genérico (tools:false).
//   3. NIM: publisher fora da allowlist sumia do listModels (openai/gpt-oss,
//      ibm/granite) e caía em caps com streaming:true (mentira — pseudo-stream).
//   4. OpenAI: filtro perdia gpt-4.1/gpt-4-turbo/chatgpt/o-series futuras e
//      "preview" derrubava chat legítimo.
//   5. OpenRouter listModels: ":free" todo escondido + includes("auto") pegava
//      falso-positivo.
//   6. Overlay do catálogo vivo (enriched) em getModelCapabilities.
//   7. maxOutputTokens: NIM fallback 16k podia dar 400 → 4k conservador.
//   8. parseOpenAIChatMessage extrai reasoning_content (R1 via pseudo-stream).

import { describe, it, expect, afterEach } from "vitest";
import { Platform } from "obsidian";
import { getModelCapabilities } from "../src/providers/modelCapabilities";
import { hydrateModelInfoCache } from "../src/providers/modelInfoStore";
import { isRelevantOpenRouterModel } from "../src/providers/openrouter";
import { isRelevantNimModel, nodeBodyToWebStream } from "../src/providers/nim";
import { isRelevantOpenAIModel } from "../src/providers/openai";
import { resolveMaxTokens } from "../src/providers/paramPolicy";
import { parseOpenAIChatMessage } from "../src/providers/_shared";

afterEach(() => hydrateModelInfoCache({})); // limpa overlay entre testes

describe("capabilities — multi-vendor (OpenRouter)", () => {
  it("vendor desconhecido no OpenRouter ganha tools (fallback otimista)", () => {
    for (const m of [
      "x-ai/grok-4",
      "cohere/command-a",
      "amazon/nova-pro-v1",
      "moonshotai/kimi-k2",
      "z-ai/glm-4.6",
      "some-new-lab/brand-new-model",
    ]) {
      expect(getModelCapabilities("openrouter", m).tools, m).toBe(true);
    }
  });

  it("google/gemini-3 via OpenRouter tem tools (era tools:false)", () => {
    const caps = getModelCapabilities("openrouter", "google/gemini-3-pro");
    expect(caps.tools).toBe(true);
    expect(caps.vision).toBe(true);
  });

  it("perplexity/sonar NÃO tem tools (curado)", () => {
    expect(getModelCapabilities("openrouter", "perplexity/sonar-pro").tools).toBe(false);
  });

  it(":free marca free sem perder caps do upstream", () => {
    const caps = getModelCapabilities(
      "openrouter",
      "meta-llama/llama-3.2-vision:free"
    );
    expect(caps.free).toBe(true);
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
  });
});

describe("capabilities — NIM (stream por plataforma)", () => {
  it("DESKTOP: publisher desconhecido tem tools E streaming REAL (Node https)", () => {
    Platform.isMobile = false;
    for (const m of ["openai/gpt-oss-120b", "ibm/granite-4.0-h-small"]) {
      const caps = getModelCapabilities("nim", m);
      expect(caps.tools, m).toBe(true);
      expect(caps.streaming, m).toBe(true);
    }
  });

  it("MOBILE: streaming continua pseudo (false)", () => {
    Platform.isMobile = true;
    try {
      expect(getModelCapabilities("nim", "openai/gpt-oss-120b").streaming).toBe(false);
      expect(getModelCapabilities("nim", "meta/llama-3.3-70b-instruct").streaming).toBe(false);
    } finally {
      Platform.isMobile = false;
    }
  });

  it("image-gen do NIM nunca vira 'stream' (não é chat)", () => {
    Platform.isMobile = false;
    const caps = getModelCapabilities("nim", "stabilityai/stable-diffusion-3-medium");
    expect(caps.imageGen).toBe(true);
    expect(caps.streaming).toBe(false);
  });
});

describe("NIM SSE real — conversor Node→Web stream", () => {
  it("nodeBodyToWebStream entrega chunks e fecha no end", async () => {
    type Handler = (...args: unknown[]) => void;
    const handlers: Record<string, Handler[]> = {};
    const fakeRes = {
      statusCode: 200,
      on(ev: string, cb: Handler) {
        (handlers[ev] ??= []).push(cb);
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = nodeBodyToWebStream(fakeRes as any);
    const reader = stream.getReader();
    const enc = new TextEncoder();
    handlers["data"]?.forEach((cb) => cb(enc.encode("data: hello\n")));
    handlers["data"]?.forEach((cb) => cb(enc.encode("data: [DONE]\n")));
    handlers["end"]?.forEach((cb) => cb());
    const dec = new TextDecoder();
    let out = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value);
    }
    expect(out).toBe("data: hello\ndata: [DONE]\n");
  });
});

describe("capabilities — overlay do catálogo vivo (enriched)", () => {
  it("openrouter: catálogo é a verdade (sobe E desce tools)", () => {
    hydrateModelInfoCache({
      "openrouter::vendor-x/no-tools-model": { supportsTools: false },
      "openrouter::perplexity/sonar-deep": { supportsTools: true },
    });
    expect(
      getModelCapabilities("openrouter", "vendor-x/no-tools-model").tools
    ).toBe(false);
    expect(
      getModelCapabilities("openrouter", "perplexity/sonar-deep").tools
    ).toBe(true);
  });

  it("provider direto: overlay só FAZ UPGRADE (nunca desliga o curado)", () => {
    hydrateModelInfoCache({
      "openai::gpt-4o": { supportsTools: false }, // catálogo errado não rebaixa
      "ollama::mistral": { supportsTools: true }, // mas pode ligar o que faltava
    });
    expect(getModelCapabilities("openai", "gpt-4o").tools).toBe(true);
    expect(getModelCapabilities("ollama", "mistral").tools).toBe(true);
  });

  it("modalities image → vision; tier free → free", () => {
    hydrateModelInfoCache({
      "openrouter::new-lab/multi": { modalities: ["text", "image"], tier: "free" },
    });
    const caps = getModelCapabilities("openrouter", "new-lab/multi");
    expect(caps.vision).toBe(true);
    expect(caps.free).toBe(true);
  });

  it("overlay NUNCA mexe no streaming (transporte é nosso) — mobile pseudo", () => {
    Platform.isMobile = true;
    try {
      hydrateModelInfoCache({
        "nim::meta/llama-3.3-70b-instruct": { supportsTools: true },
      });
      expect(
        getModelCapabilities("nim", "meta/llama-3.3-70b-instruct").streaming
      ).toBe(false);
    } finally {
      Platform.isMobile = false;
    }
  });
});

describe("listModels filters", () => {
  it("OpenRouter: mantém :free, 'auto' no nome e openrouter/auto; corta outros pseudo-modelos", () => {
    expect(isRelevantOpenRouterModel("meta-llama/llama-3.3-70b:free")).toBe(true);
    expect(isRelevantOpenRouterModel("vendor/automatic-writer")).toBe(true);
    expect(isRelevantOpenRouterModel("openrouter/auto")).toBe(true);
    expect(isRelevantOpenRouterModel("openrouter/other-router")).toBe(false);
    expect(isRelevantOpenRouterModel("openai/text-embedding-3-small")).toBe(false);
  });

  it("NIM: aceita qualquer publisher/model; corta pipeline (embed/rerank/ASR)", () => {
    expect(isRelevantNimModel("openai/gpt-oss-120b")).toBe(true);
    expect(isRelevantNimModel("ibm/granite-4.0-h-small")).toBe(true);
    expect(isRelevantNimModel("stabilityai/stable-diffusion-3-medium")).toBe(true);
    expect(isRelevantNimModel("nvidia/llama-3.2-nv-embedqa-1b-v2")).toBe(false);
    expect(isRelevantNimModel("nvidia/rerank-qa-mistral-4b")).toBe(false);
    expect(isRelevantNimModel("nvidia/parakeet-ctc-0.6b")).toBe(false);
    expect(isRelevantNimModel("not-a-model")).toBe(false);
  });

  it("OpenAI: pega gpt-4.1, gpt-4-turbo, chatgpt, o-series futuras, 3.5", () => {
    for (const m of [
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4-turbo",
      "chatgpt-4o-latest",
      "o5",
      "o5-mini",
      "o1-preview",
      "gpt-3.5-turbo",
      "gpt-5.4",
    ]) {
      expect(isRelevantOpenAIModel(m), m).toBe(true);
    }
    for (const m of [
      "gpt-4o-realtime-preview",
      "gpt-4o-audio-preview",
      "gpt-4o-search-preview",
      "gpt-4-vision-preview",
      "gpt-3.5-turbo-instruct",
      "text-embedding-3-small",
      "whisper-1",
    ]) {
      expect(isRelevantOpenAIModel(m), m).toBe(false);
    }
    // Generation continuam entrando — incluindo o gpt-4o-mini-tts, que casa
    // com o prefixo de chat mas é TTS (precisa ser checado ANTES).
    expect(isRelevantOpenAIModel("dall-e-3")).toBe(true);
    expect(isRelevantOpenAIModel("gpt-image-1")).toBe(true);
    expect(isRelevantOpenAIModel("tts-1-hd")).toBe(true);
    expect(isRelevantOpenAIModel("gpt-4o-mini-tts")).toBe(true);
  });
});

describe("paramPolicy — tetos de output", () => {
  it("NIM desconhecido capa em 4096 (era 16384 → 400)", () => {
    expect(resolveMaxTokens("nim", "ibm/granite-4.0-h-small", 16000)).toBe(4096);
  });
  it("DeepSeek capa em 8192 em qualquer host", () => {
    expect(resolveMaxTokens("nim", "deepseek-ai/deepseek-v4-pro", 16000)).toBe(8192);
    expect(resolveMaxTokens("openrouter", "deepseek/deepseek-chat", 16000)).toBe(8192);
  });
  it("famílias grandes não mudam (Claude 128k, GPT-5 128k, Gemini 64k)", () => {
    expect(resolveMaxTokens("anthropic", "claude-opus-4-8", 200000)).toBe(128000);
    expect(resolveMaxTokens("openai", "gpt-5.4", 200000)).toBe(128000);
    expect(resolveMaxTokens("gemini", "gemini-2.5-pro", 200000)).toBe(65536);
  });
});

describe("reasoning em resposta não-stream (NIM pseudo-stream)", () => {
  it("parseOpenAIChatMessage extrai reasoning_content", () => {
    const r = parseOpenAIChatMessage({
      content: "resposta",
      reasoning_content: "pensando...",
    });
    expect(r.content).toBe("resposta");
    expect(r.reasoning).toBe("pensando...");
  });
  it("aceita o campo alternativo 'reasoning'", () => {
    expect(parseOpenAIChatMessage({ content: "x", reasoning: "y" }).reasoning).toBe("y");
  });
  it("sem reasoning → undefined", () => {
    expect(parseOpenAIChatMessage({ content: "x" }).reasoning).toBeUndefined();
  });
});

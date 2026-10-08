import { describe, it, expect } from "vitest";
import {
  getFreeDailyTokens,
  getModelCapabilities,
} from "../src/providers/modelCapabilities";
import { buildModelCatalog, porFabricante } from "../src/ui/modelCatalog";

describe("getFreeDailyTokens", () => {
  it("as duas cotas do programa de tráfego compartilhado", () => {
    expect(getFreeDailyTokens("openai", "gpt-5.4")).toBe(250_000);
    expect(getFreeDailyTokens("openai", "o3")).toBe(250_000);
    expect(getFreeDailyTokens("openai", "gpt-5.4-mini")).toBe(2_500_000);
    expect(getFreeDailyTokens("openai", "o4-mini")).toBe(2_500_000);
  });

  it("aceita o id datado que a API devolve", () => {
    expect(getFreeDailyTokens("openai", "gpt-4o-2024-08-06")).toBe(250_000);
    expect(getFreeDailyTokens("openai", "gpt-4o-mini-2024-07-18")).toBe(
      2_500_000
    );
  });

  it("match é EXATO, não por prefixo — mini e nano têm cota própria", () => {
    // gpt-5.2 está na lista de 250k; gpt-5.2-mini não está em nenhuma.
    expect(getFreeDailyTokens("openai", "gpt-5.2")).toBe(250_000);
    expect(getFreeDailyTokens("openai", "gpt-5.2-mini")).toBeNull();
    expect(getFreeDailyTokens("openai", "gpt-4o-audio-preview")).toBeNull();
    expect(getFreeDailyTokens("openai", "dall-e-3")).toBeNull();
  });

  it("só vale pra OpenAI", () => {
    expect(getFreeDailyTokens("openrouter", "gpt-4o")).toBeNull();
    expect(getFreeDailyTokens("nim", "o3")).toBeNull();
    expect(getFreeDailyTokens("openai", "")).toBeNull();
  });

  it("quem tem cota diária sai marcado como free nas capabilities", () => {
    expect(getModelCapabilities("openai", "gpt-5-mini").free).toBe(true);
    expect(getModelCapabilities("openai", "o1").free).toBe(true);
    expect(getModelCapabilities("openai", "tts-1").free).toBeUndefined();
  });
});

describe("buildModelCatalog", () => {
  const models = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-5",
    "gpt-5-mini",
    "o3",
    "o3-mini",
    "dall-e-3",
    "tts-1",
  ];

  it("separa por papel e só devolve papel que tem modelo", () => {
    const roles = buildModelCatalog("openai", models).map((r) => r.id);
    expect(roles).toContain("chat");
    expect(roles).toContain("reasoning");
    expect(roles).toContain("image");
    expect(roles).toContain("tts");
    expect(roles).not.toContain("video");
    expect(roles).not.toContain("embedding");
  });

  it("dentro do papel, famílias na ordem canônica (linhagem nova primeiro)", () => {
    const chat = buildModelCatalog("openai", models).find(
      (r) => r.id === "chat"
    );
    expect(chat?.families.map((f) => f.id)).toEqual(["gpt5", "gpt4o"]);
    expect(chat?.count).toBe(4);
  });

  it("modelos ordenados dentro da família", () => {
    const chat = buildModelCatalog("openai", models).find(
      (r) => r.id === "chat"
    );
    expect(chat?.families[0].models).toEqual(["gpt-5", "gpt-5-mini"]);
  });

  it("cada família carrega rótulo e ícone pra seção", () => {
    const reasoning = buildModelCatalog("openai", models).find(
      (r) => r.id === "reasoning"
    );
    expect(reasoning?.families[0].label).toBe("o-series");
    expect(reasoning?.families[0].icon).toBeTruthy();
  });

  it("embedding não cai no chat", () => {
    const roles = buildModelCatalog("openai", [
      "gpt-4o",
      "text-embedding-3-small",
      "text-embedding-3-large",
    ]);
    const embed = roles.find((r) => r.id === "embedding");
    expect(embed?.count).toBe(2);
    expect(roles.find((r) => r.id === "chat")?.count).toBe(1);
  });

  it("lista vazia não inventa papel", () => {
    expect(buildModelCatalog("openai", [])).toEqual([]);
  });

  it("funciona com ids de vendor do OpenRouter", () => {
    const roles = buildModelCatalog("openrouter", [
      "meta/llama-3.3-70b-instruct:free",
      "qwen/qwen-2.5-7b:free",
      "deepseek/deepseek-r1",
    ]);
    const familias = roles.flatMap((r) => r.families.map((f) => f.id));
    expect(familias).toContain("llama");
    expect(familias).toContain("qwen");
    expect(familias).toContain("deepseek");
  });

  it("openrouter/auto é classificado como chat com família router", () => {
    const roles = buildModelCatalog("openrouter", ["openrouter/auto"]);
    expect(roles).toHaveLength(1);
    expect(roles[0].id).toBe("chat");
    expect(roles[0].families[0].id).toBe("router");
    expect(roles[0].families[0].label).toBe("Auto Router");

    const porFab = porFabricante(roles);
    expect(porFab[0].fabricante.nome).toBe("OpenRouter");
  });
});

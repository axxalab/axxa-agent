import { describe, expect, it } from "vitest";
import { prettyModelName } from "../src/providers/modelDescriptions";

// O nome de um modelo na tela: a versão se junta com ponto (4-8 → 4.8), mas o
// TAMANHO fica separado — "llama-3.2-11b" virava "Llama 3.2.11b", e "3.2.11"
// parecia uma versão que não existe.

describe("nomes de modelo", () => {
  it("o tamanho não cola na versão", () => {
    expect(prettyModelName("meta/llama-3.2-11b-vision-instruct")).toBe("Llama 3.2 11B Vision Instruct");
    expect(prettyModelName("meta/llama-3.1-8b-instruct")).toBe("Llama 3.1 8B Instruct");
    expect(prettyModelName("qwen/qwen2.5-7b-instruct")).toBe("Qwen2.5 7B Instruct");
    expect(prettyModelName("google/gemma-3-27b-it")).toBe("Gemma 3 27B IT");
    expect(prettyModelName("qwen/qwen3-235b-a22b")).toBe("Qwen3 235B A22B");
    expect(prettyModelName("mistralai/mixtral-8x7b-instruct")).toBe("Mixtral 8x7B Instruct");
  });

  it("as versões continuam se juntando", () => {
    expect(prettyModelName("claude-opus-4-8")).toBe("Opus 4.8");
    expect(prettyModelName("claude-3-5-sonnet-20241022")).toBe("3.5 Sonnet 20241022");
    expect(prettyModelName("gpt-5.4-mini")).toBe("GPT 5.4 Mini");
    expect(prettyModelName("gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
  });

  it("a tag do Ollama: o tamanho fica, o resto sai", () => {
    expect(prettyModelName("llama3.2:3b")).toBe("Llama3.2 3B");
    expect(prettyModelName("qwen3-embedding:0.6b")).toBe("Qwen3 Embedding 0.6B");
    expect(prettyModelName("nomic-embed-text:latest")).toBe("Nomic Embed Text");
    expect(prettyModelName("meta-llama/llama-3.2-3b-instruct:free")).toBe("Llama 3.2 3B Instruct");
  });

  it("openrouter/auto vira Auto Router", () => {
    expect(prettyModelName("openrouter/auto")).toBe("Auto Router");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { definirGeminiSemCobranca, getPricing } from "../src/usage/pricing";
import { ehPago, gastoDesde } from "../src/usage/gastoDoDia";
import { lancar, type LivroDoDia } from "../src/usage/livroDoDia";
import { freeTag } from "../src/usage/freeTag";
import { isGeminiBillingError } from "../src/providers/gemini";
import { readControl } from "../src/ui/settings/values";
import type { AxxaSettings } from "../src/main";

// A API do Gemini não diz se a chave é de um projeto sem cobrança. Sem isso,
// o gasto do dia contava o plano grátis pelo preço pago — e, com "parar os
// pagos no limite", o Gemini grátis parava junto. Agora a pessoa diz nas
// settings (Providers › Gemini), e os modelos com plano grátis valem zero.

afterEach(() => definirGeminiSemCobranca(false));

describe("o preço do Gemini segue a chave", () => {
  it("desligado (de fábrica): preço pago — no orçamento, contar a mais é o erro seguro", () => {
    expect(getPricing("gemini", "gemini-2.5-flash").inputPerMillion).toBeGreaterThan(0);
    expect(ehPago("gemini", "gemini-2.5-flash")).toBe(true);
  });

  it("ligado: os modelos com plano grátis custam zero e não param no limite", () => {
    definirGeminiSemCobranca(true);
    expect(getPricing("gemini", "gemini-2.5-flash")).toMatchObject({ inputPerMillion: 0, outputPerMillion: 0, tier: "free" });
    expect(getPricing("gemini", "gemini-3.5-flash").inputPerMillion).toBe(0);
    expect(ehPago("gemini", "gemini-2.5-flash")).toBe(false);
  });

  it("ligado: os que são só pagos continuam pagos (imagem, 3.1 Pro)", () => {
    definirGeminiSemCobranca(true);
    expect(getPricing("gemini", "gemini-2.5-flash-image").outputPerMillion).toBeGreaterThan(0);
    expect(getPricing("gemini", "gemini-3.1-pro-preview").inputPerMillion).toBeGreaterThan(0);
  });

  it("ligado: o OpenRouter (google/…) não muda — lá quem cobra é o OpenRouter", () => {
    const antes = getPricing("openrouter", "google/gemini-2.5-flash").inputPerMillion;
    definirGeminiSemCobranca(true);
    expect(getPricing("openrouter", "google/gemini-2.5-flash").inputPerMillion).toBe(antes);
    expect(antes).toBeGreaterThan(0);
  });

  it("o gasto do dia ignora o Gemini grátis quando a chave é do plano grátis", () => {
    const livro: LivroDoDia = {};
    const agora = new Date("2026-10-10T15:00:00");
    lancar(livro, agora, "gemini", "gemini-2.5-flash", { r: 1, i: 1_000_000, o: 100_000 });
    expect(gastoDesde(livro, new Date("2026-10-10T00:00:00")).total).toBeGreaterThan(0);
    definirGeminiSemCobranca(true);
    expect(gastoDesde(livro, new Date("2026-10-10T00:00:00")).total).toBe(0);
  });
});

describe("a etiqueta e a setting", () => {
  const opts = { free: false, dataSharing: false, tier: 1 };

  it("desligado: 'free tier' é oferta; ligado: é fato", () => {
    expect(freeTag("gemini", "gemini-2.5-flash", opts)?.kind).toBe("offer");
    expect(freeTag("gemini", "gemini-2.5-flash", { ...opts, geminiFreeTier: true })).toMatchObject({ kind: "daily", label: "free tier" });
    expect(freeTag("gemini", "gemini-2.5-flash-image", { ...opts, geminiFreeTier: true })).toBeNull();
  });

  it("a setting nasce desligada", () => {
    expect(readControl({} as AxxaSettings, "geminiFreeTier")).toBe(false);
    expect(readControl({ geminiFreeTier: true } as AxxaSettings, "geminiFreeTier")).toBe(true);
  });
});

describe("o 429 do teto diário do plano grátis não é 'precisa de cobrança'", () => {
  const google = (limite: number) =>
    "You exceeded your current quota, please check your plan and billing details. " +
    "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, " +
    `limit: ${limite}, model: gemini-2.5-flash`;

  it("teto acima de zero: é limite de uso (espere), não cobrança", () => {
    expect(isGeminiBillingError(429, google(250), "chat")).toBe(false);
  });

  it("limite 0: o modelo não tem plano grátis — aí sim, precisa de cobrança", () => {
    expect(isGeminiBillingError(429, google(0), "chat")).toBe(true);
  });

  it("400 de cobrança e o 429 dos modelos de imagem seguem como antes", () => {
    expect(isGeminiBillingError(400, "FAILED_PRECONDITION: billing is not enabled", "chat")).toBe(true);
    expect(isGeminiBillingError(429, google(250), "image")).toBe(true);
  });
});

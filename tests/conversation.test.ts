import { describe, it, expect } from "vitest";
import {
  buildChatSystemPrompt,
  buildAgentSystemPrompt,
  storeMessagesToProvider,
  flattenAgentResponse,
} from "../src/agent/conversation";

describe("buildChatSystemPrompt", () => {
  it("sem persona → usa o base", () => {
    expect(buildChatSystemPrompt({ base: "BASE" })).toBe("BASE");
  });
  it("persona SUBSTITUI o base", () => {
    expect(buildChatSystemPrompt({ persona: "PIRATA", base: "BASE" })).toBe("PIRATA");
  });
  it("a explicação das notas do vault entra no fim — os TRECHOS não (vão na mensagem)", () => {
    expect(buildChatSystemPrompt({ base: "BASE", vaultSuffix: "\n\nNOTAS" })).toBe("BASE\n\nNOTAS");
  });
  it("sem o interruptor das notas, nada de sufixo", () => {
    expect(buildChatSystemPrompt({ base: "BASE" })).toBe("BASE");
  });
  it("styleInstruction entra após o head (antes do vault) — v0.1.189", () => {
    expect(
      buildChatSystemPrompt({ base: "BASE", styleInstruction: "Seja conciso." })
    ).toBe("BASE\n\nSeja conciso.");
  });
  it("styleInstruction vazio/espacos não muda nada", () => {
    expect(buildChatSystemPrompt({ base: "BASE", styleInstruction: "   " })).toBe(
      "BASE"
    );
  });
  it("ordem completa: persona + style + explicação do vault", () => {
    const r = buildChatSystemPrompt({
      persona: "P",
      base: "BASE",
      styleInstruction: "S",
      vaultSuffix: "\n\nV",
    });
    expect(r).toBe("P\n\nS\n\nV");
  });
  it("persona só com espaços cai pro base", () => {
    expect(buildChatSystemPrompt({ persona: "   ", base: "BASE" })).toBe("BASE");
  });
  it("style aplica mesmo sem persona (head = base)", () => {
    expect(
      buildChatSystemPrompt({ base: "BASE", styleInstruction: "S" })
    ).toBe("BASE\n\nS");
  });
});

describe("buildAgentSystemPrompt", () => {
  it("sem persona → só o prompt do agent", () => {
    expect(buildAgentSystemPrompt(undefined, "AGENT")).toBe("AGENT");
    expect(buildAgentSystemPrompt("  ", "AGENT")).toBe("AGENT");
  });
  it("persona é PREPENDIDA (não substitui)", () => {
    expect(buildAgentSystemPrompt("PIRATA", "AGENT")).toBe("PIRATA\n\nAGENT");
  });
  it("a explicação das notas entra no FIM, a mesma que o chat usa", () => {
    // Mesmo texto de apresentação nos dois: dois jeitos de apresentar os
    // trechos dariam ao agente uma leitura diferente do vault sem ninguém ter
    // decidido isso.
    expect(buildAgentSystemPrompt(undefined, "AGENT", "SUFIXO")).toBe("AGENTSUFIXO");
    expect(buildAgentSystemPrompt(undefined, "AGENT")).toBe("AGENT");
  });
});

describe("storeMessagesToProvider", () => {
  const msgs = [
    { type: "user", content: "oi" },
    { type: "ai-comment", content: "pensando…" }, // descartado
    { type: "ai-response", content: "olá" },
    { type: "ai-response", content: "[Erro] x", isError: true }, // descartado
    { type: "user", content: "de novo" },
  ];

  it("filtra ai-comment e ai-response com erro; mapeia roles", () => {
    const out = storeMessagesToProvider(msgs);
    expect(out).toEqual([
      { role: "user", content: "oi" },
      { role: "assistant", content: "olá" },
      { role: "user", content: "de novo" },
    ]);
  });

  it("cada mensagem do usuário leva os SEUS anexos, em todo turno (não só a última)", () => {
    const img = [{ type: "image" as const, dataUrl: "data:img" }];
    const out = storeMessagesToProvider([
      { type: "user", content: "olha isso", anexos: img },
      { type: "ai-response", content: "vi" },
      { type: "user", content: "e agora?" },
    ]);
    expect(out[0]).toMatchObject({ role: "user", content: "olha isso", attachments: img });
    expect(out[2]).not.toHaveProperty("attachments");
  });

  it("o contexto da mensagem (vault + notas) vai junto, antes do texto, em todo turno", () => {
    const out = storeMessagesToProvider([
      { type: "user", content: "resume", contexto: "<attached_notes>\n### a.md\n\nA\n</attached_notes>" },
      { type: "ai-response", content: "feito" },
      { type: "user", content: "e o segundo ponto?" },
    ]);
    expect(out[0].content).toBe("<attached_notes>\n### a.md\n\nA\n</attached_notes>\n\nresume");
    expect(out[2].content).toBe("e o segundo ponto?");
  });

  it("rodada do agente que caiu com erro: os passos ficam, o texto do erro não", () => {
    const passos = [{ id: "c1", name: "vault_create", arguments: { path: "a.md" }, result: "criado", ok: true }];
    const out = storeMessagesToProvider(
      [
        { type: "user", content: "cria" },
        { type: "ai-response", content: "[Erro] 429", isError: true, agentSteps: passos },
        { type: "user", content: "e então?" },
      ],
      true
    );
    // depois dos passos, uma linha dizendo que a rodada parou (nunca tool → user direto)
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "user"]);
    expect(out[3].content).toMatch(/stopped with an error/);
    expect(JSON.stringify(out)).not.toContain("429");
  });

  it("sem attachments → nenhuma msg ganha o campo", () => {
    const out = storeMessagesToProvider(msgs);
    expect(out.some((m) => "attachments" in m)).toBe(false);
  });

  it("array vazio → []", () => {
    expect(storeMessagesToProvider([])).toEqual([]);
  });

  it("só comentários/erros → [] (nada usável)", () => {
    const out = storeMessagesToProvider([
      { type: "ai-comment", content: "..." },
      { type: "ai-response", content: "[Erro]", isError: true },
    ]);
    expect(out).toEqual([]);
  });

  it("anexos com array VAZIO não adicionam o campo", () => {
    const out = storeMessagesToProvider([{ type: "user", content: "oi", anexos: [] }]);
    expect(out.some((m) => "attachments" in m)).toBe(false);
  });

  it("content ausente vira string vazia", () => {
    const out = storeMessagesToProvider([{ type: "user" }]);
    expect(out).toEqual([{ role: "user", content: "" }]);
  });

  it("agentSteps VAZIO → assistant comum (sem bloco de memória)", () => {
    const out = storeMessagesToProvider([
      { type: "user", content: "oi" },
      { type: "ai-response", content: "ok", agentSteps: [] },
    ]);
    expect(out[1]).toEqual({ role: "assistant", content: "ok" });
  });

  it("toolMode=true com content vazio → não emite assistant de texto final", () => {
    const out = storeMessagesToProvider(
      [{ type: "ai-response", content: "", agentSteps: [
        { id: "c1", name: "vault_read", arguments: { path: "a.md" }, result: "x", ok: true },
      ] }],
      true
    );
    // assistant(tool_calls) + tool(result) — sem assistant de texto no fim
    expect(out.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(out.some((m) => m.role === "tool")).toBe(true);
  });

  const stepsFixture = [
    { id: "c1", name: "vault_create", arguments: { path: "a.md" }, result: "criado", ok: true },
    { id: "c2", name: "vault_search", arguments: { query: "x" }, result: "2 hits", ok: true },
  ];

  it("AGENT (toolMode=true): agentSteps vira assistant(tool_calls)+tool(result)+assistant(texto)", () => {
    const out = storeMessagesToProvider(
      [
        { type: "user", content: "cria a.md" },
        { type: "ai-response", content: "Feito!", agentSteps: stepsFixture },
      ],
      true
    );
    expect(out).toEqual([
      { role: "user", content: "cria a.md" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c1", name: "vault_create", arguments: { path: "a.md" } },
          { id: "c2", name: "vault_search", arguments: { query: "x" } },
        ],
      },
      { role: "tool", toolCallId: "c1", content: "criado" },
      { role: "tool", toolCallId: "c2", content: "2 hits" },
      { role: "assistant", content: "Feito!" },
    ]);
  });

  it("CHAT (toolMode=false, default): agentSteps ACHATA num assistant de texto — SEM tool_calls/tool", () => {
    const out = storeMessagesToProvider([
      { type: "user", content: "cria a.md" },
      { type: "ai-response", content: "Feito!", agentSteps: stepsFixture },
    ]);
    // Nenhuma msg role:"tool" e nenhum toolCalls — portável em todo provider.
    expect(out.some((m) => m.role === "tool")).toBe(false);
    expect(out.some((m) => "toolCalls" in m)).toBe(false);
    expect(out[0]).toEqual({ role: "user", content: "cria a.md" });
    // A resposta vira UM assistant cujo texto preserva a memória das ações.
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe("assistant");
    expect(out[1].content).toContain("Feito!");
    expect(out[1].content).toContain("agent memory");
    expect(out[1].content).toContain("vault_create(a.md)");
    expect(out[1].content).toContain("vault_search(x)");
  });
});

describe("flattenAgentResponse", () => {
  it("inclui o texto final + uma linha por ação com status", () => {
    const r = flattenAgentResponse("Pronto.", [
      { id: "1", name: "vault_read", arguments: { path: "n.md" }, result: "conteúdo", ok: true },
      { id: "2", name: "vault_delete", arguments: { path: "x.md" }, result: "boom", ok: false },
    ]);
    expect(r.startsWith("Pronto.")).toBe(true);
    expect(r).toContain("1. vault_read(n.md) → ok — conteúdo");
    expect(r).toContain("2. vault_delete(x.md) → ERRO — boom");
  });

  it("sem texto final → só o bloco de memória", () => {
    const r = flattenAgentResponse("", [
      { id: "1", name: "vault_list", arguments: { folder: "f" }, result: "3 itens", ok: true },
    ]);
    expect(r.startsWith("〔agent memory")).toBe(true);
    expect(r).toContain("vault_list(f) → ok — 3 itens");
  });

  it("steps vazios → bloco de memória sem linhas de ação", () => {
    const r = flattenAgentResponse("ok", []);
    expect(r.startsWith("ok\n\n")).toBe(true);
    expect(r).toContain("agent memory");
  });

  it("trunca args e results longos inline (sem quebrar linha)", () => {
    const longArg = "p/".padEnd(200, "a");
    const longRes = "r".padEnd(500, "z");
    const r = flattenAgentResponse("ok", [
      { id: "1", name: "vault_read", arguments: { path: longArg }, result: longRes, ok: true },
    ]);
    expect(r).toContain("…");
    // a linha da ação não contém newline interno além do separador do bloco
    const actionLine = r.split("\n").find((l) => l.startsWith("1."))!;
    expect(actionLine.length).toBeLessThan(280);
  });
});

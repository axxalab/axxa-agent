import { describe, it, expect } from "vitest";
import {
  renderChatMarkdown,
  parseChatMarkdown,
  type ChatData,
  type ChatMessageStored,
} from "../src/core/chatPersistence";
import { storeMessagesToProvider } from "../src/agent/conversation";
import { toOpenAIMessages } from "../src/providers/_shared";
import { toAnthropicPayload } from "../src/providers/anthropic";
import type { AIToolStep } from "../src/agent/types";
import type { ProviderMessage } from "../src/providers/base";

// =============================================================================
// Persistência de chat × continuidade do agent — EDGE CASES (v0.1.161/162)
//
// Dois eixos cobertos:
//   1. Round-trip do .md (render → parse) com agentSteps em situações chatas.
//   2. Reconstrução do history (storeMessagesToProvider) → payload WIRE válido
//      em TODOS os providers: OpenAI-compat (toOpenAIMessages) e Anthropic
//      (toAnthropicPayload). É a prova de que "reabrir o chat e continuar"
//      funciona em qualquer provider/modo.
// =============================================================================

const baseChat: ChatData = {
  id: "edge1",
  title: "Edge",
  date: "2026-06-11T00:00:00.000Z",
  mode: "agent",
  provider: "anthropic",
  model: "claude-opus-4-8",
  effort: "high",
  tokensIn: 10,
  tokensOut: 20,
  messages: [],
};

const mkChat = (messages: ChatMessageStored[]): ChatData => ({
  ...baseChat,
  messages,
});

// ── Validadores de invariantes wire ─────────────────────────────────────────

/** OpenAI-compat: todo `tool` casa com um assistant.tool_calls[].id anterior. */
function assertOpenAIToolIntegrity(wire: Array<Record<string, any>>) {
  const declared = new Set<string>();
  for (const m of wire) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        declared.add(tc.id);
        // arguments sempre string JSON (formato OpenAI)
        expect(typeof tc.function.arguments).toBe("string");
      }
    }
    if (m.role === "tool") {
      expect(declared.has(m.tool_call_id)).toBe(true);
    }
  }
}

/** Anthropic: alternância estrita, 1ª msg user, tool_use↔tool_result casados,
 *  zero text-block vazio. Se qualquer uma falhar, a API responde 400. */
function assertAnthropicValid(payload: ReturnType<typeof toAnthropicPayload>) {
  const { messages } = payload;
  if (messages.length === 0) return;
  // 1. primeira msg é user (Anthropic exige começar por user)
  expect(messages[0].role).toBe("user");
  // 2. alternância estrita user/assistant
  for (let i = 1; i < messages.length; i++) {
    expect(messages[i].role).not.toBe(messages[i - 1].role);
  }
  // 3. todo tool_use tem tool_result correspondente (e vice-versa)
  const useIds: string[] = [];
  const resultIds: string[] = [];
  for (const m of messages) {
    const blocks = Array.isArray(m.content) ? m.content : [];
    for (const b of blocks as Array<Record<string, any>>) {
      if (b.type === "tool_use") useIds.push(b.id);
      if (b.type === "tool_result") resultIds.push(b.tool_use_id);
    }
  }
  expect(useIds.sort()).toEqual(resultIds.sort());
  // 4. nenhum text-block vazio (Anthropic rejeita text content vazio)
  for (const m of messages) {
    const blocks = Array.isArray(m.content) ? m.content : [];
    for (const b of blocks as Array<Record<string, any>>) {
      if (b.type === "text") expect(b.text.length).toBeGreaterThan(0);
    }
  }
}

const steps2: AIToolStep[] = [
  { id: "c1", name: "vault_create", arguments: { path: "p/projeto.md" }, result: "criado", ok: true },
  { id: "c2", name: "vault_search", arguments: { query: "arquitetura" }, result: "3 hits", ok: true },
];

// =============================================================================
// 1. Round-trip de persistência — edge cases de conteúdo
// =============================================================================
describe("persistência round-trip — edge cases", () => {
  it("result com headings '## You'/'## Assistant' não quebra o parse (base64 protege)", () => {
    const steps: AIToolStep[] = [
      {
        id: "c1",
        name: "vault_read",
        arguments: { path: "n.md" },
        result: "## You\nfake\n## Assistant\nmais fake",
        ok: true,
      },
    ];
    const chat = mkChat([
      { type: "user", content: "leia", timestamp: 1 },
      { type: "ai-response", content: "li", timestamp: 2, agentSteps: steps },
    ]);
    const r = parseChatMarkdown(renderChatMarkdown(chat));
    expect(r.messages).toHaveLength(2);
    expect(r.messages[1].agentSteps).toEqual(steps);
    expect(r.messages[1].content).toBe("li");
  });

  it("emoji/acentos em content + result sobrevivem (base64 UTF-8 + YAML)", () => {
    const steps: AIToolStep[] = [
      { id: "c1", name: "vault_create", arguments: { path: "ação.md" }, result: "✅ feito — ção", ok: true },
    ];
    const chat = mkChat([
      { type: "user", content: "açaí 🍇 e ñ", timestamp: 1 },
      { type: "ai-response", content: "pronto 🚀 ção", timestamp: 2, agentSteps: steps },
    ]);
    const r = parseChatMarkdown(renderChatMarkdown(chat));
    expect(r.messages[0].content).toBe("açaí 🍇 e ñ");
    expect(r.messages[1].content).toBe("pronto 🚀 ção");
    expect(r.messages[1].agentSteps).toEqual(steps);
  });

  it("múltiplas respostas com steps → tools_used agrega todas + round-trip exato", () => {
    const chat = mkChat([
      { type: "user", content: "t1", timestamp: 1 },
      { type: "ai-response", content: "r1", timestamp: 2, agentSteps: [steps2[0]] },
      { type: "user", content: "t2", timestamp: 3 },
      { type: "ai-response", content: "r2", timestamp: 4, agentSteps: [steps2[1]] },
    ]);
    const md = renderChatMarkdown(chat);
    expect(md).toContain("vault_create p/projeto.md");
    expect(md).toContain("vault_search arquitetura");
    const r = parseChatMarkdown(md);
    expect(r.messages[1].agentSteps).toEqual([steps2[0]]);
    expect(r.messages[3].agentSteps).toEqual([steps2[1]]);
  });

  it("step com result vazio e args aninhados sobrevive", () => {
    const steps: AIToolStep[] = [
      { id: "c1", name: "vault_edit", arguments: { path: "a.md", patch: { from: "x", to: "y" } }, result: "", ok: true },
    ];
    const chat = mkChat([
      { type: "user", content: "edita", timestamp: 1 },
      { type: "ai-response", content: "ok", timestamp: 2, agentSteps: steps },
    ]);
    const r = parseChatMarkdown(renderChatMarkdown(chat));
    expect(r.messages[1].agentSteps).toEqual(steps);
  });

  it("reaction + agentSteps na MESMA msg coexistem no round-trip", () => {
    const chat = mkChat([
      { type: "user", content: "vai", timestamp: 1 },
      { type: "ai-response", content: "feito", timestamp: 2, reaction: "like", agentSteps: [steps2[0]] },
    ]);
    const r = parseChatMarkdown(renderChatMarkdown(chat));
    expect(r.messages[1].reaction).toBe("like");
    expect(r.messages[1].agentSteps).toEqual([steps2[0]]);
  });

  it("content SEM steps que termina com um comentário axxa-steps falso fica intacto", () => {
    const chat = mkChat([
      { type: "user", content: "oi", timestamp: 1 },
      // sem agentSteps; o texto só PARECE ter o marcador
      { type: "ai-response", content: "veja <!-- axxa-steps: bogus -->", timestamp: 2 },
    ]);
    const r = parseChatMarkdown(renderChatMarkdown(chat));
    expect(r.messages[1].content).toBe("veja <!-- axxa-steps: bogus -->");
    expect(r.messages[1].agentSteps).toBeUndefined();
  });
});

// =============================================================================
// 2. storeMessagesToProvider — cross-mode edge cases
// =============================================================================
describe("storeMessagesToProvider — cross-mode", () => {
  it("toolMode=true: resposta de agent com content vazio → NÃO emite assistant de texto vazio", () => {
    const out = storeMessagesToProvider(
      [
        { type: "user", content: "faz" },
        { type: "ai-response", content: "", agentSteps: steps2 },
      ],
      true
    );
    // user, assistant(tool_calls), tool, tool — sem assistant final (content vazio)
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool"]);
    expect(out.some((m) => m.role === "assistant" && m.content === "")).toBe(true);
    // o assistant vazio é o de tool_calls (tem toolCalls), não um texto solto
    const emptyAssist = out.find((m) => m.role === "assistant" && m.content === "")!;
    expect(emptyAssist.toolCalls?.length).toBe(2);
  });

  it("toolMode=false: múltiplas respostas de agent → cada uma vira UM assistant de texto, zero tool", () => {
    const out = storeMessagesToProvider([
      { type: "user", content: "t1" },
      { type: "ai-response", content: "r1", agentSteps: [steps2[0]] },
      { type: "user", content: "t2" },
      { type: "ai-response", content: "r2", agentSteps: [steps2[1]] },
    ]);
    expect(out.some((m) => m.role === "tool")).toBe(false);
    expect(out.some((m) => "toolCalls" in m)).toBe(false);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(out[1].content).toContain("vault_create");
    expect(out[3].content).toContain("vault_search");
  });
});

// =============================================================================
// 3. Continuidade CROSS-PROVIDER — o history reconstruído é WIRE-válido nos 6
// =============================================================================
describe("continuidade cross-provider — payload wire válido", () => {
  // Cenário canônico do user: abriu agente, criou projeto, voltou e continuou.
  const singleTurn: ProviderMessage[] = [
    { role: "system", content: "AGENT" },
    ...storeMessagesToProvider(
      [
        { type: "user", content: "cria o projeto" },
        { type: "ai-response", content: "Pronto!", agentSteps: steps2 },
        { type: "user", content: "feito, continue" },
      ],
      true
    ),
  ];

  // Multi-turn REAL: o agent emitiu texto entre tool calls → o store guarda
  // ai-responses CONSECUTIVOS (cada turn é uma msg), só o último tem agentSteps.
  // É o caso que gerava `assistant` consecutivos → Anthropic 400 sem o merge.
  const multiTurn: ProviderMessage[] = [
    { role: "system", content: "AGENT" },
    ...storeMessagesToProvider(
      [
        { type: "user", content: "constrói o app" },
        { type: "ai-response", content: "Deixa eu olhar a estrutura…" }, // turn 1, sem steps
        { type: "ai-response", content: "Agora vou criar os arquivos…" }, // turn 2, sem steps
        { type: "ai-response", content: "Tudo pronto.", agentSteps: steps2 }, // final
      ],
      true
    ),
  ];

  it("OpenAI-compat: single-turn — tool ids casam, args são string JSON", () => {
    assertOpenAIToolIntegrity(toOpenAIMessages(singleTurn) as Array<Record<string, any>>);
  });

  it("OpenAI-compat: multi-turn (assistants consecutivos) — integridade mantida", () => {
    assertOpenAIToolIntegrity(toOpenAIMessages(multiTurn) as Array<Record<string, any>>);
  });

  it("Anthropic: single-turn — alternância + tool_use/result casados", () => {
    assertAnthropicValid(toAnthropicPayload(singleTurn));
  });

  it("Anthropic: multi-turn — assistants consecutivos são MERGEADOS (sem 400)", () => {
    const payload = toAnthropicPayload(multiTurn);
    assertAnthropicValid(payload);
    // o system foi extraído, não virou mensagem
    expect(payload.system).toBe("AGENT");
    // os 3 ai-responses + tool_calls colapsam em UM bloco assistant antes do
    // user(tool_result) — prova do merge (texto dos turns 1/2 + tool_use juntos).
    const firstAssistant = payload.messages.find((m) => m.role === "assistant")!;
    const blocks = Array.isArray(firstAssistant.content) ? firstAssistant.content : [];
    const texts = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text);
    expect(texts.join(" ")).toContain("Deixa eu olhar");
    expect(texts.join(" ")).toContain("criar os arquivos");
    expect(blocks.some((b: any) => b.type === "tool_use")).toBe(true);
  });

  it("cross-provider: steps com ids de OUTRO provider (openai_call_*) casam no Anthropic", () => {
    const foreignSteps: AIToolStep[] = [
      { id: "openai_call_1717_0", name: "vault_create", arguments: { path: "x.md" }, result: "ok", ok: true },
    ];
    const hist: ProviderMessage[] = storeMessagesToProvider(
      [
        { type: "user", content: "cria" },
        { type: "ai-response", content: "feito", agentSteps: foreignSteps },
      ],
      true
    );
    const payload = toAnthropicPayload([{ role: "system", content: "A" }, ...hist]);
    assertAnthropicValid(payload);
    // o id estrangeiro foi preservado no tool_use E no tool_result
    const flat = payload.messages.flatMap((m) =>
      Array.isArray(m.content) ? m.content : []
    ) as Array<Record<string, any>>;
    expect(flat.find((b) => b.type === "tool_use")?.id).toBe("openai_call_1717_0");
    expect(flat.find((b) => b.type === "tool_result")?.tool_use_id).toBe("openai_call_1717_0");
  });

  it("flatten (chat mode) também produz Anthropic válido em chat multi-turn de agente", () => {
    const flat = storeMessagesToProvider([
      { type: "user", content: "oi" },
      { type: "ai-response", content: "pensando…" },
      { type: "ai-response", content: "feito", agentSteps: steps2 },
    ]); // toolMode=false
    const payload = toAnthropicPayload([{ role: "system", content: "S" }, ...flat]);
    assertAnthropicValid(payload);
    // sem tool_use no flatten — tudo é texto
    const flatBlocks = payload.messages.flatMap((m) =>
      Array.isArray(m.content) ? m.content : []
    ) as Array<Record<string, any>>;
    expect(flatBlocks.some((b) => b.type === "tool_use")).toBe(false);
  });

  it("end-to-end: persiste no .md → relê → reconstrói → Anthropic válido", () => {
    // Simula o ciclo completo: salvar agent chat, reabrir, continuar.
    const chat = mkChat([
      { type: "user", content: "cria o projeto", timestamp: 1 },
      { type: "ai-response", content: "olhando…", timestamp: 2 },
      { type: "ai-response", content: "Pronto!", timestamp: 3, agentSteps: steps2 },
    ]);
    const reloaded = parseChatMarkdown(renderChatMarkdown(chat));
    const hist = storeMessagesToProvider(
      reloaded.messages.concat({ type: "user", content: "feito", timestamp: 4 }),
      undefined,
      true
    );
    assertOpenAIToolIntegrity(
      toOpenAIMessages([{ role: "system", content: "A" }, ...hist]) as Array<Record<string, any>>
    );
    assertAnthropicValid(toAnthropicPayload([{ role: "system", content: "A" }, ...hist]));
  });
});

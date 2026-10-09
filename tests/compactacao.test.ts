import { afterEach, describe, expect, it } from "vitest";
import {
  aprenderJanela,
  caberNaJanela,
  custoDaMensagem,
  emPedacos,
  encolherResultados,
  janelaDoModelo,
  janelaNoErro,
  pontoDeCorte,
  tetoDaResposta,
  transcricao,
} from "../src/core/compactacao";
import { storeMessagesToProvider, inicioVisivel } from "../src/agent/conversation";
import { gravarContextoDoTurno } from "../src/core/contextoDoTurno";
import { parseChatMarkdown, renderChatMarkdown, type ChatData } from "../src/core/chatPersistence";
import { mensagensParaGravar } from "../src/core/session";
import { streamReply } from "../src/core/chatEngine";
import { getTranslations } from "../src/i18n";
import { useChatStore, type ChatMessage } from "../src/store/chat";
import { ProviderError, type ProviderRequest } from "../src/providers/base";
import { resolveMaxTokens } from "../src/providers/paramPolicy";
import { tokensDoAnexo } from "../src/providers/ollama";

// Conversa longa que não cabe mais na janela do modelo: o começo vira um
// resumo (feito pelo próprio modelo), gravado na mensagem do corte; o modelo
// segue recebendo resumo + recentes inteiras, e a tela continua com tudo.

const u = (id: string, content: string, x: Partial<Extract<ChatMessage, { type: "user" }>> = {}) =>
  ({ id, type: "user", content, timestamp: 1, ...x }) as ChatMessage;
const r = (id: string, content: string) => ({ id, type: "ai-response", content, timestamp: 1 }) as ChatMessage;
const longo = (n: number) => "palavra ".repeat(n);

afterEach(() => {
  useChatStore.getState().newChat();
  useChatStore.getState().clearBackground();
});

describe("o tamanho da janela, no erro do provider", () => {
  it("cada provider diz do seu jeito", () => {
    expect(janelaNoErro("This model's maximum context length is 32768 tokens. However, you requested 40000")).toBe(32768);
    expect(janelaNoErro("prompt is too long: 215000 tokens > 200000 maximum")).toBe(200000);
    expect(janelaNoErro("input length and `max_tokens` exceed context limit: 188240 + 21333 > 200000")).toBe(200000);
    expect(janelaNoErro("The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).")).toBe(1048576);
    expect(janelaNoErro("Request exceeds context window of 8,192 tokens")).toBe(8192);
    expect(janelaNoErro("Bad request")).toBeNull();
  });

  it("a janela aprendida vale nos próximos pedidos", async () => {
    aprenderJanela("nim", "modelo-x", new Error("maximum context length is 16384 tokens"));
    expect(await janelaDoModelo("nim", "modelo-x", "k")).toBe(16384);
  });

  it("a resposta cabe junto com o pedido (e nunca abaixo de 1k)", () => {
    expect(tetoDaResposta(128000, 120000)).toBe(7488);
    expect(tetoDaResposta(8000, 9000)).toBe(1024);
  });

  it("o teto da janela vale DEPOIS do piso dos modelos que pensam", () => {
    // Claude 5.5 no Max: o piso é 64k — num pedido que só deixa 5k, vão 5k
    expect(resolveMaxTokens("anthropic", "claude-sonnet-5-5", 2000, "max")).toBe(64000);
    expect(resolveMaxTokens("anthropic", "claude-sonnet-5-5", 2000, "max", 5000)).toBe(5000);
  });

  it("PDF conta no tamanho (antes: zero)", () => {
    expect(tokensDoAnexo({ type: "pdf", dataUrl: "x".repeat(800_000) })).toBe(10000);
    expect(tokensDoAnexo({ type: "image", dataUrl: "x" })).toBe(1000);
  });
});

describe("onde cortar", () => {
  it("numa mensagem do usuário, guardando o fim que cabe no orçamento", () => {
    const msgs = [u("u1", longo(300)), r("r1", longo(300)), u("u2", longo(30)), r("r2", longo(30)), u("u3", "e agora?")];
    const custoDoFim = custoDaMensagem(msgs[2]) + custoDaMensagem(msgs[3]) + custoDaMensagem(msgs[4]);
    expect(pontoDeCorte(msgs, custoDoFim)).toBe(2);
    // orçamento mínimo: fica ao menos a última mensagem do usuário
    expect(pontoDeCorte(msgs, 1)).toBe(4);
  });

  it("sempre depois do resumo atual; sem conversa antes, não corta", () => {
    const msgs = [u("u1", "a"), r("r1", "b"), u("u2", "c", { resumo: "resumo" }), r("r2", "d"), u("u3", "e")];
    expect(inicioVisivel(msgs)).toBe(2);
    expect(pontoDeCorte(msgs, 1)).toBe(4);
    expect(pontoDeCorte([u("u1", "só eu")], 1)).toBeNull();
  });
});

describe("o histórico pro modelo começa no resumo", () => {
  it("o que veio antes some; o resumo vai no começo da mensagem do corte, antes do contexto", () => {
    const out = storeMessagesToProvider([
      u("u1", "pergunta antiga"),
      r("r1", "resposta antiga"),
      u("u2", "pergunta nova", { resumo: "- decidiram lançar em março", contexto: "<vault_notes>x</vault_notes>" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toMatch(/^<conversation_summary>[\s\S]*lançar em março[\s\S]*<\/conversation_summary>\n\n<vault_notes>x<\/vault_notes>\n\npergunta nova$/);
  });

  it("o trecho do vault que só estava ANTES do resumo pode voltar", () => {
    const a = "### [[A]]\n_(A.md)_\n\ntexto A";
    useChatStore.getState().setMessages([
      u("u1", "1", { contexto: `<vault_notes>\n${a}\n</vault_notes>` }),
      r("r1", "r"),
      u("u2", "2", { resumo: "resumo" }),
      r("r2", "r"),
      u("u3", "3"),
    ]);
    gravarContextoDoTurno(a, undefined);
    const u3 = useChatStore.getState().messages[4] as Extract<ChatMessage, { type: "user" }>;
    expect(u3.contexto).toContain("texto A");
  });
});

describe("só o resumo mais novo fica", () => {
  it("o novo já soma os anteriores: o velho sai da mensagem", () => {
    useChatStore.getState().setMessages([u("u1", "a"), r("r1", "b"), u("u2", "c", { resumo: "velho" }), r("r2", "d"), u("u3", "e")]);
    useChatStore.getState().setResumo("u3", "novo");
    const comResumo = useChatStore.getState().messages.filter((m) => m.type === "user" && m.resumo);
    expect(comResumo.map((m) => [m.id, (m as { resumo?: string }).resumo])).toEqual([["u3", "novo"]]);
  });
});

describe("o resumo obedece ao Parar e não insiste quando falha", () => {
  const conversaLonga = () => {
    useChatStore.getState().setCurrentChatId("cx");
    useChatStore.getState().setMessages([u("u1", longo(3000)), r("r1", longo(3000)), u("u2", "e então?")]);
  };

  it("Parar no meio do resumo: o turno para (AbortError) e nada é gravado", async () => {
    aprenderJanela("falso", "parar", new Error("maximum context length is 8192 tokens"));
    conversaLonga();
    const controle = new AbortController();
    let usos = 0;
    const provider = {
      chat: () => new Promise((ok) => setTimeout(() => { usos++; ok({ content: "resumo", usage: { input: 10, output: 1 } }); }, 30)),
    };
    const indo = caberNaJanela({
      provider: provider as never, providerId: "falso", model: "parar", apiKey: "k",
      system: "s", opcoes: {}, maxTokens: 1000, dono: "cx", signal: controle.signal,
    });
    // Parar com o pedido do resumo já no ar
    await new Promise((ok) => setTimeout(ok, 5));
    controle.abort();
    await expect(indo).rejects.toMatchObject({ name: "AbortError" });
    expect(useChatStore.getState().messages.some((m) => m.type === "user" && m.resumo)).toBe(false);
    // o pedido que já tinha saído ainda conta no gasto quando volta
    await new Promise((ok) => setTimeout(ok, 60));
    expect(usos).toBe(1);
    expect(useChatStore.getState().tokensIn).toBe(10);
  });

  it("resumir falhou: não tenta de novo a cada turno (cada tentativa é paga)", async () => {
    aprenderJanela("falso", "falha", new Error("maximum context length is 8192 tokens"));
    conversaLonga();
    let tentativas = 0;
    const provider = { chat: async () => { tentativas++; throw new Error("500"); } };
    const pedido = {
      provider: provider as never, providerId: "falso", model: "falha", apiKey: "k",
      system: "s", opcoes: {}, maxTokens: 1000, dono: "cx",
    };
    expect((await caberNaJanela(pedido)).resumiu).toBe(false);
    expect((await caberNaJanela(pedido)).resumiu).toBe(false);
    expect(tentativas).toBe(1);
    // recusado pelo provider (apertado): tenta mesmo assim
    await caberNaJanela({ ...pedido, apertado: true });
    expect(tentativas).toBe(2);
  });
});

describe("o resumo no arquivo", () => {
  it("vai na linha de meta e volta igual (com o contexto junto)", () => {
    const chat: ChatData = {
      id: "c1", title: "T", date: "2026-10-09T12:00:00.000Z", mode: "chat", provider: "openai",
      model: "gpt-5.4", effort: "med", tokensIn: 1, tokensOut: 1,
      messages: mensagensParaGravar([
        u("u1", "oi"),
        r("r1", "olá"),
        u("u2", "e aí?", { resumo: "## Decisões\n- lançar em março\n## You", contexto: "ctx" }),
      ]),
    };
    const md = renderChatMarkdown(chat);
    expect(md).toMatch(/<!-- axxa: ts=1 ctx=\S+ sum=[A-Za-z0-9+/=]+ -->/);
    expect(parseChatMarkdown(md).messages).toEqual(chat.messages);
  });
});

describe("o texto que vai pra quem resume", () => {
  it("quem disse o quê, as ações do agente e QUAIS notas foram (sem o conteúdo)", () => {
    const partes = transcricao([
      u("u1", "resume a reunião", { contexto: "<vault_notes>\n### [[Reunião]]\n_(R.md)_\n\nconteúdo enorme\n</vault_notes>" }),
      {
        id: "r1", type: "ai-response", content: "Feito.", timestamp: 1,
        agentSteps: [{ id: "c1", name: "vault_create", arguments: { path: "Resumo.md" }, result: "ok", ok: true }],
      } as ChatMessage,
      { id: "x", type: "ai-comment", content: "pensando", timestamp: 1 } as ChatMessage,
    ]);
    expect(partes).toHaveLength(2);
    expect(partes[0]).toContain("[Notes sent along: [[Reunião]]]");
    expect(partes[0]).not.toContain("conteúdo enorme");
    expect(partes[1]).toContain("vault_create(Resumo.md)");
  });

  it("conversa grande vai em pedaços; parte maior que o pedaço é aparada", () => {
    expect(emPedacos(["a".repeat(60), "b".repeat(60)], 100)).toHaveLength(2);
    const [unico] = emPedacos(["c".repeat(500)], 100);
    expect(unico.length).toBeLessThanOrEqual(100);
    expect(unico).toContain("[… trimmed]");
  });
});

describe("no meio de uma rodada longa do agente", () => {
  it("os resultados de ferramenta antigos encolhem; os 2 últimos ficam inteiros", () => {
    const grande = "x".repeat(5000);
    const h = [
      { role: "system", content: "s" },
      { role: "tool", content: grande },
      { role: "tool", content: "curto" },
      { role: "tool", content: grande },
      { role: "tool", content: grande },
      { role: "tool", content: grande },
    ];
    expect(encolherResultados(h)).toBe(2);
    expect(h[1].content.length).toBeLessThan(1200);
    expect(h[2].content).toBe("curto");
    expect(h[3].content.length).toBeLessThan(1200);
    expect(h[4].content).toBe(grande);
    expect(h[5].content).toBe(grande);
  });
});

/** Um provider falso: o chat() é quem resume; o streamChat responde o turno. */
function falso(o: { recusarPrimeiro?: boolean } = {}) {
  const pedidosDoResumo: ProviderRequest[] = [];
  const pedidosDoTurno: ProviderRequest[] = [];
  let recusou = false;
  const provider = {
    id: "falso",
    name: "Falso",
    supportsTools: true,
    chat: async (req: ProviderRequest) => {
      pedidosDoResumo.push(req);
      return { content: "- o usuário quer lançar em março", usage: { input: 900, output: 20 } };
    },
    streamChat: async (req: ProviderRequest, _k: string, onToken: (t: string) => void) => {
      pedidosDoTurno.push(req);
      if (o.recusarPrimeiro && !recusou) {
        recusou = true;
        throw new ProviderError("Falso: This model's maximum context length is 4096 tokens.", "context-overflow");
      }
      onToken("ok");
      return { content: "ok" };
    },
  };
  return { provider, pedidosDoResumo, pedidosDoTurno };
}

const ctx = (provider: unknown, model: string) => ({
  plugin: { settings: { effortConfigs: undefined } } as never,
  t: getTranslations("pt-br"),
  abortRef: { current: null },
  activeProviderId: "falso",
  activeProvider: provider as never,
  activeModel: model,
  activeMode: "chat",
  useVault: false,
  apiKeyFor: () => "k",
  effort: "low",
  resolveStyleInstruction: () => "",
});

describe("no turno", () => {
  it("passou de 80% da janela: o começo vira resumo antes do pedido", async () => {
    aprenderJanela("falso", "pequeno", new Error("maximum context length is 8192 tokens"));
    const { provider, pedidosDoResumo } = falso();
    useChatStore.getState().setCurrentChatId("c1");
    useChatStore.getState().setMessages([
      u("u1", longo(4000)), r("r1", longo(4000)), u("u2", longo(3000)), r("r2", "certo"), u("u3", "e o prazo?"),
    ]);
    const res = await caberNaJanela({
      provider: provider as never, providerId: "falso", model: "pequeno", apiKey: "k",
      system: "Você é o AXXA.", opcoes: {}, maxTokens: 1000, dono: "c1",
    });
    expect(res).toEqual({ janela: 8192, resumiu: true });
    // a conversa antiga não cabe num pedido só: vai em pedaços, cada um
    // somado ao resumo do anterior
    expect(pedidosDoResumo.length).toBeGreaterThan(1);
    expect(pedidosDoResumo[0].messages[1].content).toContain("<transcript>");
    expect(pedidosDoResumo.slice(1).every((p) => p.messages[1].content.includes("<previous_summary>"))).toBe(true);
    expect(pedidosDoResumo[0].cacheKey).toBeUndefined();
    const st = useChatStore.getState();
    const comResumo = st.messages.filter((m) => m.type === "user" && m.resumo);
    expect(comResumo.map((m) => m.id)).toEqual(["u3"]);
    // o gasto do resumo entra na conversa
    expect(st.tokensIn).toBe(900 * pedidosDoResumo.length);
    // e a tela continua com tudo
    expect(st.messages).toHaveLength(5);
  });

  it("cabendo, nada acontece", async () => {
    const { provider, pedidosDoResumo } = falso();
    useChatStore.getState().setMessages([u("u1", "oi")]);
    const res = await caberNaJanela({
      provider: provider as never, providerId: "falso", model: "grande", apiKey: "k",
      system: "s", opcoes: {}, maxTokens: 1000, dono: null,
    });
    expect(res.resumiu).toBe(false);
    expect(pedidosDoResumo).toHaveLength(0);
  });

  it("o provider recusou por tamanho: aprende a janela, resume e manda de novo", async () => {
    const { provider, pedidosDoResumo, pedidosDoTurno } = falso({ recusarPrimeiro: true });
    useChatStore.getState().setCurrentChatId("c2");
    useChatStore.getState().setMessages([
      u("u1", longo(300)), r("r1", longo(300)), u("u2", "e o prazo?"),
    ]);
    await streamReply(ctx(provider, "recusa") as never, "e o prazo?");
    expect(pedidosDoTurno).toHaveLength(2);
    expect(pedidosDoResumo).toHaveLength(1);
    const segundo = pedidosDoTurno[1].messages;
    expect(segundo).toHaveLength(2); // system + a mensagem do corte (com o resumo)
    expect(segundo[1].content).toContain("<conversation_summary>");
    expect(segundo[1].content).toContain("e o prazo?");
    // a janela que o erro disse fica guardada
    expect(await janelaDoModelo("falso", "recusa", "k")).toBe(4096);
    // e a conversa termina com a resposta, sem bolha de erro
    const ultima = useChatStore.getState().messages.at(-1);
    expect(ultima).toMatchObject({ type: "ai-response", content: "ok" });
  });
});

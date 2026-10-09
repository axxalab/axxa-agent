import { describe, it, expect } from "vitest";
import {
  formatarTokens,
  resumoDoProjeto,
  tokensDeEntrada,
} from "../src/ui/projectSummary";
import {
  blocoDeInstrucoes,
  blocoDeNotasAnexadas,
} from "../src/agent/conversation";
import { estimateTokens } from "../src/core/tokens";
import type { Project } from "../src/projects";

// O CARTÃO de projeto responde três perguntas sem abrir o projeto: está vivo?
// do que se trata? quanto já tem?

const AGORA = new Date("2026-09-29T12:00:00Z").getTime();
const dias = (n: number) => new Date(AGORA - n * 86_400_000).toISOString();

const projeto = (p: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "Tese",
  icon: "book",
  color: "default",
  sources: [],
  chatIds: [],
  createdAt: dias(5),
  ...p,
});

describe("está vivo?", () => {
  it("com conversas: quando foi a ÚLTIMA", () => {
    const r = resumoDoProjeto(
      projeto({ chatIds: ["a", "b"] }),
      [
        { id: "a", title: "Antiga", date: dias(9) },
        { id: "b", title: "Recente", date: dias(2) },
      ],
      AGORA
    );
    expect(r.quando).toBe("2d ago");
  });

  it("sem conversa nenhuma: quando ele nasceu", () => {
    expect(resumoDoProjeto(projeto(), [], AGORA).quando).toBe("5d ago");
  });

  it("agora mesmo não vira '0m ago'", () => {
    const r = resumoDoProjeto(
      projeto({ chatIds: ["a"] }),
      [{ id: "a", title: "x", date: new Date(AGORA - 5_000).toISOString() }],
      AGORA
    );
    expect(r.quando).toBe("just now");
  });

  it("mais de um mês: a data, sem 'ago' pendurado depois dela", () => {
    const r = resumoDoProjeto(projeto({ createdAt: dias(60) }), [], AGORA);
    expect(r.quando).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("do que se trata?", () => {
  it("a primeira linha das instruções — a frase que a pessoa escreveu", () => {
    const r = resumoDoProjeto(
      projeto({ instructions: "\n  Responda em português.\nCite a nota." }),
      [],
      AGORA
    );
    expect(r.sobre).toBe("Responda em português.");
  });

  it("sem instruções: o título da conversa mais recente", () => {
    const r = resumoDoProjeto(
      projeto({ chatIds: ["a", "b"] }),
      [
        { id: "a", title: "Antiga", date: dias(9) },
        { id: "b", title: "Kuhn e paradigmas", date: dias(1) },
      ],
      AGORA
    );
    expect(r.sobre).toBe("Latest: Kuhn e paradigmas");
  });

  it("sem os dois: nada — o cartão mostra a dica, não inventa assunto", () => {
    expect(resumoDoProjeto(projeto(), [], AGORA).sobre).toBeNull();
  });
});

describe("quanto já tem?", () => {
  it("conta só as conversas que EXISTEM", () => {
    // `chatIds` guarda id de conversa apagada também, e um "3 chats" que abre
    // em dois seria o cartão mentindo.
    const r = resumoDoProjeto(
      projeto({ chatIds: ["a", "apagada", "b"] }),
      [
        { id: "a", title: "A", date: dias(1) },
        { id: "b", title: "B", date: dias(2) },
        { id: "de-outro", title: "C", date: dias(0) },
      ],
      AGORA
    );
    expect(r.conversas).toBe(2);
  });
});

describe("quanto custa abrir uma conversa aqui? (tokens de entrada)", () => {
  const nota = (path: string, content: string) => ({ path, content });

  it("é o texto que o projeto SOMA ao prompt — instruções e notas inteiras", () => {
    // Os mesmos montadores que o envio usa: o número é o texto que sai.
    const notas = [nota("Tese/Kuhn.md", "Paradigma.".repeat(35))];
    const instr = "Responda em português.";
    const texto =
      blocoDeInstrucoes(instr) + blocoDeNotasAnexadas(notas);
    expect(tokensDeEntrada(instr, notas)).toBe(estimateTokens(texto));
  });

  it("projeto sem notas e sem instruções não custa nada", () => {
    expect(tokensDeEntrada(undefined, [])).toBe(0);
    expect(tokensDeEntrada("   ", [])).toBe(0);
  });

  it("nota maior, projeto mais caro — o conteúdo inteiro vai", () => {
    const pequena = tokensDeEntrada("", [nota("a.md", "x".repeat(350))]);
    const grande = tokensDeEntrada("", [nota("a.md", "x".repeat(3500))]);
    expect(grande).toBeGreaterThan(pequena * 5);
  });

  it("o bloco de notas é o mesmo texto que vai pro modelo", () => {
    // O cartão conta os tokens do MESMO montador que o envio usa.
    expect(
      blocoDeNotasAnexadas([nota("A.md", "um"), nota("B.md", "dois")])
    ).toBe(
      "<attached_notes>\n### A.md\n\num\n\n---\n\n### B.md\n\ndois\n</attached_notes>"
    );
    expect(blocoDeNotasAnexadas([])).toBe("");
    expect(blocoDeInstrucoes("  Seja breve.  ")).toBe("\n\nSeja breve.");
  });
});

describe("formatarTokens — curto, e com ~ porque é estimativa", () => {
  it("zero sem til", () => expect(formatarTokens(0)).toBe("0 tokens"));
  it("centenas", () => expect(formatarTokens(340)).toBe("~340 tokens"));
  it("milhares com uma casa", () => {
    expect(formatarTokens(1234)).toBe("~1.2k tokens");
    expect(formatarTokens(2000)).toBe("~2k tokens");
  });
  it("dezenas de milhares, redondo", () =>
    expect(formatarTokens(12_400)).toBe("~12k tokens"));
});

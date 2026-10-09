// src/ui/Thinking.tsx
// A linha de "pensando" enquanto a rodada acontece.
//
// Três coisas, na linguagem da referência:
//   - um asterisco em ACENTO que respira: cresce, encolhe e volta com OUTRA
//     forma (três desenhos que se revezam girando)
//   - o tempo decorrido, que é o que responde "travou?" sem precisar perguntar
//   - o verbo, que troca de tempos em tempos — a mesma espera com palavra nova
//     parece uma espera menor
//
// O texto some no primeiro pedaço da resposta: a partir daí quem mostra que
// tem coisa acontecendo é o próprio texto aparecendo.

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { marca, tr } from "../i18n/tr";

/** Os verbos da espera. Ordem fixa (não sorteada) pra a sequência ser sempre
 *  a mesma — e pra o teste poder olhar pra ela. */
export const THINKING_VERBS = [
  marca("Thinking"),
  marca("Pondering"),
  marca("Deliberating"),
  marca("Mulling it over"),
  marca("Considering"),
  marca("Ruminating"),
  marca("Turning it over"),
  marca("Weighing options"),
  marca("Chewing on it"),
  marca("Puzzling it out"),
];

/** De quanto em quanto tempo a palavra muda. */
export const VERB_MS = 5000;

export function verbAt(passadoMs: number): string {
  const i = Math.floor(Math.max(0, passadoMs) / VERB_MS) % THINKING_VERBS.length;
  return THINKING_VERBS[i];
}

/** "7s", "59s", "1m 12s" — curto o bastante pra caber antes do verbo. */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const resto = s % 60;
  return `${m}m ${String(resto).padStart(2, "0")}s`;
}

/**
 * O asterisco que respira. Três formas empilhadas, cada uma com a sua vez.
 *
 * Exportado porque a espera é a MESMA em toda parte: o chat esperando o modelo
 * e a assistente escrevendo um skill são a mesma coisa acontecendo, e duas
 * animações diferentes pra isso ensinariam que são coisas diferentes.
 */
export function ThinkingGlyph() {
  return (
    <span className="axxa-thinking-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="axxa-glyph-a">
        <g
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        >
          <line x1="12" y1="3" x2="12" y2="21" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
          <line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
        </g>
      </svg>
      <svg viewBox="0 0 24 24" className="axxa-glyph-b">
        <g
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          fill="none"
        >
          <line x1="12" y1="6" x2="12" y2="18" />
          <line x1="6.8" y1="9" x2="17.2" y2="15" />
          <line x1="17.2" y1="9" x2="6.8" y2="15" />
        </g>
      </svg>
      <svg viewBox="0 0 24 24" className="axxa-glyph-c">
        <path
          d="M12 2.5c.7 4.4 2.4 6.1 6.8 6.8v1.4c-4.4.7-6.1 2.4-6.8 6.8h-1.4c-.7-4.4-2.4-6.1-6.8-6.8V9.3c4.4-.7 6.1-2.4 6.8-6.8z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

export function ThinkingLine({
  /** Quantas ações já aconteceram nesta rodada (0 = nada pra abrir). */
  count,
  /** Quando a rodada começou (ms). */
  since,
  onOpen,
  /** O que está acontecendo, quando não é "pensar" (ex.: resumindo a
   *  conversa) — no lugar do verbo da vez. */
  rotulo,
}: {
  count: number;
  since: number;
  onOpen: () => void;
  rotulo?: string;
}) {
  const [agora, setAgora] = useState(() => Date.now());
  const sinceRef = useRef(since);
  sinceRef.current = since;

  // Um tique por segundo: o relógio é a informação, não a animação.
  useEffect(() => {
    setAgora(Date.now());
    const t = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [since]);

  const passado = Math.max(0, agora - since);
  // O VERBO, não o nome da tool: o que rodou mora na folha, a um toque do
  // chevron — é assim na referência, e é o que mantém a linha com uma
  // informação só.
  const texto = verbAt(passado);

  return (
    <button
      type="button"
      className="axxa-thinking"
      disabled={count === 0}
      onClick={onOpen}
    >
      <ThinkingGlyph />
      <span className="axxa-thinking-label">
        <span className="axxa-thinking-time">{elapsedLabel(passado)}</span>
        <span className="axxa-thinking-dot"> · </span>
        {rotulo ?? `${tr(texto)}…`}
      </span>
      {count > 0 && <Icon name="chevron-right" size={15} />}
    </button>
  );
}

/**
 * A mesma espera, sem o botão em volta.
 *
 * O `Thinking` de cima é um BOTÃO: ele abre a folha dos passos do agente. Onde
 * não há passos pra abrir — a assistente escrevendo um skill — sobra o que
 * importa: o glifo, o relógio e o verbo. O relógio é o que responde "travou?"
 * sem ninguém precisar perguntar.
 */
export function ThinkingInline({ since }: { since: number }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    setAgora(Date.now());
    const t = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [since]);
  const passado = Math.max(0, agora - since);
  return (
    <span className="axxa-thinking is-inline">
      <ThinkingGlyph />
      <span className="axxa-thinking-label">
        <span className="axxa-thinking-time">{elapsedLabel(passado)}</span>
        <span className="axxa-thinking-dot"> · </span>
        {tr(verbAt(passado))}…
      </span>
    </span>
  );
}

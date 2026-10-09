// src/providers/index.ts
// Registry de todos os providers disponíveis.
// AxxaApp usa getProvider(settings.defaultProvider) pra escolher o provider ativo.

import type { Provider, Usage } from "./base";
import { openaiProvider } from "./openai";
import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { openrouterProvider } from "./openrouter";
import { nimProvider } from "./nim";
import { ollamaProvider } from "./ollama";
import { anotarUso, conferirGasto } from "../usage/anotador";
import type { Lancamento } from "../usage/livroDoDia";

export const providers: Record<string, Provider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  openrouter: openrouterProvider,
  nim: nimProvider,
  ollama: ollamaProvider,
};

/**
 * O provider com o uso ANOTADO (ver usage/anotador.ts): cada pedido de chat
 * que o servidor ACEITOU soma 1 pedido e os tokens que o provider reportou —
 * é disso que sai o "quanto sobra hoje" da tela de Uso.
 *
 * Aceito = respondeu, ou mandou ao menos um pedaço antes de parar (Stop no
 * meio também gastou a cota). Recusado antes de começar (chave errada, 429,
 * rede) não conta: a cota do provider também não andou.
 *
 * Do stream vale o ÚLTIMO uso reportado, somado uma vez no fim: o leitor de
 * SSE chama o aviso a cada pedaço que traz uso, e há provider que manda o
 * acumulado mais de uma vez (somar todos multiplicaria). O resto do provider
 * (listar modelos, gerar mídia…) passa direto, pelo protótipo.
 */
function comRegistro(p: Provider): Provider {
  const w = Object.create(p) as Provider;
  w.chat = async (req, apiKey) => {
    // O limite de gasto do dia barra ANTES de sair (ver usage/gastoDoDia.ts).
    conferirGasto(p.id, req.model);
    const res = await p.chat(req, apiKey);
    anotarUso(p.id, req.model, lancamentoDe(res.usage));
    return res;
  };
  w.streamChat = async (req, apiKey, onToken, onUsage, signal, onReasoning) => {
    conferirGasto(p.id, req.model);
    let aceito = false;
    let ultimo: Usage | null = null;
    try {
      const res = await p.streamChat(
        req,
        apiKey,
        (t) => {
          aceito = true;
          onToken(t);
        },
        (u) => {
          aceito = true;
          ultimo = u;
          onUsage?.(u);
        },
        signal,
        onReasoning &&
          ((d) => {
            aceito = true;
            onReasoning(d);
          })
      );
      aceito = true;
      ultimo ??= res.usage ?? null;
      return res;
    } finally {
      if (aceito) anotarUso(p.id, req.model, lancamentoDe(ultimo ?? undefined));
    }
  };
  return w;
}

/** Um pedido aceito no formato do livro: entrada (toda), saída e, quando o
 *  provider contou, o que veio do cache e o que foi gravado nele. */
function lancamentoDe(u: Usage | undefined): Partial<Lancamento> {
  const l: Partial<Lancamento> = { r: 1, i: u?.input ?? 0, o: u?.output ?? 0 };
  if (u?.cacheRead) l.c = u.cacheRead;
  if (u?.cacheWrite) l.w = u.cacheWrite;
  return l;
}

/** Um embrulho por OBJETO de provider (não por id): trocar o objeto — um
 *  teste, um reload — ganha embrulho novo em vez de herdar o do antigo. */
const comUso = new WeakMap<Provider, Provider>();

/**
 * Retorna o provider pelo id — com o uso anotado (ver comRegistro). Se o id
 * for desconhecido (ex: settings corrompida), cai pro OpenAI como default
 * seguro.
 */
export function getProvider(id: string): Provider {
  const p = providers[id] ?? openaiProvider;
  let w = comUso.get(p);
  if (!w) {
    w = comRegistro(p);
    comUso.set(p, w);
  }
  return w;
}

export {
  openaiProvider,
  anthropicProvider,
  geminiProvider,
  openrouterProvider,
  nimProvider,
  ollamaProvider,
};

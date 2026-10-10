// src/core/cacheDoTurno.ts
// Quanto o cache de prompt de um turno dura (Anthropic, e os Claude pelo
// OpenRouter) — escolhido pelo RITMO da conversa.
//
// O cache de 5 min custa 1,25× a entrada pra gravar e bem menos pra ler
// (0,025× a 0,1×). Respondendo em poucos minutos, ele paga: cada turno relê a
// conversa inteira barato. Com pausas maiores, ele expira antes de ser lido,
// e todo turno grava tudo de novo a 1,25× — mais caro que sem cache (nas
// contas da 0.9.24, até +160% num chat com notas). Então o turno escolhe pela
// pausa desde o último pedido DESTA conversa:
//   · menos de ~5 min: o cache ainda está vivo — segue com a duração dele;
//   · de 5 a ~55 min: 1 hora (gravar custa 2×, mas o turno seguinte relê);
//   · mais de ~55 min: no chat, não grava (mandar cheio sai mais barato que
//     gravar de novo pra talvez ninguém ler); no Agent grava 5 min — os
//     passos da rodada relêem em segundos.
// O OpenRouter só segura a conversa no mesmo provedor por 10 min parada: um
// cache de 1 h lá provavelmente ficaria noutro provedor. Lá, pausa = sem
// gravar no chat, 5 min no Agent.
//
// A mesma duração vale pra todos os pedidos do turno (o Agent faz vários):
// trocar no meio arriscaria ler com uma duração o que foi gravado com outra,
// e a doc da Anthropic não diz se isso acerta.

export type TtlDoCache = "5m" | "1h" | "off";

/** Margens: o relógio do cache conta do COMEÇO do pedido que gravou ou leu. */
export const VIVE_5M = 4.5 * 60_000;
export const VIVE_1H = 55 * 60_000;

/**
 * A duração do cache de um turno. `desde`: ms desde o último pedido desta
 * conversa (null = nenhum conhecido). `anterior`: a duração que ele usou.
 */
export function ttlDoTurno(p: {
  provider: string;
  modo: "chat" | "agent";
  desde: number | null;
  anterior: TtlDoCache | null;
}): TtlDoCache {
  // Os outros providers guardam sozinhos (ou não guardam): a duração não vale.
  if (p.provider !== "anthropic" && p.provider !== "openrouter") return "5m";
  if (p.desde === null || p.desde < 0) return "5m";
  if (p.desde < VIVE_5M) return p.anterior && p.anterior !== "off" ? p.anterior : "5m";
  if (p.desde < VIVE_1H && p.provider === "anthropic") return "1h";
  return p.modo === "agent" ? "5m" : "off";
}

/** O último pedido de cada conversa nesta sessão: quando e com que duração. */
const ultimos = new Map<string, { quando: number; ttl: TtlDoCache }>();

/** Uma mensagem como o ritmo lê: o tipo e quando. */
interface MensagemComHora {
  type: string;
  timestamp?: number;
  /** Resposta: quando o PEDIDO que a gerou saiu (o relógio do cache conta
   *  dele; o timestamp é o do 1º token, que num modelo que pensa vem minutos
   *  depois). */
  pedidoEm?: number;
  /** Bolha de erro: não diz nada do cache (o pedido pode nem ter chegado). */
  isError?: boolean;
}

/** O começo do último pedido da conversa, pela última resposta — pra conversa
 *  que a sessão não viu pedir (reaberta, ou o plugin recarregado). */
function ultimaResposta(msgs: readonly MensagemComHora[]): number | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type !== "ai-response" || m.isError) continue;
    if (typeof m.pedidoEm === "number") return m.pedidoEm;
    if (typeof m.timestamp === "number") return m.timestamp;
  }
  return null;
}

/** A duração do cache do turno que começa agora na conversa `chatId`. */
export function ttlParaOTurno(p: {
  chatId: string | null;
  provider: string;
  modo: "chat" | "agent";
  agora: number;
  mensagens: readonly MensagemComHora[];
}): TtlDoCache {
  const ultimo = p.chatId ? ultimos.get(p.chatId) : undefined;
  const quando = ultimo?.quando ?? ultimaResposta(p.mensagens);
  return ttlDoTurno({
    provider: p.provider,
    modo: p.modo,
    desde: quando === null ? null : p.agora - quando,
    anterior: ultimo?.ttl ?? null,
  });
}

/** Anota um pedido da conversa que CHEGOU ao provider (o relógio do cache
 *  começa nele; o recusado antes — 429, limite de gasto, rede — não tocou no
 *  cache e não conta). `quando` é o começo do pedido. */
export function anotarPedido(chatId: string | null, ttl: TtlDoCache, quando: number): void {
  if (chatId) ultimos.set(chatId, { quando, ttl });
}

/**
 * Esquece o ritmo anotado de uma conversa. A conversa relida do disco pode ter
 * andado noutro aparelho (o arquivo sincroniza): o que vale é a última
 * resposta DELA, não o último pedido que esta sessão fez.
 */
export function esquecerRitmo(chatId: string): void {
  ultimos.delete(chatId);
}

/** Só pros testes: esquece o que a sessão anotou. */
export function esquecerRitmos(): void {
  ultimos.clear();
}

// src/core/contextoDoTurno.ts
// O que o motor (chatEngine / agentTurn) lê e grava da conversa DO TURNO.
//
// Só existe um turno por vez, mas ele pode estar na tela ou em segundo plano
// (a pessoa abriu outra conversa no meio da resposta). Ler do topo do store
// — messages, persona, instruções — mandava pro modelo o histórico e as
// instruções da conversa ERRADA quando a troca acontecia antes do pedido
// sair (durante a busca no vault, por exemplo). Tudo que o motor precisa da
// conversa passa por aqui.

import type { MessageAttachment, NoteAttachment } from "../providers/base";
import { mensagensDoTurno, useChatStore, type ChatMessage } from "../store/chat";
import { montarContexto, trechosNovos } from "../agent/conversation";
import { getModelCapabilities } from "../providers/modelCapabilities";
import type { AIErrorCode } from "../store/chat";

export interface EstadoDoTurno {
  mensagens: ChatMessage[];
  persona: string;
  instrucoes: string;
}

export function estadoDoTurno(): EstadoDoTurno {
  const st = useChatStore.getState();
  const bg = st.background;
  return {
    mensagens: mensagensDoTurno(st),
    persona: bg ? (bg.persona ?? "") : st.sessionPersona,
    instrucoes: bg ? (bg.instructions ?? "") : st.sessionInstructions,
  };
}

/** A chave de cache dos pedidos de uma conversa (ver ProviderRequest.cacheKey):
 *  a mesma em todo pedido dela, e só dela. Sem conversa, sem chave. */
export function chaveDeCache(chatId: string | null | undefined): string | undefined {
  return chatId ? `axxa-${chatId}` : undefined;
}

/** O que o modelo do turno lê (o que ele não lê vira texto no histórico). */
export function oQueOModeloLe(provider: string, model: string): { imagem: boolean; pdf: boolean } {
  const caps = getModelCapabilities(provider, model);
  return { imagem: caps.vision === true, pdf: caps.pdf === true };
}

/** A última mensagem do usuário na conversa do turno. */
function ultimaDoUsuario(): Extract<ChatMessage, { type: "user" }> | null {
  const msgs = mensagensDoTurno(useChatStore.getState());
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type === "user") return m;
  }
  return null;
}

/**
 * Grava, na última mensagem do usuário do turno, o contexto que vai junto
 * com ela: os trechos que a busca no vault achou e as notas anexadas (ver
 * montarContexto). Trecho que já está no histórico não entra de novo. Imagens
 * e PDFs não passam por aqui — já estão na mensagem (session.send). Sem nada a
 * juntar, a mensagem fica como está.
 */
export function gravarContextoDoTurno(
  vault: string,
  anexos: readonly MessageAttachment[] | undefined
): void {
  const ultima = ultimaDoUsuario();
  if (!ultima) return;
  const anteriores = mensagensDoTurno(useChatStore.getState())
    .filter((m): m is Extract<ChatMessage, { type: "user" }> => m.type === "user" && m.id !== ultima.id)
    .map((m) => m.contexto ?? "")
    .filter(Boolean);
  const notas = (anexos ?? []).filter((a): a is NoteAttachment => a.type === "note");
  const contexto = montarContexto({ vault: trechosNovos(vault, anteriores), notas });
  if (!contexto) return;
  useChatStore.getState().setContexto(ultima.id, contexto);
}

/**
 * O turno falhou ANTES de qualquer resposta: o que veio junto com a mensagem
 * pode ser a causa — e, gravado nela, iria de novo em todo turno, travando a
 * conversa pra sempre.
 *   · contexto estourado → sai o contexto e os anexos da mensagem;
 *   · pedido recusado (400: um PDF que o modelo não lê, uma imagem grande
 *     demais) → saem os anexos.
 * Falha de rede, de chave ou de cota não é culpa do que foi junto: fica.
 */
export function descartarDoTurnoQueFalhou(codigo: AIErrorCode | undefined, semResposta: boolean): void {
  const ultima = ultimaDoUsuario();
  if (!ultima) return;
  if (codigo === "context-overflow") {
    useChatStore.getState().descartarDaMensagem(ultima.id, { contexto: true, anexos: true });
  } else if (codigo === "unknown" && semResposta && (ultima.anexos?.length ?? 0) > 0) {
    useChatStore.getState().descartarDaMensagem(ultima.id, { anexos: true });
  }
}

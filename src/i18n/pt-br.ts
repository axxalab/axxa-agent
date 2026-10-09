// src/i18n/pt-br.ts
// O dicionário em português do Brasil.
//
// Ele cobre o MOTOR: os erros e estados do chat, o agente (inclusive o modal de
// aprovação), o Vault Q&A e os prompts de sistema. A casca redesenhada ainda
// escreve em inglês direto no componente — quando ela for para o dicionário,
// é aqui que a tradução entra.
//
// Uma parte disto não é rótulo de tela: `systemPrompt` e `agent.systemPrompt`
// mandam no idioma da RESPOSTA do modelo. Traduzir a interface e deixar essas
// duas em inglês seria a pior das combinações — a tela em português e o modelo
// respondendo em inglês dentro dela.
//
// O tipo vem do EN-US: qualquer chave que nasça lá e não chegue aqui é erro de
// compilação, não um pedaço de tela em inglês descoberto por acaso meses
// depois.

import type { Translations } from "./en-us";

export const PT_BR: Translations = {
  chat: {
    deletedToTrash: "Conversa movida pra lixeira.",
  },

  conversations: {
    renameSuccess: (title: string) => `Renomeada pra "${title}".`,
    renameFailed: (msg: string) => `Não consegui renomear: ${msg}`,
  },

  agent: {
    loopAborted:
      "O agente ficou repetindo a mesma ação e foi parado. Tente reformular a tarefa ou dar mais contexto.",
    thinking: "🤖 Agente pensando...",
    systemPrompt:
      "Você é o AXXA Agent, um assistente integrado ao Obsidian com acesso " +
      "direto ao vault do usuário por ferramentas. Responda em português do " +
      "Brasil. " +
      "Pra ACHAR notas sobre um assunto ou pergunta, use vault_search PRIMEIRO " +
      "(busca semântica) em vez de listar pastas e ler arquivo por arquivo — é " +
      "muito mais eficiente. " +
      "Use as ferramentas pra cumprir a tarefa pedida — ler, criar, editar, " +
      "mover ou apagar arquivos quando o usuário pedir. Pergunte ANTES se a " +
      "intenção estiver ambígua. " +
      "Ao terminar, devolva uma resposta em texto resumindo o que você fez. " +
      "Pra editar arquivos, use SEMPRE vault_read antes, pra ver o conteúdo " +
      "exato. " +
      "Se uma ferramenta falhar, MUDE a estratégia (caminho errado? formato? " +
      "permissão?) antes de tentar de novo — nunca repita a MESMA chamada que " +
      "acabou de falhar. " +
      "Quando precisar listar muitos arquivos, prefira chamadas em paralelo " +
      "(no mesmo turno).",
    needsOpenAI:
      "O modo Agente precisa de um provider com tool calling. Use OpenAI, Anthropic, Gemini, OpenRouter, Nvidia NIM ou Ollama (modelo compatível).",
    maxTurnsReached: (n: number) =>
      `O agente bateu o limite de ${n} turnos sem terminar. Tente reformular a tarefa.`,
    unknownTool: (name: string) => `Ferramenta desconhecida: ${name}`,
    deniedTool: (name: string) => `Negado: ${name}`,
    loopDetectedPending: "Repetição detectada — pedindo pro agente repensar",
    loopDetectedDone: "Repetição detectada — pedi pro agente repensar",
    confirmTitle: "Revisar mudança do agente",
    confirmTitleIrreversible: "⚠️ Apagar isto?",
    confirmTitleWeb: "Permitir este acesso à web?",
    confirmDeny: "Negar",
    confirmApproveAll: "Aprovar tudo",
    confirmApprove: "Aprovar",
    confirmDelete: "Sim, apagar",
    confirmLabelEdit: "Editar",
    confirmLabelCreate: "Criar",
    confirmLabelCreateFolder: "Criar pasta",
    confirmLabelFrom: "De",
    confirmLabelTo: "Pra",
    confirmLabelDelete: "Apagar",
    confirmLabelWebSearch: "Buscar na web (Tavily)",
    confirmLabelWebFetch: "Abrir página",
    webPrompt:
      " Você também pode buscar na web (web_search) e abrir páginas públicas (web_fetch) quando a tarefa pedir informação de fora ou recente: abra as páginas em que se apoiar e cite as URLs.",
    confirmTruncated: (n: number) => `+${n} caracteres não mostrados`,
  },

  vault: {
    searching: (topK: number, effort: string) =>
      `Procurando até ${topK} notas no vault (esforço: ${effort})...`,
    searchDone: "Busca concluída",
    foundContextSemantic: (count: number) =>
      `${count} nota${count !== 1 ? "s" : ""} encontrada${count !== 1 ? "s" : ""} (semântica + palavra-chave)`,
    foundContextKeyword: (count: number) =>
      `${count} nota${count !== 1 ? "s" : ""} encontrada${count !== 1 ? "s" : ""} (palavra-chave — sem índice semântico)`,
    foundContextKeywordFallback: (count: number) =>
      `${count} nota${count !== 1 ? "s" : ""} encontrada${count !== 1 ? "s" : ""} (palavra-chave — a busca semântica falhou)`,
    notFound:
      "Nenhuma nota relevante encontrada — respondendo sem o contexto do vault",
  },

  ai: {
    thinking: "Pensando...",
    compacting: "Resumindo o começo da conversa pra caber no modelo...",
    emptyResponse: "[Resposta vazia]",
    errorPrefix: "[Erro]",
    unknownError: "Erro desconhecido.",
    failed: "Falhou",
    interrupted: "Interrompido",
    err: {
      noKey: (provider: string) =>
        `Sem chave de API pra ${provider}. Coloque a sua nas configurações pra começar.`,
      noEndpoint: (provider: string) =>
        `Sem endereço do servidor pra ${provider}. Coloque em Configurações → Providers → ${provider} (normalmente http://localhost:11434).`,
      noModel: (provider: string) =>
        `Nenhum modelo do ${provider} escolhido ainda. Em Configurações → Providers → ${provider}, toque em Buscar modelos e escolha um.`,
      invalidKey: (provider: string) =>
        `Sua chave da ${provider} parece inválida ou expirada. Confira nas configurações.`,
      rateLimit: "Limite de uso atingido. Espere alguns segundos e tente de novo.",
      network: "A conexão falhou. Confira a internet e tente de novo.",
      billing:
        "O Gemini precisa de cobrança ativa na API pra esse modelo. Sua assinatura do Google AI Pro/Ultra NÃO cobre a API — ela é cobrada à parte no AI Studio. Ative a cobrança (plano pré-pago, mínimo US$ 10) e tente de novo.",
      contextOverflow:
        "Esta conversa não cabe mais na janela de contexto do modelo. Comece uma nova (esta fica salva), ou apague algumas mensagens/anexos antes de tentar de novo.",
    },
  },

  systemPrompt: {
    base:
      "Você é o AXXA Agent, um assistente integrado ao Obsidian. " +
      "Responda em português do Brasil, com clareza, direto ao ponto e de " +
      "forma útil. " +
      "Use Markdown quando fizer sentido.",
    vaultQaSuffix:
      "\n\nAs notas do vault do usuário chegam dentro das mensagens dele, em " +
      "blocos <vault_notes> (trechos que a busca achou pra aquela mensagem) e " +
      "<attached_notes> (notas que ele anexou). Use-as como fonte principal " +
      "da resposta, inclusive as de mensagens anteriores. CITE SEMPRE as " +
      "notas que usou ao longo do texto, no formato [[Título]], usando " +
      "EXATAMENTE o título mostrado no cabeçalho ### de cada bloco (o texto " +
      "dentro de [[ ]]). Não invente notas que não estão nesses blocos. " +
      "Quando uma resposta vier de uma nota específica, cite logo depois da " +
      "frase.",
  },
};

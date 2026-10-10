// src/i18n/ui-pt/plugin.ts
// pt-BR da interface: o plugin (avisos do main, comandos do editor, o agente na tela, o core).
// Chave = o texto em inglês do código (ver i18n/tr.ts). As {variáveis} da
// chave têm que aparecer na tradução — o teste de cobertura confere.

export const PT_PLUGIN: Record<string, string> = {
  // ── main.ts ────────────────────────────────────────────────────────────
  // Indexar o vault (o índice do Q&A)
  "Indexing vault…": "Indexando o vault…",
  "Indexing (scanning): {done}/{total} files · {chunks} chunks":
    "Indexando (varredura): {done}/{total} arquivos · {chunks} trechos",
  "Indexing (embedding): {done}/{total} files · {chunks} chunks":
    "Indexando (embeddings): {done}/{total} arquivos · {chunks} trechos",
  "Indexing (done): {done}/{total} files · {chunks} chunks":
    "Indexando (concluído): {done}/{total} arquivos · {chunks} trechos",
  "Index ready: 1 chunk.": "Índice pronto: 1 trecho.",
  "Index ready: {n} chunks.": "Índice pronto: {n} trechos.",
  "Indexing cancelled.": "Indexação cancelada.",
  "Indexing failed: {error}": "A indexação falhou: {error}",
  "RAG index too large for mobile ({mb} MB) — semantic search is off here to avoid a crash. Use desktop or shrink the index.":
    "Índice RAG grande demais pro mobile ({mb} MB) — busca semântica desligada aqui pra evitar crash. Use no desktop ou reduza o índice.",
  // Comando da paleta
  "Open panel": "Abrir o painel",
  // Limite de gasto do dia
  "You've used 80% of today's {limit} spending limit ({spent}).":
    "Você já usou 80% do limite de gasto de hoje: {spent} de {limit}.",
  "Today's {limit} spending limit is reached ({spent}). Paid models pause until midnight; free and local ones still work.":
    "O limite de gasto de hoje foi atingido: {spent} de {limit}. Os modelos pagos param até a meia-noite; os grátis e os locais continuam funcionando.",
  "Today's {limit} spending limit is reached ({spent}). Turn on “Stop paid models at the limit” in settings to pause them.":
    "O limite de gasto de hoje foi atingido: {spent} de {limit}. Ligue “Parar os modelos pagos no limite” nas configurações pra pausá-los.",
  "If your Gemini key's project has no billing, turn on “My Gemini key is on the free tier” in Settings › Providers › Gemini.":
    "Se o projeto da sua chave do Gemini não tem faturamento, ligue “Minha chave do Gemini está no plano grátis” em Settings › Providers › Gemini.",
  "Today's {limit} spending limit is reached ({spent} spent), so paid models are paused until midnight. Free and local models still work, or raise the limit in Settings › Chat › Daily spending.":
    "O limite de gasto de hoje foi atingido ({spent} de {limit}), então os modelos pagos estão pausados até a meia-noite. Os grátis e os locais continuam funcionando — ou aumente o limite em Configurações › Chat › Gasto diário.",
  // Painel, settings e a pasta oculta
  "Couldn't open the AXXA panel — try toggling the right sidebar.":
    "Não consegui abrir o painel do AXXA — tente abrir a barra lateral direita.",
  "AXXA: couldn't read your settings file. Nothing will be overwritten — restart Obsidian, and check data.backup.json next to it if needed.":
    "AXXA: não consegui ler o arquivo de configurações. Nada vai ser sobrescrito — reinicie o Obsidian e, se precisar, confira o data.backup.json ao lado dele.",
  "AXXA moved its files into a hidden .axxa folder — your chats are out of the vault's search and file list now.":
    "O AXXA levou os arquivos dele pra uma pasta oculta, .axxa — as suas conversas saíram da busca e da lista de arquivos do vault.",
  "AXXA could not save your settings — the change is active now but will be lost when you reopen Obsidian. Check the vault's disk space and permissions.":
    "A AXXA não conseguiu gravar as configurações — a mudança vale agora, mas se perde ao reabrir o Obsidian. Confira o espaço em disco e as permissões do vault.",

  // ── editor/comandos.ts ─────────────────────────────────────────────────
  // Comandos da paleta
  "Ask about this note": "Perguntar sobre esta nota",
  "Summarize this note": "Resumir esta nota",
  "Send selection to chat": "Mandar a seleção pra conversa",
  "Rewrite selection": "Reescrever a seleção",
  "Fix grammar and spelling in selection": "Corrigir gramática e ortografia da seleção",
  "Translate selection…": "Traduzir a seleção…",
  "Continue writing": "Continuar escrevendo",
  // Clique direito no texto e na nota
  "Rewrite with AXXA": "Reescrever com AXXA",
  "Fix grammar with AXXA": "Corrigir a gramática com AXXA",
  "Translate with AXXA…": "Traduzir com AXXA…",
  "Send selection to AXXA": "Mandar a seleção pro AXXA",
  "Continue writing with AXXA": "Continuar escrevendo com AXXA",
  "Ask AXXA about this note": "Perguntar ao AXXA sobre esta nota",
  "Summarize with AXXA": "Resumir com AXXA",

  // ── editor/inline.ts ───────────────────────────────────────────────────
  // O aviso enquanto o modelo escreve
  "Rewriting with {model}…": "Reescrevendo com {model}…",
  "Fixing with {model}…": "Corrigindo com {model}…",
  "Translating with {model}…": "Traduzindo com {model}…",
  "Writing with {model}…": "Escrevendo com {model}…",
  // Antes de começar, e quando não dá
  "Pick a default model in the plugin settings first.":
    "Escolha primeiro um modelo padrão nas configurações do plugin.",
  "Add your {provider} key in the plugin settings first.":
    "Coloque primeiro a sua chave pra {provider} nas configurações do plugin.",
  "Write something first: the model continues from what's there.":
    "Escreva alguma coisa primeiro: o modelo continua a partir do que já está escrito.",
  "Select some text first.": "Selecione um texto primeiro.",
  "the model returned nothing": "o modelo não devolveu nada",
  "Couldn't finish: {error}": "Não consegui terminar: {error}",
  "The text changed while the model was writing, so nothing was replaced. The result is on your clipboard.":
    "O texto mudou enquanto o modelo escrevia, então nada foi substituído. O resultado está na sua área de transferência.",
  "The text changed while the model was writing, so nothing was replaced.":
    "O texto mudou enquanto o modelo escrevia, então nada foi substituído.",
  // "Translate selection…": os idiomas da lista (pro modelo vai o nome em inglês)
  "Translate into…": "Traduzir pra…",
  "English": "Inglês",
  "Portuguese (Brazil)": "Português (Brasil)",
  "Spanish": "Espanhol",
  "French": "Francês",
  "German": "Alemão",
  "Italian": "Italiano",
  "Japanese": "Japonês",
  "Chinese (Simplified)": "Chinês (simplificado)",
  "Korean": "Coreano",
  "Russian": "Russo",
  "Arabic": "Árabe",
  "Hindi": "Híndi",
  "Dutch": "Holandês",
  "Portuguese (Portugal)": "Português (Portugal)",

  // ── core/session.ts ────────────────────────────────────────────────────
  "Project sources not found: {names}": "Notas do projeto não encontradas: {names}",
  "AXXA could not save this chat to your vault — what you see here is not on disk yet. Check the vault's disk space and permissions.":
    "A AXXA não conseguiu gravar esta conversa no vault — o que está na tela ainda não está em disco. Confira o espaço e as permissões do vault.",

  // ── core/helpers.ts ────────────────────────────────────────────────────
  // A narração do agente: fazendo · feito · falhou
  'Searching "{query}"': 'Buscando "{query}"',
  'Searched "{query}"': 'Buscou "{query}"',
  'Failed on "{query}"': 'Falhou na busca "{query}"',
  "Listing {path}": "Listando {path}",
  "Listed {path}": "Listou {path}",
  "Listing root": "Listando a raiz",
  "Listed root": "Listou a raiz",
  "Failed on root": "Falhou na raiz",
  "Reading {path}": "Lendo {path}",
  "Read {path}": "Leu {path}",
  "Creating {path}": "Criando {path}",
  "Created {path}": "Criou {path}",
  "Editing {path}": "Editando {path}",
  "Edited {path}": "Editou {path}",
  "Moving {from} → {to}": "Movendo {from} → {to}",
  "Moved {from} → {to}": "Moveu {from} → {to}",
  "Failed on {from} → {to}": "Falhou em {from} → {to}",
  "Deleting {path}": "Apagando {path}",
  "Deleted {path}": "Apagou {path}",
  "Creating folder {path}": "Criando a pasta {path}",
  "Created folder {path}": "Criou a pasta {path}",
  "Failed on folder {path}": "Falhou na pasta {path}",
  "Failed on {path}": "Falhou em {path}",
  'Searching the web for "{query}"': 'Buscando na web "{query}"',
  'Searched the web for "{query}"': 'Buscou na web "{query}"',
  'Failed on web search "{query}"': 'Falhou na busca na web "{query}"',
  "Opening {host}": "Abrindo {host}",
  "Read {host}": "Leu {host}",
  "Failed on {host}": "Falhou em {host}",
  "Running {tool}": "Rodando {tool}",
  "{tool} completed": "Rodou {tool}",
  "Failed on {tool}": "Falhou em {tool}",
  // O número ao lado da linha
  "1 item": "1 item",
  "{n} items": "{n} itens",
  "{n} chars": "{n} caracteres",

  // ── core/chatPersistence.ts ────────────────────────────────────────────
  "Invalid frontmatter — no `---` delimiters found.":
    "Frontmatter inválido — não achei os delimitadores `---`.",
  "Title is empty.": "O título está vazio.",
  "Invalid frontmatter in this chat file.": "Frontmatter inválido neste arquivo de conversa.",

  // ── agent/permissions.ts ───────────────────────────────────────────────
  // Os nomes dos níveis (Ask, Vault, YOLO) ficam; a descrição se traduz.
  "Ask — confirms every change": "Ask — confirma cada mudança",
  "Vault — edits freely, deletes ask": "Vault — edita à vontade, só apagar pergunta",
  "YOLO — runs everything, deletes go to the trash": "YOLO — roda tudo, o que apaga vai pra lixeira",

  // ── providers/modelRoles.ts · modelFamily.ts · vendors.ts ──────────────
  // Os papéis e as famílias genéricas do catálogo de modelos ("Chat" e os
  // nomes de família/fabricante, que são marcas, ficam como estão).
  "Reasoning": "Raciocínio",
  "Image": "Imagem",
  "Video": "Vídeo",
  "Audio": "Áudio",
  "Text-to-speech": "Síntese de voz",
  "Text embedding": "Embedding de texto",
  "Other": "Outros",
  // editor/comandos.ts — o pedido do "Summarize this note" (vira a mensagem da pessoa)
  "Summarize this note: the main points first, then anything that needs action or a decision.":
    "Resuma esta nota: primeiro os pontos principais, depois o que pede ação ou uma decisão.",
};

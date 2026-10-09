// src/i18n/ui-pt/chat.ts
// pt-BR da interface: a conversa (ChatView, o composer, o "+", o desfazer, a leitura em voz alta).
// Chave = o texto em inglês do código (ver i18n/tr.ts). As {variáveis} da
// chave têm que aparecer na tradução — o teste de cobertura confere.

export const PT_CHAT: Record<string, string> = {
  // ── ui/ChatView.tsx ────────────────────────────────────────────────────
  // Títulos das folhas (o "+" e a de modelos)
  "Add context": "Adicionar contexto",
  "Attach note": "Anexar nota",
  "Use a skill": "Usar uma skill",
  "Attach artifact": "Anexar artefato",
  "Select model": "Escolher modelo",
  "All models": "Todos os modelos",
  "Effort": "Esforço",
  // Provider ainda não ligado
  "{name} is not set up": "{name} não está configurado",
  "Open Settings › Providers to add it, then run the connection test.":
    "Abra Configurações › Provedores pra adicionar e depois rode o teste de conexão.",
  "Open settings": "Abrir configurações",
  // Anexos: arquivo, link, imagem, nota
  "Could not read that file.": "Não deu pra ler esse arquivo.",
  "Attach link": "Anexar link",
  "Address": "Endereço",
  "Fetch": "Buscar",
  "That doesn't look like an address.": "Isso não parece um endereço.",
  "Fetching {url}…": "Buscando {url}…",
  "Nothing readable at that address.": "Nada legível nesse endereço.",
  "Could not reach that address.": "Não deu pra acessar esse endereço.",
  "This model can't read images.": "Este modelo não lê imagens.",
  "Note not found: {path}": "Nota não encontrada: {path}",
  "Could not read that image.": "Não deu pra ler essa imagem.",
  "Another chat is still answering — try again in a moment.":
    "Outra conversa ainda está respondendo — tente de novo daqui a pouco.",
  "{n} favorites per provider is the limit — unstar one first.":
    "O limite é de {n} favoritos por provedor — desmarque um antes.",
  // Barra do topo e composer
  "Back": "Voltar",
  "Untitled": "Sem título",
  "New chat": "Nova conversa",
  "Loading…": "Carregando…",
  "Answer ready": "Resposta pronta",
  "Jump to latest": "Ir pro fim",
  "Cancel queued message": "Cancelar a mensagem da fila",
  "Remove attachment": "Remover anexo",
  "Add to chat": "Adicionar à conversa",
  "no model": "sem modelo",
  "Voice mode": "Modo de voz",
  "Send when this finishes": "Enviar quando a resposta terminar",
  "Stop": "Parar",
  "Send": "Enviar",
  // Folha de modelos
  "Provider": "Provedor",
  "Default": "Padrão",
  "This chat is locked to {model} — start a new chat to pick another model. Effort still changes freely.":
    "Esta conversa está travada no {model} — comece uma conversa nova pra escolher outro modelo. O esforço continua livre.",
  "No favorites for this provider yet — star up to {n} in Settings › Providers, or open the full list below.":
    "Ainda sem favoritos neste provedor — marque até {n} em Configurações › Provedores, ou abra a lista completa abaixo.",
  "Nothing marked to show for this provider yet — pick what appears here in Settings → Providers.":
    "Nada marcado pra aparecer neste provedor ainda — escolha o que aparece aqui em Configurações → Provedores.",
  "Use my notes": "Usar minhas notas",
  "On": "Ligado",
  "Off": "Desligado",
  "Remove from favorites": "Remover dos favoritos",
  "Add to favorites": "Adicionar aos favoritos",
  "Search models": "Buscar modelos",
  "Model category": "Categoria do modelo",
  "No model matches that.": "Nenhum modelo bate com isso.",
  // Folha do "+"
  "Search notes": "Buscar notas",
  "No note matches that.": "Nenhuma nota bate com isso.",
  "No skills yet — they live as notes in your vault, and show up here once you create one.":
    "Nenhuma skill ainda — elas são notas no seu vault e aparecem aqui assim que você criar uma.",
  "Nothing generated yet — images, audio and video made here land in {folder} and show up in this list.":
    "Nada gerado ainda — imagens, áudio e vídeo feitos aqui vão pra {folder} e aparecem nesta lista.",
  "Notes": "Notas",
  "Camera": "Câmera",
  "unavailable": "indisponível",
  "Image": "Imagem", // também o rótulo do anexo de imagem sem nome (attachSources.ts)
  "This note": "Esta nota",
  "From this device": "Deste aparelho",
  "This model can't read PDFs": "Este modelo não lê PDFs",
  "Fetch a page as context": "Buscar uma página como contexto",
  "{n} in your vault": "{n} no seu vault",
  "None yet": "Nenhuma ainda",
  "Artifact": "Artefato",
  "Images, audio and video made here": "Imagens, áudio e vídeo feitos aqui",
  // O que o agente fez: a folha de ações, o detalhe e o desfazer
  "Ran 1 action": "Rodou 1 ação",
  "Ran {n} actions": "Rodou {n} ações",
  "failed": "falhou",
  "undone": "desfeita",
  "done": "feito",
  "Failed": "Falhou",
  "Completed": "Concluída",
  "Undone": "Desfeita",
  "Reasoning": "Raciocínio",
  "{n} chars": "{n} caracteres",
  "Undo the agent's change": "Desfazer a mudança do agente",
  "Undo the agent's {n} changes": "Desfazer as {n} mudanças do agente",
  "Undo": "Desfazer",
  "Undo this change": "Desfazer esta mudança",
  "Arguments": "Argumentos",
  "Result": "Resultado",
  "(empty)": "(vazio)",
  "What happened": "O que aconteceu",
  // Mensagens: ouvir, cortada, detalhes
  "Read aloud": "Ouvir a resposta",
  "Copy": "Copiar",
  "Copied": "Copiado",
  "Copy answer": "Copiar resposta",
  "Copy message": "Copiar mensagem",
  "Earlier messages summarized for the model": "Mensagens anteriores resumidas para o modelo",
  "Couldn't copy. Select the text and use the system Copy.":
    "Não deu pra copiar. Selecione o texto e use o Copiar do sistema.",
  "Listen": "Ouvir",
  "truncated": "cortada",
  "details": "detalhes",

  // ── ui/StarterScreen.tsx ───────────────────────────────────────────────
  "Still up": "Ainda de pé",
  "Good morning": "Bom dia",
  "Good afternoon": "Boa tarde",
  "Good evening": "Boa noite",
  "Chat mode": "Modo da conversa",
  "No API key for {provider} yet — add one to start.":
    "Ainda sem chave de API pra {provider} — adicione uma pra começar.",

  // ── ui/Thinking.tsx (os verbos da espera) ──────────────────────────────
  "Thinking": "Pensando",
  "Pondering": "Ponderando",
  "Deliberating": "Deliberando",
  "Mulling it over": "Matutando",
  "Considering": "Considerando",
  "Ruminating": "Ruminando",
  "Turning it over": "Revirando a ideia",
  "Weighing options": "Pesando as opções",
  "Chewing on it": "Mastigando o assunto",
  "Puzzling it out": "Decifrando",

  // ── ui/agentUndo.ts ────────────────────────────────────────────────────
  "Could not undo: {error}": "Não deu pra desfazer: {error}",
  "Undo anyway?": "Desfazer mesmo assim?",
  "{message} Undoing now throws away what changed since.":
    "{message} Desfazer agora joga fora o que mudou desde então.",
  "Undo anyway": "Desfazer mesmo assim",
  "Undo the agent's change?": "Desfazer a mudança do agente?",
  "Undo the agent's {n} changes?": "Desfazer as {n} mudanças do agente?",
  "Notes go back to how they were before this turn. Anything you changed by hand since is kept.":
    "As notas voltam a ser como eram antes desta rodada. O que você mudou à mão depois disso é mantido.",
  "1 change undone": "1 mudança desfeita",
  "{n} changes undone": "{n} mudanças desfeitas",
  "1 kept because the note changed since (undo it from the action list to force)":
    "1 mantida porque a nota mudou depois (desfaça pela lista de ações pra forçar)",
  "{n} kept because the note changed since (undo them from the action list to force)":
    "{n} mantidas porque as notas mudaram depois (desfaça pela lista de ações pra forçar)",
  "1 failed: {error}": "1 falhou: {error}",
  "{n} failed: {error}": "{n} falharam: {error}",

  // ── agent/undo.ts (o que o desfazer diz, nos avisos e no modal) ────────
  "{path} no longer exists.": "{path} não existe mais.",
  "{path} changed after the agent created it.":
    "{path} mudou depois que o agente criou o arquivo.",
  "Removed {path}": "Removido: {path}",
  "{path} changed after the agent's edit.": "{path} mudou depois da edição do agente.",
  "Restored {path}": "Restaurado: {path}",
  "Nothing at {path} anymore.": "Não há mais nada em {path}.",
  "{path} is taken now — move it by hand.": "{path} está ocupado agora — mova à mão.",
  "Moved back to {path}": "Movido de volta pra {path}",
  "{path} exists again — nothing to restore over.":
    "{path} existe de novo — não dá pra restaurar por cima.",
  "{path} has files in it now.": "{path} tem arquivos dentro agora.",
  "Removed folder {path}": "Pasta removida: {path}",
  "This change can no longer be undone.": "Esta mudança não pode mais ser desfeita.",

  // ── ui/readAloud.ts ────────────────────────────────────────────────────
  "OpenAI key": "chave da OpenAI",
  "ElevenLabs key": "chave da ElevenLabs",
  "Add your ElevenLabs key in Settings › Chat › Voice.":
    "Adicione sua chave da ElevenLabs em Configurações › Chat › Voz.",
  "Add your OpenAI key in Settings › Providers.":
    "Adicione sua chave da OpenAI em Configurações › Provedores.",
  "This provider can't do text-to-speech yet.":
    "Este provedor ainda não converte texto em fala.",
  "Playback blocked: {error}": "Reprodução bloqueada: {error}",
  "Read aloud failed: {error}": "A leitura em voz alta falhou: {error}",

  // ── ui/useVoice.ts ─────────────────────────────────────────────────────
  "Part of the recording could not be transcribed — check the connection.":
    "Parte da gravação não foi transcrita — confira a conexão.",
  "This device can't record audio.": "Este aparelho não grava áudio.",
  "Voice needs an OpenAI key — add one in Settings › Providers.":
    "A voz precisa de uma chave da OpenAI — adicione uma em Configurações › Provedores.",
  "Microphone blocked — allow it for Obsidian and try again.":
    "Microfone bloqueado — libere pro Obsidian e tente de novo.",
  "Recording stopped at 5 minutes.": "A gravação parou nos 5 minutos.",

  // ── ui/VoiceBar.tsx ────────────────────────────────────────────────────
  "Discard recording": "Descartar gravação",
  "Transcribing…": "Transcrevendo…",
  "Use this transcript": "Usar esta transcrição",

  // ── ui/attachSources.ts (o rótulo do chip; o que vai pro modelo não muda)
  "Pasted text ({size})": "Texto colado ({size})",
  "Audio": "Áudio",

  // ── ui/ChatInstructionsSheet.tsx ───────────────────────────────────────
  "Instructions saved for this chat.": "Instruções salvas pra esta conversa.",
  "Instructions removed from this chat.": "Instruções removidas desta conversa.",
  "Could not save the instructions: {error}": "Não deu pra salvar as instruções: {error}",
  "Instructions": "Instruções",
  "Save instructions": "Salvar instruções",
  "Added to the assistant's own rules in every reply of this chat — like a project's instructions, they don't replace them. Leave it empty to remove.":
    "Somadas às regras do próprio assistente em toda resposta desta conversa — como as instruções de um projeto, elas não as substituem. Deixe vazio pra remover.",
  "e.g. Answer in short bullet points and cite the note behind every claim.":
    "ex.: Responda em tópicos curtos e cite a nota por trás de cada afirmação.",

  // ── ui/chatAlert.ts (o estado da conversa na lista; quem mostra chama tr)
  "Needs you": "Precisa de você",
  "Responding": "Respondendo",
  "New reply": "Resposta nova",
};

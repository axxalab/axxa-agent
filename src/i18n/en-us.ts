// src/i18n/en-us.ts
// Strings do MOTOR (v0.4.0, base CRUD): erros/estados do chat (`ai`), agente
// (`agent` — inclui o ConfirmationModal), Vault Q&A (`vault`), system prompts
// (`systemPrompt`) e os poucos avisos de CRUD (`chat`, `conversations`).
// A casca nova usa strings inline; quando a UI for redesenhada, o i18n volta
// a crescer daqui. Shape canônico = typeof EN_US.

export const EN_US = {












  // Clean "new conversation" base screen (no starter screen) — per mode. v0.1.219

  // Redesigned model selector (category tabs + modal + favorites). v0.1.222

  // (ModelArena removida na limpeza pós-DS-1.0 — a tela que consumia estas
  // strings saiu junto com a StarterScreen. Bloco removido em 0.1.247 para o
  // dicionário refletir só o que existe na UI; o histórico do git guarda o
  // texto original se a arena voltar.)


  chat: {
    deletedToTrash: "Conversation moved to trash.",
  },

  conversations: {
    renameSuccess: (title: string) => `Renamed to "${title}".`,
    renameFailed: (msg: string) => `Failed to rename: ${msg}`,
  },


  // Dashboard — starter became the plugin home (v0.1.103): usage stats,
  // activity, new-chat setup and RAG/provider status.


  agent: {
    loopAborted: "Agent kept repeating the same action and was stopped. Try rephrasing the task or giving more context.",
    thinking: "🤖 Agent thinking...",
    systemPrompt:
      "You are AXXA Agent, an assistant integrated into Obsidian with direct access " +
      "to the user's vault via tools. Respond in English. " +
      "To FIND notes about a topic or question, use vault_search FIRST " +
      "(semantic search) instead of listing folders and reading file by file — it's " +
      "much more efficient. " +
      "Use the tools to accomplish the requested task — read, create, edit, move, or " +
      "delete files when the user asks. Ask FIRST if the intent is ambiguous. " +
      "When done, return a text response summarizing what you did. " +
      "To edit files, ALWAYS use vault_read first to see the exact content. " +
      "If a tool fails, ADJUST your strategy (wrong path? format? permission?) " +
      "before retrying — never repeat the EXACT same call that just failed. " +
      "When you need to list many files, prefer parallel tool calls (same turn).",
    needsOpenAI:
      "Agent Mode requires a provider with tool calling. Use OpenAI, Anthropic, Gemini, OpenRouter, Nvidia NIM, or Ollama (compatible model).",
    maxTurnsReached: (n: number) =>
      `Agent hit the limit of ${n} turns without finishing. Try rephrasing the task.`,
    // Chips de activity do agent loop (P1-03/P1-27) — antes hardcoded em PT.
    unknownTool: (name: string) => `Unknown tool: ${name}`,
    deniedTool: (name: string) => `Denied: ${name}`,
    loopDetectedPending: "Loop detected — asking the agent to reconsider",
    loopDetectedDone: "Loop detected — asked the agent to reconsider",
    confirmTitle: "Review Agent change",
    confirmTitleIrreversible: "⚠️ Delete this?",
    confirmTitleWeb: "Allow this web request?",
    confirmDeny: "Deny",
    confirmApproveAll: "Approve all",
    confirmApprove: "Approve",
    confirmDelete: "Yes, delete",
    confirmLabelEdit: "Edit",
    confirmLabelCreate: "Create",
    confirmLabelCreateFolder: "Create folder",
    confirmLabelFrom: "From",
    confirmLabelTo: "To",
    confirmLabelDelete: "Delete",
    confirmLabelWebSearch: "Search the web (Tavily)",
    confirmLabelWebFetch: "Open page",
    webPrompt:
      " You can also search the web (web_search) and open public pages (web_fetch) when the task needs outside or recent information: open the pages you rely on, and cite their URLs.",
    confirmTruncated: (n: number) => `+${n} chars not shown`,
  },


  vault: {
    searching: (topK: number, effort: string) =>
      `Searching up to ${topK} notes in vault (effort: ${effort})...`,
    searchDone: "Search complete",
    foundContextSemantic: (count: number) =>
      `${count} note${count !== 1 ? "s" : ""} found (semantic + keyword)`,
    foundContextKeyword: (count: number) =>
      `${count} note${count !== 1 ? "s" : ""} found (keyword — no semantic index)`,
    foundContextKeywordFallback: (count: number) =>
      `${count} note${count !== 1 ? "s" : ""} found (keyword — semantic search failed)`,
    notFound:
      "No relevant notes found — answering without vault context",
  },

  ai: {
    thinking: "Thinking...",
    compacting: "Summarizing the start of the conversation to fit the model...",
    emptyResponse: "[Empty response received]",
    errorPrefix: "[Error]",
    unknownError: "Unknown error.",
    failed: "Failed",
    interrupted: "Interrupted",
    err: {
      noKey: (provider: string) =>
        `No API key for ${provider}. Add your key in Settings to get started.`,
      noEndpoint: (provider: string) =>
        `No server address for ${provider}. Add it in Settings → Providers → ${provider} (usually http://localhost:11434).`,
      noModel: (provider: string) =>
        `No ${provider} model picked yet. In Settings → Providers → ${provider}, press Fetch models, then pick one.`,
      invalidKey: (provider: string) =>
        `Your ${provider} API key looks invalid or expired. Check it in Settings.`,
      rateLimit: "Rate limit reached. Wait a few seconds and try again.",
      network: "Connection failed. Check your internet and try again.",
      billing:
        "Gemini needs active API billing for this model. Your Google AI Pro/Ultra subscription does NOT cover the API — it's billed separately in AI Studio. Enable billing (Prepay plan, min $10) and try again.",
      contextOverflow:
        "This conversation no longer fits the model's context window. Start a new chat (this one stays saved), or delete some messages/attachments before retrying.",
    },
  },


  // Activities/erros do motor de geração de mídia (useGeneration) — P1-27.

  // ErrorBoundary (painel de erro de render) — P1-27.




  systemPrompt: {
    base:
      "You are AXXA Agent, an assistant integrated into Obsidian. " +
      "Answer in English, clearly, directly, and helpfully. " +
      "Use Markdown when it makes sense.",
    vaultQaSuffix:
      "\n\nNotes from the user's vault come inside their messages, in " +
      "<vault_notes> blocks (excerpts the search found for that message) and " +
      "<attached_notes> blocks (notes the user attached). Use them as the main " +
      "source to answer, including notes from earlier messages. ALWAYS cite " +
      "the notes you used inline, in the [[Title]] format, using EXACTLY the " +
      "title shown in each block's ### header (the text inside [[ ]]). Do not " +
      "invent notes that are not in those blocks. When an answer comes from a " +
      "specific note, cite it right after the sentence.",
  },

};

export type Translations = typeof EN_US;

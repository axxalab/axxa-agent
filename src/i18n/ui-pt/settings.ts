// src/i18n/ui-pt/settings.ts
// pt-BR da interface: as settings (a árvore, o editor de esforço e os pintores do SettingsTab).
// Chave = o texto em inglês do código (ver i18n/tr.ts). As {variáveis} da
// chave têm que aparecer na tradução — o teste de cobertura confere.

export const PT_SETTINGS: Record<string, string> = {
  // ── ui/settings/tree.ts: as abas ──────────────────────────────────────────
  // "Chat", "Q&A" e "Agent" são os nomes dos modos: ficam como estão.
  Providers: "Provedores",
  "Your keys and the model each provider uses. Keys stay on this device.":
    "Suas chaves e o modelo que cada provedor usa. As chaves ficam neste aparelho.",
  Chat: "Chat",
  "What every new conversation starts with.": "Com o que toda conversa nova começa.",
  Vault: "Vault",
  "Where the plugin writes in your vault.": "Onde o plugin escreve no seu vault.",
  "Q&A": "Q&A",
  "Vault Q&A: the local index that grounds answers in your notes.":
    "Vault Q&A: o índice local que apoia as respostas nas suas notas.",
  Agent: "Agent",
  "What the agent may do to your notes without asking.":
    "O que o agente pode fazer nas suas notas sem perguntar.",
  Mobile: "Celular",
  "Options that only exist on the phone.": "Opções que só existem no celular.",
  "This setting failed to draw — see the developer console.":
    "Não deu pra desenhar esta configuração — veja o console do desenvolvedor.",

  // ── ui/settings/tree.ts: Provedores ───────────────────────────────────────
  // O nome longo (com o provedor) é o da busca; o curto é o da tela.
  "{provider} API key": "{provider}: chave de API",
  "API key": "Chave de API",
  "Stored in the OS keychain (not in data.json).":
    "Guardada no chaveiro do sistema (não no data.json).",
  "{provider} endpoint": "{provider}: endereço",
  Endpoint: "Endereço",
  "Local server address. Ollama needs no key.":
    "O endereço do servidor local. O Ollama não precisa de chave.",
  "{provider} connection": "{provider}: conexão",
  Connection: "Conexão",
  "{provider} model for new chats": "{provider}: modelo pra novas conversas",
  "Model for new chats": "Modelo pra novas conversas",
  "Used when this provider is selected and nothing else was picked.":
    "Usado quando este provedor está selecionado e nada mais foi escolhido.",
  "Free daily tokens": "Tokens grátis por dia",
  "I share API data with OpenAI": "Compartilho dados da API com a OpenAI",
  "Free tier": "Plano grátis",
  "My Gemini key is on the free tier": "Minha chave do Gemini está no plano grátis",
  "Turn this on if the Google Cloud project behind your key has no billing. Gemini models with a free tier then count as $0 in the daily spending and Usage, and keep working when paid models pause at the limit. Leave it off if billing is on: those requests are charged.":
    "Ligue se o projeto do Google Cloud da sua chave não tem faturamento. Aí os modelos do Gemini com plano grátis contam US$ 0 no gasto do dia e no Uso, e continuam funcionando quando os pagos param no limite. Deixe desligado se o faturamento está ativo: esses pedidos são cobrados.",
  "Their switch, in Data controls on platform.openai.com. Turning it on there gives your account a daily quota at no cost; telling us here is what makes this list show the real numbers.":
    "O interruptor é deles, em Data controls no platform.openai.com. Ligado lá, ele dá à sua conta uma cota diária sem custo; avisar aqui é o que faz esta lista mostrar os números reais.",
  "Usage tier": "Tier de uso",
  "Tiers 1–2 get 250k tokens/day on the big models and 2.5M/day on mini and nano. Tier 3 and up get 1M and 10M.":
    "Os tiers 1–2 ganham 250k tokens/dia nos modelos grandes e 2,5M/dia nos mini e nano. Do tier 3 pra cima, 1M e 10M.",
  "Tier {n} — 250k / 2.5M a day": "Tier {n} — 250k / 2,5M por dia",
  "Tier {n} — 1M / 10M a day": "Tier {n} — 1M / 10M por dia",
  "The quota counts ALL your OpenAI API use, not just this vault — so anything the app says you have left is optimistic. Image models are never covered. Program terms as of {date}.":
    "A cota conta TODO o seu uso da API da OpenAI, não só este vault — então o que o app disser que sobra é otimista. Modelos de imagem nunca entram. Termos do programa conferidos em {date}.",
  "{provider} models": "{provider}: modelos",
  Models: "Modelos",
  "Fetch what this provider offers today, then choose what shows up where.":
    "Busque o que este provedor oferece hoje e escolha o que aparece onde.",

  // ── ui/settings/tree.ts: Chat ─────────────────────────────────────────────
  Provider: "Provedor",
  "Which provider a new chat opens with.": "Com qual provedor uma conversa nova abre.",
  Mode: "Modo",
  "Chat, Vault Q&A or Agent. Locks on the first message.":
    "Chat, Vault Q&A ou Agent. Fica fixo a partir da primeira mensagem.",
  Effort: "Esforço",
  "How hard the model works: length, agent turns, temperature.":
    "O quanto o modelo se esforça: tamanho, turnos do agente, temperatura.",
  Language: "Idioma",
  "Interface, chat errors — and the language the model answers in. The creation assistant follows it too. \"Same as Obsidian\" follows the language Obsidian is set to. A few things, like command names, only switch after you reload Obsidian.":
    "Interface, erros da conversa — e o idioma em que o modelo responde. A assistente de criação segue o mesmo. \"Igual ao Obsidian\" usa o idioma do Obsidian. Algumas coisas, como os nomes dos comandos, só mudam depois que você recarrega o Obsidian.",
  // O rótulo do "auto" em i18n/index.ts (LOCALES), mostrado no menu acima.
  // Os idiomas de verdade aparecem no nome deles mesmos.
  "Same as Obsidian": "Igual ao Obsidian",
  "Effort levels": "Níveis de esforço",
  "{level} effort level": "Nível de esforço {level}",
  "Daily spending": "Gasto diário",
  "Daily limit": "Limite diário",
  "In dollars, for paid models, counted from public token prices. You get a heads-up at 80% and at 100%. Empty means no limit.":
    "Em dólares, pros modelos pagos, contado pelos preços públicos dos tokens. Você recebe um aviso em 80% e em 100%. Vazio é sem limite.",
  "Stop paid models at the limit": "Parar os modelos pagos no limite",
  "When today's spending reaches the limit, paid models pause until midnight. Free and local models keep working, and so do models without a public price. Gemini counts as paid unless you mark your key as free tier in Providers › Gemini.":
    "Quando o gasto de hoje chega ao limite, os modelos pagos param até a meia-noite. Os grátis e os locais continuam funcionando, e os sem preço público também. O Gemini conta como pago, a menos que você marque a sua chave como plano grátis em Providers › Gemini.",
  Assistant: "Assistente",
  "Assistant model": "Modelo da assistente",
  Model: "Modelo",
  "Let it see your note names": "Deixar ela ver os nomes das notas",
  "So it can suggest which notes to attach to a project. Only the paths are sent — never what is inside them. Off by default.":
    "Pra ela poder sugerir quais notas anexar a um projeto. Só os caminhos são enviados — nunca o que tem dentro. Desligado por padrão.",

  // ── ui/settings/tree.ts: Voz ──────────────────────────────────────────────
  Voice: "Voz",
  "Talk instead of typing": "Falar em vez de digitar",
  "Puts a microphone in the composer: you speak, the words land in the box, and you send when you are happy with them.":
    "Põe um microfone na caixa de mensagem: você fala, as palavras caem nela e você envia quando estiver contente com elas.",
  "Dictation runs on OpenAI — add that key in Providers.":
    "O ditado roda na OpenAI — adicione essa chave em Provedores.",
  Ears: "Ouvidos",
  "Mini is quick, cheap and gets normal speech right; the full one is better with names, accents and noise.":
    "O Mini é rápido, barato e acerta a fala normal; o completo se sai melhor com nomes, sotaques e ruído.",
  "What you speak": "O que você fala",
  "Naming your language beats letting it guess — short takes are where guessing goes wrong.":
    "Dizer o seu idioma é melhor que deixar adivinhar — é nas falas curtas que o palpite erra.",
  "Auto (detect)": "Automático (detectar)",
  "Read answers out loud": "Ler as respostas em voz alta",
  "Adds a Listen button under every answer.": "Põe um botão Ouvir embaixo de cada resposta.",
  "Who reads": "Quem lê",
  "OpenAI voices are ready to use. ElevenLabs sounds better and is the only one that can read in YOUR voice — clone it in their app and it shows up in the list below.":
    "As vozes da OpenAI já vêm prontas. A ElevenLabs soa melhor e é a única que lê com a SUA voz — clone a sua no app deles e ela aparece na lista abaixo.",
  "Add your OpenAI key in Providers to hear anything.":
    "Adicione a sua chave da OpenAI em Provedores pra ouvir alguma coisa.",
  "Eleven of them — tap ▶ in the list to hear one before you pick it.":
    "São onze — toque no ▶ da lista pra ouvir uma antes de escolher.",
  "OpenAI voice quality": "Qualidade da voz da OpenAI",
  Quality: "Qualidade",
  "gpt-4o-mini-tts reads with intention; tts-1 is the cheap classic; the HD one is the same voice, cleaner.":
    "O gpt-4o-mini-tts lê com intenção; o tts-1 é o clássico barato; o HD é a mesma voz, mais limpa.",
  "Test OpenAI voice": "Testar a voz da OpenAI",
  Test: "Testar",
  "Plays one short line with the settings above.": "Toca uma frase curta com os ajustes acima.",
  // A chave da ElevenLabs e a da Tavily (a marca é variável).
  "{provider} key": "Chave da {provider}",
  "From elevenlabs.io › Profile › API key. Stored in the OS keychain (not in data.json).":
    "Em elevenlabs.io › Profile › API key. Guardada no chaveiro do sistema (não no data.json).",
  "Your voices": "Suas vozes",
  "Fetch what your account has — the stock voices and any you cloned, including your own.":
    "Busque o que a sua conta tem — as vozes prontas e as que você clonou, inclusive a sua.",
  "ElevenLabs voice": "Voz da ElevenLabs",
  "Cloned ones are marked — that is the one that sounds like you. Tap ▶ in the list to hear any of them.":
    "As clonadas vêm marcadas — essa é a que soa como você. Toque no ▶ da lista pra ouvir qualquer uma.",
  "No voices loaded yet — hit Fetch voices.": "Nenhuma voz carregada ainda — toque em Buscar vozes.",
  "ElevenLabs voice quality": "Qualidade da voz da ElevenLabs",
  "Multilingual sounds best; the faster ones answer sooner.":
    "O Multilingual soa melhor; os mais rápidos respondem antes.",
  // Os modelos da ElevenLabs (providers/elevenlabs.ts), mostrados no menu acima.
  "Multilingual v2 — best quality": "Multilingual v2 — a melhor qualidade",
  "Turbo v2.5 — faster, cheaper": "Turbo v2.5 — mais rápido, mais barato",
  "Flash v2.5 — fastest": "Flash v2.5 — o mais rápido",
  "Test ElevenLabs voice": "Testar a voz da ElevenLabs",

  // ── ui/settings/tree.ts: Vault, Q&A, Agent, Celular ───────────────────────
  "Chats folder": "Pasta das conversas",
  "Each chat is a .md file under <folder>/<mode>/. A folder starting with a dot is hidden from the file explorer, search and graph — which is why the default is .axxa/chats.":
    "Cada conversa é um arquivo .md em <pasta>/<modo>/. Uma pasta que começa com ponto fica escondida do explorador de arquivos, da busca e do grafo — por isso o padrão é .axxa/chats.",
  "Skills folder": "Pasta das skills",
  "Each skill is a .md note (frontmatter + prompt body).":
    "Cada skill é uma nota .md (frontmatter + o prompt no corpo).",
  "Index folder": "Pasta do índice",
  "Where the Vault Q&A index lives. Changing it starts a fresh index there — the current one stays in the old folder, and switching back loads it again.":
    "Onde mora o índice do Vault Q&A. Trocar começa um índice novo lá — o atual fica na pasta antiga, e voltar pra ela carrega ele de novo.",
  "Embedding model": "Modelo de embedding",
  "Needs the key of that model's provider. Without an index, Vault Q&A falls back to keyword search. Fetch models on a provider to list the embedding models your account has.":
    "Precisa da chave do provedor desse modelo. Sem índice, o Vault Q&A volta pra busca por palavra-chave. Busque os modelos num provedor pra listar os modelos de embedding que a sua conta tem.",
  "Index precision": "Precisão do índice",
  "How much detail each note keeps in the index. Lighter takes less space and memory; Light and Minimal also shrink the vectors on OpenAI's text-embedding-3. Applies on the next index update, which rebuilds it from scratch.":
    "Quanto detalhe cada nota guarda no índice. Mais leve ocupa menos espaço e memória; Leve e Mínima também encolhem os vetores no text-embedding-3 da OpenAI. Vale na próxima atualização do índice, que refaz ele do zero.",
  "Search the index in pieces": "Buscar no índice em pedaços",
  "Reads the index about 4 MB at a time instead of all at once — keeps memory low on big vaults, which matters on the phone. The catch: every index update then rebuilds it whole and re-embeds the vault, which costs tokens.":
    "Lê o índice uns 4 MB por vez, em vez de tudo de uma vez — mantém a memória baixa em vaults grandes, o que faz diferença no celular. O porém: toda atualização do índice passa a refazer ele inteiro e a gerar de novo os embeddings do vault, o que custa tokens.",
  "Auto re-index on note changes": "Reindexar sozinho quando as notas mudam",
  "Re-embeds only changed notes (costs tokens). Only runs once an index exists.":
    "Refaz os embeddings só das notas alteradas (custa tokens). Só roda quando já existe um índice.",
  Index: "Índice",
  "Permission level": "Nível de permissão",
  "When the agent stops to ask before changing the vault. In YOLO, deletes run on their own too when Obsidian sends deleted files to a trash (set to delete permanently, they still ask). Every change can be undone from the chat while Obsidian is open.":
    "Quando o agente para pra perguntar antes de mexer no vault. No YOLO, apagar também roda sozinho quando o Obsidian manda os arquivos apagados pra uma lixeira (configurado pra apagar de vez, ele ainda pergunta). Toda mudança pode ser desfeita na conversa enquanto o Obsidian estiver aberto.",
  "Show diff before applying edits": "Mostrar o diff antes de aplicar as edições",
  "Preview every change the agent wants to write.":
    "Ver antes cada mudança que o agente quer escrever.",
  "Web access": "Acesso à web",
  "Let the agent search the web and open public pages when a task needs it. In Ask and Vault, each request shows you the address or the search first; local addresses are always refused.":
    "Deixa o agente buscar na web e abrir páginas públicas quando a tarefa precisar. No Ask e no Vault, cada pedido mostra antes o endereço ou a busca; endereços locais são sempre recusados.",
  "For web search, from tavily.com › API keys: 1,000 free searches a month, no card needed. Without it the agent can still open pages. Stored in the OS keychain (not in data.json).":
    "Pra busca na web, em tavily.com › API keys: 1.000 buscas grátis por mês, sem cartão. Sem ela, o agente ainda abre páginas. Guardada no chaveiro do sistema (não no data.json).",
  Fullscreen: "Tela cheia",
  "Hides the drawer chrome and the global navbar while AXXA is the active tab. The menu button stays, so you are never stuck.":
    "Esconde a moldura da barra lateral e a barra de navegação global enquanto a AXXA é a aba ativa. O botão de menu fica, então você nunca fica preso.",
  Haptics: "Vibração",
  "A short buzz on every tap. Android only — iPhone doesn't let a plugin touch the Taptic Engine.":
    "Uma vibração curta a cada toque. Só no Android — o iPhone não deixa um plugin mexer no Taptic Engine.",

  // ── ui/settings/indice.ts ─────────────────────────────────────────────────
  "Precision — full detail": "Precisão — detalhe total",
  "Balanced — 4× smaller": "Equilibrada — 4× menor",
  "Light — smaller vectors": "Leve — vetores menores",
  "Minimal — smallest": "Mínima — a menor",
  "the new embedding model": "o novo modelo de embedding",
  "the new precision": "a nova precisão",
  "search in pieces": "a busca em pedaços",
  "a single index file": "o índice num arquivo só",
  "{a} and {b}": "{a} e {b}",
  "Update the index to apply {changes}.": "Atualize o índice pra aplicar {changes}.",

  // ── core/effort.ts (o chat também mostra) ─────────────────────────────────
  Low: "Baixo",
  Medium: "Médio",
  High: "Alto",
  "Extra high": "Extra alto",
  Max: "Máximo",
  "Fast and economical": "Rápido e econômico",
  Balanced: "Equilibrado",
  Detailed: "Detalhado",
  Deep: "Profundo",
  Relentless: "Incansável",
  "up to {pct}% of context": "até {pct}% do contexto",
  "≤{n} tok": "≤{n} tok",
  "no turn cap": "sem teto de turnos",
  "1 turn": "1 turno",
  "{n} turns": "{n} turnos",

  // ── ui/settings/effortEditor.ts ───────────────────────────────────────────
  "Reply length": "Tamanho da resposta",
  "The longest a reply can get, in tokens — longer costs more. No cap lets it use up to the share of context below. Models that think first (GPT-5, the o-series, Claude 5, Fable, Gemini 2.5 and 3) spend part of it thinking, so they always get at least 16k (32k on High, 64k from Extra high), and where the provider allows, the level also sets how hard they think. Each model has its own ceiling (4k on NVIDIA, 64k on Claude Haiku 4.5…), and the plugin never asks above it.":
    "O máximo que uma resposta pode ter, em tokens — mais longa custa mais. Sem teto deixa ela usar até a parte do contexto abaixo. Os modelos que pensam antes (GPT-5, a série o, Claude 5, Fable, Gemini 2.5 e 3) gastam parte disso pensando, então sempre ganham pelo menos 16k (32k no Alto, 64k a partir do Extra alto) e, onde o provedor deixa, o nível também define o quanto eles pensam. Cada modelo tem o seu teto (4k na NVIDIA, 64k no Claude Haiku 4.5…), e o plugin nunca pede acima dele.",
  "No cap": "Sem teto",
  "{n} tokens": "{n} tokens",
  "Share of context": "Parte do contexto",
  "With no cap on the reply, how much of the model's context window it may fill. The rest is kept for your message, the chat so far and the notes. The model's own output ceiling still applies on top.":
    "Com a resposta sem teto, quanto da janela de contexto do modelo ela pode ocupar. O resto fica pra sua mensagem, a conversa até aqui e as notas. O teto de saída do próprio modelo continua valendo por cima.",
  "up to {n}%": "até {n}%",
  Temperature: "Temperatura",
  "How adventurous the wording is: low sticks to the likeliest answer, high is more creative and less predictable. Provider default sends nothing. Not every model takes it — the newest Claude (Fable, Opus 4.7+, Sonnet 5+) and the reasoning models (GPT-5, the o-series, DeepSeek R1) always use their own, so the plugin leaves it out for them. Claude goes up to 1 and NVIDIA from 0.01 to 1 — values outside are brought in.":
    "O quanto o texto se arrisca: baixa fica na resposta mais provável, alta é mais criativa e menos previsível. Padrão do provedor não manda nada. Nem todo modelo aceita — os Claude mais novos (Fable, Opus 4.7+, Sonnet 5+) e os modelos de raciocínio (GPT-5, a série o, DeepSeek R1) sempre usam a própria, então o plugin deixa ela de fora pra eles. O Claude vai até 1 e a NVIDIA de 0.01 a 1 — valores fora disso são trazidos pra dentro.",
  "Provider default": "Padrão do provedor",
  "Agent turns": "Turnos do agente",
  "How many rounds of tool use (read, search, edit…) the Agent gets before it stops and answers. No cap leaves only the loop guard to stop it.":
    "Quantas rodadas de uso de ferramentas (ler, buscar, editar…) o agente tem antes de parar e responder. Sem teto deixa só a trava de repetição pra parar ele.",
  "Tool retries": "Novas tentativas",
  "How many times the Agent retries a tool that failed for a passing reason: network, timeout, a locked file. A wrong path is never retried.":
    "Quantas vezes o agente tenta de novo uma ferramenta que falhou por um motivo passageiro: rede, tempo esgotado, um arquivo travado. Um caminho errado nunca é repetido.",
  None: "Nenhuma",
  "1 retry": "1 tentativa",
  "{n} retries": "{n} tentativas",
  "Loop guard": "Trava de repetição",
  "How many identical tool calls in a row make the Agent stop and rethink, so it doesn't spin in place. Off turns the check off.":
    "Quantas chamadas iguais de ferramenta seguidas fazem o agente parar e repensar, pra ele não ficar girando em falso. Desligado desliga a checagem.",
  Off: "Desligado",
  "1 in a row": "1 seguida",
  "{n} in a row": "{n} seguidas",
  "Run tools in parallel": "Rodar ferramentas em paralelo",
  "When the Agent asks for several tools at once, run them together instead of one after another. Faster; off is easier to follow.":
    "Quando o agente pede várias ferramentas de uma vez, roda todas juntas em vez de uma depois da outra. Mais rápido; desligado é mais fácil de acompanhar.",
  "Vault Q&A notes": "Notas do Vault Q&A",
  "How many of your notes Vault Q&A pulls in to answer each question. More notes, wider view, more tokens. On a local Ollama model the plugin grows the context window to fit what's sent (8k, 16k, 32k…, up to what the model supports), so nothing gets cut — a bigger window just uses more memory.":
    "Quantas das suas notas o Vault Q&A puxa pra responder cada pergunta. Mais notas, visão mais ampla, mais tokens. Num modelo local do Ollama, o plugin aumenta a janela de contexto pra caber o que é enviado (8k, 16k, 32k…, até o que o modelo suporta), então nada é cortado — uma janela maior só usa mais memória.",
  "1 note": "1 nota",
  "{n} notes": "{n} notas",
  "Characters per note": "Caracteres por nota",
  "How much of each note Vault Q&A pulls in goes into the context, in characters. More text, more detail, more tokens.":
    "Quanto de cada nota puxada pelo Vault Q&A entra no contexto, em caracteres. Mais texto, mais detalhe, mais tokens.",
  "{n} chars": "{n} caracteres",
  "provider temperature": "temperatura do provedor",
  "temperature {t}": "temperatura {t}",
  "{level} effort": "Esforço {level}",
  "Restore {level}'s defaults": "Restaurar os padrões do nível {level}",
  Restore: "Restaurar",
  "Restore {level} to its defaults?": "Restaurar o nível {level} aos padrões?",
  "Every setting of {level} goes back to {level}'s own defaults. The other levels keep theirs.":
    "Cada ajuste do nível {level} volta aos padrões do próprio {level}. Os outros níveis ficam como estão.",
  "{level} effort is back to its defaults.": "O nível {level} voltou aos padrões.",
  "What is {name}?": "O que é {name}?",
  "Back to the {level} default ({value})": "Voltar ao padrão do nível {level} ({value})",
  on: "ligado",
  off: "desligado",

  // ── ui/SettingsTab.ts: conexão e catálogo ─────────────────────────────────
  "no credential": "sem credencial",
  "not tested": "não testado",
  connected: "conectado",
  "last test failed": "o último teste falhou",
  "Not tested yet — hit Test to check the credential.":
    "Ainda não testado — toque em Testar pra conferir a credencial.",
  "Talking to the provider…": "Falando com o provedor…",
  "Connected. {detail}": "Conectado. {detail}",
  "Failed. {detail}": "Falhou. {detail}",
  "key…": "chave…",
  "Testing…": "Testando…",
  "The provider answered, but listed no models.":
    "O provedor respondeu, mas não listou nenhum modelo.",
  "1 model available.": "1 modelo disponível.",
  "{n} models available.": "{n} modelos disponíveis.",
  "Fetching…": "Buscando…",
  "Fetch models": "Buscar modelos",
  "1 model found": "1 modelo encontrado",
  "{n} models found": "{n} modelos encontrados",
  "{n} free": "{n} grátis",
  "{n} for Vault Q&A embeddings": "{n} pra embeddings do Vault Q&A",
  "No models returned — check the key or the endpoint.":
    "Nenhum modelo voltou — confira a chave ou o endereço.",
  "Fetch failed: {error}": "A busca falhou: {error}",
  "1 model in this list would get a daily quota — it is the one marked with a \"+\".":
    "1 modelo desta lista ganharia uma cota diária — é o marcado com \"+\".",
  "{n} models in this list would get a daily quota — they are the ones marked with a \"+\".":
    "{n} modelos desta lista ganhariam uma cota diária — são os marcados com \"+\".",
  "No models yet — fetch the catalog, or type one in the field above.":
    "Nenhum modelo ainda — busque o catálogo ou digite um no campo acima.",
  "1 model": "1 modelo",
  "{n} models": "{n} modelos",
  "Show · Favorite ({n}/{max})": "Mostrar · Favorito ({n}/{max})",
  Favorites: "Favoritos",
  "1 model · {free} free": "1 modelo · {free} grátis",
  "{n} models · {free} free": "{n} modelos · {free} grátis",
  All: "Tudo",
  Free: "Grátis",
  "Nothing free in this catalog.": "Nada grátis neste catálogo.",
  "No cost, checked by price, not by the \":free\" in the name. They share 20 requests a minute and 50 a day (1,000 once you've bought $10 in credits).":
    "Sem custo, conferido pelo preço, não pelo \":free\" no nome. Eles dividem 20 pedidos por minuto e 50 por dia (1.000 depois que você compra US$ 10 em créditos).",
  "No cost, checked by price, not by the \":free\" in the name. They share 20 requests a minute and {n} a day on this key.":
    "Sem custo, conferido pelo preço, não pelo \":free\" no nome. Eles dividem 20 pedidos por minuto e {n} por dia nesta chave.",
  "No cost, checked by price, not by the \":free\" in the name. They share 20 requests a minute and {n} a day on this key (1,000 once you've bought $10 in credits).":
    "Sem custo, conferido pelo preço, não pelo \":free\" no nome. Eles dividem 20 pedidos por minuto e {n} por dia nesta chave (1.000 depois que você compra US$ 10 em créditos).",
  "No cost: the models NVIDIA marks as Free Endpoint, for development and testing, 40 requests a minute. The rest of NIM isn't part of the free tier.":
    "Sem custo: os modelos que a NVIDIA marca como Free Endpoint, pra desenvolvimento e testes, 40 pedidos por minuto. O resto do NIM não faz parte do plano grátis.",
  Show: "Mostrar",
  "Appears in this provider's model list": "Aparece na lista de modelos deste provedor",
  "Appears on the new-chat screen (max {n})": "Aparece na tela de nova conversa (máx. {n})",
  "{n} favorites per provider is the limit — unstar one first.":
    "O limite é de {n} favoritos por provedor — desmarque um antes.",

  // ── ui/SettingsTab.ts: menus, esforço, assistente, voz, índice ────────────
  "Play {name}": "Ouvir {name}",
  edited: "editado",
  Edit: "Editar",
  "Writes skills and projects for you. Now: {model}":
    "Escreve skills e projetos por você. Agora: {model}",
  free: "grátis",
  "Nothing free found yet — run SCAN on OpenRouter, or pick a model here.":
    "Nada grátis encontrado ainda — rode o SCAN no OpenRouter ou escolha um modelo aqui.",
  "Automatic — first free model": "Automático — primeiro grátis",
  "{provider} (needs {what})": "{provider} (sem {what})",
  "No limit": "Sem limite",
  "Starts with tvly": "Começa com tvly",
  "Fetch voices": "Buscar vozes",
  yours: "sua",
  "Play sample": "Ouvir amostra",
  "Playing…": "Tocando…",
  Play: "Ouvir",
  Stop: "Parar",
  "1 voice": "1 voz",
  "{n} voices": "{n} vozes",
  "1 yours": "1 sua",
  "{n} yours": "{n} suas",
  "Could not load voices: {error}": "Não deu pra carregar as vozes: {error}",
  local: "local",
  "free tier": "plano grátis",
  "needs Ollama": "precisa do Ollama",
  "needs key": "precisa de chave",
  "No index yet (folder: {folder}).": "Nenhum índice ainda (pasta: {folder}).",
  "Index loaded: 1 chunk (folder: {folder}).": "Índice carregado: 1 trecho (pasta: {folder}).",
  "Index loaded: {n} chunks (folder: {folder}).":
    "Índice carregado: {n} trechos (pasta: {folder}).",
  "Cancel indexing": "Cancelar indexação",
  "Index vault": "Indexar o vault",
  "Delete index": "Apagar o índice",
  "Index deleted.": "Índice apagado.",

  // ── core/providersMeta.ts (o chat mostra no item bloqueado) ───────────────
  "No credential yet — add one in Settings › Providers.":
    "Sem credencial ainda — adicione uma em Configurações › Provedores.",
  "Last connection test failed — check the key in Settings › Providers.":
    "O último teste de conexão falhou — confira a chave em Configurações › Provedores.",

  // ── ui/modelGroups.ts (os grupos da folha de modelos; "Chat" e "Voice"
  //    já estão acima) ─────────────────────────────────────────────────────
  Reasoning: "Raciocínio",
  Image: "Imagem",
  Video: "Vídeo",
  Other: "Outros",
};

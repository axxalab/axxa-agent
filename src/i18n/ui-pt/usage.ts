// src/i18n/ui-pt/usage.ts
// pt-BR da interface: a tela de Uso (UsageView, Left today, o cartão da home, o gráfico).
// Chave = o texto em inglês do código (ver i18n/tr.ts). As {variáveis} da
// chave têm que aparecer na tradução — o teste de cobertura confere.

export const PT_USAGE: Record<string, string> = {
  // ── ui/UsageView.tsx ─────────────────────────────────────────────────
  // O período (o segmented tem quatro colunas: o rótulo é curto de propósito).
  "All time": "Tudo",
  "7 days": "7 dias",
  "30 days": "30 dias",
  "90 days": "90 dias",
  "Last {n} days": "Últimos {n} dias",
  "Period": "Período",
  // O passo do gráfico.
  "Daily": "Por dia",
  "Weekly": "Por semana",
  "Monthly": "Por mês",
  // As dimensões dos filtros e as listas inteiras.
  "Provider": "Provedor",
  "Providers": "Provedores",
  "Search providers": "Buscar provedores",
  "Model": "Modelo",
  "Models": "Modelos",
  "Search models": "Buscar modelos",
  "Mode": "Modo",
  "Modes": "Modos",
  "Search modes": "Buscar modos",
  "Filter": "Filtros",
  "Clear": "Limpar",
  "See all {n}": "Ver tudo ({n})",
  "Nothing matches that search.": "Nada bate com essa busca.",
  // A barra e o relatório.
  "Back": "Voltar",
  "Usage": "Uso",
  "Save this report as a note": "Salvar este relatório como nota",
  "Saving…": "Salvando…",
  "Report": "Relatório",
  "Report saved: {path}": "Relatório salvo: {path}",
  "Could not save the report: {error}": "Não consegui salvar o relatório: {error}",
  // O total.
  "Totals": "Totais",
  "spent": "gastos",
  "tokens": "tokens",
  "{n} tokens": "{n} tokens",
  "Some models have no public price — this is a floor":
    "Alguns modelos não têm preço público — este é o valor mínimo",
  "1 chat": "1 conversa",
  "{n} chats": "{n} conversas",
  "Sent": "Enviados",
  "Received": "Recebidos",
  // "Por conversa" cortava no quadro do celular ("POR CONV…"): o rótulo tem
  // a largura de "PER CHAT", e "chat" é palavra corrente em português.
  "Per chat": "Por chat",
  "{pct}% of what you sent came from the cache — saved {usd}":
    "{pct}% do que você mandou saiu do cache — economizou {usd}",
  "{pct}% of what you sent came from the cache": "{pct}% do que você mandou saiu do cache",
  "{pct}% of what you sent came from the cache, but writing to it cost {usd} more than it saved":
    "{pct}% do que você mandou saiu do cache, mas gravar nele custou {usd} a mais do que ele poupou",
  "avg": "média",
  // O gráfico no tempo, e o vazio dele.
  "Tokens over time": "Tokens ao longo do tempo",
  "Over time": "Ao longo do tempo",
  "peak {n}": "pico {n}",
  "Tokens per day": "Tokens por dia",
  "Tokens per week": "Tokens por semana",
  "Tokens per month": "Tokens por mês",
  "{when}: {sent} sent, {received} received": "{when}: {sent} enviados, {received} recebidos",
  "{when} · {sent} sent · {received} received": "{when} · {sent} enviados · {received} recebidos",
  "{n} sent": "{n} enviados",
  "{n} received": "{n} recebidos",
  "Your tokens land here as you chat.": "Seus tokens aparecem aqui conforme você conversa.",
  "Nothing to plot yet.": "Nada pra desenhar ainda.",
  "No tokens recorded in these chats.": "Nenhum token registrado nestas conversas.",
  "Just one day so far — the shape fills in as you go.":
    "Só um dia até agora — o desenho se completa conforme você usa.",
  // As listas.
  "No usage yet. Every chat is counted here as you go.":
    "Nenhum uso ainda. Cada conversa entra na conta aqui, conforme você usa.",
  "Nothing in this slice. Try a longer period or fewer filters.":
    "Nada neste recorte. Tente um período maior ou menos filtros.",
  "By model": "Por modelo",
  "Most expensive chats": "Conversas mais caras",
  "Biggest chats": "Maiores conversas",
  "Free": "Grátis",
  "free": "grátis",
  "no public price": "sem preço público",
  "No public price": "Sem preço público",
  "No chats in this slice": "Nenhuma conversa neste recorte",
  "Untitled": "Sem título",

  // ── ui/LeftToday.tsx ─────────────────────────────────────────────────
  "Left today": "Sobra hoje",
  // O title do "zera em": o {when} já traz a preposição (ver sobraDoDia).
  "Resets at {when}": "Zera {when}",
  "resets in {time}": "zera em {time}",
  "1 left": "resta 1",
  "{n} left": "restam {n}",
  "{name}: 1 of {limit} left": "{name}: resta 1 de {limit}",
  "{name}: {left} of {limit} left": "{name}: restam {left} de {limit}",
  "1 request": "1 pedido",
  "{n} requests": "{n} pedidos",
  "{n} spent": "{n} gastos",
  "{used} of {limit} spent": "{used} de {limit} gastos",
  "{used} of {limit} tokens used": "{used} de {limit} tokens usados",
  "{used} of 1 request used": "{used} de 1 pedido usado",
  "{used} of {limit} requests used": "{used} de {limit} pedidos usados",
  "No daily limit set": "Sem limite diário definido",
  "Ask OpenRouter again": "Perguntar de novo ao OpenRouter",
  "Asking…": "Perguntando…",
  "Refresh": "Atualizar",
  // O editor do teto.
  "Edit": "Editar",
  "Set limit": "Definir limite",
  "Edit the daily spending limit": "Editar o limite de gasto diário",
  "Set the daily spending limit": "Definir o limite de gasto diário",
  "Edit the daily limit for {name}": "Editar o limite diário do {name}",
  "Set the daily limit for {name}": "Definir o limite diário do {name}",
  "$ a day": "$ por dia",
  "Per day": "Por dia",
  "Daily spending limit in dollars": "Limite de gasto diário em dólares",
  "Requests per day for {name}": "Pedidos por dia do {name}",
  "Save limit": "Salvar limite",
  "Requests per day.": "Pedidos por dia.",
  // O crédito da chave do OpenRouter.
  "Key credit": "Crédito da chave",
  "Spent today": "Gasto hoje",
  "{amount} spent today": "{amount} gastos hoje",
  "No spending cap on this key": "Sem teto de gasto nesta chave",
  "resets daily": "zera todo dia",
  "resets weekly": "zera toda semana",
  "resets monthly": "zera todo mês",
  "resets {when}": "zera {when}",

  // ── ui/UsageCard.tsx ─────────────────────────────────────────────────
  "Usage in {month} — open details": "Uso em {month} — abrir detalhes",
  "Daily usage this month, busiest day {n} tokens": "Uso diário deste mês, dia mais cheio com {n} tokens",
  "{day} · {n} tokens": "{day} · {n} tokens",
  "Streak": "Sequência",
  "day": "dia",
  "days": "dias",
  "Active": "Ativos",
  "of {n}": "de {n}",
  "Actions": "Ações",
  "in vault": "no vault",
  "Messages": "Mensagens",
  // A unidade de "Messages" (mensagens enviadas).
  "sent": "enviadas",

  // ── ui/RagLine.tsx ───────────────────────────────────────────────────
  "Index settings": "Configurações do índice",
  "Local index": "Índice local",
  "1 note": "1 nota",
  "{n} notes": "{n} notas",
  "1 chunk": "1 trecho",
  "{n} chunks": "{n} trechos",
  "searched on this device": "buscado neste aparelho",
  "not built yet — notes are found by keyword until you build it":
    "ainda não criado — até lá, as notas são achadas por palavra-chave",
  "Cancel indexing": "Cancelar indexação",
  "Update index": "Atualizar índice",
  "Update index with new notes": "Atualizar o índice com as notas novas",

  // ── usage/sobraDoDia.ts ──────────────────────────────────────────────
  // Onde o dia vira: vão no title "Zera {when}", então levam a preposição.
  "midnight, your time": "à meia-noite, no seu horário",
  "midnight Pacific": "à meia-noite do Pacífico",
  "00:00 UTC": "às 00:00 UTC",
  "no daily cap": "sem teto diário",
  // Os cartões e os medidores.
  "Paid models": "Modelos pagos",
  "Flagship models": "Modelos grandes",
  "Mini models": "Modelos mini",
  "Free models": "Modelos grátis",
  "All models": "Todos os modelos",
  "Paid only": "Só pago",
  "Your limits in AI Studio": "Seus limites no AI Studio",
  // O gasto do dia.
  "Counted in this vault from public token prices. Gemini counts at paid prices unless you mark your key as free tier in Settings › Providers › Gemini.":
    "Contado neste vault pelos preços públicos dos tokens. O Gemini entra pelo preço pago, a menos que você marque a sua chave como plano grátis em Settings › Providers › Gemini.",
  "Counted in this vault from public token prices. Your Gemini key is on the free tier, so Gemini models with a free tier count as $0.":
    "Contado neste vault pelos preços públicos dos tokens. A sua chave do Gemini está no plano grátis, então os modelos do Gemini com plano grátis contam US$ 0.",
  "1 request on models without a public price isn't included.":
    "1 pedido em modelos sem preço público não entra na conta.",
  "{n} requests on models without a public price aren't included.":
    "{n} pedidos em modelos sem preço público não entram na conta.",
  "At the limit, paid models pause until midnight.": "No limite, os modelos pagos param até a meia-noite.",
  "At the limit you get a heads-up; turn on “Stop paid models at the limit” in settings to pause them.":
    "No limite você recebe um aviso; ligue “Parar os modelos pagos no limite” nas configurações pra pausá-los.",
  "Set a limit to get a heads-up at 80% and 100%.": "Defina um limite pra receber um aviso em 80% e 100%.",
  "Resets at midnight, your time.": "Zera à meia-noite, no seu horário.",
  // OpenAI.
  "No free tokens to track. If your organization shares API data with OpenAI, turn that on in settings.":
    "Nenhum token grátis pra acompanhar. Se a sua organização compartilha dados da API com a OpenAI, ligue isso nas configurações.",
  "Free tokens start at usage tier 1.": "Os tokens grátis começam no usage tier 1.",
  "Free daily tokens for sharing API data with OpenAI. Flagship: GPT-5, GPT-4.1, GPT-4o, o1, o3. Mini: their mini and nano versions, and o4-mini. Counted in this vault: other apps on the same OpenAI organization draw from the same quota, so the real number may be lower. Resets at 00:00 UTC.":
    "Tokens grátis por dia por compartilhar dados da API com a OpenAI. Grandes: GPT-5, GPT-4.1, GPT-4o, o1, o3. Mini: as versões mini e nano deles, e o o4-mini. Contado neste vault: outros apps na mesma organização da OpenAI gastam da mesma cota, então o número real pode ser menor. Zera às 00:00 UTC.",
  // Gemini.
  "Nothing used since midnight Pacific.": "Nada usado desde a meia-noite do Pacífico.",
  "Requests per day, per model and per Google Cloud project. The free tier only exists on projects without billing, and Google shows its numbers in AI Studio, not in the docs: set each model's limit here to see what's left. Resets at midnight Pacific.":
    "Pedidos por dia, por modelo e por projeto do Google Cloud. O plano grátis só existe em projetos sem faturamento, e o Google mostra os números dele no AI Studio, não na documentação: defina aqui o limite de cada modelo pra ver quanto sobra. Zera à meia-noite do Pacífico.",
  // OpenRouter.
  "Counted by OpenRouter for this key, across every app that uses it.":
    "Contado pelo OpenRouter nesta chave, somando todo app que a usa.",
  "Counted on this device: OpenRouter didn't answer, so other apps using this key aren't included.":
    "Contado neste aparelho: o OpenRouter não respondeu, então outros apps que usam esta chave ficam de fora.",
  "Models ending in :free allow 20 requests a minute and 50 a day, or 1,000 a day once you've bought $10 in credits. Resets at 00:00 UTC.":
    "Modelos terminados em :free aceitam 20 pedidos por minuto e 50 por dia, ou 1.000 por dia depois que você compra $10 em créditos. Zera às 00:00 UTC.",
  // NIM.
  "Free endpoints allow 40 requests a minute. NVIDIA publishes no daily cap, so this is just what you used today (your local day).":
    "Os endpoints grátis aceitam 40 pedidos por minuto. A NVIDIA não publica teto diário, então isto é só o que você usou hoje (no seu dia local).",

  // ── usage/freeTag.ts (a etiqueta de grátis na lista de modelos) ──────
  "free tier": "plano grátis",
  "{n}/day": "{n}/dia",
  "+{n}/day": "+{n}/dia",
  "free · {n}/day": "grátis · {n}/dia",
  "free · 40/min": "grátis · 40/min",
  "{n} tokens a day at no cost while you share API data with OpenAI. Past that, this model is billed normally — and the quota counts ALL your OpenAI API use, not just this vault.":
    "{n} tokens por dia sem custo enquanto você compartilha dados da API com a OpenAI. Passando disso, este modelo é cobrado normalmente — e a cota conta TODO o seu uso da API da OpenAI, não só este vault.",
  "Turn on data sharing in OpenAI's Data controls to get {n} tokens a day here at no cost.":
    "Ligue o compartilhamento de dados nos Data controls da OpenAI pra ganhar {n} tokens por dia aqui, sem custo.",
  "No cost: your Gemini key is on the free tier (a project without billing), within its rate limits. Google may use what you send to improve its products. The daily spending counts it as $0.":
    "Sem custo: a sua chave do Gemini está no plano grátis (um projeto sem faturamento), dentro dos limites de uso. O Google pode usar o que você envia pra melhorar os produtos dele. O gasto do dia conta US$ 0.",
  "No cost on the Gemini API's free tier — a project without billing turned on, where Google may use what you send to improve its products — within its rate limits. With billing on, this model is charged.":
    "Sem custo no plano grátis da API do Gemini — um projeto sem faturamento ativado, em que o Google pode usar o que você envia pra melhorar os produtos dele — dentro dos limites de uso. Com o faturamento ativado, este modelo é cobrado.",
  "No cost. OpenRouter's free models share 20 requests a minute and {limit} a day on this key.":
    "Sem custo. Os modelos grátis do OpenRouter dividem 20 pedidos por minuto e {limit} por dia nesta chave.",
  "No cost. OpenRouter's free models share 20 requests a minute and {limit} a day on this key — 1,000 once you've bought $10 in credits.":
    "Sem custo. Os modelos grátis do OpenRouter dividem 20 pedidos por minuto e {limit} por dia nesta chave — 1.000 depois que você compra $10 em créditos.",
  "No cost. OpenRouter's free models share 20 requests a minute and 50 a day (1,000 once you've bought $10 in credits).":
    "Sem custo. Os modelos grátis do OpenRouter dividem 20 pedidos por minuto e 50 por dia (1.000 depois que você compra $10 em créditos).",
  // Sem concordância de número: vale pra 1 e pra 37.
  "{n} were left when you fetched.": "Restante na última busca de modelos: {n}.",
  "A free variant can run on a different host, with a smaller context than the paid one.":
    "Uma variante grátis pode rodar em outro host, com um contexto menor que o da paga.",
  "A Free Endpoint in NVIDIA's API catalog: no cost with your developer key, for development and testing, up to 40 requests a minute. Models without this mark aren't part of the free tier.":
    "Um Free Endpoint do catálogo de API da NVIDIA: sem custo com a sua chave de desenvolvedor, pra desenvolvimento e testes, até 40 pedidos por minuto. Modelos sem essa marca não fazem parte do plano grátis.",
  "Runs on your own machine — there's no bill at all.": "Roda na sua própria máquina — não existe fatura nenhuma.",
  "No cost — this model has no billing at all.": "Sem custo — este modelo não tem cobrança nenhuma.",

  // ── usage/timeline.ts (o eixo e as datas do gráfico) ─────────────────
  // Em português o dia vem antes do mês ("11 set"), e o mês curto é minúsculo.
  "Jan": "jan",
  "Feb": "fev",
  "Mar": "mar",
  "Apr": "abr",
  "May": "mai",
  "Jun": "jun",
  "Jul": "jul",
  "Aug": "ago",
  "Sep": "set",
  "Oct": "out",
  "Nov": "nov",
  "Dec": "dez",
  "{month} {day}": "{day} {month}",
  "{month} {day}, {year}": "{day} {month} {year}",
  "{start} – {end}, {year}": "{start} – {end} {year}",
};

<h1 align="center">AXXA Agent</h1>

<p align="center">
  <a href="https://community.obsidian.md/plugins/axxa-agent"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&query=%24%5B%22axxa-agent%22%5D.downloads&label=downloads&logo=obsidian&color=7C3AED" alt="Obsidian downloads"></a>
  <a href="https://github.com/axxalab/axxa-agent/releases/latest"><img src="https://img.shields.io/github/v/release/axxalab/axxa-agent?label=version&color=6c5ce7" alt="Latest release"></a>
  <a href="#faq"><img src="https://img.shields.io/badge/desktop%20%2B%20mobile-supported-success" alt="Desktop and mobile"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-green" alt="GPL-3.0"></a>
</p>

<p align="center"><b>English</b> · <a href="README.pt-BR.md">Português (Brasil)</a></p>

<p align="center">
  <a href="https://community.obsidian.md/plugins/axxa-agent"><img src="https://img.shields.io/badge/Add%20to%20Obsidian-7c3aed?logo=obsidian&logoColor=white&style=for-the-badge" alt="Add to Obsidian"></a>
</p>

<p align="center"><b>Chat, ask your vault, and let an agent edit your notes, on your phone as well as your desktop.</b><br>Six providers, your own API keys, every conversation saved as Markdown.</p>

<p align="center"><img src="assets/demo/hero.gif" width="900" alt="A real recording on the Obsidian mobile layout: a question about the vault, then an answer that cites the notes it came from"></p>

<p align="center"><a href="https://agent.axxalab.com.br">Website</a> · <a href="#install">Install</a> · <a href="#quick-start">Quick start</a> · <a href="#privacy-and-data">Privacy</a> · <a href="#faq">FAQ</a> · <a href="https://github.com/axxalab/axxa-agent/discussions">Discussions</a></p>

## What it does

- **Three modes, one panel.** Chat, Vault Q&A over your notes, and an Agent that works on your files.
- **Answers that cite your notes.** Vault Q&A runs hybrid search (keyword + vector, re-ranked by your links) and cites the notes it used as wikilinks you can open.
- **An agent that asks first.** It creates, edits, moves and deletes notes through a small set of tools. By default every change waits for your OK; moves rewrite your `[[links]]`, and deletes follow your Obsidian trash setting.
- **Made for your phone.** Designed for the Obsidian mobile drawer first: the composer follows the keyboard, there is an optional fullscreen mode, and the agent works on the phone too.
- **Six providers, your keys.** OpenAI, Anthropic, Google Gemini, OpenRouter, NVIDIA NIM and local Ollama. Keys live in your OS keychain.
- **Small and fast.** `main.js` is under 0.6 MB (587,963 bytes in 0.9.24). The 12 most-downloaded AI plugins have a median of about 3.8 MB (measured October 2026).
- **Everything is Markdown.** Chats, skills and cost reports are files in your vault, and a usage dashboard shows what you spend by provider, model and day, and what's left today on each free tier.

<p align="center">
  <img src="assets/screenshots/ask-your-vault.jpg" width="260" alt="Vault Q&A: an answer citing the meeting note">
  <img src="assets/screenshots/agent-asks-first.jpg" width="260" alt="The agent asks before moving a note">
  <img src="assets/screenshots/providers.jpg" width="260" alt="Model picker with six providers">
</p>

<details>
<summary>More screenshots</summary>
<p align="center">
  <img src="assets/screenshots/usage.jpg" width="260" alt="Usage dashboard with tokens by model">
  <img src="assets/screenshots/home.jpg" width="260" alt="Home: recent chats and the three modes">
</p>
</details>

## Install

Requires Obsidian **1.11.4** or newer, on desktop or mobile, and either an API key for one provider or a local Ollama server.

1. Open the [AXXA Agent page in the community directory](https://community.obsidian.md/plugins/axxa-agent) and choose **Add to Obsidian**, or in Obsidian go to **Settings → Community plugins → Browse** and search for **AXXA Agent**.
2. Select **Install**, then **Enable**.
3. Open it from the ribbon icon or the command palette (**AXXA Agent: Open**).

### Beta builds (BRAT)

Test builds are published as GitHub pre-releases. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), add `axxalab/axxa-agent`, and BRAT keeps you on the latest beta. Betas can break; the community directory always serves the stable release.

<details>
<summary>Manual install</summary>

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/axxalab/axxa-agent/releases/latest).
2. Copy them into `<vault>/.obsidian/plugins/axxa-agent/`.
3. Reload Obsidian and enable the plugin in **Settings → Community plugins**.
</details>

## Quick start

1. Open **Settings → AXXA Agent → Providers**.
2. Add a key for one provider ([where to get one](#providers)), or set your Ollama server address (usually `http://localhost:11434`).
3. Start a chat from the home screen, pick a mode, and send.

**Free ways to start:** Google Gemini's free tier (on a project without billing), OpenRouter's free models, NVIDIA NIM's Free Endpoints, or a local model through Ollama, which needs no key and no account. The first message locks the provider, model and mode for that conversation.

## The three modes

| Mode | What it does |
|---|---|
| **Chat** | A conversation with the model you pick: streaming answers, Markdown, copy buttons on answers, code blocks and your own messages. No vault access unless you turn it on. |
| **Vault Q&A** | Answers grounded in your notes. Search finds the relevant passages and the answer cites them. |
| **Agent** | The model uses tools on your vault: search, list, read, create, edit, move and delete notes and folders, with confirmations. |

<details>
<summary>How Vault Q&A searches</summary>

- Hybrid search: semantic similarity plus keyword matching (a match in a note's title counts more than one in its text), re-ranked with your vault's link graph.
- Embedding models from 5 providers: OpenAI (`text-embedding-3-small/large`, `ada-002`), Gemini (`gemini-embedding-001`, `text-embedding-004`), NVIDIA NIM (the embedding models its catalog lists when you fetch models), OpenRouter's free Nemotron VL, which also embeds images, and your own Ollama (for example `nomic-embed-text`), which keeps indexing and search on your machine.
- The index is stored in your vault and updates incrementally, only for changed files. Without an embedding model (or offline with a cloud one), search falls back to keywords.
</details>

## Providers

All providers use your own key. You only need one.

| Provider | Type | Free option | Get a key |
|---|---|---|---|
| **OpenAI** | Cloud | Free daily tokens for eligible organizations that share API data | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Anthropic (Claude)** | Cloud | No | [console.anthropic.com](https://console.anthropic.com/) |
| **Google Gemini** | Cloud | Free tier on a project without billing; image generation is paid | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **OpenRouter** | Cloud, many models | Free models: 50 requests a day, 1,000 after $10 in credits | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **NVIDIA NIM** | Cloud | Free Endpoints: 20 hosted models, 40 requests a minute, for development | [build.nvidia.com](https://build.nvidia.com/) |
| **Ollama** | Local, no key | Free | [ollama.com](https://ollama.com/), then set the server address in Settings |

Model lists come live from each provider. Badges show what each model can do (vision, tools, image or audio generation), and a banner warns you when a model can't do what the current mode needs. A free model carries its limit: `free · 50/day` on OpenRouter (your key's own number), `free · 40/min` on NVIDIA NIM, `free tier` on Gemini, and the daily allowance on OpenAI (`250k/day` at tiers 1–2) once data sharing is on, with a `+` in front while it's off.

## Agent safety

The agent uses eight tools on your vault: `vault_search`, `vault_list`, `vault_read`, `vault_create`, `vault_edit`, `vault_move`, `vault_delete` and `vault_create_folder`. With **Web access** on (Settings › Agent), it also has two on the web: `web_search`, which needs your own [Tavily](https://tavily.com) key (1,000 free searches a month), and `web_fetch`, which opens a public page. Web requests show you the address or the search first in Ask and Vault (unless you chose **Approve all** on an earlier web request in the same turn), and local addresses (your computer, your home network) are always refused. Three permission levels decide what it can do without asking:

- **Ask** (default): every change waits for your OK.
- **Vault**: creates, edits and moves run on their own; deletes still ask.
- **YOLO**: everything runs on its own, deletes included. Deletes go to your trash; if Obsidian is set to delete files permanently, they still ask.

Every change the agent makes can be undone from the chat: **Undo** under the answer reverts the whole turn, and each action in the list has its own. Undo keeps anything you changed by hand since, unless you choose to overwrite it, and lasts while Obsidian stays open.

File paths are sandboxed to your vault, and the confirmation shows exactly what will change.

## Privacy and data

- **No telemetry, no account, nothing sent to us.** Requests go only to the providers you configure and to web pages you ask it to read.
- **Keys stay on your device** in your OS keychain (Obsidian's `secretStorage`), never in `data.json`, so they don't travel through Sync or backups.
- **Your notes leave the device only to the provider you chose**, as part of a conversation or the Vault Q&A index. The index itself is stored in your vault.
- **Offline with Ollama.** Chat, Vault Q&A and the agent can all run on your machine with Ollama (Vault Q&A needs an embedding model such as `nomic-embed-text`; the agent needs a model with tools).

When you use a third-party provider, its own terms and privacy policy apply.

### Disclosures

Per Obsidian's developer policies, in plain terms:

- **Network use.** Requests go only to the AI providers you configure (OpenAI, Anthropic, Google Gemini, OpenRouter, NVIDIA NIM, ElevenLabs for optional read-aloud voices, and your own Ollama endpoint), to any web page you ask it to fetch with **+ › Link**, and, with the agent's **Web access** on, to the search and pages described below. What each one receives:
  - the chat provider: your messages, the notes, files, images, PDFs and web pages you attach, and the vault excerpts described under *Automatic context*. Attached notes, pasted text and linked pages go again with every later message of the conversation (until that part of a long conversation is summarized), and images and PDFs too, for the 3 most recent messages that carry them, while the chat stays open. OpenAI and OpenRouter also get a random ID per conversation, used for prompt caching. When a long conversation nears the model's limit, the same provider is also asked to summarize its start, from the text of the earlier messages, the names of the notes and files sent along, and the agent's actions with a short excerpt of each result;
  - the embedding provider (Vault Q&A): the text of your notes while the index is built, and the images too if you pick an image-capable embedding model, plus each search query;
  - OpenAI's transcription API: your voice recordings, when you dictate;
  - OpenAI or ElevenLabs: the text of an answer, when you press Listen;
  - OpenRouter's key endpoint (`openrouter.ai/api/v1/key`), with your OpenRouter key, when you fetch OpenRouter's models or open Usage: it only reads your key's free-request quota, credit left and today's spend;
  - NVIDIA's public model catalog (`api.ngc.nvidia.com`), when you fetch NIM's model list: a search for the models NVIDIA marks *Free Endpoint*, so the list can tell which ones are really free. No key and nothing of yours goes with it;
  - Tavily's search API (`api.tavily.com`), with your Tavily key, when the agent searches the web: the search the agent wrote;
  - a web page the agent opens (`web_fetch`): a plain request for that address, which you see and approve first unless your permission level is YOLO or you chose **Approve all** on an earlier web request in that turn.

  There is no telemetry and nothing is sent to us. Answers are rendered as Markdown, so an image link inside an answer is loaded from wherever it points.
- **Accounts and payment.** The plugin is free, but it needs your own key for at least one provider (Ollama, running locally, needs none). Most providers bill API usage per token; some offer free models or quotas.
- **Vault enumeration.** The plugin reads your vault's file list (Obsidian's `getMarkdownFiles` / `getFiles`) to build the Vault Q&A index, for the keyword half of vault search (Vault Q&A, Agent context and the agent's `vault_search`), for the note picker (**+ › Notes**, `[[` mentions and project sources) and, only if you turn on *Let it see your note names* (off by default), so the creation assistant can suggest notes for a project. The list itself stays on your device, with three exceptions: in that last case the paths of up to 300 recent notes (never their content) go to the assistant's model; in Agent mode the `vault_list` tool sends the names of the files in a folder (the vault root included) to the chat model, without asking; and `vault_search` sends the paths and excerpts of the notes it finds.
- **Automatic context.** In Vault Q&A and Agent conversations, a per-chat vault switch starts **on**: excerpts of the notes that match your message are sent with it to the chat provider and stay with that message, so they go again with every later message of the conversation (until that part of a long conversation is summarized). In Chat it starts **off**.
- **Files read and written.** Chats and the Vault Q&A index are saved inside your vault, in the hidden `.axxa/` folder by default. Each chat file also keeps, base64-encoded (not encrypted) in a hidden comment on each of your messages, the vault excerpts and the text of the notes, pasted text and pages sent with it, plus the summary of a long conversation's start. When you ask for them, exports go to `axxa-ai/exports/`, usage reports to `axxa-ai/reports/` and skills to `axxa-ai/skills/`. In Agent mode the model can read any text file in your vault and create, edit, move and delete notes and folders through its tools. Changes ask for confirmation according to the permission level you set (and **Approve all** in that dialog stops asking for the rest of that turn's reversible changes; on a web request, it covers only that turn's web requests); deletes ask at every level except YOLO, and even there when Obsidian is set to delete files permanently. Every change the agent makes can be undone from the chat while Obsidian stays open.

<details>
<summary>Why the plugin uses <code>fetch</code>, and the one Node API it touches</summary>

Obsidian recommends its own `requestUrl` for network requests, and AXXA uses it everywhere it can. But `requestUrl` returns the whole response at once and cannot stream, and streaming is what makes an answer appear as it is written (and what lets **Stop** actually stop the model). So chat replies from OpenAI, Anthropic, Gemini, OpenRouter and Ollama stream through the browser's `fetch`, in a single helper (`fetchStream` in `src/providers/_shared.ts`). That helper calls it as `window.fetch`, the very same function as `fetch` (the bare name is just a shortcut to it). Obsidian's review linter only checks the bare name, so it no longer flags this call; we would rather say so here than let the review read as "no `fetch`". If streaming can't connect (for example, blocked by CORS on mobile), the plugin falls back to `requestUrl` and shows the answer in one piece.

The NVIDIA NIM provider asks Electron for Node's `https` to stream on desktop ([`nim.ts`](src/providers/nim.ts)). It is gated behind `Platform.isMobile`, wrapped in try/catch, checked for shape, and falls back to `requestUrl`; on mobile that branch is never reached.
</details>

## FAQ

<details>
<summary><b>Is it free?</b></summary>

Yes. Every feature in the plugin today is free, with no tier, no account and no license key, and it stays that way. If paid options appear later, they will be new things built on top, never a lock on something that already worked. You pay your AI provider directly; the plugin takes no cut.
</details>

<details>
<summary><b>Does the agent work on mobile?</b></summary>

Yes. Chat, Vault Q&A and the agent with its confirmations all run in the Obsidian mobile app. Cloud providers work anywhere; Ollama runs on a computer, so using it from a phone needs an Ollama server the phone can reach.
</details>

<details>
<summary><b>What leaves my device?</b></summary>

Only what goes to the provider you chose: your messages, what you attach, and the note excerpts that Vault Q&A and the agent use. Nothing goes to us. The full list is under [Disclosures](#disclosures).
</details>

<details>
<summary><b>Which models are free?</b></summary>

Each provider has its own rule. The model list in Settings shows the limit next to each free model, and **Usage › Left today** shows what's left today.

- **Google Gemini:** the free tier covers the Flash models (2.5 and 3.x, including Lite, Live and TTS), 2.5 Pro, embeddings and Gemma, on a project without billing turned on. In exchange, Google may use what you send to improve its products. Image generation (Nano Banana included), 3.1 Pro preview, Veo and Lyria are paid only.
- **OpenRouter:** models priced at zero, tagged `free · 50/day`. They share 20 requests a minute and 50 a day per key, or 1,000 a day once the account has bought $10 in credits. A price of zero in the catalog isn't enough: Google's Lyria shows 0 but bills per clip, so it isn't marked free.
- **NVIDIA NIM:** only the models NVIDIA marks *Free Endpoint* (20 of its 81 hosted models in October 2026), for development and testing, up to 40 requests a minute. The rest of NIM is paid.
- **OpenAI:** some organizations get free tokens every day if they share their API inputs and outputs with OpenAI, which uses them to improve its models. At usage tiers 1–2 that's 250k tokens a day on the flagship models and 2.5M on the small ones; tiers 3–5 get 1M and 10M. Past that, usage is billed. The account needs a positive balance, image models never count, and you check eligibility in Data controls › Sharing.
- **Ollama:** any local model. The only limit is your machine.
</details>

<details>
<summary><b>Can I keep other AI plugins installed?</b></summary>

Yes. AXXA runs in its own panel, its styles are scoped to that panel, and it doesn't depend on or replace other plugins.
</details>

<details>
<summary><b>How do I report a bug?</b></summary>

Use the [bug report form](https://github.com/axxalab/axxa-agent/issues/new?template=bug_report.yml). Your platform, Obsidian version and the steps to reproduce make it much faster to fix. Questions go to [Discussions](https://github.com/axxalab/axxa-agent/discussions).
</details>

<details>
<summary><b>More: effort, usage and cost</b></summary>

- **Effort** (Low to Max) scales how hard the model works: max tokens, agent turn limits, temperature, parallel tool calls, retries, and how much of your vault goes into context. Every level is tunable in Settings.
- **Usage** reads your saved chats and estimates spend in USD by provider, model, mode and day, with a 30-day heatmap. Export the report as PDF, Markdown or HTML.
- **Left today**, at the top of Usage, shows what's left on each free tier and when it resets: OpenRouter's free requests, read live from your key (so they count every app that uses it); OpenAI's data-sharing tokens and Gemini's free-tier requests, counted by AXXA on this device (Google doesn't publish Gemini's limits, so you type each model's limit from AI Studio); and NVIDIA NIM's requests today, which have no daily cap. The count is a local log kept in the plugin's `data.json`; AXXA never sends it anywhere.
</details>

## Roadmap

- **Now:** stability across all six providers, and the agent with local Ollama models.
- **Next:** PDFs on Gemini, NIM and Ollama; a Coder mode with diff previews.
- **Later:** MCP connectors (Notion, Linear, GitHub); optional paid extras such as cross-device sync and automatic media transcription.

Ideas and votes live in [Discussions › Ideas](https://github.com/axxalab/axxa-agent/discussions/categories/ideas).

## Feedback and community

- Found a bug? [Report it](https://github.com/axxalab/axxa-agent/issues/new?template=bug_report.yml).
- Have a question? [Ask in Discussions](https://github.com/axxalab/axxa-agent/discussions).
- Built a useful skill? Skills are `.md` files, so share yours in Discussions.
- If AXXA helps you, a star on GitHub helps other people find it.
- Want to back it with money? [Sponsor it on GitHub](https://github.com/sponsors/rafaelpsyik), monthly or one time. It unlocks nothing: every feature stays free. More ways to help are on the [support page](https://agent.axxalab.com.br/support).

## License

**GPL-3.0-or-later**, see [LICENSE](LICENSE). Use it for anything, including at work, and fork it freely; if you distribute a modified version, ship its source under the same terms. The provider logos come from [lobe-icons](https://github.com/lobehub/lobe-icons) (MIT) and are credited in [NOTICE.md](NOTICE.md).

© 2026 AXXA Lab™.

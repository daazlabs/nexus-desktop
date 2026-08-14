# DaazNexus Desktop

A free desktop AI chat client that routes every message across 30+ LLM providers — free and paid — with automatic fallback, and gives the model real access to your own computer when you want it to.

[![Latest release](https://img.shields.io/github/v/release/daazlabs/nexus-desktop)](https://github.com/daazlabs/nexus-desktop/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/daazlabs/nexus-desktop/releases/latest)

## Download

Grab the installer for your OS from the [latest release](https://github.com/daazlabs/nexus-desktop/releases/latest):

| OS | File |
|---|---|
| macOS (Apple Silicon) | `DaazNexus-*-arm64.dmg` |
| Windows | `DaazNexus-Setup-*.exe` |
| Linux | `DaazNexus-*.AppImage` (portable) or `nexus-desktop_*_amd64.deb` |

No account required to start — bring your own API key for any provider you want to use, or run fully offline with a local model (Ollama / llama.cpp).

## What it does

DaazNexus Desktop is one chat app in front of many models, with two modes:

- **PLAN mode** (default) — a normal chat, read-only, no access to your machine.
- **BUILD mode** — the model gets real tools (read/write files, run shell commands, browse the web with a real Chromium window) to actually get work done, with a permission popup before every risky action.

### Provider routing

- **30+ providers** wired in out of the box — OpenAI, Anthropic, Gemini, Groq, OpenRouter, Cerebras, NVIDIA NIM, Cloudflare Workers AI, Mistral, Cohere, DeepSeek, xAI, Perplexity, Together, Replicate, HuggingFace, and several keyless free providers (Pollinations, Kilo, OVH, OpenCode Zen) — plus local models via Ollama and llama.cpp.
- **Three routing classes**: *Cerebro* (paid models, only used when you explicitly pick them), *Trabalhador* (free tiers, used by default), *Local* (on-device, for private or offline work).
- **Automatic fallback** — if a model is rate-limited or errors out mid-response, the chain moves to the next one without losing what was already done (tool calls already executed are summarized for the next model, not thrown away).
- **Exponential backoff + history-aware ordering** — a model that just failed is deprioritized for a while, even after its own cooldown ends.
- **Live status** — a persistent "still working" / "switching model" indicator, separate from the answer text, so a retry or a long tool call never looks like the app froze.

### Real tools (BUILD mode)

- Filesystem: read/write/list/delete files, search content, list code symbols.
- Shell: run bash commands.
- Office documents: generate real `.xlsx`, `.docx`, `.pptx`, and PDF files.
- Browser automation: a real, visible Chromium window with a persistent session (stays logged in across uses).
- Every action outside your own explicit instructions (a web page, a file's content, a tool result) is fenced off from being treated as a command — a page can't trick the model into "forgetting" your instructions.

### Connectors

First-party: GitHub, Google Drive, Gmail, WordPress, LinkedIn, Canva, n8n, Magnific, Photoshop, Premiere, InDesign, Illustrator.

Bring your own: a generic custom MCP server panel — point it at any local MCP server (stdio or HTTP), the same config shape as Claude Desktop / Cursor use, so you can reuse a server you already have configured elsewhere.

### Memory & skills

- Automatic memory — the app learns durable facts about you and your projects across conversations, without you asking it to.
- Skills — teach it a reusable procedure once, invoke it by name later.
- Web search — decided by a small free model (not a keyword list), reranked by embeddings, with source citations.

### Privacy

- Single-user, local-first — no account, no JWT, nothing leaves your machine except the API calls you explicitly make to the provider you chose.
- API keys are stored locally, never sent anywhere but the provider they belong to.
- A "Local" routing class exists specifically for anything you don't want leaving your computer at all.

## Development

```bash
git clone https://github.com/daazlabs/nexus-desktop.git
cd nexus-desktop
npm install
npm run dev          # renderer + Electron, with hot reload
```

Build a production package for your current OS:

```bash
npm run dist          # builds renderer + main, then packages with electron-builder
```

## Contributing

Bug reports, feature requests, and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up a dev environment and what a good PR looks like.

## License

[MIT](LICENSE) — do whatever you want with it, just keep the copyright notice.

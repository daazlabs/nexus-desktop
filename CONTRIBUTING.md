# Contributing to DaazNexus Desktop

Thanks for considering it — bug reports, feature requests, and pull requests are all welcome.

## Reporting a bug

Open an issue with:
- What you did, what you expected, what happened instead.
- Your OS and app version (Settings → About, or the installer filename).
- Console logs if you have them (Help → Toggle Developer Tools → Console).

## Suggesting a feature

Open an issue describing the problem you're trying to solve, not just the feature — it's easier to evaluate "I want to do X and can't" than "add button Y".

## Development setup

```bash
git clone https://github.com/daazlabs/nexus-desktop.git
cd nexus-desktop
npm install
npm run dev
```

This starts the renderer (Vite, hot reload) and the Electron main process together. Main-process changes (`src/main/**`) require a restart (`npm run dev` again); renderer changes (`src/renderer/**`) hot-reload.

### Project layout

```
src/
├── main/           Electron main process (Node.js)
│   ├── ipc/        IPC handlers — the bridge the renderer calls into
│   ├── services/    Provider routing, connectors, memory, web search
│   └── tools/       Native tools exposed to the model (bash, filesystem, office docs)
└── renderer/        React + Vite UI (its own package.json)
```

The same provider-routing logic (`src/main/services/fallbackChain.ts`, `catalog.ts`) is a TypeScript port of the Python backend that powers chat.daazlabs.com — when fixing a bug or adding a provider, check whether the equivalent fix belongs on both sides.

## Before opening a PR

- `npm run build:main` and `npm run build:renderer` should both pass with no TypeScript errors.
- Keep changes focused — one bug fix or one feature per PR is much easier to review than a bundle of unrelated changes.
- If you're adding a new tool the model can call, remember it needs to go through the permission system (`src/main/ipc/permissions.ts`) if it touches the filesystem, shell, or anything else irreversible — nothing risky should execute without the user confirming first.
- If you're adding a new LLM provider, add it to `src/main/services/catalog.ts`; if you know the equivalent belongs in the web backend too, flag that in the PR description even if you don't have access to make that change yourself.

## Code style

There's no linter enforced yet — match the style of the file you're editing (this codebase favors small, well-commented functions with the *why* explained inline, not just the *what*).

## License

By contributing, you agree your contribution is licensed under the project's [MIT license](LICENSE).

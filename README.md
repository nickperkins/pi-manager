# Pi Manager

A desktop app for managing multiple [pi](https://github.com/mariozechner/pi-coding-agent) agentic coding sessions. Each session runs in its own isolated process, streaming conversation history, tool calls, and status in real time.

![Pi Manager screenshot](docs/screenshot.png)

> **Status:** Early development — M1 Foundation milestone in progress.

---

## Features

- **Multiple sessions** — run several pi sessions side by side, switch between them instantly
- **Streaming conversation view** — see messages, thinking blocks, and tool calls as they arrive
- **Session lifecycle** — create, close, reopen, and delete sessions; archived sessions show their full history without needing to restart
- **Session browser** — discover and open existing pi session files from disk
- **Monitoring** — token counts, cost, context window usage, compaction and retry status
- **Offline history** — click any archived session to read its conversation without spinning up a host process
- **App icon & About panel** — native macOS About dialog via the ⓘ button in the sidebar

---

## Requirements

- **macOS** (arm64) — Windows and Linux support is planned but not yet built or tested
- **Node.js** 18 or later
- **[pi](https://github.com/mariozechner/pi-coding-agent)** configured with at least one model and API key (`~/.pi/agent/auth.json`)

---

## Getting started

```bash
# Install dependencies
npm install

# Start in development mode (hot reload)
npm run dev
```

On first launch, pi Manager reads your pi configuration from `~/.pi/agent/` (or `$PI_CODING_AGENT_DIR` if set). You'll need API keys configured for at least one provider before sessions will run.

---

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with Electron hot reload |
| `npm run build` | Production build |
| `npm run dist` | Build and package as a `.dmg` (macOS arm64) |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | TypeScript type check |
| `npm start` | Preview the production build |

---

## Architecture

Pi Manager is a three-process Electron app:

```
┌─────────────────────────────────────┐
│ Main Process                        │
│  Supervisor — spawns/tracks hosts   │
│  IPC bridge — renderer ↔ main       │
│  Session store — disk persistence   │
└──────────┬──────────────────────────┘
           │ parentPort.postMessage
           ▼
┌──────────────────────────┐    ┌──────────────────┐
│ Session Host             │    │ Renderer (React) │
│ (Electron utilityProcess)│    │                  │
│  Wraps AgentSession SDK  │    │  Sidebar         │
│  Dispatches commands     │◄───│  SessionView     │
│  Forwards events         │    │  PromptInput     │
└──────────────────────────┘    └──────────────────┘
```

Each pi session runs in its own `utilityProcess` — a crash in one session cannot take down the app or other sessions. The renderer communicates through a `contextBridge` API; `nodeIntegration` is disabled.

Session files (JSONL) live on disk at `~/.pi/agent/sessions/`. Pi Manager reads them directly for offline history display, without needing a running host.

For full details see [`docs/architecture.md`](docs/architecture.md).

---

## Development

### Prerequisites

```bash
node --version  # 18+
npm --version   # 9+
```

### Project layout

```
src/
├── main/       # Electron main process (CJS)
├── preload/    # contextBridge API surface
├── host/       # Session host (ESM — runs in utilityProcess)
├── renderer/   # React UI
└── shared/     # Types shared across all processes
tests/
└── unit/       # Vitest unit tests (mirrors src/ structure)
docs/           # Architecture, plans, roadmap
resources/      # App icon assets
```

### Running tests

```bash
npm test                    # All unit tests
npm run test:watch          # Watch mode
npm run typecheck           # TypeScript only
```

### Building for distribution

```bash
npm run dist                # macOS arm64 DMG → dist/
```

Cross-platform builds (Windows, Linux) require the appropriate CI runners. See [`electron-builder.yml`](electron-builder.yml) for the build configuration.

---

## Contributing

Issues and pull requests are welcome. Please read [`AGENTS.md`](AGENTS.md) for coding conventions, architecture decisions, and the task-with-tests contract before contributing.

---

## License

[MIT](LICENSE) — © 2026 Nick Perkins

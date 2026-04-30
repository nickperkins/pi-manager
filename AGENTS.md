# AGENTS.md — Pi Manager

This file describes the coding conventions, architecture, and rules for anyone (human or AI agent) working on this codebase.

## Project Overview

**Pi Manager** is a desktop Electron app for managing multiple [pi](https://github.com/nickperkins/pi-coding-agent) agentic coding sessions. Each session runs in its own Electron `utilityProcess` hosting the `@mariozechner/pi-coding-agent` SDK. The app is built with React + TypeScript, bundled via `electron-vite`.

## Documentation

- **`docs/architecture.md`** — architecture reference: process model, vocabulary, session lifecycle, data flow, build config, module formats, risks. Read this before making structural changes.
- **`docs/plan/roadmap.md`** — current milestone, active phase, development status.
- **`.pi/skills/plan-manager/SKILL.md`** — templates and rules for authoring phase plans and task files (including the task-with-tests contract).

## Commands

```bash
npm run dev            # Start dev server (Electron + React hot reload)
npm run build          # Production build (host + electron-vite)
npm run build:host     # Build the session host utilityProcess bundle only
npm run test           # Run unit tests (vitest)
npm run test:watch     # Run tests in watch mode
npm run typecheck      # TypeScript type checking (tsc -b)
npm run test:host      # End-to-end host smoke test (requires built host + API keys)
npm run start          # Preview production build
```

## Architecture

Three-process Electron app with a fourth auxiliary process:

```
┌──────────────────────────────────────────────────┐
│ Main Process (src/main/)                         │
│  - Supervisor: spawns/kills/tracks hosts         │
│  - IPC handlers: renderer ↔ main bridge          │
│  - Manager session store (disk persistence)      │
└────────┬─────────────────────┬───────────────────┘
         │ ipcMain/ipcRenderer │ parentPort.postMessage
         ▼                     ▼
┌──────────────────┐  ┌──────────────────────────────┐
│ Renderer (React) │  │ Session Host (utilityProcess) │
│  src/renderer/   │  │  src/host/                    │
│  - Sidebar       │  │  - Wraps AgentSession SDK     │
│  - SessionView   │  │  - Dispatches commands         │
│  - PromptInput   │  │  - Forwards events             │
└──────────────────┘  │  - Extension UI bridge         │
                      └──────────────────────────────┘
         ▲
         │ contextBridge
┌──────────────────┐
│ Preload          │
│  src/preload/    │
│  - window.api    │
└──────────────────┘
```

### Key Design Decisions

- **SDK-in-utilityProcess** (not spawning `pi` binary): crash isolation, type safety via shared TS types, no PATH discovery issues, direct SDK API access for extensions.
- **Host bundle is ESM** (`.mjs`): required because `@mariozechner/pi-coding-agent` is ESM-only.
- **Host is a separate build target**: not one of electron-vite's three standard targets. Built via `vite build --config vite.host.config.mts` → `out/host/index.mjs`.
- **Security**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on BrowserWindow.

See `docs/architecture.md` for the full rationale table, data flow diagram, and module format details.

## Source Layout

```
src/
├── shared/           # Imported by main, host, and renderer
│   ├── protocol.ts   # HostInit, HostCommand, HostResponse, HostEvent (host ↔ supervisor)
│   ├── ipc-protocol.ts # IPC channel name constants (renderer ↔ main)
│   └── types.ts      # ManagerSessionRecord, SessionStatus, persisted types
├── main/             # Electron main process
│   └── index.ts      # App entry, window creation
├── preload/          # Context bridge (exposes window.api)
│   └── index.ts
├── host/             # Session host (utilityProcess entry point)
│   ├── index.ts      # Composition root — init, runtime setup, command loop
│   ├── dispatch.ts   # Pure command dispatch (no globals, fully testable)
│   ├── event-forwarder.ts # Subscribe to AgentSession events → post to supervisor
│   └── ui-bridge.ts  # ExtensionUIContext implementation (extension UI → main process)
└── renderer/         # React UI
    ├── App.tsx
    ├── main.tsx
    └── index.html
```

## Coding Conventions

### TypeScript

- Strict mode enabled. All code is TypeScript.
- Path aliases: `@shared/` → `src/shared/`.
- Prefer explicit return types on exported functions.
- Use `type` for type aliases, `interface` for objects that may be extended.

### File Naming

Two rules, no exceptions:

- **React component files** → PascalCase (`SessionItem.tsx`, `NewSessionDialog.tsx`). The filename matches the exported component name.
- **Everything else** → kebab-case (`use-manager-sessions.ts`, `session-view.ts`, `ipc-protocol.ts`, `event-forwarder.ts`).

This applies to hooks, utilities, shared types, host modules, test files — everything that is not a React component. Test files mirror their source file name (`use-manager-sessions.test.ts`, `App.test.tsx`).

### Dependency Injection

All logic in `src/host/` must be dependency-injected, not hardwired to globals:

- **`dispatch.ts`** — pure function: `(cmd, session, runtime, handleUiResponse, onBackgroundError?)` → `HostResponse | null`. No globals.
- **`event-forwarder.ts`** — `post` function is a parameter, not `process.parentPort`.
- **`ui-bridge.ts`** — `post` function is a parameter.
- **`index.ts`** (host) — composition root only. No logic worth testing lives here.

This convention enables unit testing without Electron, without process spawning, without any runtime dependencies.

### Shared Protocol Types

All cross-process messages are defined in `src/shared/`:

| File | Direction | Purpose |
|---|---|---|
| `protocol.ts` | supervisor ↔ host | `HostInit`, `HostCommand`, `HostResponse`, `HostEvent` |
| `ipc-protocol.ts` | renderer ↔ main | IPC channel name constants (`IPC.*`) |
| `types.ts` | everywhere | `ManagerSessionRecord`, `SessionStatus`, `PersistedManagerSession` |

When adding a new cross-process message, add the type to the appropriate file in `src/shared/` first.

### Session Status State Machine

Statuses are derived (never persisted):

```
spawning → idle ↔ streaming
               ↔ compacting
               ↔ retrying
         → errored (recoverable)
         → stopped (clean exit)
         → archived (host killed, sessionFile on disk)
```

### Error Handling in Host

- `uncaughtException` and `unhandledRejection` handlers post `host_error` with `fatal: true` and exit.
- Background errors (e.g., rejected prompt) post `host_error` with `fatal: false` via `reportNonFatal`.
- `dispatchCommand` fire-and-starts `session.prompt()` with a `.catch()` to avoid unhandled rejections.

### Event Serialization

`event-forwarder.ts` applies a `JSON.parse(JSON.stringify(...))` round-trip on all `AgentSessionEvent` payloads before posting. This is a safety net against non-serializable values (class instances, functions, Symbols) that could fail structured clone across the MessagePort boundary.

## Testing

- **Framework**: Vitest (`vitest.config.ts` at project root).
- **Unit tests**: `tests/unit/` — mirrors `src/` structure. Host logic, main-process modules, renderer hooks and components all have unit tests.
- **E2E host test**: `scripts/test-host.ts` — runs the full host in a `utilityProcess`, sends a prompt, asserts `agent_end`. Run via `npm run test:host` (requires API keys in `~/.pi/agent/auth.json`).
- **Test philosophy**: all host logic is pure/DI, so unit tests mock dependencies directly. No need for Electron in unit tests.
- **Task contract**: every task in a phase `tasks.md` must have a `Tests` section. No task is done until its tests are written and passing. See `.pi/skills/plan-manager/SKILL.md` for the full contract.

## Build Details

| Build | Config | Output |
|---|---|---|
| Main process | `electron.vite.config.ts` (main target) | `out/main/` |
| Preload | `electron.vite.config.ts` (preload target) | `out/preload/` |
| Renderer | `electron.vite.config.ts` (renderer target) | `out/renderer/` |
| Session host | `vite.host.config.mts` | `out/host/index.mjs` |

The host uses `externalizeDepsPlugin()` to keep `@mariozechner/pi-coding-agent` as a runtime import (not bundled). **ESM-only dependencies belong in the host only** — importing them from `src/main/` or `src/preload/` will break the CJS build.

See `docs/architecture.md` for the full module format explanation and CJS/ESM boundary rules.

## Vocabulary

These terms are used precisely in code, docs, and conversation:

- **Agent session** — pi's concept. A JSONL file on disk. Identified by `sessionId` and `sessionFile`.
- **Session host** — the `utilityProcess` running one `AgentSession`. Has an OS PID.
- **Manager session** — pi-manager's UI record. Has a `managerSessionId` (UUID), display name, cwd, optional bound `sessionFile` and host.
- **Status** — derived field on the manager session (see state machine above).

See `docs/architecture.md` for the full vocabulary, session lifecycle operations table, and status state machine.


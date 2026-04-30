# Pi Manager — Architecture

Stable technical reference for Pi Manager. Covers architecture rationale, vocabulary, data flow, build configuration, and open risks.

For current development state see `docs/plan/roadmap.md`.
For coding conventions see `AGENTS.md`.

---

## Process Architecture

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

---

## Why SDK-in-utilityProcess

The session host imports `@mariozechner/pi-coding-agent` directly rather than spawning a `pi` binary subprocess.

| Concern | Result |
|---|---|
| Crash isolation | Preserved — child death does not take down Electron |
| `pi` binary PATH discovery (esp. macOS GUI apps) | Eliminated — bundled as dep |
| JSONL framing pitfalls (U+2028 etc.) | Eliminated — `MessagePort` structured clone |
| Type safety end-to-end | Yes — shared TS types between main, host, renderer |
| Custom tools / extensions injected by pi-manager | Possible — direct SDK API |
| Extension UI dialogs (`select`/`confirm`/`input`) | Direct binding, no JSON sub-protocol |
| Native module ABI | **Risk** — must rebuild against Electron's Node ABI if pi pulls in any native deps. Verified in Phase 1. |
| Pi version drift | We pin and upgrade deliberately |

If a native-module problem turns out to be intractable, falling back to spawning `pi --mode rpc` is straightforward because the internal protocol mirrors the RPC vocabulary.

---

## Vocabulary

These terms are used precisely in code, docs, and conversation.

- **Agent session** — pi's concept. A JSONL file on disk under `~/.pi/agent/sessions/<project>/<id>.jsonl` containing the conversation tree. Identified by `sessionId` (string in the JSONL header) and `sessionFile` (absolute path).
- **Session host** — the OS process (`utilityProcess`) running one `AgentSession` instance. Has an OS PID.
- **Manager session** — pi-manager's UI record. Has a `managerSessionId` (UUID, stable across restarts), a display name, a cwd, an optional bound `sessionFile`, and an optional bound session host. This is what the user sees as a row in the sidebar.
- **Status** — derived field on the manager session (never persisted). See state machine below.

### Session Status State Machine

Statuses are derived, never persisted:

```
spawning → idle ↔ streaming
               ↔ compacting
               ↔ retrying
         → errored (recoverable)
         → stopped (clean exit)
         → archived (host killed, sessionFile on disk)
```

### Session Lifecycle Operations

These are the only ways a manager session changes state. Each maps to one explicit user action:

| Operation | Effect |
|---|---|
| **Create** | New manager session (new UUID, name, cwd). Spawn host. Host creates fresh JSONL. Status: `spawning` → `idle`. |
| **Open** | New manager session bound to an existing `sessionFile`. Spawn host. Host calls `SessionManager.open(path)`. Status: `spawning` → `idle`. |
| **Close** | Terminate the host (SIGTERM, then SIGKILL after grace). Session moves to `archived` if `sessionFile` exists, else removed. |
| **Reopen** | Archived manager session: spawn a new host bound to its `sessionFile`. |
| **Delete** | Remove the manager session record. Optionally delete the `sessionFile` (separate confirmation). |
| **Fork** | Inside a host: call `runtime.fork(entryId)`. The host's `sessionFile` changes; manager session record updates. |
| **New (in-place)** | Inside a host: call `runtime.newSession()`. Host stays alive, `sessionFile` changes. |

There is no implicit "resume on app start" behaviour. The app starts with all manager sessions in `archived` state.

---

## Source Layout

```
src/
├── shared/                    # Imported by main, host, and renderer
│   ├── protocol.ts            # HostInit, HostCommand, HostResponse, HostEvent (host ↔ supervisor)
│   ├── ipc-protocol.ts        # IPC channel name constants (renderer ↔ main)
│   └── types.ts               # ManagerSessionRecord, SessionStatus, persisted types
├── main/                      # Electron main process
│   ├── index.ts               # App entry, window creation, IPC registration
│   ├── supervisor.ts          # Spawn/track/kill session hosts; ring buffer
│   ├── manager-session-store.ts # Persists ManagerSessionRecord to disk
│   ├── ipc.ts                 # ipcMain handlers: renderer ↔ main bridge
│   └── session-browser.ts     # SDK SessionManager.list() (read-only)
├── preload/                   # Context bridge (exposes window.api)
│   └── index.ts
├── host/                      # Session host (utilityProcess entry point)
│   ├── index.ts               # Composition root — init, runtime setup, command loop
│   ├── dispatch.ts            # Pure command dispatch (no globals, fully testable)
│   ├── event-forwarder.ts     # Subscribe to AgentSession events → post to supervisor
│   └── ui-bridge.ts           # ExtensionUIContext implementation (extension UI → main process)
└── renderer/                  # React UI
    ├── App.tsx
    ├── main.tsx
    ├── index.html
    ├── components/            # React components (PascalCase filenames)
    ├── hooks/                 # React hooks (kebab-case filenames)
    └── utils/                 # Pure utilities (kebab-case filenames)
```

---

## Build Details

| Build | Config | Output |
|---|---|---|
| Main process | `electron.vite.config.ts` (main target) | `out/main/` |
| Preload | `electron.vite.config.ts` (preload target) | `out/preload/` |
| Renderer | `electron.vite.config.ts` (renderer target) | `out/renderer/` |
| Session host | `vite.host.config.mts` | `out/host/index.mjs` |

### Module Formats

| Build | Format | Why |
|---|---|---|
| Main process | CJS (`require`) | electron-vite default; Electron main process works best as CJS |
| Preload | CJS (`require`) | Same — runs in a Node context |
| Session host | ESM (`.mjs`) | `@mariozechner/pi-coding-agent` is ESM-only; must match |
| Renderer | ESM (Vite bundle) | Browser context — irrelevant at runtime |

**The CJS/ESM boundary never crosses a module import at runtime.** The main process (CJS) does not `require()` or `import()` the host. It passes a file path string to `utilityProcess.fork()`, which spawns a new process. Node loads `out/host/index.mjs` as native ESM because of the `.mjs` extension. Communication is via `MessagePort` only.

**`src/shared/` has no runtime format issue.** Although shared code is imported by both CJS (main) and ESM (host) sources, each build target bundles its own copy at compile time. There is no cross-format import at runtime.

**ESM-only dependencies belong in the host, not in main or preload.** If you add a package that is ESM-only (no CJS export), it must only be imported from `src/host/`. Importing it from `src/main/` or `src/preload/` will break the CJS build.

### Vite / electron-vite Setup

Using **`electron-vite`** (the framework, not `vite-plugin-electron`). It handles all three standard Electron targets (main, preload, renderer). The session host is a **separate build target** — it must be ESM and cannot share electron-vite's CJS output.

- `externalizeDepsPlugin()` in main and preload keeps npm deps as `require()` calls (not inlined). Required for native modules and `@mariozechner/pi-coding-agent`.
- The renderer does NOT use `externalizeDepsPlugin()` — it bundles normally.
- `BrowserWindow` must use: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a `preload` script.
- `electron-builder.yml` `files` must include `out/**/*` plus `node_modules/@mariozechner/pi-coding-agent/**` and any other runtime deps.

---

## Data Flow

```
User types prompt
  └─ PromptInput
       window.api.session.command(id, { type: "prompt", message })
  └─ preload (contextBridge)
       ipcRenderer.invoke("session:command", id, cmd)
  └─ main/ipc.ts
       supervisor.sendCommand(id, cmd)
  └─ main/supervisor.ts
       child.postMessage(cmd)              ── via MessagePort
  └─ host/index.ts (utilityProcess)
       session.prompt(message)
            │
            └─ AgentSession emits events
                 host posts { type: "agent_event", event } back
  └─ main/supervisor.ts
       ring-buffer.push(event)
       emit("event", id, event)
  └─ main/ipc.ts
       webContents.send("session:event", id, event)
  └─ preload → window.api.session.onEvent(cb)
  └─ useSession hook updates state
  └─ SessionView re-renders
```

---

## Key Dependencies

| Package | Purpose |
|---|---|
| `@mariozechner/pi-coding-agent` | The pi SDK — provides `AgentSession`, `SessionManager`, `createAgentSessionRuntime`, etc. |
| `electron` | Desktop shell |
| `electron-vite` | Build tooling for Electron (main + preload + renderer) |
| `react` / `react-dom` | UI framework |
| `vitest` | Test runner |

---

## Open Questions and Risks

1. **Native modules in pi's dep tree.** Phase 1 audit decides whether `utilityProcess` is viable. If not, fall back to `pi --mode rpc` subprocesses; protocol shape is similar enough that supervisor + UI changes are localised. *(Verified clean in Phase 1.)*
2. **`AgentSessionEvent` serializability.** `MessagePort` uses structured clone, which handles plain objects but not class instances or functions. JSON round-trip applied in `event-forwarder.ts` as a safety net. *(Audited in Phase 2a.)*
3. **Memory.** Each host ≈ 150–300 MB. Soft cap of 8 concurrent hosts planned for Phase 7.
4. **Multi-window.** Plan assumes one `BrowserWindow`. Supervisor's event emitter is per-process, so a second window later requires broadcasting to all `webContents`. A broadcaster abstraction is in place from day one — do not hardcode `mainWindow.webContents.send`.
5. **No-keys UX.** If `~/.pi/agent/auth.json` is empty and no env vars, every prompt fails. Banner planned for Phase 7.

import { ipcMain, BrowserWindow, dialog, app } from "electron";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { IPC } from "@shared/ipc-protocol";
import type {
  ManagerSessionRecord,
  PersistedManagerSession,
  PersistedStats,
} from "@shared/types";
import type { HostCommand, HostEvent } from "@shared/protocol";
import type { Supervisor } from "./supervisor";
import type { ManagerSessionStore } from "./manager-session-store";
import type { SessionHistoryReader } from "./session-history-reader";
import type { SessionBrowser } from "./session-browser";

// ---------------------------------------------------------------------------
// Attach map: managerSessionId → Set of attached WebContents
// ---------------------------------------------------------------------------

const attachedRenderers = new Map<string, Set<Electron.WebContents>>();

function getOrCreateAttachSet(id: string): Set<Electron.WebContents> {
  if (!attachedRenderers.has(id)) attachedRenderers.set(id, new Set());
  return attachedRenderers.get(id)!;
}

function cleanAttachSet(id: string): void {
  const set = attachedRenderers.get(id);
  if (set && set.size === 0) {
    attachedRenderers.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface IpcDeps {
  sv: Supervisor;
  store: ManagerSessionStore;
  broadcast: (channel: string, ...args: unknown[]) => void;
  agentDir: string;
  historyReader: SessionHistoryReader;
  browser: SessionBrowser;
}

export function register({ sv, store, broadcast, agentDir, historyReader, browser }: IpcDeps): void {
  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function buildManagerList(): ManagerSessionRecord[] {
    return store.load().map((p) => {
      const liveStatus = sv.getStatus(p.managerSessionId);
      const liveInfo = sv.getLiveInfo(p.managerSessionId);
      const status = liveStatus ?? (p.sessionFile ? "archived" : "stopped");
      return {
        managerSessionId: p.managerSessionId,
        name: liveInfo?.sessionName ?? p.name,
        cwd: p.cwd,
        sessionFile: liveInfo?.sessionFile ?? p.sessionFile,
        createdAt: p.createdAt,
        status,
        errorMessage: sv.getErrorMessage(p.managerSessionId),
        lastStats: p.lastStats,
      };
    });
  }

  function broadcastManagerList(): void {
    broadcast(IPC.MANAGER_LIST_CHANGED, buildManagerList());
  }

  // -----------------------------------------------------------------------
  // Supervisor event forwarding
  // -----------------------------------------------------------------------

  sv.on("statusChanged", () => broadcastManagerList());
  sv.on("nameChanged", () => broadcastManagerList());

  sv.on("hostEvent", (managerSessionId: string, event: HostEvent) => {
    if (event.type === "agent_event") {
      const set = attachedRenderers.get(managerSessionId);
      if (set) {
        for (const wc of set) {
          if (!wc.isDestroyed()) {
            wc.send(IPC.SESSION_EVENT, managerSessionId, event.event);
          }
        }
      }
    }
    // extension_ui_request and other host events can be forwarded here in Phase 4.5
  });

  // -----------------------------------------------------------------------
  // manager:list
  // -----------------------------------------------------------------------

  ipcMain.handle(IPC.MANAGER_LIST, () => {
    return buildManagerList();
  });

  // -----------------------------------------------------------------------
  // manager:create
  // -----------------------------------------------------------------------

  ipcMain.handle(
    IPC.MANAGER_CREATE,
    (_e, opts: { cwd: string; name?: string }) => {
      const managerSessionId = randomUUID();
      const name = opts.name ?? `Session ${new Date().toLocaleTimeString()}`;
      const now = new Date().toISOString();

      const persisted: PersistedManagerSession = {
        managerSessionId,
        name,
        cwd: opts.cwd,
        createdAt: now,
      };
      store.upsert(persisted);

      sv.create({
        managerSessionId,
        cwd: opts.cwd,
        agentDir,
        sessionMode: { kind: "new" },
        initialName: name,
      });

      broadcastManagerList();
      return managerSessionId;
    },
  );

  // -----------------------------------------------------------------------
  // manager:open
  // -----------------------------------------------------------------------

  ipcMain.handle(
    IPC.MANAGER_OPEN,
    (_e, opts: { sessionFile: string; cwd: string; name?: string }) => {
      const managerSessionId = randomUUID();
      const name = opts.name ?? `Resumed ${new Date().toLocaleTimeString()}`;
      const now = new Date().toISOString();

      const persisted: PersistedManagerSession = {
        managerSessionId,
        name,
        cwd: opts.cwd,
        sessionFile: opts.sessionFile,
        createdAt: now,
      };
      store.upsert(persisted);

      sv.create({
        managerSessionId,
        cwd: opts.cwd,
        agentDir,
        sessionMode: { kind: "open", sessionFile: opts.sessionFile },
        initialName: name,
      });

      broadcastManagerList();
      return managerSessionId;
    },
  );

  // -----------------------------------------------------------------------
  // manager:close
  // -----------------------------------------------------------------------

  ipcMain.handle(
    IPC.MANAGER_CLOSE,
    async (_e, opts: { managerSessionId: string }) => {
      const { managerSessionId } = opts;
      const liveInfo = sv.getLiveInfo(managerSessionId);
      const liveStatus = sv.getStatus(managerSessionId);

      // Fetch stats from the running host before closing (best-effort)
      const terminalStatuses: ReadonlySet<string> = new Set(["stopped", "archived", "errored"]);
      if (liveStatus && !terminalStatuses.has(liveStatus)) {
        try {
          const resp = await sv.sendCommand(managerSessionId, {
            type: "get_session_stats",
            id: randomUUID(),
          });
          if (resp.success && resp.data) {
            const stats = (resp.data as { stats?: PersistedStats }).stats;
            if (stats) {
              const persisted = store
                .load()
                .find((s) => s.managerSessionId === managerSessionId);
              if (persisted) {
                store.upsert({ ...persisted, lastStats: stats });
              }
            }
          }
        } catch {
          // ignore — stats are best-effort
        }
      }

      await sv.close(managerSessionId);

      // Persist the sessionFile returned by the host (may be set after host_ready)
      if (liveInfo?.sessionFile) {
        const persisted = store
          .load()
          .find((s) => s.managerSessionId === managerSessionId);
        if (persisted && !persisted.sessionFile) {
          store.upsert({ ...persisted, sessionFile: liveInfo.sessionFile });
        }
      }

      broadcastManagerList();
    },
  );

  // -----------------------------------------------------------------------
  // manager:reopen
  // -----------------------------------------------------------------------

  ipcMain.handle(
    IPC.MANAGER_REOPEN,
    async (_e, opts: { managerSessionId: string }) => {
      const { managerSessionId } = opts;
      const persisted = store
        .load()
        .find((s) => s.managerSessionId === managerSessionId);
      if (!persisted) throw new Error(`Session not found: ${managerSessionId}`);

      // Close any existing live host first to prevent orphaning
      await sv.close(managerSessionId);

      sv.create({
        managerSessionId,
        cwd: persisted.cwd,
        agentDir,
        sessionMode: persisted.sessionFile
          ? { kind: "open", sessionFile: persisted.sessionFile }
          : { kind: "new" },
        initialName: persisted.name,
      });

      broadcastManagerList();
    },
  );

  // -----------------------------------------------------------------------
  // manager:delete
  // -----------------------------------------------------------------------

  ipcMain.handle(
    IPC.MANAGER_DELETE,
    async (_e, opts: { managerSessionId: string; deleteFile?: boolean }) => {
      const { managerSessionId, deleteFile } = opts;

      // Stop the host if it's running
      await sv.close(managerSessionId);

      if (deleteFile) {
        const persisted = store
          .load()
          .find((s) => s.managerSessionId === managerSessionId);
        if (persisted?.sessionFile) {
          try {
            unlinkSync(persisted.sessionFile);
          } catch (err) {
            console.warn("[ipc] Failed to delete session file:", err);
          }
        }
      }

      store.remove(managerSessionId);

      // Clean up any empty attach sets
      const set = attachedRenderers.get(managerSessionId);
      if (set) {
        for (const wc of set) {
          if (!wc.isDestroyed()) {
            // Detach gracefully — no more events will arrive
          }
        }
        attachedRenderers.delete(managerSessionId);
      }

      broadcastManagerList();
    },
  );

  // -----------------------------------------------------------------------
  // session:command
  // -----------------------------------------------------------------------

  ipcMain.handle(
    IPC.SESSION_COMMAND,
    (_e, opts: { managerSessionId: string; cmd: HostCommand }) => {
      return sv.sendCommand(opts.managerSessionId, opts.cmd);
    },
  );

  // -----------------------------------------------------------------------
  // session:readHistory
  // -----------------------------------------------------------------------

  ipcMain.handle(
    IPC.SESSION_READ_HISTORY,
    async (_e, opts: { sessionFile: string }) => {
      // Validate path is under the agent sessions directory to prevent traversal
      const sessionsRoot = resolve(agentDir, "sessions");
      const resolved = resolve(opts.sessionFile);
      if (!resolved.startsWith(sessionsRoot + sep) && resolved !== sessionsRoot) {
        return [];
      }
      return historyReader.readHistory(opts.sessionFile);
    },
  );

  // -----------------------------------------------------------------------
  // sessions:browse
  // -----------------------------------------------------------------------

  ipcMain.handle(IPC.SESSIONS_BROWSE, async () => {
    return browser.browse(agentDir);
  });

  // -----------------------------------------------------------------------
  // session:attach
  // -----------------------------------------------------------------------

  ipcMain.handle(
    IPC.SESSION_ATTACH,
    (event, opts: { managerSessionId: string }) => {
      const { managerSessionId } = opts;
      const wc = event.sender;

      // Track the renderer
      getOrCreateAttachSet(managerSessionId).add(wc);

      // Remove from set when renderer navigates away or is destroyed
      wc.once("destroyed", () => {
        attachedRenderers.get(managerSessionId)?.delete(wc);
        cleanAttachSet(managerSessionId);
      });

      // Return ring buffer for replay
      const events: AgentSessionEvent[] = sv.getRingBuffer(managerSessionId);
      return { events };
    },
  );

  // -----------------------------------------------------------------------
  // dialog:pickFolder
  // -----------------------------------------------------------------------

  ipcMain.handle(IPC.DIALOG_PICK_FOLDER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose session working directory",
    };
    const result = await (win != null
      ? dialog.showOpenDialog(win, opts)
      : dialog.showOpenDialog(opts));
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // -----------------------------------------------------------------------
  // dialog:showAbout
  // -----------------------------------------------------------------------

  ipcMain.handle(IPC.DIALOG_SHOW_ABOUT, () => {
    try {
      app.showAboutPanel();
    } catch (err) {
      // showAboutPanel() may be a no-op or throw on non-macOS platforms
      console.warn("[ipc] showAboutPanel failed:", err);
    }
  });

  // -----------------------------------------------------------------------
  // session:detach
  // -----------------------------------------------------------------------

  ipcMain.handle(
    IPC.SESSION_DETACH,
    (event, opts: { managerSessionId: string }) => {
      const set = attachedRenderers.get(opts.managerSessionId);
      if (set) {
        set.delete(event.sender);
        cleanAttachSet(opts.managerSessionId);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Broadcast helper for use in index.ts
// ---------------------------------------------------------------------------

export function broadcastToAllWindows(
  channel: string,
  ...args: unknown[]
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

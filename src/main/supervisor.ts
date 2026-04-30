import { utilityProcess } from "electron";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { HostInit, HostCommand, HostResponse, HostEvent } from "@shared/protocol";
import type { SessionStatus } from "@shared/types";

const RING_BUFFER_SIZE = 500;

/** Terminal statuses — host is no longer running. */
const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "stopped",
  "archived",
  "errored",
]);

type ForkFn = (
  path: string,
  args: string[],
  opts: { serviceName: string },
) => Electron.UtilityProcess;

interface HostEntry {
  managerSessionId: string;
  child: Electron.UtilityProcess;
  status: SessionStatus;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  errorMessage?: string;
  pendingCommands: Map<string, (response: HostResponse) => void>;
  ringBuffer: AgentSessionEvent[];
}

export class Supervisor extends EventEmitter {
  private entries = new Map<string, HostEntry>();

  /**
   * @param hostPath  Absolute path to the host bundle (out/host/index.mjs).
   * @param spawnHost Fork function — injected so tests never spawn real processes.
   */
  constructor(
    private readonly hostPath: string,
    private readonly spawnHost: ForkFn,
  ) {
    super();
  }

  // -----------------------------------------------------------------------
  // Spawn
  // -----------------------------------------------------------------------

  create(opts: {
    managerSessionId: string;
    cwd: string;
    agentDir: string;
    sessionMode: HostInit["sessionMode"];
    initialName?: string;
  }): void {
    const { managerSessionId, cwd, agentDir, sessionMode, initialName } = opts;

    // Guard: prevent orphaning an existing live host
    if (this.entries.has(managerSessionId)) {
      throw new Error(
        `Host already running for session ${managerSessionId} — close it first`,
      );
    }

    const child = this.spawnHost(this.hostPath, [], {
      serviceName: `pi-host-${managerSessionId.slice(0, 8)}`,
    });

    const entry: HostEntry = {
      managerSessionId,
      child,
      status: "spawning",
      pendingCommands: new Map(),
      ringBuffer: [],
    };
    this.entries.set(managerSessionId, entry);

    // Listen for messages from the host
    child.on("message", (data: unknown) => {
      this._handleMessage(managerSessionId, data as HostEvent | HostResponse);
    });

    // Handle host exit
    child.on("exit", (code) => {
      const e = this.entries.get(managerSessionId);
      if (!e) return;

      let newStatus: SessionStatus;
      if (code === 0) {
        newStatus = e.sessionFile ? "archived" : "stopped";
      } else {
        newStatus = "errored";
      }

      e.status = newStatus;
      e.ringBuffer = []; // clear on exit
      // Preserve errorMessage on exit — the renderer needs it to display
      // the error banner. It's cleaned up when the entry is deleted via close().

      // Reject all pending commands
      for (const [, resolve] of e.pendingCommands) {
        resolve({ type: "response", id: "", success: false, error: "Host exited" });
      }
      e.pendingCommands.clear();

      this.emit("statusChanged", managerSessionId, newStatus);
    });

    // Send HostInit
    const init: HostInit = {
      type: "init",
      managerSessionId,
      cwd,
      agentDir,
      sessionMode,
      initialName,
    };
    child.postMessage(init);
  }

  // -----------------------------------------------------------------------
  // Command
  // -----------------------------------------------------------------------

  sendCommand(managerSessionId: string, cmd: HostCommand): Promise<HostResponse> {
    const entry = this.entries.get(managerSessionId);
    if (!entry) {
      return Promise.resolve({
        type: "response",
        id: (cmd as { id?: string }).id ?? "",
        success: false,
        error: `No host for session ${managerSessionId}`,
      });
    }

    // extension_ui_response has no id field — fire and forget
    if (cmd.type === "extension_ui_response") {
      entry.child.postMessage(cmd);
      return Promise.resolve({ type: "response", id: "", success: true });
    }

    const cmdId = cmd.id;
    return new Promise((resolve) => {
      entry.pendingCommands.set(cmdId, resolve);
      entry.child.postMessage(cmd);
    });
  }

  // -----------------------------------------------------------------------
  // Ring buffer
  // -----------------------------------------------------------------------

  getRingBuffer(managerSessionId: string): AgentSessionEvent[] {
    return this.entries.get(managerSessionId)?.ringBuffer ?? [];
  }

  // -----------------------------------------------------------------------
  // Status + live info
  // -----------------------------------------------------------------------

  getStatus(managerSessionId: string): SessionStatus | undefined {
    return this.entries.get(managerSessionId)?.status;
  }

  getLiveInfo(
    managerSessionId: string,
  ): { sessionFile?: string; sessionId?: string; sessionName?: string } | undefined {
    const e = this.entries.get(managerSessionId);
    if (!e) return undefined;
    return {
      sessionFile: e.sessionFile,
      sessionId: e.sessionId,
      sessionName: e.sessionName,
    };
  }

  getErrorMessage(managerSessionId: string): string | undefined {
    return this.entries.get(managerSessionId)?.errorMessage;
  }

  // -----------------------------------------------------------------------
  // Close
  // -----------------------------------------------------------------------

  async close(managerSessionId: string, opts: { graceMs?: number } = {}): Promise<void> {
    const entry = this.entries.get(managerSessionId);
    if (!entry) return;

    // Fast path: host already exited (terminal status)
    if (TERMINAL_STATUSES.has(entry.status)) {
      this.entries.delete(managerSessionId);
      return;
    }

    const { graceMs = 3000 } = opts;

    // Ask agent to abort gracefully
    try {
      await Promise.race([
        this.sendCommand(managerSessionId, { type: "abort", id: randomUUID() }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("abort timeout")), 1000),
        ),
      ]);
    } catch {
      // ignore timeout — host may already be gone
    }

    const exitPromise = new Promise<void>((resolve) => {
      entry.child.once("exit", () => resolve());
    });

    entry.child.kill();

    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => setTimeout(resolve, graceMs)),
    ]);

    // Force kill if still alive
    try {
      entry.child.kill();
    } catch {
      // already exited
    }

    this.entries.delete(managerSessionId);
  }

  async closeAll(opts: { graceMs?: number } = {}): Promise<void> {
    const ids = Array.from(this.entries.keys());
    await Promise.all(ids.map((id) => this.close(id, opts)));
  }

  // -----------------------------------------------------------------------
  // Internal: message handling
  // -----------------------------------------------------------------------

  private _handleMessage(managerSessionId: string, msg: HostEvent | HostResponse): void {
    const entry = this.entries.get(managerSessionId);
    if (!entry) return;

    // HostResponse (keyed by command id)
    if (msg.type === "response") {
      const resolve = entry.pendingCommands.get((msg as HostResponse).id);
      if (resolve) {
        entry.pendingCommands.delete((msg as HostResponse).id);
        resolve(msg as HostResponse);
      }
      return;
    }

    // HostEvent
    const event = msg as HostEvent;
    this.emit("hostEvent", managerSessionId, event);

    switch (event.type) {
      case "host_ready":
        entry.sessionFile = event.sessionFile;
        entry.sessionId = event.sessionId;
        entry.sessionName = event.sessionName;
        entry.status = "idle";
        this.emit("statusChanged", managerSessionId, "idle");
        break;

      case "agent_event": {
        // Ring buffer
        entry.ringBuffer.push(event.event);
        if (entry.ringBuffer.length > RING_BUFFER_SIZE) {
          entry.ringBuffer.shift();
        }
        // Status transitions
        const inner = event.event;
        if (inner.type === "agent_start") {
          entry.status = "streaming";
          this.emit("statusChanged", managerSessionId, "streaming");
        } else if (inner.type === "agent_end") {
          entry.status = "idle";
          this.emit("statusChanged", managerSessionId, "idle");
        } else if (inner.type === "compaction_start") {
          entry.status = "compacting";
          this.emit("statusChanged", managerSessionId, "compacting");
        } else if (inner.type === "compaction_end") {
          entry.status = "idle";
          this.emit("statusChanged", managerSessionId, "idle");
        } else if (inner.type === "auto_retry_start") {
          entry.status = "retrying";
          this.emit("statusChanged", managerSessionId, "retrying");
        } else if (inner.type === "auto_retry_end") {
          entry.status = "idle";
          this.emit("statusChanged", managerSessionId, "idle");
        } else if (inner.type === "session_info_changed") {
          entry.sessionName = inner.name;
          this.emit("nameChanged", managerSessionId, inner.name);
        }
        break;
      }

      case "host_error":
        if (event.fatal) {
          entry.errorMessage = event.error;
          entry.status = "errored";
          this.emit("statusChanged", managerSessionId, "errored");
        }
        break;
    }
  }
}

// Singleton — uses real Electron APIs
export const supervisor = new Supervisor(
  join(__dirname, "../host/index.mjs"),
  (path, args, opts) => utilityProcess.fork(path, args, opts),
);

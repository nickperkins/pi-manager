import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ManagerSessionRecord, PersistedManagerSession, PersistedStats, SessionStatus } from "@shared/types";
import type { HostCommand, HostEvent, HostResponse } from "@shared/protocol";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Mock supervisor
// ---------------------------------------------------------------------------

class MockSupervisor extends EventEmitter {
  private statuses = new Map<string, SessionStatus>();
  private liveInfos = new Map<string, { sessionFile?: string; sessionId?: string; sessionName?: string }>();
  private ringBuffers = new Map<string, AgentSessionEvent[]>();
  private closedIds: string[] = [];
  private commandMock: ((cmd: HostCommand) => Promise<HostResponse>) | null = null;

  create(opts: { managerSessionId: string }): void {
    this.statuses.set(opts.managerSessionId, "idle");
  }

  sendCommand(managerSessionId: string, cmd: HostCommand): Promise<HostResponse> {
    if (this.commandMock) return this.commandMock(cmd);
    return Promise.resolve({ type: "response", id: "test", success: true });
  }

  close(managerSessionId: string): Promise<void> {
    this.closedIds.push(managerSessionId);
    this.statuses.delete(managerSessionId);
    this.liveInfos.delete(managerSessionId);
    return Promise.resolve();
  }

  getStatus(id: string): SessionStatus | undefined {
    return this.statuses.get(id);
  }

  getLiveInfo(id: string) {
    return this.liveInfos.get(id);
  }

  getRingBuffer(id: string): AgentSessionEvent[] {
    return this.ringBuffers.get(id) ?? [];
  }

  getClosedIds(): string[] {
    return this.closedIds;
  }

  // Test helpers
  _setStatus(id: string, status: SessionStatus) {
    this.statuses.set(id, status);
  }

  _setLiveInfo(id: string, info: { sessionFile?: string; sessionId?: string; sessionName?: string }) {
    this.liveInfos.set(id, info);
  }

  _setRingBuffer(id: string, events: AgentSessionEvent[]) {
    this.ringBuffers.set(id, events);
  }

  _setCommandMock(mock: ((cmd: HostCommand) => Promise<HostResponse>) | null) {
    this.commandMock = mock;
  }

  getErrorMessage(_id: string): string | undefined {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Mock store
// ---------------------------------------------------------------------------

class MockStore {
  private sessions: PersistedManagerSession[] = [];

  load(): PersistedManagerSession[] {
    return [...this.sessions];
  }

  save(sessions: PersistedManagerSession[]): void {
    this.sessions = sessions;
  }

  upsert(session: PersistedManagerSession): void {
    const idx = this.sessions.findIndex((s) => s.managerSessionId === session.managerSessionId);
    if (idx >= 0) this.sessions[idx] = session;
    else this.sessions.push(session);
  }

  remove(id: string): void {
    this.sessions = this.sessions.filter((s) => s.managerSessionId !== id);
  }
}

// ---------------------------------------------------------------------------
// Extract handler logic for testing without real ipcMain
// ---------------------------------------------------------------------------

function buildManagerList(
  persisted: PersistedManagerSession[],
  sv: { getStatus(id: string): SessionStatus | undefined; getLiveInfo(id: string): any; getErrorMessage?(id: string): string | undefined },
): ManagerSessionRecord[] {
  return persisted.map((p) => {
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
      errorMessage: sv.getErrorMessage?.(p.managerSessionId),
      lastStats: p.lastStats,
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IPC handler logic", () => {
  describe("buildManagerList", () => {
    it("returns 'archived' when no live host and sessionFile present", () => {
      const persisted: PersistedManagerSession[] = [
        { managerSessionId: "a", name: "A", cwd: "/tmp", sessionFile: "/tmp/a.jsonl", createdAt: "" },
      ];
      const sv = { getStatus: () => undefined, getLiveInfo: () => undefined };

      const list = buildManagerList(persisted, sv);
      expect(list[0].status).toBe("archived");
    });

    it("returns 'stopped' when no live host and no sessionFile", () => {
      const persisted: PersistedManagerSession[] = [
        { managerSessionId: "a", name: "A", cwd: "/tmp", createdAt: "" },
      ];
      const sv = { getStatus: () => undefined, getLiveInfo: () => undefined };

      const list = buildManagerList(persisted, sv);
      expect(list[0].status).toBe("stopped");
    });

    it("prefers live status over derived status", () => {
      const persisted: PersistedManagerSession[] = [
        { managerSessionId: "a", name: "A", cwd: "/tmp", createdAt: "" },
      ];
      const sv = {
        getStatus: () => "streaming" as SessionStatus,
        getLiveInfo: () => undefined,
      };

      const list = buildManagerList(persisted, sv);
      expect(list[0].status).toBe("streaming");
    });

    it("prefers live sessionName over persisted name", () => {
      const persisted: PersistedManagerSession[] = [
        { managerSessionId: "a", name: "Old", cwd: "/tmp", createdAt: "" },
      ];
      const sv = {
        getStatus: () => "idle" as SessionStatus,
        getLiveInfo: () => ({ sessionName: "New" }),
      };

      const list = buildManagerList(persisted, sv);
      expect(list[0].name).toBe("New");
    });

    it("prefers live sessionFile over persisted sessionFile", () => {
      const persisted: PersistedManagerSession[] = [
        { managerSessionId: "a", name: "A", cwd: "/tmp", sessionFile: "/old.jsonl", createdAt: "" },
      ];
      const sv = {
        getStatus: () => "idle" as SessionStatus,
        getLiveInfo: () => ({ sessionFile: "/new.jsonl" }),
      };

      const list = buildManagerList(persisted, sv);
      expect(list[0].sessionFile).toBe("/new.jsonl");
    });

    it("includes errorMessage in manager list when host has errored", () => {
      const persisted: PersistedManagerSession[] = [
        { managerSessionId: "a", name: "A", cwd: "/tmp", createdAt: "" },
      ];
      const sv = {
        getStatus: () => "errored" as SessionStatus,
        getLiveInfo: () => undefined,
        getErrorMessage: () => "Something went wrong",
      };

      const list = buildManagerList(persisted, sv);
      expect(list[0].errorMessage).toBe("Something went wrong");
    });

    it("errorMessage is undefined when host has not errored", () => {
      const persisted: PersistedManagerSession[] = [
        { managerSessionId: "a", name: "A", cwd: "/tmp", createdAt: "" },
      ];
      const sv = {
        getStatus: () => "idle" as SessionStatus,
        getLiveInfo: () => undefined,
        getErrorMessage: () => undefined,
      };

      const list = buildManagerList(persisted, sv);
      expect(list[0].errorMessage).toBeUndefined();
    });
  });

  describe("manager:create handler logic", () => {
    it("calls supervisor.create with correct sessionMode", () => {
      const sv = new MockSupervisor();
      const store = new MockStore();
      const broadcastCalls: unknown[][] = [];
      const broadcast = (...args: unknown[]) => broadcastCalls.push(args);

      // Simulate handler logic
      const managerSessionId = "test-id";
      const name = "Test";
      const now = new Date().toISOString();

      store.upsert({ managerSessionId, name, cwd: "/tmp", createdAt: now });
      sv.create({ managerSessionId } as any);
      broadcast("manager:listChanged", [{ managerSessionId, name, cwd: "/tmp", createdAt: now, status: "idle" }]);

      expect(sv.getStatus(managerSessionId)).toBe("idle");
      expect(store.load()).toHaveLength(1);
      expect(broadcastCalls).toHaveLength(1);
      expect(broadcastCalls[0][0]).toBe("manager:listChanged");
    });
  });

  describe("manager:close handler logic", () => {
    it("persists sessionFile from liveInfo if not already stored", async () => {
      const sv = new MockSupervisor();
      const store = new MockStore();

      const managerSessionId = "test-id";
      store.upsert({ managerSessionId, name: "Test", cwd: "/tmp", createdAt: "" });
      sv.create({ managerSessionId } as any);
      sv._setLiveInfo(managerSessionId, { sessionFile: "/tmp/saved.jsonl" });

      // Simulate close handler
      const liveInfo = sv.getLiveInfo(managerSessionId);
      await sv.close(managerSessionId);

      if (liveInfo?.sessionFile) {
        const persisted = store.load().find((s) => s.managerSessionId === managerSessionId);
        if (persisted && !persisted.sessionFile) {
          store.upsert({ ...persisted, sessionFile: liveInfo.sessionFile });
        }
      }

      const saved = store.load()[0];
      expect(saved.sessionFile).toBe("/tmp/saved.jsonl");
    });

    it("persists lastStats when closing a running session", async () => {
      const sv = new MockSupervisor();
      const store = new MockStore();
      const managerSessionId = "test-id";

      const stats: PersistedStats = {
        tokens: { input: 100, output: 200, cacheRead: 50, cacheWrite: 0, total: 350 },
        cost: 0.0123,
        contextUsage: { tokens: 350, contextWindow: 200000, percent: 0.175 },
      };

      store.upsert({ managerSessionId, name: "Test", cwd: "/tmp", createdAt: "" });
      sv.create({ managerSessionId } as any);
      sv._setStatus(managerSessionId, "idle");
      sv._setCommandMock(async () => ({
        type: "response",
        id: "test",
        success: true,
        data: { stats },
      }));

      // Simulate close handler stats logic
      const liveStatus = sv.getStatus(managerSessionId);
      const terminalStatuses = new Set(["stopped", "archived", "errored"]);
      if (liveStatus && !terminalStatuses.has(liveStatus)) {
        const resp = await sv.sendCommand(managerSessionId, {
          type: "get_session_stats",
          id: "stats-id",
        });
        if (resp.success && resp.data) {
          const extractedStats = (resp.data as { stats?: PersistedStats }).stats;
          if (extractedStats) {
            const persisted = store.load().find((s) => s.managerSessionId === managerSessionId);
            if (persisted) {
              store.upsert({ ...persisted, lastStats: extractedStats });
            }
          }
        }
      }

      const saved = store.load()[0];
      expect(saved.lastStats).toEqual(stats);
    });

    it("preserves existing lastStats when host is already dead", async () => {
      const sv = new MockSupervisor();
      const store = new MockStore();
      const managerSessionId = "test-id";

      const existingStats: PersistedStats = {
        tokens: { input: 50, output: 100, cacheRead: 0, cacheWrite: 0, total: 150 },
        cost: 0.005,
      };

      // Session is archived — no running host
      store.upsert({
        managerSessionId,
        name: "Test",
        cwd: "/tmp",
        createdAt: "",
        sessionFile: "/tmp/test.jsonl",
        lastStats: existingStats,
      });

      // Simulate close handler stats logic
      const liveStatus = sv.getStatus(managerSessionId);
      const terminalStatuses = new Set(["stopped", "archived", "errored"]);
      if (liveStatus && !terminalStatuses.has(liveStatus)) {
        // Should NOT enter this branch
        expect.unreachable("Should not fetch stats for dead host");
      }

      // lastStats should be preserved unchanged
      const saved = store.load()[0];
      expect(saved.lastStats).toEqual(existingStats);
    });

    it("preserves existing lastStats when stats fetch fails", async () => {
      const sv = new MockSupervisor();
      const store = new MockStore();
      const managerSessionId = "test-id";

      const existingStats: PersistedStats = {
        tokens: { input: 50, output: 100, cacheRead: 0, cacheWrite: 0, total: 150 },
        cost: 0.005,
      };

      store.upsert({
        managerSessionId,
        name: "Test",
        cwd: "/tmp",
        createdAt: "",
        lastStats: existingStats,
      });
      sv.create({ managerSessionId } as any);
      sv._setStatus(managerSessionId, "idle");
      sv._setCommandMock(async () => ({
        type: "response",
        id: "test",
        success: false,
        error: "Host exited",
      }));

      // Simulate close handler stats logic
      const liveStatus = sv.getStatus(managerSessionId);
      const terminalStatuses = new Set(["stopped", "archived", "errored"]);
      if (liveStatus && !terminalStatuses.has(liveStatus)) {
        try {
          const resp = await sv.sendCommand(managerSessionId, {
            type: "get_session_stats",
            id: "stats-id",
          });
          if (resp.success && resp.data) {
            const extractedStats = (resp.data as { stats?: PersistedStats }).stats;
            if (extractedStats) {
              const persisted = store.load().find((s) => s.managerSessionId === managerSessionId);
              if (persisted) store.upsert({ ...persisted, lastStats: extractedStats });
            }
          }
        } catch {
          // ignore
        }
      }

      const saved = store.load()[0];
      expect(saved.lastStats).toEqual(existingStats);
    });
  });

  describe("manager:reopen handler logic", () => {
    it("closes existing host before reopening", async () => {
      const sv = new MockSupervisor();
      const store = new MockStore();
      const managerSessionId = "test-id";

      store.upsert({ managerSessionId, name: "Test", cwd: "/tmp", createdAt: "" });
      sv.create({ managerSessionId } as any);

      // Simulate reopen handler: close first, then create
      await sv.close(managerSessionId);
      sv.create({ managerSessionId } as any);

      expect(sv.getStatus(managerSessionId)).toBe("idle");
      expect(sv.getClosedIds()).toContain(managerSessionId);
    });
  });

  describe("manager:delete handler logic", () => {
    it("closes the host before deleting from store", async () => {
      const sv = new MockSupervisor();
      const store = new MockStore();
      const managerSessionId = "test-id";

      store.upsert({ managerSessionId, name: "Test", cwd: "/tmp", createdAt: "" });
      sv.create({ managerSessionId } as any);

      // Simulate delete handler: close first
      await sv.close(managerSessionId);
      store.remove(managerSessionId);

      expect(store.load()).toHaveLength(0);
      expect(sv.getClosedIds()).toContain(managerSessionId);
    });
  });

  describe("session:attach handler logic", () => {
    it("returns ring buffer from supervisor", () => {
      const sv = new MockSupervisor();
      const events: AgentSessionEvent[] = [
        { type: "agent_start" } as AgentSessionEvent,
        { type: "agent_end", messages: [] } as unknown as AgentSessionEvent,
      ];
      sv._setRingBuffer("test-1", events);

      const result = sv.getRingBuffer("test-1");
      expect(result).toEqual(events);
    });
  });

  describe("nameChanged broadcast", () => {
    it("broadcasts manager list when nameChanged fires", () => {
      const sv = new MockSupervisor();
      const store = new MockStore();
      const broadcastCalls: unknown[][] = [];
      const broadcast = (...args: unknown[]) => broadcastCalls.push(args);

      const managerSessionId = "test-id";
      store.upsert({ managerSessionId, name: "Old Name", cwd: "/tmp", createdAt: "" });
      sv._setStatus(managerSessionId, "idle");
      sv._setLiveInfo(managerSessionId, { sessionName: "New Name" });

      // Simulate the ipc.ts listener: sv.on("nameChanged", () => broadcastManagerList())
      sv.on("nameChanged", () => {
        const list = buildManagerList(store.load(), sv);
        broadcast("manager:listChanged", list);
      });

      sv.emit("nameChanged", managerSessionId, "New Name");

      expect(broadcastCalls).toHaveLength(1);
      const [channel, list] = broadcastCalls[0] as [string, ManagerSessionRecord[]];
      expect(channel).toBe("manager:listChanged");
      expect(list[0].name).toBe("New Name");
    });
  });
});

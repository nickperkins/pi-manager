import { describe, it, expect, vi, beforeEach } from "vitest";
import { Supervisor } from "../../../src/main/supervisor";
import type { HostEvent, HostResponse, HostCommand } from "@shared/protocol";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { SessionStatus } from "@shared/types";

// ---------------------------------------------------------------------------
// Mock UtilityProcess helper
// ---------------------------------------------------------------------------

function createMockChild() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    postMessage: vi.fn(),
    kill: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    // Helpers to simulate messages from the host
    emitMessage(data: unknown) {
      for (const h of listeners["message"] ?? []) h(data);
    },
    emitExit(code: number | null) {
      for (const h of listeners["exit"] ?? []) h(code);
    },
  };
}

type MockChild = ReturnType<typeof createMockChild>;

function createSupervisor() {
  const children: MockChild[] = [];
  const sv = new Supervisor("/fake/host/path", () => {
    const child = createMockChild();
    children.push(child);
    return child as unknown as Electron.UtilityProcess;
  });
  return { sv, children };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Supervisor", () => {
  describe("create + status transitions", () => {
    it("starts in 'spawning' status after create", () => {
      const { sv, children } = createSupervisor();
      sv.create({
        managerSessionId: "test-1",
        cwd: "/tmp",
        agentDir: "/tmp/.pi",
        sessionMode: { kind: "new" },
      });

      expect(sv.getStatus("test-1")).toBe("spawning");
      // HostInit should have been sent
      expect(children[0].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "init", managerSessionId: "test-1" }),
      );
    });

    it("throws if a host is already running for the same session", () => {
      const { sv } = createSupervisor();
      sv.create({
        managerSessionId: "test-1",
        cwd: "/tmp",
        agentDir: "/tmp/.pi",
        sessionMode: { kind: "new" },
      });

      expect(() =>
        sv.create({
          managerSessionId: "test-1",
          cwd: "/tmp",
          agentDir: "/tmp/.pi",
          sessionMode: { kind: "new" },
        }),
      ).toThrow("Host already running");
    });

    it("transitions to 'idle' on host_ready", () => {
      const { sv, children } = createSupervisor();
      sv.create({
        managerSessionId: "test-1",
        cwd: "/tmp",
        agentDir: "/tmp/.pi",
        sessionMode: { kind: "new" },
      });

      children[0].emitMessage({
        type: "host_ready",
        sessionFile: "/tmp/session.jsonl",
        sessionId: "sess-1",
        sessionName: "Test Session",
      });

      expect(sv.getStatus("test-1")).toBe("idle");
      const info = sv.getLiveInfo("test-1");
      expect(info?.sessionFile).toBe("/tmp/session.jsonl");
      expect(info?.sessionId).toBe("sess-1");
      expect(info?.sessionName).toBe("Test Session");
    });

    it("transitions to 'streaming' on agent_start", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });

      // Must get host_ready first
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });
      expect(sv.getStatus("test-1")).toBe("idle");

      children[0].emitMessage({ type: "agent_event", event: { type: "agent_start" } });
      expect(sv.getStatus("test-1")).toBe("streaming");
    });

    it("transitions to 'idle' on agent_end", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });
      children[0].emitMessage({ type: "agent_event", event: { type: "agent_start" } });
      children[0].emitMessage({ type: "agent_event", event: { type: "agent_end", messages: [] } });
      expect(sv.getStatus("test-1")).toBe("idle");
    });

    it("transitions to 'compacting' on compaction_start", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });
      children[0].emitMessage({ type: "agent_event", event: { type: "compaction_start" } });
      expect(sv.getStatus("test-1")).toBe("compacting");
    });

    it("transitions to 'idle' on compaction_end", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });
      children[0].emitMessage({ type: "agent_event", event: { type: "compaction_start" } });
      children[0].emitMessage({ type: "agent_event", event: { type: "compaction_end" } });
      expect(sv.getStatus("test-1")).toBe("idle");
    });

    it("transitions to 'retrying' on auto_retry_start", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });
      children[0].emitMessage({ type: "agent_event", event: { type: "auto_retry_start" } });
      expect(sv.getStatus("test-1")).toBe("retrying");
    });

    it("transitions to 'idle' on auto_retry_end", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });
      children[0].emitMessage({ type: "agent_event", event: { type: "auto_retry_start" } });
      children[0].emitMessage({ type: "agent_event", event: { type: "auto_retry_end" } });
      expect(sv.getStatus("test-1")).toBe("idle");
    });

    it("transitions to 'errored' on fatal host_error", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_error", error: "boom", fatal: true });
      expect(sv.getStatus("test-1")).toBe("errored");
    });

    it("does not change status on non-fatal host_error", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });
      children[0].emitMessage({ type: "host_error", error: "non-fatal", fatal: false });
      expect(sv.getStatus("test-1")).toBe("idle");
    });

    it("transitions to 'archived' on exit code 0 with sessionFile", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: "/tmp/s.jsonl", sessionId: "s1", sessionName: undefined });
      children[0].emitExit(0);
      expect(sv.getStatus("test-1")).toBe("archived");
    });

    it("transitions to 'stopped' on exit code 0 without sessionFile", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitExit(0);
      expect(sv.getStatus("test-1")).toBe("stopped");
    });

    it("transitions to 'errored' on non-zero exit code", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitExit(1);
      expect(sv.getStatus("test-1")).toBe("errored");
    });
  });

  describe("ring buffer", () => {
    it("accumulates agent_event events", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });

      const ev1: AgentSessionEvent = { type: "agent_start" } as AgentSessionEvent;
      const ev2: AgentSessionEvent = { type: "message_start", message: {} as any } as AgentSessionEvent;
      children[0].emitMessage({ type: "agent_event", event: ev1 });
      children[0].emitMessage({ type: "agent_event", event: ev2 });

      const buf = sv.getRingBuffer("test-1");
      expect(buf).toHaveLength(2);
      expect(buf[0]).toEqual(ev1);
      expect(buf[1]).toEqual(ev2);
    });

    it("drops oldest events when exceeding RING_BUFFER_SIZE (500)", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });

      // Push 502 events
      for (let i = 0; i < 502; i++) {
        children[0].emitMessage({
          type: "agent_event",
          event: { type: "message_start", message: { idx: i } as any } as AgentSessionEvent,
        });
      }

      const buf = sv.getRingBuffer("test-1");
      expect(buf).toHaveLength(500);
      // Oldest two should have been dropped (idx 0 and 1)
      expect((buf[0] as any).message.idx).toBe(2);
      expect((buf[499] as any).message.idx).toBe(501);
    });

    it("clears buffer on host exit", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });
      children[0].emitMessage({ type: "agent_event", event: { type: "agent_start" } as any });
      expect(sv.getRingBuffer("test-1")).toHaveLength(1);

      children[0].emitExit(0);
      expect(sv.getRingBuffer("test-1")).toHaveLength(0);
    });

    it("returns empty array for unknown session", () => {
      const { sv } = createSupervisor();
      expect(sv.getRingBuffer("unknown")).toEqual([]);
    });
  });

  describe("sendCommand", () => {
    it("resolves when matching HostResponse arrives", async () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });

      const cmdPromise = sv.sendCommand("test-1", { type: "prompt", id: "cmd-1", message: "hi" });

      // Verify the command was posted to the child
      expect(children[0].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "prompt", id: "cmd-1" }),
      );

      // Simulate response
      children[0].emitMessage({ type: "response", id: "cmd-1", success: true });

      const resp = await cmdPromise;
      expect(resp.success).toBe(true);
      expect(resp.id).toBe("cmd-1");
    });

    it("rejects immediately for non-existent host", async () => {
      const { sv } = createSupervisor();
      const resp = await sv.sendCommand("nonexistent", { type: "abort", id: "x" });
      expect(resp.success).toBe(false);
      expect(resp.error).toContain("No host");
    });

    it("handles extension_ui_response as fire-and-forget", async () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });

      const resp = await sv.sendCommand("test-1", {
        type: "extension_ui_response",
        requestId: "r1",
        value: "yes",
      });
      expect(resp.success).toBe(true);
      expect(children[0].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "extension_ui_response" }),
      );
    });

    it("resolves pending commands with error on host exit", async () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });

      const cmdPromise = sv.sendCommand("test-1", { type: "prompt", id: "cmd-1", message: "hi" });

      // Host exits before responding
      children[0].emitExit(1);

      const resp = await cmdPromise;
      expect(resp.success).toBe(false);
      expect(resp.error).toBe("Host exited");
    });
  });

  describe("close", () => {
    it("removes the entry after close", async () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      expect(sv.getStatus("test-1")).toBeDefined();

      // Simulate exit on kill
      const closePromise = sv.close("test-1", { graceMs: 100 });

      // Trigger exit to resolve the close promise
      children[0].emitExit(0);

      await closePromise;
      expect(sv.getStatus("test-1")).toBeUndefined();
    });

    it("is a no-op for non-existent session", async () => {
      const { sv } = createSupervisor();
      await sv.close("nonexistent");
      // Should not throw
    });

    it("returns immediately for terminal status (dead host)", async () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });

      // Host exits → status becomes "stopped"
      children[0].emitExit(0);
      expect(sv.getStatus("test-1")).toBe("stopped");

      const start = Date.now();
      await sv.close("test-1", { graceMs: 5000 });
      const elapsed = Date.now() - start;

      // Should be nearly instant, not waiting for grace period
      expect(elapsed).toBeLessThan(500);
      expect(sv.getStatus("test-1")).toBeUndefined();
    });

    it("returns immediately for 'errored' status", async () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });

      children[0].emitExit(1);
      expect(sv.getStatus("test-1")).toBe("errored");

      const start = Date.now();
      await sv.close("test-1", { graceMs: 5000 });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(sv.getStatus("test-1")).toBeUndefined();
    });
  });

  describe("events", () => {
    it("emits statusChanged on status transitions", () => {
      const { sv, children } = createSupervisor();
      const statusChanges: Array<{ id: string; status: SessionStatus }> = [];
      sv.on("statusChanged", (id, status) => {
        statusChanges.push({ id, status });
      });

      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });

      expect(statusChanges).toEqual([{ id: "test-1", status: "idle" }]);
    });

    it("emits hostEvent on agent_event", () => {
      const { sv, children } = createSupervisor();
      const events: unknown[] = [];
      sv.on("hostEvent", (id, event) => {
        events.push({ id, event });
      });

      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });
      children[0].emitMessage({ type: "agent_event", event: { type: "agent_start" } });

      expect(events).toHaveLength(2); // host_ready + agent_event
      expect(events[1]).toEqual({
        id: "test-1",
        event: { type: "agent_event", event: { type: "agent_start" } },
      });
    });
  });

  describe("host_error errorMessage tracking", () => {
    it("stores errorMessage on fatal host_error", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });

      children[0].emitMessage({ type: "host_error", error: "boom", fatal: true });

      expect(sv.getErrorMessage("test-1")).toBe("boom");
    });

    it("getErrorMessage returns undefined before any error", () => {
      const { sv } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });

      expect(sv.getErrorMessage("test-1")).toBeUndefined();
    });

    it("does not set errorMessage on non-fatal host_error", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });
      children[0].emitMessage({ type: "host_error", error: "soft error", fatal: false });

      expect(sv.getErrorMessage("test-1")).toBeUndefined();
    });

    it("preserves errorMessage on host exit so renderer can display it", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_error", error: "crash", fatal: true });
      expect(sv.getErrorMessage("test-1")).toBe("crash");

      children[0].emitExit(1);
      // errorMessage should be preserved — the renderer still needs it
      expect(sv.getErrorMessage("test-1")).toBe("crash");
    });
  });

  describe("session_info_changed", () => {
    it("updates sessionName on session_info_changed event", () => {
      const { sv, children } = createSupervisor();
      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: "Old" });

      expect(sv.getLiveInfo("test-1")?.sessionName).toBe("Old");

      children[0].emitMessage({
        type: "agent_event",
        event: { type: "session_info_changed", name: "New Name" },
      });

      expect(sv.getLiveInfo("test-1")?.sessionName).toBe("New Name");
    });

    it("emits nameChanged when session_info_changed arrives", () => {
      const { sv, children } = createSupervisor();
      const nameChanges: Array<{ id: string; name: string | undefined }> = [];
      sv.on("nameChanged", (id, name) => nameChanges.push({ id, name }));

      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });

      children[0].emitMessage({
        type: "agent_event",
        event: { type: "session_info_changed", name: "Renamed" },
      });

      expect(nameChanges).toHaveLength(1);
      expect(nameChanges[0]).toEqual({ id: "test-1", name: "Renamed" });
    });

    it("does not emit nameChanged for other event types", () => {
      const { sv, children } = createSupervisor();
      const nameChanges: unknown[] = [];
      sv.on("nameChanged", (...args) => nameChanges.push(args));

      sv.create({ managerSessionId: "test-1", cwd: "/tmp", agentDir: "/tmp/.pi", sessionMode: { kind: "new" } });
      children[0].emitMessage({ type: "host_ready", sessionFile: undefined, sessionId: "s1", sessionName: undefined });
      children[0].emitMessage({ type: "agent_event", event: { type: "agent_start" } });
      children[0].emitMessage({ type: "agent_event", event: { type: "agent_end", messages: [] } });

      expect(nameChanges).toHaveLength(0);
    });
  });
});

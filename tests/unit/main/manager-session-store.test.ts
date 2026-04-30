import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ManagerSessionStore } from "../../../src/main/manager-session-store";
import type { PersistedManagerSession } from "@shared/types";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeStore(): { store: ManagerSessionStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "pi-manager-test-"));
  const store = new ManagerSessionStore(join(dir, "sessions.json"));
  return { store, dir };
}

function makeSession(overrides: Partial<PersistedManagerSession> = {}): PersistedManagerSession {
  return {
    managerSessionId: randomUUID(),
    name: "Test Session",
    cwd: "/tmp",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ManagerSessionStore", () => {
  let ctx: { store: ManagerSessionStore; dir: string };

  beforeEach(() => {
    ctx = makeStore();
  });

  afterEach(() => {
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  describe("load()", () => {
    it("returns [] when file does not exist", () => {
      expect(ctx.store.load()).toEqual([]);
    });

    it("returns parsed sessions when file is valid JSON", () => {
      const session = makeSession();
      ctx.store.save([session]);
      const loaded = ctx.store.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].managerSessionId).toBe(session.managerSessionId);
    });

    it("returns [] when file is malformed JSON", () => {
      writeFileSync(join(ctx.dir, "sessions.json"), "not json {{{{", "utf-8");
      const loaded = ctx.store.load();
      expect(loaded).toEqual([]);
    });
  });

  describe("save()", () => {
    it("persists sessions that survive load()", () => {
      const session = makeSession();
      ctx.store.save([session]);

      // Create a new store instance pointing at the same path
      const store2 = new ManagerSessionStore(join(ctx.dir, "sessions.json"));
      const loaded = store2.load();
      expect(loaded).toEqual([session]);
    });
  });

  describe("upsert()", () => {
    it("adds a new session", () => {
      const session = makeSession();
      ctx.store.upsert(session);
      const loaded = ctx.store.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(session);
    });

    it("updates an existing session by managerSessionId", () => {
      const session = makeSession({ name: "Original" });
      ctx.store.upsert(session);

      ctx.store.upsert({ ...session, name: "Updated" });
      const loaded = ctx.store.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].name).toBe("Updated");
    });

    it("preserves other sessions when upserting one", () => {
      const s1 = makeSession({ name: "Session 1" });
      const s2 = makeSession({ name: "Session 2" });
      ctx.store.upsert(s1);
      ctx.store.upsert(s2);

      ctx.store.upsert({ ...s1, name: "Session 1 Updated" });
      const loaded = ctx.store.load();
      expect(loaded).toHaveLength(2);
      expect(loaded.find((s) => s.managerSessionId === s1.managerSessionId)?.name).toBe(
        "Session 1 Updated",
      );
      expect(loaded.find((s) => s.managerSessionId === s2.managerSessionId)?.name).toBe(
        "Session 2",
      );
    });
  });

  describe("remove()", () => {
    it("removes the session with the matching id", () => {
      const s1 = makeSession();
      const s2 = makeSession();
      ctx.store.upsert(s1);
      ctx.store.upsert(s2);

      ctx.store.remove(s1.managerSessionId);
      const loaded = ctx.store.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].managerSessionId).toBe(s2.managerSessionId);
    });

    it("is a no-op for an unknown id", () => {
      const s1 = makeSession();
      ctx.store.upsert(s1);
      ctx.store.remove("nonexistent");
      expect(ctx.store.load()).toHaveLength(1);
    });
  });
});

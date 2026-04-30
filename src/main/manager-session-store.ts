import { app } from "electron";
import { join } from "node:path";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { PersistedManagerSession } from "@shared/types";

export class ManagerSessionStore {
  private readonly storePath: string;
  private readonly storeTmp: string;

  /**
   * @param storePath  Absolute path to the JSON file. Injected so tests use tmp paths.
   */
  constructor(storePath: string) {
    this.storePath = storePath;
    this.storeTmp = storePath + ".tmp";
  }

  load(): PersistedManagerSession[] {
    const dir = dirname(this.storePath);
    mkdirSync(dir, { recursive: true });
    if (!existsSync(this.storePath)) return [];
    try {
      const raw = readFileSync(this.storePath, "utf-8");
      return JSON.parse(raw) as PersistedManagerSession[];
    } catch (err) {
      console.warn(
        "[store] Failed to parse manager-sessions.json — starting fresh:",
        err,
      );
      return [];
    }
  }

  save(sessions: PersistedManagerSession[]): void {
    const dir = dirname(this.storePath);
    mkdirSync(dir, { recursive: true });
    const json = JSON.stringify(sessions, null, 2);
    writeFileSync(this.storeTmp, json, "utf-8");
    try {
      renameSync(this.storeTmp, this.storePath);
    } catch {
      // Fallback: copy then unlink (preserves atomicity better than direct write)
      try {
        copyFileSync(this.storeTmp, this.storePath);
        unlinkSync(this.storeTmp);
      } catch {
        // Last resort: direct write (non-atomic but load() handles corruption)
        writeFileSync(this.storePath, json, "utf-8");
        try { unlinkSync(this.storeTmp); } catch { /* ignore */ }
      }
    }
  }

  upsert(session: PersistedManagerSession): void {
    const all = this.load();
    const idx = all.findIndex(
      (s) => s.managerSessionId === session.managerSessionId,
    );
    if (idx >= 0) all[idx] = session;
    else all.push(session);
    this.save(all);
  }

  remove(managerSessionId: string): void {
    this.save(
      this.load().filter((s) => s.managerSessionId !== managerSessionId),
    );
  }
}

// Singleton factory for use in ipc.ts (path resolved once after app is ready)
export function createStore(): ManagerSessionStore {
  return new ManagerSessionStore(
    join(app.getPath("home"), ".pi-manager", "manager-sessions.json"),
  );
}

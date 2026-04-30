/**
 * Shared types used by main process, preload, host, and renderer.
 * protocol.ts covers host ↔ supervisor types (HostInit, HostCommand, etc.).
 * ipc-protocol.ts covers channel name constants for renderer ↔ main.
 */

// ---------------------------------------------------------------------------
// Session status
// Derived at runtime from host events. Never written to disk.
// ---------------------------------------------------------------------------

export type SessionStatus =
  | "spawning" // host process started; HostInit sent; waiting for host_ready
  | "idle" // host_ready received; agent not running
  | "streaming" // agent_start received; agent mid-turn
  | "compacting" // compaction_start received
  | "retrying" // auto_retry_start received
  | "errored" // host crashed or fatal host_error
  | "stopped" // host exited cleanly; no sessionFile bound
  | "archived"; // sessionFile on disk; no running host

// ---------------------------------------------------------------------------
// Manager session record (in-memory, sent to renderer)
// ---------------------------------------------------------------------------

export interface DiscoveredSession {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  isCapped: boolean;
}

export interface PersistedStats {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

export interface ManagerSessionRecord {
  managerSessionId: string; // stable UUID generated at creation
  name: string; // display name (user-editable)
  cwd: string; // working directory
  sessionFile?: string; // absolute path to JSONL on disk, if known
  createdAt: string; // ISO 8601 timestamp
  status: SessionStatus; // derived, not persisted
  errorMessage?: string; // set on fatal host_error; absent otherwise
  lastStats?: PersistedStats; // persisted snapshot from last close
}

// ---------------------------------------------------------------------------
// Persisted session (written to ~/.pi-manager/manager-sessions.json)
// status is excluded — always re-derived on load
// ---------------------------------------------------------------------------

export interface PersistedManagerSession {
  managerSessionId: string;
  name: string;
  cwd: string;
  sessionFile?: string;
  createdAt: string;
  lastStats?: PersistedStats;
}

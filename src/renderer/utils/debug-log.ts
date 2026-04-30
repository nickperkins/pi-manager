import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventLogSource =
  | "ring-buffer"    // from attach() ring buffer
  | "live"           // live event after setup settled
  | "pending-flush"  // buffered during setup, flushed after
  | "get_messages";  // response to a get_messages command

export interface EventLogEntry {
  /** Monotonically increasing sequence number within this session lifecycle. */
  seq: number;
  /** Date.now() when the entry was recorded in the renderer. */
  receivedAt: number;
  /** Where the event came from. */
  source: EventLogSource;
  /** The raw SDK event (absent for get_messages entries). */
  event?: AgentSessionEvent;
  /** Message array returned by get_messages (absent for event entries). */
  messages?: unknown[];
  /** Optional human-readable label for context (e.g. "setup", "agent_end refresh"). */
  label?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES = 1000;

/**
 * Module-level sequence counter. Always increments, independent of log array
 * length, so seq values remain unique even after eviction.
 */
let _seq = 0;

/**
 * Append an entry to the log array, evicting the oldest if over the cap.
 * Mutates the array in place for efficiency.
 */
export function appendEntry(log: EventLogEntry[], entry: EventLogEntry): void {
  if (log.length >= MAX_LOG_ENTRIES) {
    log.splice(0, log.length - MAX_LOG_ENTRIES + 1);
  }
  log.push(entry);
}

/** Build a fresh entry for an SDK event. */
export function makeEventEntry(
  _log: EventLogEntry[],
  source: EventLogSource,
  event: AgentSessionEvent,
  label?: string,
): EventLogEntry {
  return {
    seq: _seq++,
    receivedAt: Date.now(),
    source,
    event,
    label,
  };
}

/** Build a fresh entry for a get_messages response. */
export function makeMessagesEntry(
  _log: EventLogEntry[],
  messages: unknown[],
  label?: string,
): EventLogEntry {
  return {
    seq: _seq++,
    receivedAt: Date.now(),
    source: "get_messages",
    messages,
    label,
  };
}

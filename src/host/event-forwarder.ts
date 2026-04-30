/**
 * event-forwarder.ts — Subscribe to AgentSession events and forward each one
 * to the supervisor via a post function.
 *
 * The `post` parameter is injected so this module has no dependency on
 * `process.parentPort` — making it fully unit-testable.
 *
 * Serializability audit (Task 6):
 * AgentSessionEvent is a union of:
 *   - AgentEvent variants: agent_start/end, turn_start/end, message_start/update/end,
 *     tool_execution_start/update/end — all plain objects. The `messages` arrays in
 *     agent_end/turn_end contain AgentMessage (= UserMessage | AssistantMessage |
 *     ToolResultMessage | CustomAgentMessages) which are plain data objects with no
 *     class instances or functions.
 *   - queue_update, compaction_start/end, session_info_changed, auto_retry_start/end —
 *     all plain objects.
 *
 * Conclusion: all AgentSessionEvent variants are POJOs safe for structured clone.
 * A JSON round-trip is applied as a defensive safety net in case any future SDK
 * version introduces non-cloneable fields (class instances, functions, Symbols).
 */

import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { HostEvent } from "@shared/protocol";

export function toSerializable(event: AgentSessionEvent): AgentSessionEvent {
  // JSON round-trip normalises class instances, functions, and undefined values,
  // making the payload safe for structured clone across the IPC boundary.
  // Most SDK events are already POJOs; this is a lightweight safety net.
  try {
    return JSON.parse(JSON.stringify(event)) as AgentSessionEvent;
  } catch {
    // Fallback: let structured clone attempt it and surface any error.
    return event;
  }
}

export function subscribeToSession(
  session: AgentSession,
  post: (event: HostEvent) => void,
  onPostError?: (err: unknown) => void,
): () => void {
  return session.subscribe((event: AgentSessionEvent) => {
    try {
      post({ type: "agent_event", event: toSerializable(event) });
    } catch (err) {
      // post() can throw if the event is non-cloneable (circular reference in SDK update)
      // or if the port has already closed. Report as non-fatal rather than crashing the host.
      onPostError?.(err);
    }
  });
}

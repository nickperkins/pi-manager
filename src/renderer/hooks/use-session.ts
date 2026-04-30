import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import {
  applyEvent,
  buildViewItems,
  initialState,
  type MessageViewItem,
  type SessionViewState,
} from "../utils/session-view";
import {
  appendEntry,
  makeEventEntry,
  makeMessagesEntry,
  type EventLogEntry,
} from "../utils/debug-log";

export interface UseSessionResult {
  items: MessageViewItem[];
  isStreaming: boolean;
  isLoading: boolean;
  sendPrompt: (text: string) => void;
  abort: () => void;
  /** Returns a snapshot copy of the debug event log for this session lifecycle. */
  getEventLog: () => EventLogEntry[];
}

export function useSession(managerSessionId: string): UseSessionResult {
  const [viewState, setViewState] = useState(initialState);
  const [isLoading, setIsLoading] = useState(true);

  // Refs used inside the async setup so the closure stays current.
  const settledRef = useRef(false);
  const pendingEventsRef = useRef<AgentSessionEvent[]>([]);
  const cancelledRef = useRef(false);

  // Tracks the "generation" of get_messages calls. Incremented on:
  //   - every agent_start (invalidates any in-flight get_messages from the prior run)
  //   - every agent_end-triggered get_messages call (so only the latest response applies)
  const refreshGenRef = useRef(0);

  // ── Debug event log ────────────────────────────────────────────────────────
  const eventLogRef = useRef<EventLogEntry[]>([]);

  function logEvent(
    source: Parameters<typeof makeEventEntry>[1],
    event: AgentSessionEvent,
    label?: string,
  ): void {
    appendEntry(eventLogRef.current, makeEventEntry(eventLogRef.current, source, event, label));
  }
  function logMessages(messages: unknown[], label?: string): void {
    appendEntry(eventLogRef.current, makeMessagesEntry(eventLogRef.current, messages, label));
  }

  const getEventLog = useCallback((): EventLogEntry[] => [...eventLogRef.current], []);

  useEffect(() => {
    pendingEventsRef.current = [];
    cancelledRef.current = false;
    refreshGenRef.current = 0;
    eventLogRef.current = []; // reset log for new session lifecycle
    setViewState(initialState());
    setIsLoading(true);

    // Step 1: Subscribe to live events BEFORE attach to avoid a race.
    const unsub = window.api.session.onEvent(
      (id: string, event: AgentSessionEvent) => {
        if (id !== managerSessionId) return;

        if (!settledRef.current) {
          logEvent("live", event, "buffered-pre-settle");
          pendingEventsRef.current.push(event);
          return;
        }

        // agent_start: invalidate any pending get_messages response from the prior run.
        if (event.type === "agent_start") {
          refreshGenRef.current++;
          logEvent("live", event);
          setViewState((prev) => applyEvent(prev, event));
          return;
        }

        // agent_end: clear streaming flags immediately, then refresh from session.messages.
        if (event.type === "agent_end") {
          logEvent("live", event);
          setViewState((prev) => applyEvent(prev, event));
          const gen = refreshGenRef.current;
          void window.api.session.command(managerSessionId, {
            type: "get_messages",
            id: crypto.randomUUID(),
          }).then((response) => {
            if (cancelledRef.current || gen !== refreshGenRef.current) return;
            const msgs = getMessagesFromResponse(response);
            logMessages(msgs, "agent_end refresh");
            setViewState({ items: buildViewItems(msgs), isStreaming: false });
          }).catch((err) => console.error("[useSession] agent_end get_messages failed:", err));
          return;
        }

        logEvent("live", event);
        setViewState((prev) => applyEvent(prev, event));
      },
    );

    // Step 2: Attach — registers this renderer for live events and returns the ring buffer.
    async function setup(): Promise<void> {
      try {
        const { events } = await window.api.session.attach(managerSessionId);
        if (cancelledRef.current) return;

        // Step 3: Fetch the authoritative full message history from session.messages.
        // This is the ONLY correct base for the conversation view — ring buffer
        // agent_end.messages only contains the current run, not the full history.
        const response = await window.api.session.command(managerSessionId, {
          type: "get_messages",
          id: crypto.randomUUID(),
        });
        if (cancelledRef.current) return;

        const settledMessages = getMessagesFromResponse(response);
        logMessages(settledMessages, "setup");

        // Step 4: Build base view from settled history.
        let recovered: SessionViewState = {
          items: buildViewItems(settledMessages),
          isStreaming: false,
        };

        // Step 5: Build a Set of settled message timestamps for deduplication.
        // Used to skip ring-buffer message events that are already represented in
        // the settled base (avoids duplicate items for the same message).
        const settledTimestampSet = new Set<number>(
          settledMessages.map((m) => (m as { timestamp?: number }).timestamp ?? 0),
        );

        // Find the start of in-progress events: take only events that arrived AFTER
        // the last agent_end in the ring buffer. If there's no agent_end, apply all
        // ring-buffer events (first run, or buffer overflowed).
        let inProgressStartIndex = 0;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].type === "agent_end") {
            inProgressStartIndex = i + 1;
            break;
          }
        }

        // Step 6: Overlay the in-progress (streaming) portion from the ring buffer.
        // For message_* events, skip any whose timestamp is already in the settled Set
        // (prevents duplicating messages that committed to session.messages during
        // the window between our attach and get_messages calls).
        for (let i = inProgressStartIndex; i < events.length; i++) {
          const ev = events[i];
          if (
            ev.type === "message_start" ||
            ev.type === "message_update" ||
            ev.type === "message_end"
          ) {
            const ts =
              (ev as unknown as { message?: { timestamp?: number } }).message?.timestamp ?? 0;
            if (settledTimestampSet.has(ts)) {
              logEvent("ring-buffer", ev, "skipped-settled");
              continue;
            }
          }
          logEvent("ring-buffer", ev);
          recovered = applyEvent(recovered, ev);
        }

        if (!cancelledRef.current) setViewState(recovered);

        // Step 7: Flush buffered live events that arrived during setup.
        let hadAgentEnd = false;
        if (!cancelledRef.current) {
          for (const event of pendingEventsRef.current) {
            if (event.type === "agent_end") hadAgentEnd = true;
            logEvent("pending-flush", event);
            setViewState((prev) => applyEvent(prev, event));
          }
          pendingEventsRef.current = [];
          settledRef.current = true;
          setIsLoading(false);
        }

        // If a run completed while we were doing setup (agent_end in pending buffer),
        // our get_messages call was mid-run and may be stale. Refresh once more.
        if (hadAgentEnd && !cancelledRef.current) {
          const gen = refreshGenRef.current;
          void window.api.session.command(managerSessionId, {
            type: "get_messages",
            id: crypto.randomUUID(),
          }).then((r) => {
            if (cancelledRef.current || gen !== refreshGenRef.current) return;
            const msgs = getMessagesFromResponse(r);
            logMessages(msgs, "pending agent_end refresh");
            setViewState({ items: buildViewItems(msgs), isStreaming: false });
          }).catch((err) => console.error("[useSession] pending agent_end get_messages failed:", err));
        }
      } catch (err) {
        if (!cancelledRef.current) {
          console.error("[useSession] setup error:", err);
          pendingEventsRef.current = [];
          setIsLoading(false);
          settledRef.current = true;
        }
      }
    }

    void setup();

    return () => {
      cancelledRef.current = true;
      unsub();
      // Guard: window.api may be absent in test teardown after mocks are cleared.
      if (typeof window !== "undefined" && window.api) {
        void window.api.session.detach(managerSessionId);
      }
    };
  }, [managerSessionId]);

  const sendPrompt = useCallback(
    (text: string) => {
      void window.api.session.command(managerSessionId, {
        type: "prompt",
        id: crypto.randomUUID(),
        message: text,
      });
    },
    [managerSessionId],
  );

  const abort = useCallback(() => {
    void window.api.session.command(managerSessionId, {
      type: "abort",
      id: crypto.randomUUID(),
    });
  }, [managerSessionId]);

  return {
    items: viewState.items,
    isStreaming: viewState.isStreaming,
    isLoading,
    sendPrompt,
    abort,
    getEventLog,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the messages array from a get_messages command response. */
function getMessagesFromResponse(
  response: unknown,
): Parameters<typeof buildViewItems>[0] {
  return (
    (
      (response as { data?: { messages?: unknown[] } } | undefined)?.data?.messages ?? []
    ) as Parameters<typeof buildViewItems>[0]
  );
}

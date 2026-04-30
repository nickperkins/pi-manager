import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSession } from "../../../src/renderer/hooks/use-session";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage, UserMessage } from "@mariozechner/pi-ai";

// Capture the onEvent callback so tests can push live events.
let liveEventHandler: ((id: string, event: AgentSessionEvent) => void) | null = null;

function setupSessionApi(
  opts: {
    ringBuffer?: AgentSessionEvent[];
    messages?: unknown[];
    /** Optionally return different data per call index (0-based). */
    commandResponses?: Array<{ messages: unknown[] }>;
  } = {},
) {
  liveEventHandler = null;
  const detach = vi.fn().mockResolvedValue(undefined);

  let callCount = 0;
  const command = vi.fn().mockImplementation(() => {
    const responses = opts.commandResponses;
    const msgs = responses?.[callCount++]?.messages ?? opts.messages ?? [];
    return Promise.resolve({
      type: "response",
      id: "x",
      success: true,
      data: { messages: msgs },
    });
  });

  vi.stubGlobal("api", {
    session: {
      attach: vi.fn().mockResolvedValue({ events: opts.ringBuffer ?? [] }),
      detach,
      command,
      onEvent: vi.fn().mockImplementation(
        (cb: (id: string, event: AgentSessionEvent) => void) => {
          liveEventHandler = cb;
          return vi.fn(); // unsub
        },
      ),
    },
  });

  return { detach, command };
}

function userMsg(text: string, ts = 1000): UserMessage {
  return { role: "user", content: text, timestamp: ts };
}

function assistantMsg(text: string, ts = 2000): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic" as never,
    provider: "anthropic" as never,
    model: "claude-3",
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: ts,
  };
}

describe("useSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("starts with isLoading true and empty items", () => {
    setupSessionApi();
    const { result } = renderHook(() => useSession("sess-1"));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it("resolves to isLoading false after attach", async () => {
    setupSessionApi();
    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("always calls get_messages on attach to build the authoritative history base", async () => {
    // Even when ring buffer contains an agent_end, get_messages is the source of truth.
    // agent_end.messages is partial (current run only), so it must never be used as base.
    const agentEnd: AgentSessionEvent = {
      type: "agent_end",
      messages: [userMsg("ring-buffer-msg", 999)] as never,
    };
    const { command } = setupSessionApi({
      ringBuffer: [agentEnd],
      messages: [userMsg("full-history-msg", 1000)] as never[],
    });
    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // get_messages was called
    expect(command).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ type: "get_messages" }),
    );
    // Items come from get_messages, not from ring buffer's agent_end.messages
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ kind: "user", text: "full-history-msg" });
  });

  it("shows full multi-turn history from get_messages on attach", async () => {
    // Regression: previously only the last run was visible after agent_end replaced items.
    const history = [
      userMsg("turn 1", 100),
      userMsg("turn 2", 200),
      userMsg("turn 3", 300),
    ];
    setupSessionApi({ messages: history as never[] });
    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(3);
    expect(result.current.items[0]).toMatchObject({ text: "turn 1" });
    expect(result.current.items[2]).toMatchObject({ text: "turn 3" });
  });

  it("get_messages is called even when there is no agent_end in ring buffer", async () => {
    const { command } = setupSessionApi({ ringBuffer: [], messages: [userMsg("msg")] as never[] });
    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(command).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ type: "get_messages" }),
    );
    expect(result.current.items[0]).toMatchObject({ kind: "user", text: "msg" });
  });

  it("overlays in-progress ring buffer events on top of settled get_messages base", async () => {
    // Scenario: session has settled history (from get_messages) but is mid-stream.
    // Ring buffer contains: agent_end (last run), then agent_start + message_start (current run).
    const settledMsg = assistantMsg("settled response", 1000);
    const ringBuffer: AgentSessionEvent[] = [
      { type: "agent_end", messages: [settledMsg] as never },
      { type: "agent_start" },
      { type: "message_start", message: assistantMsg("", 2000) as never },
    ];
    setupSessionApi({
      ringBuffer,
      messages: [settledMsg] as never[], // get_messages returns settled history
    });
    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Should show settled item + streaming item
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]).toMatchObject({ kind: "assistant", text: "settled response", isStreaming: false });
    expect(result.current.items[1]).toMatchObject({ kind: "assistant", isStreaming: true });
    expect(result.current.isStreaming).toBe(true);
  });

  it("ring buffer timestamp filter prevents duplicate items for settled messages", async () => {
    // Scenario: ring buffer contains message_start/message_end for a message that is
    // also in get_messages (settled). The timestamp filter must skip those events.
    const settled = assistantMsg("already settled", 3000);
    const ringBuffer: AgentSessionEvent[] = [
      // No agent_end in ring buffer (simulates ring buffer overflow / first run scenario)
      { type: "agent_start" },
      { type: "message_start", message: settled as never },
      { type: "message_end", message: settled as never },
      // agent_end also settled (not in ring buffer in this scenario — run just completed
      // and message is now in session.messages but agent_end rolled out of buffer)
    ];
    setupSessionApi({
      ringBuffer,
      messages: [settled] as never[], // settled in session.messages
    });
    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Should show exactly ONE item, not two (the ring buffer events were filtered out)
    const assistantItems = result.current.items.filter((i) => i.kind === "assistant");
    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0]).toMatchObject({ text: "already settled", isStreaming: false });
  });

  it("applies live events after settle", async () => {
    setupSessionApi();
    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      liveEventHandler!("sess-1", { type: "agent_start" });
    });
    expect(result.current.isStreaming).toBe(true);
  });

  it("live agent_end clears streaming and triggers get_messages refresh", async () => {
    const initialMessages = [userMsg("before", 100)];
    const afterMessages = [userMsg("before", 100), userMsg("after", 200)];
    const { command } = setupSessionApi({
      messages: initialMessages as never[],
      commandResponses: [
        { messages: initialMessages }, // first call: setup get_messages
        { messages: afterMessages },   // second call: agent_end refresh
      ],
    });
    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Start a streaming run.
    act(() => liveEventHandler!("sess-1", { type: "agent_start" }));
    act(() => liveEventHandler!("sess-1", {
      type: "message_start",
      message: assistantMsg("", 2000) as never,
    }));
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.items.some((i) => i.kind === "assistant" && (i as { isStreaming: boolean }).isStreaming)).toBe(true);

    // agent_end fires — should clear streaming immediately, then refresh.
    await act(async () => {
      liveEventHandler!("sess-1", { type: "agent_end", messages: [] as never });
    });

    // command should have been called twice: once during setup, once for agent_end refresh.
    expect(command).toHaveBeenCalledTimes(2);
    expect(command).toHaveBeenNthCalledWith(
      2,
      "sess-1",
      expect.objectContaining({ type: "get_messages" }),
    );

    // After refresh, items reflect the new get_messages result.
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.items[1]).toMatchObject({ kind: "user", text: "after" });
  });

  it("agent_start invalidates pending get_messages response from prior agent_end", async () => {
    // Scenario: agent_end fires → get_messages call in-flight → agent_start fires
    // before the response arrives → the stale get_messages response must be ignored.
    let pendingResolve: ((v: unknown) => void) | null = null;
    let callCount = 0;
    liveEventHandler = null;

    vi.stubGlobal("api", {
      session: {
        attach: vi.fn().mockResolvedValue({ events: [] }),
        detach: vi.fn().mockResolvedValue(undefined),
        command: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // First call: setup get_messages — resolve immediately with empty messages.
            return Promise.resolve({ type: "response", id: "x", success: true, data: { messages: [] } });
          }
          // Second call: agent_end refresh — hold it so we can test invalidation.
          return new Promise((resolve) => { pendingResolve = resolve; });
        }),
        onEvent: vi.fn().mockImplementation(
          (cb: (id: string, event: AgentSessionEvent) => void) => {
            liveEventHandler = cb;
            return vi.fn();
          },
        ),
      },
    });

    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Fire agent_end → queues a get_messages call (now blocked).
    act(() => liveEventHandler!("sess-1", { type: "agent_end", messages: [] as never }));

    // Wait for the second command call to be initiated.
    await waitFor(() => expect(pendingResolve).not.toBeNull());

    // Before it resolves, fire agent_start → increments gen, invalidating the above.
    act(() => liveEventHandler!("sess-1", { type: "agent_start" }));
    expect(result.current.isStreaming).toBe(true);

    // Now resolve the stale get_messages — it should be discarded.
    await act(async () => {
      pendingResolve!({
        type: "response", id: "y", success: true,
        data: { messages: [userMsg("stale data", 999)] },
      });
    });

    // isStreaming must still be true (not clobbered by stale response).
    expect(result.current.isStreaming).toBe(true);
    // No stale items added.
    expect(result.current.items.filter((i) => i.kind === "user")).toHaveLength(0);
  });

  it("ignores live events for other session IDs", async () => {
    setupSessionApi();
    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      liveEventHandler!("DIFFERENT", { type: "agent_start" });
    });
    expect(result.current.isStreaming).toBe(false);
  });

  it("calls detach on unmount", async () => {
    const { detach } = setupSessionApi();
    const { unmount } = renderHook(() => useSession("sess-1"));
    await waitFor(() =>
      expect(vi.mocked(window.api.session.attach)).toHaveBeenCalled(),
    );
    unmount();
    expect(detach).toHaveBeenCalledWith("sess-1");
  });

  it("sendPrompt dispatches a prompt command", async () => {
    const { command } = setupSessionApi();
    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.sendPrompt("hello"));
    expect(command).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ type: "prompt", message: "hello" }),
    );
  });

  it("abort dispatches an abort command", async () => {
    const { command } = setupSessionApi();
    const { result } = renderHook(() => useSession("sess-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.abort());
    expect(command).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ type: "abort" }),
    );
  });

  it("run completing during setup triggers a second get_messages refresh", async () => {
    // Scenario: attach is slow; agent_end arrives as a live event while setup is
    // still in flight (pending buffer). The setup get_messages may be stale (captured
    // mid-run), so a second get_messages call must be made after flush.
    let resolveAttach!: (v: { events: AgentSessionEvent[] }) => void;
    liveEventHandler = null;
    let callCount = 0;
    const command = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Setup get_messages — stale (no messages yet, run still in progress).
        return Promise.resolve({ type: "response", id: "x", success: true, data: { messages: [] } });
      }
      // Second get_messages after agent_end flush — now has the full result.
      return Promise.resolve({
        type: "response", id: "y", success: true,
        data: { messages: [userMsg("hello", 100)] },
      });
    });
    vi.stubGlobal("api", {
      session: {
        attach: vi.fn().mockReturnValue(
          new Promise<{ events: AgentSessionEvent[] }>((r) => { resolveAttach = r; }),
        ),
        detach: vi.fn().mockResolvedValue(undefined),
        command,
        onEvent: vi.fn().mockImplementation(
          (cb: (id: string, event: AgentSessionEvent) => void) => {
            liveEventHandler = cb;
            return vi.fn();
          },
        ),
      },
    });

    const { result } = renderHook(() => useSession("sess-1"));

    // Fire agent_end while attach is still pending — it lands in pendingEventsRef.
    act(() => liveEventHandler!("sess-1", { type: "agent_end", messages: [] as never }));

    // Resolve attach — triggers setup continuation, flush, and second get_messages.
    act(() => resolveAttach({ events: [] }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Two get_messages calls: one during setup, one after the pending agent_end flush.
    expect(command).toHaveBeenCalledTimes(2);
    // Final state comes from the second (up-to-date) get_messages response.
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ kind: "user", text: "hello" });
  });

  it("buffers live events during attach and applies them in order after settle", async () => {
    // Use a deferred attach promise so we control when it resolves.
    let resolveAttach!: (v: { events: AgentSessionEvent[] }) => void;
    liveEventHandler = null;
    vi.stubGlobal("api", {
      session: {
        attach: vi.fn().mockReturnValue(
          new Promise<{ events: AgentSessionEvent[] }>((r) => { resolveAttach = r; }),
        ),
        detach: vi.fn().mockResolvedValue(undefined),
        command: vi.fn().mockResolvedValue({ type: "response", id: "x", success: true, data: { messages: [] } }),
        onEvent: vi.fn().mockImplementation(
          (cb: (id: string, event: AgentSessionEvent) => void) => {
            liveEventHandler = cb;
            return vi.fn();
          },
        ),
      },
    });

    const { result } = renderHook(() => useSession("sess-1"));

    // Fire a live event while attach is still pending — should be buffered.
    act(() => {
      liveEventHandler!("sess-1", { type: "agent_start" });
    });
    // Not applied yet because settledRef is false.
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isLoading).toBe(true);

    // Resolve attach — triggers setup continuation.
    act(() => {
      resolveAttach({ events: [] });
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // The buffered agent_start should now be applied.
    expect(result.current.isStreaming).toBe(true);
  });
});

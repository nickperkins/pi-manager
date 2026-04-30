import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSessionStats } from "../../../src/renderer/hooks/use-session-stats";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { SessionStatsData } from "../../../src/renderer/hooks/use-session-stats";

// ---------------------------------------------------------------------------
// Mock window.api
// ---------------------------------------------------------------------------

let liveEventHandler: ((id: string, event: AgentSessionEvent) => void) | null = null;

const mockStats: SessionStatsData = {
  tokens: { input: 100, output: 200, cacheRead: 0, cacheWrite: 0, total: 300 },
  cost: 0.0012,
  contextUsage: { tokens: 1000, contextWindow: 5000, percent: 20 },
};

function setupApi(opts: { statsData?: SessionStatsData | null } = {}) {
  liveEventHandler = null;
  const statsToReturn = opts.statsData !== undefined ? opts.statsData : mockStats;

  const command = vi.fn().mockResolvedValue({
    type: "response",
    id: "x",
    success: true,
    data: statsToReturn ? { stats: statsToReturn } : {},
  });

  vi.stubGlobal("api", {
    session: {
      command,
      onEvent: vi.fn().mockImplementation(
        (cb: (id: string, event: AgentSessionEvent) => void) => {
          liveEventHandler = cb;
          return vi.fn(); // unsub
        },
      ),
    },
  });

  return { command };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSessionStats", () => {
  it("returns null initially before fetch completes", () => {
    // Make command never resolve so we stay in loading state
    vi.stubGlobal("api", {
      session: {
        command: vi.fn().mockReturnValue(new Promise(() => {})),
        onEvent: vi.fn().mockReturnValue(vi.fn()),
      },
    });

    const { result } = renderHook(() => useSessionStats("session-1"));
    expect(result.current).toBeNull();
  });

  it("fetches stats on mount", async () => {
    const { command } = setupApi();

    const { result } = renderHook(() => useSessionStats("session-1"));

    await waitFor(() => expect(result.current).not.toBeNull());

    expect(command).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ type: "get_session_stats" }),
    );
    expect(result.current?.tokens.total).toBe(300);
    expect(result.current?.cost).toBe(0.0012);
  });

  it("re-fetches stats when agent_end fires", async () => {
    const updatedStats: SessionStatsData = {
      tokens: { input: 200, output: 400, cacheRead: 0, cacheWrite: 0, total: 600 },
      cost: 0.0024,
    };

    let callCount = 0;
    vi.stubGlobal("api", {
      session: {
        command: vi.fn().mockImplementation(() => {
          const stats = callCount++ === 0 ? mockStats : updatedStats;
          return Promise.resolve({
            type: "response",
            id: "x",
            success: true,
            data: { stats },
          });
        }),
        onEvent: vi.fn().mockImplementation(
          (cb: (id: string, event: AgentSessionEvent) => void) => {
            liveEventHandler = cb;
            return vi.fn();
          },
        ),
      },
    });

    const { result } = renderHook(() => useSessionStats("session-1"));

    // Wait for initial fetch
    await waitFor(() => expect(result.current?.tokens.total).toBe(300));

    // Fire agent_end
    act(() => {
      liveEventHandler?.("session-1", { type: "agent_end", messages: [] } as unknown as AgentSessionEvent);
    });

    // Should re-fetch and get updated stats
    await waitFor(() => expect(result.current?.tokens.total).toBe(600));
  });

  it("ignores agent_end events for other session IDs", async () => {
    const { command } = setupApi();

    const { result } = renderHook(() => useSessionStats("session-1"));
    await waitFor(() => expect(result.current).not.toBeNull());

    const callsBefore = command.mock.calls.length;

    act(() => {
      liveEventHandler?.("session-OTHER", { type: "agent_end", messages: [] } as unknown as AgentSessionEvent);
    });

    // No additional fetch
    expect(command.mock.calls.length).toBe(callsBefore);
  });

  it("ignores non-agent_end events", async () => {
    const { command } = setupApi();

    const { result } = renderHook(() => useSessionStats("session-1"));
    await waitFor(() => expect(result.current).not.toBeNull());

    const callsBefore = command.mock.calls.length;

    act(() => {
      liveEventHandler?.("session-1", { type: "agent_start" } as AgentSessionEvent);
    });

    expect(command.mock.calls.length).toBe(callsBefore);
  });

  it("does not update state after unmount", async () => {
    // Use a deferred promise to control when fetch resolves
    let resolveCommand!: (value: unknown) => void;
    const deferred = new Promise((r) => { resolveCommand = r; });

    vi.stubGlobal("api", {
      session: {
        command: vi.fn().mockReturnValue(deferred),
        onEvent: vi.fn().mockReturnValue(vi.fn()),
      },
    });

    const { result, unmount } = renderHook(() => useSessionStats("session-1"));
    expect(result.current).toBeNull();

    unmount();

    // Resolve after unmount — should not throw or update
    await act(async () => {
      resolveCommand({
        type: "response",
        id: "x",
        success: true,
        data: { stats: mockStats },
      });
    });

    // State should remain null (cancelled)
    expect(result.current).toBeNull();
  });

  it("handles missing stats gracefully (no data.stats in response)", async () => {
    setupApi({ statsData: null });

    const { result } = renderHook(() => useSessionStats("session-1"));

    // Wait a tick
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Stats remain null since response had no stats field
    expect(result.current).toBeNull();
  });
});

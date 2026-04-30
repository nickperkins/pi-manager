import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStatusDetail } from "../../../src/renderer/hooks/use-status-detail";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Mock window.api
// ---------------------------------------------------------------------------

let liveEventHandler: ((id: string, event: AgentSessionEvent) => void) | null = null;

function setupApi() {
  liveEventHandler = null;

  vi.stubGlobal("api", {
    session: {
      onEvent: vi.fn().mockImplementation(
        (cb: (id: string, event: AgentSessionEvent) => void) => {
          liveEventHandler = cb;
          return vi.fn(); // unsub
        },
      ),
    },
  });
}

function emit(id: string, event: Partial<AgentSessionEvent> & { type: string }) {
  liveEventHandler?.(id, event as AgentSessionEvent);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useStatusDetail", () => {
  it("starts with empty detail", () => {
    setupApi();
    const { result } = renderHook(() => useStatusDetail("session-1"));
    expect(result.current).toEqual({});
  });

  it("sets compactionReason on compaction_start", () => {
    setupApi();
    const { result } = renderHook(() => useStatusDetail("session-1"));

    act(() => {
      emit("session-1", { type: "compaction_start", reason: "threshold" });
    });

    expect(result.current.compactionReason).toBe("threshold");
  });

  it("clears compactionReason on compaction_end", () => {
    setupApi();
    const { result } = renderHook(() => useStatusDetail("session-1"));

    act(() => {
      emit("session-1", { type: "compaction_start", reason: "overflow" });
    });
    expect(result.current.compactionReason).toBe("overflow");

    act(() => {
      emit("session-1", { type: "compaction_end" });
    });
    expect(result.current.compactionReason).toBeUndefined();
  });

  it("sets retryInfo on auto_retry_start", () => {
    setupApi();
    const { result } = renderHook(() => useStatusDetail("session-1"));

    act(() => {
      emit("session-1", {
        type: "auto_retry_start",
        attempt: 2,
        maxAttempts: 5,
        delayMs: 3000,
        errorMessage: "Rate limit hit",
      });
    });

    expect(result.current.retryInfo).toEqual({
      attempt: 2,
      maxAttempts: 5,
      delayMs: 3000,
      errorMessage: "Rate limit hit",
    });
  });

  it("clears retryInfo on auto_retry_end", () => {
    setupApi();
    const { result } = renderHook(() => useStatusDetail("session-1"));

    act(() => {
      emit("session-1", {
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 1000,
        errorMessage: "Timeout",
      });
    });
    expect(result.current.retryInfo).toBeDefined();

    act(() => {
      emit("session-1", { type: "auto_retry_end", success: true, attempt: 1 });
    });
    expect(result.current.retryInfo).toBeUndefined();
  });

  it("ignores events for other session IDs", () => {
    setupApi();
    const { result } = renderHook(() => useStatusDetail("session-1"));

    act(() => {
      emit("session-OTHER", { type: "compaction_start", reason: "manual" });
    });

    expect(result.current.compactionReason).toBeUndefined();
  });

  it("preserves retryInfo when compaction changes", () => {
    setupApi();
    const { result } = renderHook(() => useStatusDetail("session-1"));

    act(() => {
      emit("session-1", {
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 500,
        errorMessage: "err",
      });
    });

    act(() => {
      emit("session-1", { type: "compaction_start", reason: "manual" });
    });

    // Both should be set
    expect(result.current.retryInfo).toBeDefined();
    expect(result.current.compactionReason).toBe("manual");
  });

  it("unsubscribes from events on unmount", () => {
    setupApi();
    const unsub = vi.fn();
    vi.mocked(window.api.session.onEvent).mockReturnValue(unsub);

    const { unmount } = renderHook(() => useStatusDetail("session-1"));
    unmount();

    expect(unsub).toHaveBeenCalledOnce();
  });
});

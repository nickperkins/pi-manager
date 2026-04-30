import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useManagerSessions } from "../../../src/renderer/hooks/use-manager-sessions";
import type { ManagerSessionRecord } from "@shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(id: string): ManagerSessionRecord {
  return {
    managerSessionId: id,
    name: `Session ${id}`,
    cwd: "/tmp",
    status: "idle",
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

// Captured onListChanged callback — lets tests push new lists reactively.
let listChangedCallback: ((sessions: ManagerSessionRecord[]) => void) | null =
  null;

const mockUnsub = vi.fn();

function setupApiMock(initialSessions: ManagerSessionRecord[] = []) {
  listChangedCallback = null;

  vi.stubGlobal("api", {
    manager: {
      list: vi.fn().mockResolvedValue(initialSessions),
      onListChanged: vi.fn().mockImplementation((cb) => {
        listChangedCallback = cb;
        return mockUnsub;
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useManagerSessions", () => {
  beforeEach(() => {
    mockUnsub.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty array initially, then populates from list()", async () => {
    setupApiMock([makeSession("a"), makeSession("b")]);

    const { result } = renderHook(() => useManagerSessions());

    // Starts empty before the async list() resolves
    expect(result.current).toEqual([]);

    // After list() resolves
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0].managerSessionId).toBe("a");
    expect(result.current[1].managerSessionId).toBe("b");
  });

  it("updates when onListChanged fires", async () => {
    setupApiMock([makeSession("a")]);

    const { result } = renderHook(() => useManagerSessions());
    await waitFor(() => expect(result.current).toHaveLength(1));

    // Simulate a live push
    act(() => {
      listChangedCallback!([makeSession("a"), makeSession("b")]);
    });

    expect(result.current).toHaveLength(2);
    expect(result.current[1].managerSessionId).toBe("b");
  });

  it("replaces the list entirely on each push", async () => {
    setupApiMock([makeSession("a"), makeSession("b"), makeSession("c")]);

    const { result } = renderHook(() => useManagerSessions());
    await waitFor(() => expect(result.current).toHaveLength(3));

    // Push a smaller list
    act(() => {
      listChangedCallback!([makeSession("x")]);
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].managerSessionId).toBe("x");
  });

  it("calls the unsubscribe function on unmount", async () => {
    setupApiMock([]);

    const { unmount } = renderHook(() => useManagerSessions());
    await waitFor(() =>
      expect(window.api.manager.onListChanged).toHaveBeenCalledOnce(),
    );

    unmount();

    expect(mockUnsub).toHaveBeenCalledOnce();
  });

  it("subscribes to onListChanged exactly once per mount", async () => {
    setupApiMock([]);

    const { unmount } = renderHook(() => useManagerSessions());
    await waitFor(() =>
      expect(window.api.manager.onListChanged).toHaveBeenCalledOnce(),
    );
    unmount();

    expect(window.api.manager.onListChanged).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSessionHistory } from "../../../src/renderer/hooks/use-session-history";

// ---------------------------------------------------------------------------
// Mock window.api
// ---------------------------------------------------------------------------

const mockReadHistory = vi.fn<[string], Promise<unknown[]>>();

function setupApi() {
  vi.stubGlobal("api", {
    session: {
      readHistory: mockReadHistory,
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe("useSessionHistory", () => {
  it("returns empty items and not loading when sessionFile is undefined", () => {
    setupApi();
    const { result } = renderHook(() =>
      useSessionHistory(undefined, true),
    );
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("returns empty items and not loading when isActive is false", () => {
    setupApi();
    const { result } = renderHook(() =>
      useSessionHistory("/tmp/test.jsonl", false),
    );
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("fetches history and converts to view items", async () => {
    setupApi();
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
        timestamp: 1000,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi!" }],
        timestamp: 2000,
      },
    ];
    mockReadHistory.mockResolvedValue(messages);

    const { result } = renderHook(() =>
      useSessionHistory("/tmp/test.jsonl", true),
    );

    // Starts loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].kind).toBe("user");
    expect(result.current.items[1].kind).toBe("assistant");
  });

  it("sets isLoading true while fetching", async () => {
    setupApi();
    let resolvePromise!: (value: unknown[]) => void;
    const promise = new Promise<unknown[]>((resolve) => {
      resolvePromise = resolve;
    });
    mockReadHistory.mockReturnValue(promise);

    const { result } = renderHook(() =>
      useSessionHistory("/tmp/test.jsonl", true),
    );

    expect(result.current.isLoading).toBe(true);

    resolvePromise([]);
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("returns empty items on fetch error", async () => {
    setupApi();
    mockReadHistory.mockRejectedValue(new Error("Failed"));

    const { result } = renderHook(() =>
      useSessionHistory("/tmp/test.jsonl", true),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
  });

  it("does not update state after unmount", async () => {
    setupApi();
    let resolvePromise!: (value: unknown[]) => void;
    const promise = new Promise<unknown[]>((resolve) => {
      resolvePromise = resolve;
    });
    mockReadHistory.mockReturnValue(promise);

    const { result, unmount } = renderHook(() =>
      useSessionHistory("/tmp/test.jsonl", true),
    );

    expect(result.current.isLoading).toBe(true);
    unmount();

    // Resolve after unmount — should not throw
    resolvePromise([
      { role: "user", content: [{ type: "text", text: "test" }], timestamp: 1 },
    ]);

    // Give microtasks a chance to run
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.items).toEqual([]);
  });

  it("re-fetches when sessionFile changes", async () => {
    setupApi();
    mockReadHistory.mockResolvedValue([]);

    const { rerender } = renderHook(
      ({ file }) => useSessionHistory(file, true),
      { initialProps: { file: "/tmp/a.jsonl" } },
    );

    await waitFor(() => {
      expect(mockReadHistory).toHaveBeenCalledWith("/tmp/a.jsonl");
    });

    rerender({ file: "/tmp/b.jsonl" });

    await waitFor(() => {
      expect(mockReadHistory).toHaveBeenCalledWith("/tmp/b.jsonl");
    });

    expect(mockReadHistory).toHaveBeenCalledWith("/tmp/a.jsonl");
    expect(mockReadHistory).toHaveBeenCalledWith("/tmp/b.jsonl");
  });
});

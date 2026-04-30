import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionBrowserDialog } from "../../../src/renderer/components/SessionBrowserDialog";
import type { DiscoveredSession } from "@shared/types";

// ---------------------------------------------------------------------------
// Mock window.api
// ---------------------------------------------------------------------------

const mockBrowse = vi.fn<[], Promise<DiscoveredSession[]>>();
const mockOpen = vi.fn<[opts: any], Promise<string>>();

function setupApi() {
  vi.stubGlobal("api", {
    manager: {
      browse: mockBrowse,
      open: mockOpen,
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const testSession: DiscoveredSession = {
  path: "/tmp/sessions/test.jsonl",
  id: "abc-123",
  cwd: "/tmp/project",
  name: "Test Session",
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-04-30T12:00:00.000Z",
  messageCount: 5,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionBrowserDialog", () => {
  it("calls manager.open only once on rapid double-click", async () => {
    setupApi();
    mockBrowse.mockResolvedValue([testSession]);

    let resolveOpen!: (v: string) => void;
    mockOpen.mockReturnValue(
      new Promise<string>((r) => { resolveOpen = r; }),
    );

    render(
      <SessionBrowserDialog open={true} onClose={vi.fn()} onOpened={vi.fn()} />,
    );

    await waitFor(() => screen.getByText("Test Session"));
    fireEvent.click(screen.getByText("Test Session"));

    const openBtn = screen.getByText("Open");
    fireEvent.click(openBtn);
    fireEvent.click(openBtn);

    resolveOpen("new-id");
    await waitFor(() => expect(mockOpen).toHaveBeenCalledTimes(1));
  });

  it("renders nothing when open is false", () => {
    setupApi();
    render(
      <SessionBrowserDialog open={false} onClose={vi.fn()} onOpened={vi.fn()} />,
    );
    expect(screen.queryByText("Open Session")).toBeNull();
  });

  it("shows loading state then renders session list", async () => {
    setupApi();
    mockBrowse.mockResolvedValue([testSession]);

    render(
      <SessionBrowserDialog open={true} onClose={vi.fn()} onOpened={vi.fn()} />,
    );

    expect(screen.getByText("Loading sessions…")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });
  });

  it("shows empty message when no sessions found", async () => {
    setupApi();
    mockBrowse.mockResolvedValue([]);

    render(
      <SessionBrowserDialog open={true} onClose={vi.fn()} onOpened={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("No sessions found")).toBeInTheDocument();
    });
  });

  it("shows error message when browse fails", async () => {
    setupApi();
    mockBrowse.mockRejectedValue(new Error("Disk error"));

    render(
      <SessionBrowserDialog open={true} onClose={vi.fn()} onOpened={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Disk error")).toBeInTheDocument();
    });
  });

  it("selects a session on click", async () => {
    setupApi();
    mockBrowse.mockResolvedValue([testSession]);

    render(
      <SessionBrowserDialog open={true} onClose={vi.fn()} onOpened={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Test Session"));

    // Open button should now be enabled
    expect(screen.getByText("Open")).toBeEnabled();
  });

  it("disables Open button when no session selected", async () => {
    setupApi();
    mockBrowse.mockResolvedValue([testSession]);

    render(
      <SessionBrowserDialog open={true} onClose={vi.fn()} onOpened={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });

    expect(screen.getByText("Open")).toBeDisabled();
  });

  it("calls onOpened with managerSessionId on open", async () => {
    setupApi();
    mockBrowse.mockResolvedValue([testSession]);
    mockOpen.mockResolvedValue("new-manager-id");
    const onOpened = vi.fn();

    render(
      <SessionBrowserDialog open={true} onClose={vi.fn()} onOpened={onOpened} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Test Session")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Test Session"));
    fireEvent.click(screen.getByText("Open"));

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledWith({
        sessionFile: "/tmp/sessions/test.jsonl",
        cwd: "/tmp/project",
        name: "Test Session",
      });
      expect(onOpened).toHaveBeenCalledWith("new-manager-id");
    });
  });

  it("closes on Escape key", async () => {
    setupApi();
    mockBrowse.mockResolvedValue([]);
    const onClose = vi.fn();

    render(
      <SessionBrowserDialog open={true} onClose={onClose} onOpened={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Open Session")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

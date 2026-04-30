import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../../src/renderer/App";
import type { ManagerSessionRecord } from "@shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(
  id: string,
  overrides: Partial<ManagerSessionRecord> = {},
): ManagerSessionRecord {
  return {
    managerSessionId: id,
    name: `Session ${id}`,
    cwd: `/workspace/${id}`,
    status: "idle",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Capture the onListChanged callback so tests can push live updates.
let listChangedCallback: ((sessions: ManagerSessionRecord[]) => void) | null =
  null;

function setupApiMock(initialSessions: ManagerSessionRecord[] = []) {
  listChangedCallback = null;
  vi.stubGlobal("api", {
    manager: {
      list: vi.fn().mockResolvedValue(initialSessions),
      onListChanged: vi.fn().mockImplementation((cb) => {
        listChangedCallback = cb;
        return vi.fn(); // unsub
      }),
      // NewSessionDialog also needs these — provide stubs so render doesn't throw
      pickFolder: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue("new-id"),
      close: vi.fn().mockResolvedValue(undefined),
      reopen: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      browse: vi.fn().mockResolvedValue([]),
    },
    session: {
      attach: vi.fn().mockResolvedValue({ events: [] }),
      detach: vi.fn().mockResolvedValue(undefined),
      command: vi.fn().mockResolvedValue({ type: "response", id: "x", success: true, data: { messages: [] } }),
      onEvent: vi.fn().mockReturnValue(vi.fn()),
      readHistory: vi.fn().mockResolvedValue([]),
    },
    dialog: {
      showAbout: vi.fn().mockResolvedValue(undefined),
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("App", () => {
  beforeEach(() => {
    setupApiMock([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ── Initial render ────────────────────────────────────────────────────────

  it("shows empty state when no sessions exist", async () => {
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByText("Select or create a session"),
      ).toBeInTheDocument(),
    );
  });

  it("shows session list when sessions exist on mount", async () => {
    setupApiMock([makeSession("a"), makeSession("b")]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Session a")).toBeInTheDocument(),
    );
    expect(screen.getByText("Session b")).toBeInTheDocument();
  });

  // ── Session selection ─────────────────────────────────────────────────────

  it("clicking a session shows its view in the right panel", async () => {
    const user = userEvent.setup();
    setupApiMock([makeSession("a")]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Session a")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Session a"));

    // SessionView header renders the session name in the main panel
    expect(within(screen.getByRole("main")).getByText("Session a")).toBeInTheDocument();
    // And the empty state is gone
    expect(
      screen.queryByText("Select or create a session"),
    ).not.toBeInTheDocument();
  });

  it("clicking a different session switches the active view", async () => {
    const user = userEvent.setup();
    setupApiMock([makeSession("a"), makeSession("b")]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Session a")).toBeInTheDocument(),
    );

    await user.click(screen.getByText("Session a"));
    // Session a visible in the main panel header
    expect(within(screen.getByRole("main")).getByText("Session a")).toBeInTheDocument();

    await user.click(screen.getByText("Session b"));
    // Session b now visible in the main panel header
    expect(within(screen.getByRole("main")).getByText("Session b")).toBeInTheDocument();
    // Session a is no longer in the main panel
    expect(within(screen.getByRole("main")).queryByText("Session a")).not.toBeInTheDocument();
  });

  // ── Auto-deselect ─────────────────────────────────────────────────────────

  it("reverts to empty state when the active session is removed from the list", async () => {
    const user = userEvent.setup();
    const sessionA = makeSession("a");
    setupApiMock([sessionA]);
    render(<App />);

    // Select session a
    await waitFor(() =>
      expect(screen.getByText("Session a")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Session a"));
    // Session a visible in the main panel header
    expect(within(screen.getByRole("main")).getByText("Session a")).toBeInTheDocument();

    // Push a list update that removes session a
    act(() => {
      listChangedCallback!([]);
    });

    await waitFor(() =>
      expect(
        screen.getByText("Select or create a session"),
      ).toBeInTheDocument(),
    );
    // Session a no longer in the main panel
    expect(within(screen.getByRole("main")).queryByText("Session a")).not.toBeInTheDocument();
  });

  it("keeps the active session when list updates but still contains it", async () => {
    const user = userEvent.setup();
    const sessionA = makeSession("a");
    const sessionB = makeSession("b");
    setupApiMock([sessionA]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Session a")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("Session a"));
    // Session a visible in the main panel header
    expect(within(screen.getByRole("main")).getByText("Session a")).toBeInTheDocument();

    // Push an update that adds b but keeps a
    act(() => {
      listChangedCallback!([sessionA, sessionB]);
    });

    // a is still active in the main panel
    expect(within(screen.getByRole("main")).getByText("Session a")).toBeInTheDocument();
    expect(
      screen.queryByText("Select or create a session"),
    ).not.toBeInTheDocument();
  });

  // ── New Session dialog ────────────────────────────────────────────────────

  it("opens the New Session dialog when '+ New Session' is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("+ New Session")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("+ New Session"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the New Session dialog when Cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("+ New Session")).toBeInTheDocument(),
    );
    await user.click(screen.getByText("+ New Session"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // ── Open Session button ───────────────────────────────────────────────────

  it("renders Open Session button in sidebar footer", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Open Session")).toBeInTheDocument(),
    );
  });

  it("clicking About button calls dialog.showAbout", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByLabelText("About Pi Manager")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("About Pi Manager"));
    expect(window.api.dialog.showAbout).toHaveBeenCalled();
  });

  // ── Context menu ──────────────────────────────────────────────────────────

  it("shows context menu on right-click", async () => {
    setupApiMock([makeSession("a")]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Session a")).toBeInTheDocument(),
    );

    // Right-click on session item
    const btn = screen.getByText("Session a").closest("button")!;
    fireEvent.contextMenu(btn);

    // Context menu should appear with Close action
    expect(screen.getByText("Close")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("closes session via context menu Close action", async () => {
    setupApiMock([makeSession("a")]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Session a")).toBeInTheDocument(),
    );

    const btn = screen.getByText("Session a").closest("button")!;
    fireEvent.contextMenu(btn);
    fireEvent.click(screen.getByText("Close"));

    expect(window.api.manager.close).toHaveBeenCalledWith("a");
  });

  it("reopens session via context menu Reopen action", async () => {
    setupApiMock([makeSession("a", { status: "archived" })]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Session a")).toBeInTheDocument(),
    );

    const btn = screen.getByText("Session a").closest("button")!;
    fireEvent.contextMenu(btn);
    fireEvent.click(screen.getByText("Reopen"));

    expect(window.api.manager.reopen).toHaveBeenCalledWith("a");
  });

  it("shows confirm dialog before delete", async () => {
    setupApiMock([makeSession("a")]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Session a")).toBeInTheDocument(),
    );

    const btn = screen.getByText("Session a").closest("button")!;
    fireEvent.contextMenu(btn);
    fireEvent.click(screen.getByText("Delete"));

    // Confirm dialog should appear
    expect(screen.getByText(/Delete "Session a"/)).toBeInTheDocument();
  });

  it("deletes session after confirmation", async () => {
    const user = userEvent.setup();
    setupApiMock([makeSession("a")]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Session a")).toBeInTheDocument(),
    );

    const btn = screen.getByText("Session a").closest("button")!;
    fireEvent.contextMenu(btn);
    fireEvent.click(screen.getByText("Delete"));

    // Confirm
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(window.api.manager.delete).toHaveBeenCalledWith("a");
  });

  it("closes context menu on overlay click", async () => {
    setupApiMock([makeSession("a")]);
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Session a")).toBeInTheDocument(),
    );

    const btn = screen.getByText("Session a").closest("button")!;
    fireEvent.contextMenu(btn);
    expect(screen.getByText("Close")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("context-menu-overlay"));
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
  });
});

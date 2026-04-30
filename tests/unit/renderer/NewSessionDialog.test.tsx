import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewSessionDialog } from "../../../src/renderer/components/NewSessionDialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ApiMockOpts {
  pickFolderResult?: string | null;
  createResult?: string | Promise<string>;
}

function setupApiMock({
  pickFolderResult = "/chosen/folder",
  createResult = "new-session-id",
}: ApiMockOpts = {}) {
  vi.stubGlobal("api", {
    manager: {
      pickFolder: vi.fn().mockResolvedValue(pickFolderResult),
      create: vi.fn().mockResolvedValue(createResult),
    },
  });
}

function renderDialog(
  props: Partial<{
    open: boolean;
    onClose: () => void;
    onCreated: (id: string) => void;
  }> = {},
) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const { rerender } = render(
    <NewSessionDialog
      open={props.open ?? true}
      onClose={props.onClose ?? onClose}
      onCreated={props.onCreated ?? onCreated}
    />,
  );
  return { onClose, onCreated, rerender };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NewSessionDialog", () => {
  beforeEach(() => {
    setupApiMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ── Visibility ────────────────────────────────────────────────────────────

  it("renders nothing when open is false", () => {
    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the dialog when open is true", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("New Session")).toBeInTheDocument();
  });

  // ── Create button disabled state ──────────────────────────────────────────

  it("Create button is disabled before a folder is chosen", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("Create button is enabled after a folder is chosen", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Browse…" }));
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });

  // ── Browse button ─────────────────────────────────────────────────────────

  it("clicking Browse calls pickFolder and shows the returned path", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Browse…" }));

    expect(window.api.manager.pickFolder).toHaveBeenCalledOnce();
    expect(screen.getByPlaceholderText("No folder selected")).toHaveValue(
      "/chosen/folder",
    );
  });

  it("pickFolder returning null leaves the cwd field empty", async () => {
    setupApiMock({ pickFolderResult: null });
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Browse…" }));

    expect(screen.getByPlaceholderText("No folder selected")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  // ── Create flow ───────────────────────────────────────────────────────────

  it("clicking Create calls manager.create with cwd and optional name", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Browse…" }));
    await user.type(screen.getByPlaceholderText("Session name"), "My Work");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(window.api.manager.create).toHaveBeenCalledWith({
      cwd: "/chosen/folder",
      name: "My Work",
    });
    expect(onCreated).toHaveBeenCalledWith("new-session-id");
  });

  it("omits name from create call when name field is left blank", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Browse…" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(window.api.manager.create).toHaveBeenCalledWith({
      cwd: "/chosen/folder",
      name: undefined,
    });
  });

  it("shows 'Creating…' and disables buttons while create is in-flight", async () => {
    let resolveCreate!: (id: string) => void;
    vi.stubGlobal("api", {
      manager: {
        pickFolder: vi.fn().mockResolvedValue("/folder"),
        create: vi.fn().mockReturnValue(
          new Promise<string>((res) => {
            resolveCreate = res;
          }),
        ),
      },
    });

    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Browse…" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    // Clean up
    resolveCreate("done");
  });

  it("shows error message and re-enables buttons when create rejects", async () => {
    vi.stubGlobal("api", {
      manager: {
        pickFolder: vi.fn().mockResolvedValue("/folder"),
        create: vi.fn().mockRejectedValue(new Error("Disk full")),
      },
    });

    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Browse…" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Disk full")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  // ── Cancel paths ──────────────────────────────────────────────────────────

  it("clicking Cancel calls onClose", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("pressing Escape calls onClose", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the backdrop calls onClose", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    // Click the overlay div (the backdrop), not the dialog box
    await user.click(screen.getByTestId("dialog-overlay"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking inside the dialog box does not call onClose", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    // Click the title inside the box
    await user.click(screen.getByText("New Session"));
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── State reset on reopen ─────────────────────────────────────────────────

  it("resets cwd and name when dialog is closed and reopened", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();

    const { rerender } = render(
      <NewSessionDialog open={true} onClose={onClose} onCreated={onCreated} />,
    );

    // Browse and type a name
    await user.click(screen.getByRole("button", { name: "Browse…" }));
    await user.type(screen.getByPlaceholderText("Session name"), "Old name");

    // Close and reopen
    rerender(
      <NewSessionDialog open={false} onClose={onClose} onCreated={onCreated} />,
    );
    rerender(
      <NewSessionDialog open={true} onClose={onClose} onCreated={onCreated} />,
    );

    expect(screen.getByPlaceholderText("No folder selected")).toHaveValue("");
    expect(screen.getByPlaceholderText("Session name")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });
});

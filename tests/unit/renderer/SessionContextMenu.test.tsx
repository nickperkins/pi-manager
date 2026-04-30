import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionContextMenu } from "../../../src/renderer/components/SessionContextMenu";
import type { ManagerSessionRecord } from "@shared/types";

function makeRecord(status: ManagerSessionRecord["status"]): ManagerSessionRecord {
  return {
    managerSessionId: "test",
    name: "Test",
    cwd: "/tmp",
    status,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionContextMenu", () => {
  it("shows Close for idle session", () => {
    render(
      <SessionContextMenu
        record={makeRecord("idle")}
        x={0} y={0}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Close")).toBeInTheDocument();
    expect(screen.queryByText("Reopen")).toBeNull();
  });

  it("shows Close for streaming session", () => {
    render(
      <SessionContextMenu
        record={makeRecord("streaming")}
        x={0} y={0}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Close")).toBeInTheDocument();
  });

  it("shows Reopen for archived session", () => {
    render(
      <SessionContextMenu
        record={makeRecord("archived")}
        x={0} y={0}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Reopen")).toBeInTheDocument();
    expect(screen.queryByText("Close")).toBeNull();
  });

  it("shows Reopen for stopped session", () => {
    render(
      <SessionContextMenu
        record={makeRecord("stopped")}
        x={0} y={0}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Reopen")).toBeInTheDocument();
  });

  it("shows Reopen for errored session", () => {
    render(
      <SessionContextMenu
        record={makeRecord("errored")}
        x={0} y={0}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Reopen")).toBeInTheDocument();
  });

  it("always shows Delete", () => {
    const { rerender } = render(
      <SessionContextMenu
        record={makeRecord("idle")}
        x={0} y={0}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete")).toBeInTheDocument();

    rerender(
      <SessionContextMenu
        record={makeRecord("archived")}
        x={0} y={0}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("calls onAction with action string when clicked", () => {
    const onAction = vi.fn();
    render(
      <SessionContextMenu
        record={makeRecord("idle")}
        x={0} y={0}
        onAction={onAction}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Close"));
    expect(onAction).toHaveBeenCalledWith("close");

    fireEvent.click(screen.getByText("Delete"));
    expect(onAction).toHaveBeenCalledWith("delete");
  });

  it("calls onClose when overlay is clicked", () => {
    const onClose = vi.fn();
    render(
      <SessionContextMenu
        record={makeRecord("idle")}
        x={0} y={0}
        onAction={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId("context-menu-overlay"));
    expect(onClose).toHaveBeenCalled();
  });

  it("positions menu at given x, y coordinates", () => {
    render(
      <SessionContextMenu
        record={makeRecord("idle")}
        x={100} y={200}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("100px");
    expect(menu.style.top).toBe("200px");
  });
});

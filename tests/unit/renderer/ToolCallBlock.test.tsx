import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolCallBlock } from "../../../src/renderer/components/ToolCallBlock";
import type { ToolCallViewItem } from "../../../src/renderer/utils/session-view";

function makeItem(overrides: Partial<ToolCallViewItem> = {}): ToolCallViewItem {
  return {
    kind: "tool_call",
    key: "tc1",
    toolCallId: "tc1",
    name: "bash",
    args: { command: "ls -la" },
    result: null,
    isError: false,
    isRunning: false,
    timestamp: 1000,
    ...overrides,
  };
}

describe("ToolCallBlock", () => {
  it("renders the tool name", () => {
    render(<ToolCallBlock item={makeItem()} />);
    expect(screen.getByText("bash")).toBeInTheDocument();
  });

  it("args are collapsed by default (JSON not visible)", () => {
    render(<ToolCallBlock item={makeItem()} />);
    expect(screen.queryByText(/ls -la/)).not.toBeInTheDocument();
  });

  it("clicking the header expands args", async () => {
    const user = userEvent.setup();
    render(<ToolCallBlock item={makeItem()} />);
    await user.click(screen.getByRole("button", { name: /Expand arguments for bash/i }));
    expect(screen.getByText(/ls -la/)).toBeInTheDocument();
  });

  it("shows spinner when isRunning is true", () => {
    render(<ToolCallBlock item={makeItem({ isRunning: true })} />);
    expect(screen.getByLabelText("Running")).toBeInTheDocument();
  });

  it("no spinner when isRunning is false", () => {
    render(<ToolCallBlock item={makeItem({ isRunning: false })} />);
    expect(screen.queryByLabelText("Running")).not.toBeInTheDocument();
  });

  it("result section absent when result is null", () => {
    render(<ToolCallBlock item={makeItem({ result: null })} />);
    expect(screen.queryByText("result")).not.toBeInTheDocument();
  });

  it("result section visible when result is non-null", () => {
    render(<ToolCallBlock item={makeItem({ result: "file.ts\nother.ts" })} />);
    // The "result" label is rendered even collapsed
    expect(screen.getByText("result")).toBeInTheDocument();
  });

  it("result content is collapsed by default", () => {
    render(<ToolCallBlock item={makeItem({ result: "file.ts" })} />);
    expect(screen.queryByText("file.ts")).not.toBeInTheDocument();
  });

  it("clicking result header expands result content", async () => {
    const user = userEvent.setup();
    render(<ToolCallBlock item={makeItem({ result: "file.ts" })} />);
    // There are two toggle buttons: args and result. Get the result one.
    const buttons = screen.getAllByRole("button");
    await user.click(buttons[buttons.length - 1]); // result toggle is last
    expect(screen.getByText("file.ts")).toBeInTheDocument();
  });

  it("shows 'error' label when isError is true", () => {
    render(<ToolCallBlock item={makeItem({ result: "err", isError: true })} />);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("applies tool-call-error class when isError is true", () => {
    const { container } = render(
      <ToolCallBlock item={makeItem({ result: "err", isError: true })} />,
    );
    expect(container.firstChild).toHaveClass("tool-call-error");
  });
});

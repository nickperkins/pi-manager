import { describe, it, expect } from "vitest";
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
  // ── Core rendering ─────────────────────────────────────────────────────

  it("renders the tool name", () => {
    render(<ToolCallBlock item={makeItem()} />);
    expect(screen.getByText("bash")).toBeInTheDocument();
  });

  it("shows spinner when isRunning is true", () => {
    render(<ToolCallBlock item={makeItem({ isRunning: true })} />);
    expect(screen.getByLabelText("Running")).toBeInTheDocument();
  });

  it("no spinner when isRunning is false", () => {
    render(<ToolCallBlock item={makeItem({ isRunning: false })} />);
    expect(screen.queryByLabelText("Running")).not.toBeInTheDocument();
  });

  it("applies tool-call-error class when isError is true", () => {
    const { container } = render(
      <ToolCallBlock item={makeItem({ result: "err", isError: true })} />,
    );
    expect(container.firstChild).toHaveClass("tool-call-error");
  });

  // ── Toggle behaviour ────────────────────────────────────────────────────

  it("bash/read/grep: header not clickable when result is null", () => {
    const { container } = render(<ToolCallBlock item={makeItem({ result: null })} />);
    expect(container.querySelector(".tool-call-header")).not.toHaveClass("tool-call-header-clickable");
  });

  it("bash: clicking header expands result", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({ result: "output text" })} />);
    await ue.click(screen.getByRole("button"));
    expect(screen.getByText("output text")).toBeInTheDocument();
  });

  it("bash: clicking header again collapses result", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({ result: "output text" })} />);
    const btn = screen.getByRole("button");
    await ue.click(btn);
    await ue.click(btn);
    expect(screen.queryByText("output text")).not.toBeInTheDocument();
  });

  it("shows 'result' label when expanded and not error", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({ result: "ok" })} />);
    await ue.click(screen.getByRole("button"));
    expect(screen.getByText("result")).toBeInTheDocument();
  });

  it("shows 'error' label when expanded and isError is true", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({ result: "err", isError: true })} />);
    await ue.click(screen.getByRole("button"));
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  // ── write ───────────────────────────────────────────────────────────────

  it("write: always expandable even when result is null", () => {
    const { container } = render(
      <ToolCallBlock item={makeItem({ name: "write", args: { path: "/a.ts", content: "hello" }, result: null })} />,
    );
    expect(container.querySelector(".tool-call-header")).toHaveClass("tool-call-header-clickable");
  });

  it("write: expanding shows args.content with 'written' label", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({
      name: "write",
      args: { path: "/a.ts", content: "const x = 1;" },
      result: null,
    })} />);
    await ue.click(screen.getByRole("button"));
    expect(screen.getByText("written")).toBeInTheDocument();
    expect(screen.getByText(/const x = 1;/)).toBeInTheDocument();
  });

  it("write: does not show result string", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({
      name: "write",
      args: { path: "/a.ts", content: "hello" },
      result: "Written 5 bytes to /a.ts",
    })} />);
    await ue.click(screen.getByRole("button"));
    expect(screen.queryByText(/Written 5 bytes/)).not.toBeInTheDocument();
  });

  // ── edit ────────────────────────────────────────────────────────────────

  it("edit: always expandable even when result is null", () => {
    const { container } = render(
      <ToolCallBlock item={makeItem({
        name: "edit",
        args: { path: "/a.ts", edits: [{ oldText: "old", newText: "new" }] },
        result: null,
      })} />,
    );
    expect(container.querySelector(".tool-call-header")).toHaveClass("tool-call-header-clickable");
  });

  it("edit: expanding shows diff with 'changes' label", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({
      name: "edit",
      args: { path: "/a.ts", edits: [{ oldText: "before", newText: "after" }] },
      result: null,
    })} />);
    await ue.click(screen.getByRole("button"));
    expect(screen.getByText("changes")).toBeInTheDocument();
  });

  it("edit: shows oldText with - prefix in diff", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({
      name: "edit",
      args: { path: "/a.ts", edits: [{ oldText: "before", newText: "after" }] },
      result: null,
    })} />);
    await ue.click(screen.getByRole("button"));
    // diffLines on single-line strings: "before" is removed, "after" is added
    expect(screen.getByText(/- before/)).toBeInTheDocument();
  });

  it("edit: shows newText with + prefix in diff", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({
      name: "edit",
      args: { path: "/a.ts", edits: [{ oldText: "before", newText: "after" }] },
      result: null,
    })} />);
    await ue.click(screen.getByRole("button"));
    expect(screen.getByText(/\+ after/)).toBeInTheDocument();
  });

  it("edit: context lines (unchanged) shown without +/- prefix", async () => {
    const ue = userEvent.setup();
    const { container } = render(<ToolCallBlock item={makeItem({
      name: "edit",
      args: {
        path: "/a.ts",
        edits: [{ oldText: "ctx\nold\nctx", newText: "ctx\nnew\nctx" }],
      },
      result: null,
    })} />);
    await ue.click(screen.getByRole("button"));
    expect(screen.getByText(/- old/)).toBeInTheDocument();
    expect(screen.getByText(/\+ new/)).toBeInTheDocument();
    // context lines get the diff-line-ctx class (not add/del)
    const ctxLines = container.querySelectorAll(".diff-line-ctx");
    expect(ctxLines.length).toBeGreaterThanOrEqual(1);
  });

  it("edit: shows 'edit N of M' index when multiple edits", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({
      name: "edit",
      args: {
        path: "/a.ts",
        edits: [
          { oldText: "a", newText: "b" },
          { oldText: "c", newText: "d" },
        ],
      },
      result: null,
    })} />);
    await ue.click(screen.getByRole("button"));
    expect(screen.getByText("edit 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("edit 2 of 2")).toBeInTheDocument();
  });

  it("edit: no index label for single edit", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({
      name: "edit",
      args: { path: "/a.ts", edits: [{ oldText: "a", newText: "b" }] },
      result: null,
    })} />);
    await ue.click(screen.getByRole("button"));
    expect(screen.queryByText(/edit \d of \d/)).not.toBeInTheDocument();
  });

  it("edit: does not show result string", async () => {
    const ue = userEvent.setup();
    render(<ToolCallBlock item={makeItem({
      name: "edit",
      args: { path: "/a.ts", edits: [{ oldText: "a", newText: "b" }] },
      result: "Successfully replaced 1 block(s)",
    })} />);
    await ue.click(screen.getByRole("button"));
    expect(screen.queryByText(/Successfully replaced/)).not.toBeInTheDocument();
  });

  // ── Emoji & category ────────────────────────────────────────────────────

  it.each([
    ["bash",  "⚡", "shell"],
    ["read",  "📖", "file-read"],
    ["write", "📝", "file-write"],
    ["edit",  "✏️",  "file-write"],
    ["grep",  "🔍", "search"],
    ["find",  "🔎", "search"],
    ["ls",    "📂", "search"],
  ])("%s renders emoji %s and category %s", (name, emoji, category) => {
    const { container } = render(<ToolCallBlock item={makeItem({ name })} />);
    expect(screen.getByText(emoji)).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute("data-tool-category", category);
  });

  it("unknown tool renders 🔧 and category 'unknown'", () => {
    const { container } = render(
      <ToolCallBlock item={makeItem({ name: "web_search" })} />,
    );
    expect(screen.getByText("🔧")).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute("data-tool-category", "unknown");
  });

  it("emoji has aria-hidden so screen readers skip it", () => {
    render(<ToolCallBlock item={makeItem({ name: "bash" })} />);
    expect(screen.getByText("⚡")).toHaveAttribute("aria-hidden", "true");
  });

  // ── Summary line ────────────────────────────────────────────────────────

  it("bash shows first line of command as summary", () => {
    render(<ToolCallBlock item={makeItem({ name: "bash", args: { command: "npm test" } })} />);
    expect(screen.getByText("npm test")).toBeInTheDocument();
  });

  it("bash truncates long commands to 60 chars", () => {
    const long = "a".repeat(70);
    render(<ToolCallBlock item={makeItem({ name: "bash", args: { command: long } })} />);
    expect(screen.getByText("a".repeat(60) + "…")).toBeInTheDocument();
  });

  it("bash shows only first line of multiline command", () => {
    render(<ToolCallBlock item={makeItem({ name: "bash", args: { command: "echo hello\necho world" } })} />);
    expect(screen.getByText("echo hello")).toBeInTheDocument();
    expect(screen.queryByText(/echo world/)).not.toBeInTheDocument();
  });

  it("read shows basename of path as summary", () => {
    render(<ToolCallBlock item={makeItem({ name: "read", args: { path: "/some/dir/file.ts" } })} />);
    expect(screen.getByText("file.ts")).toBeInTheDocument();
  });

  it("write shows basename of path as summary", () => {
    render(<ToolCallBlock item={makeItem({ name: "write", args: { path: "/a/b/out.json", content: "{}" } })} />);
    expect(screen.getByText("out.json")).toBeInTheDocument();
  });

  it("edit shows basename of path as summary", () => {
    render(<ToolCallBlock item={makeItem({ name: "edit", args: { path: "/src/foo.tsx", edits: [] } })} />);
    expect(screen.getByText("foo.tsx")).toBeInTheDocument();
  });

  it("grep shows pattern wrapped in slashes as summary", () => {
    render(<ToolCallBlock item={makeItem({ name: "grep", args: { pattern: "useState" } })} />);
    expect(screen.getByText("/useState/")).toBeInTheDocument();
  });

  it("unknown tool shows no summary", () => {
    const { container } = render(
      <ToolCallBlock item={makeItem({ name: "web_search", args: { query: "test" } })} />,
    );
    expect(container.querySelector(".tool-call-summary")).toBeNull();
  });

  it("tool with missing expected arg shows no summary", () => {
    const { container } = render(<ToolCallBlock item={makeItem({ name: "read", args: {} })} />);
    expect(container.querySelector(".tool-call-summary")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageBubble } from "../../../src/renderer/components/MessageBubble";
import type { AssistantViewItem, UserViewItem } from "../../../src/renderer/utils/session-view";

const user: UserViewItem = {
  kind: "user",
  key: "u1",
  text: "Hello agent",
  timestamp: 1000,
};

function assistant(overrides: Partial<AssistantViewItem> = {}): AssistantViewItem {
  return {
    kind: "assistant",
    key: "a1",
    thinking: "",
    text: "I am an assistant",
    isStreaming: false,
    timestamp: 2000,
    ...overrides,
  };
}

describe("MessageBubble", () => {
  it("renders user bubble with correct text", () => {
    render(<MessageBubble item={user} />);
    expect(screen.getByText("Hello agent")).toBeInTheDocument();
  });

  it("user bubble has 'user' class", () => {
    const { container } = render(<MessageBubble item={user} />);
    expect(container.firstChild).toHaveClass("user");
  });

  it("renders assistant bubble with text", () => {
    const { container } = render(<MessageBubble item={assistant()} />);
    // react-markdown wraps plain text in a <p>
    expect(container.querySelector(".message-markdown")).toHaveTextContent("I am an assistant");
  });

  it("assistant bubble has 'assistant' class", () => {
    const { container } = render(<MessageBubble item={assistant()} />);
    expect(container.firstChild).toHaveClass("assistant");
  });

  it("no thinking toggle when thinking is empty", () => {
    render(<MessageBubble item={assistant({ thinking: "" })} />);
    expect(screen.queryByRole("button", { name: /Thinking/ })).not.toBeInTheDocument();
  });

  it("thinking toggle visible when thinking is non-empty", () => {
    render(<MessageBubble item={assistant({ thinking: "deep thoughts" })} />);
    expect(screen.getByRole("button", { name: /Thinking/ })).toBeInTheDocument();
  });

  it("thinking content hidden by default", () => {
    render(<MessageBubble item={assistant({ thinking: "deep thoughts" })} />);
    expect(screen.queryByText("deep thoughts")).not.toBeInTheDocument();
  });

  it("clicking thinking toggle shows thinking content", async () => {
    const ue = userEvent.setup();
    render(<MessageBubble item={assistant({ thinking: "deep thoughts" })} />);
    await ue.click(screen.getByRole("button", { name: /Thinking/ }));
    expect(screen.getByText("deep thoughts")).toBeInTheDocument();
  });

  it("clicking thinking toggle again hides thinking content", async () => {
    const ue = userEvent.setup();
    render(<MessageBubble item={assistant({ thinking: "deep thoughts" })} />);
    const btn = screen.getByRole("button", { name: /Thinking/ });
    await ue.click(btn);
    await ue.click(btn);
    expect(screen.queryByText("deep thoughts")).not.toBeInTheDocument();
  });

  it("streaming cursor present when isStreaming is true", () => {
    render(<MessageBubble item={assistant({ isStreaming: true })} />);
    expect(screen.getByLabelText("Streaming")).toBeInTheDocument();
  });

  it("streaming cursor absent when isStreaming is false", () => {
    render(<MessageBubble item={assistant({ isStreaming: false })} />);
    expect(screen.queryByLabelText("Streaming")).not.toBeInTheDocument();
  });

  it("renders plain text (not markdown) while streaming", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "**hello**", isStreaming: true })} />,
    );
    // plain text path — no ReactMarkdown output
    expect(container.querySelector(".message-markdown")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(screen.getByText(/\*\*hello\*\*/)).toBeInTheDocument();
  });

  it("renders markdown once streaming ends", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "**hello**", isStreaming: false })} />,
    );
    expect(container.querySelector(".message-markdown")).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("hello");
  });

  it("streaming cursor is inline with text (inside .message-text span)", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "hi", isStreaming: true })} />,
    );
    const textSpan = container.querySelector(".message-text");
    expect(textSpan).toBeInTheDocument();
    expect(textSpan?.querySelector("[aria-label='Streaming']")).toBeInTheDocument();
  });

  // ── Markdown rendering ──────────────────────────────────────────────────

  it("renders user message as plain text — no markdown parsing", () => {
    render(<MessageBubble item={{ ...user, text: "**not bold** just text" }} />);
    // Literal text must be present; no <strong> should exist
    expect(screen.getByText("**not bold** just text")).toBeInTheDocument();
    expect(document.querySelector("strong")).toBeNull();
  });

  it("renders assistant bold text as <strong>", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "Hello **world**" })} />,
    );
    expect(container.querySelector("strong")).toHaveTextContent("world");
  });

  it("renders assistant italic text as <em>", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "Hello _world_" })} />,
    );
    expect(container.querySelector("em")).toHaveTextContent("world");
  });

  it("renders assistant inline code as <code>", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "`npm install`" })} />,
    );
    expect(container.querySelector("code")).toHaveTextContent("npm install");
  });

  it("renders fenced code block as <pre><code>", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "```ts\nconst x = 1;\n```" })} />,
    );
    expect(container.querySelector("pre")).toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent("const x = 1;");
  });

  it("renders h2 heading", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "## Section Title" })} />,
    );
    expect(container.querySelector("h2")).toHaveTextContent("Section Title");
  });

  it("renders h1 heading", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "# Top Heading" })} />,
    );
    expect(container.querySelector("h1")).toHaveTextContent("Top Heading");
  });

  it("renders unordered list as <ul><li>", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "- alpha\n- beta\n- gamma" })} />,
    );
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("alpha");
    expect(items[1]).toHaveTextContent("beta");
  });

  it("renders ordered list as <ol><li>", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "1. first\n2. second" })} />,
    );
    expect(container.querySelector("ol")).toBeInTheDocument();
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
  });

  it("assistant message is wrapped in .message-markdown container when not streaming", () => {
    const { container } = render(<MessageBubble item={assistant()} />);
    expect(container.querySelector(".message-markdown")).toBeInTheDocument();
  });

  it("renders GFM table as <table>", () => {
    const { container } = render(
      <MessageBubble
        item={assistant({
          text: "| A | B |\n|---|---|\n| 1 | 2 |",
        })}
      />,
    );
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelector("th")).toHaveTextContent("A");
    expect(container.querySelector("td")).toHaveTextContent("1");
  });

  it("omits .message-markdown when text is empty and not streaming", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "", isStreaming: false })} />,
    );
    // pure tool-call message — entire component returns null
    expect(container.firstChild).toBeNull();
  });

  it("shows streaming cursor with no text when streaming has just started", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "", isStreaming: true })} />,
    );
    // streaming path renders plain text span, not markdown div
    expect(container.querySelector(".message-markdown")).toBeNull();
    expect(container.querySelector("[aria-label='Streaming']")).toBeInTheDocument();
  });

  it("renders GFM strikethrough as <del>", () => {
    const { container } = render(
      <MessageBubble item={assistant({ text: "~~old~~" })} />,
    );
    expect(container.querySelector("del")).toHaveTextContent("old");
  });

  it("markdown links open in a new tab (target=_blank)", () => {
    render(<MessageBubble item={assistant({ text: "[pi](https://pi.dev)" })} />);
    const link = screen.getByRole("link", { name: "pi" });
    expect(link).toHaveAttribute("href", "https://pi.dev");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("user message has no .message-markdown container", () => {
    const { container } = render(<MessageBubble item={user} />);
    expect(container.querySelector(".message-markdown")).toBeNull();
  });
});

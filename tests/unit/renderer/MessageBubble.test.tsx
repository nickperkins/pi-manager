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
    render(<MessageBubble item={assistant()} />);
    expect(screen.getByText("I am an assistant")).toBeInTheDocument();
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
});

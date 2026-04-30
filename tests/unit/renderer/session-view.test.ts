import { describe, it, expect } from "vitest";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import {
  buildViewItems,
  applyEvent,
  initialState,
  type MessageViewItem,
  type SessionViewState,
} from "../../../src/renderer/utils/session-view";

// ── Test helpers ─────────────────────────────────────────────────────────────

function userMsg(text: string, ts = 1000): UserMessage {
  return { role: "user", content: text, timestamp: ts };
}

function userMsgArr(blocks: { type: "text"; text: string }[], ts = 1001): UserMessage {
  return { role: "user", content: blocks, timestamp: ts };
}

function assistantMsg(
  opts: {
    text?: string;
    thinking?: string;
    toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  },
  ts = 2000,
): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  if (opts.thinking)
    content.push({ type: "thinking", thinking: opts.thinking, thinkingSignature: "" });
  if (opts.text) content.push({ type: "text", text: opts.text });
  for (const tc of opts.toolCalls ?? []) {
    content.push({ type: "toolCall", id: tc.id, name: tc.name, arguments: tc.args });
  }
  return {
    role: "assistant",
    content,
    api: "anthropic" as never,
    provider: "anthropic" as never,
    model: "claude-3",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: ts,
  };
}

function toolResultMsg(
  toolCallId: string,
  result: string,
  isError = false,
  ts = 3000,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "bash",
    content: [{ type: "text", text: result }],
    isError,
    timestamp: ts,
  };
}

// ── buildViewItems ────────────────────────────────────────────────────────────

describe("buildViewItems", () => {
  it("returns empty array for empty input", () => {
    expect(buildViewItems([])).toEqual([]);
  });

  it("converts a string-content user message", () => {
    const items = buildViewItems([userMsg("hello") as unknown as AgentMessage]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "user", text: "hello", timestamp: 1000 });
  });

  it("extracts text from array-content user message", () => {
    const items = buildViewItems([
      userMsgArr([
        { type: "text", text: "foo" },
        { type: "text", text: "bar" },
      ]) as unknown as AgentMessage,
    ]);
    expect(items[0]).toMatchObject({ kind: "user", text: "foobar" });
  });

  it("extracts images from array-content user message as data URIs", () => {
    const items = buildViewItems([
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image", data: "abc123", mimeType: "image/png" },
          { type: "image", data: "def456", mimeType: "image/jpeg" },
        ],
        timestamp: 1000,
      } as unknown as AgentMessage,
    ]);
    expect(items[0]).toMatchObject({
      kind: "user",
      text: "look at this",
      images: [
        "data:image/png;base64,abc123",
        "data:image/jpeg;base64,def456",
      ],
    });
  });

  it("produces empty images array for string-content user message", () => {
    const items = buildViewItems([userMsg("hello") as unknown as AgentMessage]);
    expect(items[0]).toMatchObject({ kind: "user", images: [] });
  });

  it("produces empty images array for text-only array-content user message", () => {
    const items = buildViewItems([
      userMsgArr([{ type: "text", text: "hi" }]) as unknown as AgentMessage,
    ]);
    expect(items[0]).toMatchObject({ kind: "user", images: [] });
  });

  it("converts assistant message with text only", () => {
    const items = buildViewItems([assistantMsg({ text: "hi there" }) as unknown as AgentMessage]);
    expect(items[0]).toMatchObject({
      kind: "assistant",
      text: "hi there",
      thinking: "",
      isStreaming: false,
    });
  });

  it("extracts thinking block", () => {
    const items = buildViewItems([
      assistantMsg({ thinking: "deliberating", text: "answer" }) as unknown as AgentMessage,
    ]);
    expect(items[0]).toMatchObject({ thinking: "deliberating", text: "answer" });
  });

  it("emits tool call items for each tool call in assistant message", () => {
    const items = buildViewItems([
      assistantMsg({
        toolCalls: [{ id: "tc1", name: "bash", args: { command: "ls" } }],
      }) as unknown as AgentMessage,
    ]);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      kind: "tool_call",
      toolCallId: "tc1",
      name: "bash",
      args: { command: "ls" },
      result: null,
      isRunning: false,
    });
  });

  it("patches tool call item with matching tool result", () => {
    const items = buildViewItems([
      assistantMsg({ toolCalls: [{ id: "tc1", name: "bash", args: {} }] }) as unknown as AgentMessage,
      toolResultMsg("tc1", "output text") as unknown as AgentMessage,
    ]);
    const callItem = items.find(
      (i) => i.kind === "tool_call" && (i as { toolCallId: string }).toolCallId === "tc1",
    );
    expect(callItem).toMatchObject({ result: "output text", isError: false });
  });

  it("handles error tool result", () => {
    const items = buildViewItems([
      assistantMsg({ toolCalls: [{ id: "tc1", name: "bash", args: {} }] }) as unknown as AgentMessage,
      toolResultMsg("tc1", "error msg", true) as unknown as AgentMessage,
    ]);
    const callItem = items.find((i) => i.kind === "tool_call") as { isError: boolean } | undefined;
    expect(callItem?.isError).toBe(true);
  });

  it("silently skips tool result with no matching call", () => {
    const items = buildViewItems([toolResultMsg("unknown", "result") as unknown as AgentMessage]);
    expect(items).toHaveLength(0);
  });

  it("handles a full sequence: user → assistant-with-tool → tool-result → user → assistant", () => {
    const msgs: AgentMessage[] = [
      userMsg("prompt 1", 100) as unknown as AgentMessage,
      assistantMsg(
        { toolCalls: [{ id: "tc1", name: "bash", args: { command: "ls" } }] },
        200,
      ) as unknown as AgentMessage,
      toolResultMsg("tc1", "file.ts", false, 300) as unknown as AgentMessage,
      userMsg("prompt 2", 400) as unknown as AgentMessage,
      assistantMsg({ text: "done" }, 500) as unknown as AgentMessage,
    ];
    const items = buildViewItems(msgs);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toEqual(["user", "assistant", "tool_call", "user", "assistant"]);
    const toolItem = items[2] as { result: string };
    expect(toolItem.result).toBe("file.ts");
  });
});

// ── applyEvent ────────────────────────────────────────────────────────────────

describe("applyEvent", () => {
  const empty = initialState();

  it("agent_start sets isStreaming to true", () => {
    const next = applyEvent(empty, { type: "agent_start" } as AgentSessionEvent);
    expect(next.isStreaming).toBe(true);
    expect(next.items).toEqual([]);
  });

  it("agent_end clears isStreaming but does NOT rebuild items from event.messages", () => {
    // agent_end.messages is a partial list (current run only); the full history
    // must come from get_messages. applyEvent must not clobber existing items.
    const state: SessionViewState = {
      items: [{ kind: "user", key: "user-100", text: "prior message", timestamp: 100 }],
      isStreaming: true,
    };
    const next = applyEvent(state, {
      type: "agent_end",
      messages: [userMsg("this run only") as unknown as AgentMessage],
    } as AgentSessionEvent);
    expect(next.isStreaming).toBe(false);
    // Prior item preserved — NOT replaced with event.messages
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({ kind: "user", text: "prior message" });
  });

  it("agent_end sets isStreaming: false on streaming assistant items and clears isRunning on tool calls", () => {
    // Build state with a streaming assistant item and a running tool call.
    let state = applyEvent(initialState(), {
      type: "message_start",
      message: assistantMsg({ text: "" }),
    } as AgentSessionEvent);
    state = applyEvent(state, {
      type: "message_end",
      message: assistantMsg({ toolCalls: [{ id: "tc1", name: "bash", args: {} }] }),
    } as AgentSessionEvent);
    state = applyEvent(state, {
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: {},
    } as AgentSessionEvent);
    expect(state.items.find((i) => i.kind === "tool_call")).toMatchObject({ isRunning: true });

    // agent_end should clear both streaming assistant flags AND running tool flags.
    state = applyEvent(state, { type: "agent_end", messages: [] } as AgentSessionEvent);
    expect(state.isStreaming).toBe(false);
    const toolItem = state.items.find((i) => i.kind === "tool_call");
    expect(toolItem).toMatchObject({ isRunning: false });
  });

  it("agent_end sets isStreaming: false on streaming assistant items", () => {
    let state = applyEvent(initialState(), {
      type: "message_start",
      message: assistantMsg({ text: "" }),
    } as AgentSessionEvent);
    expect(state.items[0]).toMatchObject({ isStreaming: true });
    state = applyEvent(state, {
      type: "agent_end",
      messages: [],
    } as AgentSessionEvent);
    expect(state.isStreaming).toBe(false);
    expect(state.items[0]).toMatchObject({ kind: "assistant", isStreaming: false });
  });

  it("message_start appends a streaming assistant item", () => {
    const next = applyEvent(empty, {
      type: "message_start",
      message: assistantMsg({ text: "" }),
    } as AgentSessionEvent);
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({ kind: "assistant", isStreaming: true, text: "" });
  });

  it("message_update updates the streaming assistant item text", () => {
    let state = applyEvent(empty, {
      type: "message_start",
      message: assistantMsg({ text: "" }),
    } as AgentSessionEvent);
    state = applyEvent(state, {
      type: "message_update",
      message: assistantMsg({ text: "partial" }),
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "partial",
        partial: assistantMsg({ text: "partial" }),
      },
    } as AgentSessionEvent);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ kind: "assistant", text: "partial" });
  });

  it("message_end for user role adds a user view item immediately", () => {
    // The SDK fires message_start/message_end for user prompts (and steering/follow-up
    // messages) before agent_start kicks off the assistant turn. We must show the
    // user message immediately rather than waiting for get_messages after agent_end.
    const next = applyEvent(empty, {
      type: "message_end",
      message: userMsg("hello from user", 5000) as unknown as AgentMessage,
    } as AgentSessionEvent);
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({
      kind: "user",
      key: "user-5000",
      text: "hello from user",
      timestamp: 5000,
    });
  });

  it("message_end for user role is idempotent — skips if key already present", () => {
    // Ring-buffer replay: buildViewItems already added this user message from
    // get_messages. The replayed message_end must not create a duplicate.
    const existing: MessageViewItem = {
      kind: "user",
      key: "user-5000",
      text: "hello from user",
      timestamp: 5000,
    };
    const state: SessionViewState = { items: [existing], isStreaming: false };
    const next = applyEvent(state, {
      type: "message_end",
      message: userMsg("hello from user", 5000) as unknown as AgentMessage,
    } as AgentSessionEvent);
    // Same reference — state unchanged.
    expect(next).toBe(state);
    expect(next.items).toHaveLength(1);
  });

  it("message_end finalises streaming item (no tool calls)", () => {
    let state = applyEvent(empty, {
      type: "message_start",
      message: assistantMsg({ text: "" }),
    } as AgentSessionEvent);
    state = applyEvent(state, {
      type: "message_end",
      message: assistantMsg({ text: "done" }),
    } as AgentSessionEvent);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      kind: "assistant",
      text: "done",
      isStreaming: false,
    });
  });

  it("message_end appends tool call items from tool calls", () => {
    let state = applyEvent(empty, {
      type: "message_start",
      message: assistantMsg({}),
    } as AgentSessionEvent);
    state = applyEvent(state, {
      type: "message_end",
      message: assistantMsg({
        toolCalls: [{ id: "tc1", name: "bash", args: { command: "pwd" } }],
      }),
    } as AgentSessionEvent);
    expect(state.items).toHaveLength(2);
    expect(state.items[1]).toMatchObject({
      kind: "tool_call",
      toolCallId: "tc1",
      isRunning: false,
      result: null,
    });
  });

  it("tool_execution_start sets isRunning on matching item", () => {
    let state = applyEvent(empty, {
      type: "message_end",
      message: assistantMsg({ toolCalls: [{ id: "tc1", name: "bash", args: {} }] }),
    } as AgentSessionEvent);
    state = applyEvent(state, {
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "ls" },
    } as AgentSessionEvent);
    const item = state.items.find((i) => i.kind === "tool_call") as { isRunning: boolean } | undefined;
    expect(item?.isRunning).toBe(true);
  });

  it("tool_execution_start does NOT mark running when tool call result is already set (settled)", () => {
    // Simulates ring-buffer replay where buildViewItems already patched the result.
    // The guard (result === null) prevents re-marking settled tool calls as running.
    let state = applyEvent(empty, {
      type: "message_end",
      message: assistantMsg({ toolCalls: [{ id: "tc1", name: "bash", args: {} }] }),
    } as AgentSessionEvent);
    // Settle the tool call via tool_execution_end first.
    state = applyEvent(state, {
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "bash",
      result: "output",
      isError: false,
    } as AgentSessionEvent);
    // Now replay tool_execution_start (ring-buffer replay scenario).
    state = applyEvent(state, {
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "ls" },
    } as AgentSessionEvent);
    const item = state.items.find((i) => i.kind === "tool_call") as
      | { isRunning: boolean; result: string }
      | undefined;
    expect(item?.result).toBe("output"); // result preserved
    expect(item?.isRunning).toBe(false); // NOT re-marked as running
  });

  it("tool_execution_end sets result and clears isRunning", () => {
    let state = applyEvent(empty, {
      type: "message_end",
      message: assistantMsg({ toolCalls: [{ id: "tc1", name: "bash", args: {} }] }),
    } as AgentSessionEvent);
    state = applyEvent(state, {
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "bash",
      result: "output here",
      isError: false,
    } as AgentSessionEvent);
    const item = state.items.find((i) => i.kind === "tool_call") as {
      result: string;
      isRunning: boolean;
    } | undefined;
    expect(item?.result).toBe("output here");
    expect(item?.isRunning).toBe(false);
  });

  it("tool_execution_end JSON-stringifies non-string results", () => {
    let state = applyEvent(empty, {
      type: "message_end",
      message: assistantMsg({ toolCalls: [{ id: "tc1", name: "bash", args: {} }] }),
    } as AgentSessionEvent);
    state = applyEvent(state, {
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "bash",
      result: { files: ["a.ts", "b.ts"] },
      isError: false,
    } as AgentSessionEvent);
    const item = state.items.find((i) => i.kind === "tool_call") as { result: string } | undefined;
    expect(item?.result).toContain('"files"');
  });

  it("marks isError on tool_execution_end with isError true", () => {
    let state = applyEvent(empty, {
      type: "message_end",
      message: assistantMsg({ toolCalls: [{ id: "tc1", name: "bash", args: {} }] }),
    } as AgentSessionEvent);
    state = applyEvent(state, {
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "bash",
      result: "error text",
      isError: true,
    } as AgentSessionEvent);
    const item = state.items.find((i) => i.kind === "tool_call") as { isError: boolean } | undefined;
    expect(item?.isError).toBe(true);
  });

  it("returns state unchanged for unknown event types", () => {
    const next = applyEvent(empty, {
      type: "queue_update",
      steering: [],
      followUp: [],
    } as AgentSessionEvent);
    expect(next).toBe(empty);
  });

  it("message_start skips non-assistant roles (e.g. tool result messages)", () => {
    // The SDK emits message_start/message_end for tool result messages too.
    // We must not create a spurious assistant bubble for them.
    const toolResultMsg = {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "bash",
      content: [{ type: "text", text: "some output" }],
      isError: false,
      timestamp: 5000,
    };
    const next = applyEvent(empty, {
      type: "message_start",
      message: toolResultMsg as never,
    } as AgentSessionEvent);
    // State must be unchanged — no new item added.
    expect(next).toBe(empty);
  });
});

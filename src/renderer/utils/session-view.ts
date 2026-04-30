import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";

// ── View model types ────────────────────────────────────────────────────────

export interface UserViewItem {
  kind: "user";
  key: string;
  text: string;
  /** Base64 data URIs for any images attached to this message (e.g. pasted in pi TUI). */
  images: string[];
  timestamp: number;
}

export interface AssistantViewItem {
  kind: "assistant";
  key: string;
  thinking: string;
  text: string;
  isStreaming: boolean;
  timestamp: number;
}

export interface ToolCallViewItem {
  kind: "tool_call";
  key: string;
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  result: string | null;
  isError: boolean;
  isRunning: boolean;
  timestamp: number;
}

export type MessageViewItem = UserViewItem | AssistantViewItem | ToolCallViewItem;

export interface SessionViewState {
  items: MessageViewItem[];
  isStreaming: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractUserContent(msg: UserMessage): { text: string; images: string[] } {
  if (typeof msg.content === "string") return { text: msg.content, images: [] };
  const text = msg.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
  const images = msg.content
    .filter((c): c is ImageContent => c.type === "image")
    .map((c) => `data:${c.mimeType};base64,${c.data}`);
  return { text, images };
}

function extractAssistantParts(content: AssistantMessage["content"]): {
  thinking: string;
  text: string;
  toolCalls: ToolCall[];
} {
  let thinking = "";
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of content) {
    if (block.type === "thinking") thinking += (block as ThinkingContent).thinking;
    else if (block.type === "text") text += (block as TextContent).text;
    else if (block.type === "toolCall") toolCalls.push(block as ToolCall);
  }
  return { thinking, text, toolCalls };
}

function toolCallsToViewItems(
  toolCalls: ToolCall[],
  timestamp: number,
): ToolCallViewItem[] {
  return toolCalls.map((tc) => ({
    kind: "tool_call" as const,
    key: tc.id,
    toolCallId: tc.id,
    name: tc.name,
    args: tc.arguments as Record<string, unknown>,
    result: null,
    isError: false,
    isRunning: false,
    timestamp,
  }));
}

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}

// ── Public API ───────────────────────────────────────────────────────────────

export function initialState(): SessionViewState {
  return { items: [], isStreaming: false };
}

/**
 * Convert a settled AgentMessage[] into a flat list of MessageViewItem[].
 * No external side effects — inputs are not mutated; output is deterministic.
 * Note: ToolCallViewItem objects in the output array are mutated in-place during
 * construction to patch in tool results via the internal callIndex Map.
 */
export function buildViewItems(messages: AgentMessage[]): MessageViewItem[] {
  const items: MessageViewItem[] = [];
  // Index of ToolCallViewItems by toolCallId so we can patch in results.
  const callIndex = new Map<string, ToolCallViewItem>();

  for (const msg of messages) {
    const role = (msg as { role: string }).role;

    if (role === "user") {
      const userMsg = msg as UserMessage;
      const { text, images } = extractUserContent(userMsg);
      items.push({
        kind: "user",
        key: `user-${userMsg.timestamp}`,
        text,
        images,
        timestamp: userMsg.timestamp,
      });
    } else if (role === "assistant") {
      const assistantMsg = msg as AssistantMessage;
      const { thinking, text, toolCalls } = extractAssistantParts(assistantMsg.content);
      items.push({
        kind: "assistant",
        key: `assistant-${assistantMsg.timestamp}`,
        thinking,
        text,
        isStreaming: false,
        timestamp: assistantMsg.timestamp,
      });
      for (const tc of toolCallsToViewItems(toolCalls, assistantMsg.timestamp)) {
        items.push(tc);
        callIndex.set(tc.toolCallId, tc);
      }
    } else if (role === "toolResult") {
      const trMsg = msg as ToolResultMessage;
      const existing = callIndex.get(trMsg.toolCallId);
      if (existing) {
        const resultStr = trMsg.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text)
          .join("");
        existing.result = resultStr;
        existing.isError = trMsg.isError;
      }
    }
    // Unknown roles (custom messages etc.) are silently skipped.
  }

  return items;
}

/**
 * Apply a single AgentSessionEvent to the current SessionViewState.
 * Pure reducer — never mutates, always returns new state or the same reference if
 * nothing changed.
 */
export function applyEvent(
  state: SessionViewState,
  event: AgentSessionEvent,
): SessionViewState {
  switch (event.type) {
    case "agent_start":
      return { ...state, isStreaming: true };

    case "agent_end":
      // Clear streaming flags only. Do NOT rebuild from event.messages — it contains
      // only the current run's messages, not the full history. The caller is responsible
      // for fetching the authoritative full history via get_messages after agent_end.
      return {
        items: state.items.map((item) => {
          if (item.kind === "assistant" && item.isStreaming)
            return { ...item, isStreaming: false };
          // Also clear any in-progress tool call spinners. If the run was aborted,
          // tool_execution_end may never arrive, leaving isRunning stuck.
          if (item.kind === "tool_call" && item.isRunning)
            return { ...item, isRunning: false };
          return item;
        }),
        isStreaming: false,
      };

    case "message_start": {
      const msg = event.message as AssistantMessage;
      // Tool-result messages also emit message_start/message_end; skip them here.
      // They are represented via ToolCallViewItem (patched by tool_execution_end), not
      // as assistant bubbles.
      if ((msg as unknown as { role: string }).role !== "assistant") return state;
      const { thinking, text } = extractAssistantParts(msg.content ?? []);
      const newItem: AssistantViewItem = {
        kind: "assistant",
        key: `streaming-${msg.timestamp}`,
        thinking,
        text,
        isStreaming: true,
        timestamp: msg.timestamp,
      };
      return { ...state, items: [...state.items, newItem] };
    }

    case "message_update": {
      const msg = event.message as AssistantMessage;
      const { thinking, text } = extractAssistantParts(msg.content ?? []);
      const ts = msg.timestamp;
      // Early-exit if no item will change — message_update fires at high frequency
      // during streaming and should not allocate unnecessarily when nothing matches.
      const target = state.items.find(
        (item) => item.kind === "assistant" && item.isStreaming && item.timestamp === ts,
      );
      if (!target) return state;
      const items = state.items.map((item) =>
        item === target ? { ...item, thinking, text } : item,
      );
      return { ...state, items };
    }

    case "message_end": {
      const msg = event.message;
      const role = (msg as { role: string }).role;

      // User messages (prompt, steering, follow-up) land in message_end too.
      // Add them as UserViewItems immediately rather than waiting for the
      // get_messages rebuild after agent_end.
      if (role === "user") {
        const userMsg = msg as UserMessage;
        const key = `user-${userMsg.timestamp}`;
        // Idempotent: skip if already present (e.g. ring-buffer replay after
        // buildViewItems already included this message from get_messages).
        if (state.items.some((i) => i.key === key)) return state;
        const { text, images } = extractUserContent(userMsg);
        return {
          ...state,
          items: [
            ...state.items,
            {
              kind: "user" as const,
              key,
              text,
              images,
              timestamp: userMsg.timestamp,
            },
          ],
        };
      }

      if (role !== "assistant") return state;
      const assistantMsg = msg as AssistantMessage;
      const ts = assistantMsg.timestamp;
      const { thinking, text, toolCalls } = extractAssistantParts(
        assistantMsg.content ?? [],
      );
      const toolCallItems = toolCallsToViewItems(toolCalls, assistantMsg.timestamp);

      const newItems: MessageViewItem[] = [];
      let replaced = false;
      for (const item of state.items) {
        if (item.kind === "assistant" && item.isStreaming && item.timestamp === ts && !replaced) {
          newItems.push({ ...item, thinking, text, isStreaming: false });
          for (const tc of toolCallItems) newItems.push(tc);
          replaced = true;
        } else {
          newItems.push(item);
        }
      }
      // If no streaming item was found (shouldn't happen), append finalised item.
      if (!replaced) {
        newItems.push({
          kind: "assistant",
          key: `assistant-${assistantMsg.timestamp}`,
          thinking,
          text,
          isStreaming: false,
          timestamp: assistantMsg.timestamp,
        });
        for (const tc of toolCallItems) newItems.push(tc);
      }
      return { ...state, items: newItems };
    }

    case "tool_execution_start": {
      // Guard: only mark running if result is null (not yet settled). This prevents
      // ring-buffer replay from re-marking already-settled tool calls as running.
      const items = state.items.map((item) =>
        item.kind === "tool_call" &&
        item.toolCallId === event.toolCallId &&
        item.result === null
          ? { ...item, isRunning: true, args: event.args as Record<string, unknown> }
          : item,
      );
      return { ...state, items };
    }

    case "tool_execution_end": {
      const items = state.items.map((item) =>
        item.kind === "tool_call" && item.toolCallId === event.toolCallId
          ? {
              ...item,
              result: resultText(event.result),
              isError: event.isError,
              isRunning: false,
            }
          : item,
      );
      return { ...state, items };
    }

    default:
      return state;
  }
}

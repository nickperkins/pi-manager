import React, { useLayoutEffect, useRef } from "react";
import type { MessageViewItem } from "../utils/session-view";
import { MessageBubble } from "./MessageBubble";
import { ToolCallBlock } from "./ToolCallBlock";

interface MessageListProps {
  items: MessageViewItem[];
  isStreaming: boolean;
}

export function MessageList({ items, isStreaming }: MessageListProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const stickyBottom = useRef(true);

  function onScroll(): void {
    const el = listRef.current;
    if (!el) return;
    stickyBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && (stickyBottom.current || isStreaming)) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items, isStreaming]);

  return (
    <div
      ref={listRef}
      className="message-list"
      onScroll={onScroll}
      role="log"
      aria-live="polite"
      aria-label="Conversation"
    >
      {items.map((item) => {
        if (item.kind === "tool_call") {
          return <ToolCallBlock key={item.key} item={item} />;
        }
        return <MessageBubble key={item.key} item={item} />;
      })}
    </div>
  );
}

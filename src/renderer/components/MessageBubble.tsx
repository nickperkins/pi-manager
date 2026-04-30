import React, { useState } from "react";
import type { AssistantViewItem, UserViewItem } from "../utils/session-view";

interface MessageBubbleProps {
  item: UserViewItem | AssistantViewItem;
}

export function MessageBubble({ item }: MessageBubbleProps): React.JSX.Element {
  const [thinkingOpen, setThinkingOpen] = useState(false);

  if (item.kind === "user") {
    return (
      <div className="message-bubble user">
        <span className="message-text">{item.text}</span>
      </div>
    );
  }

  // Assistant bubble
  const hasThinking = item.thinking.length > 0;

  return (
    <div className="message-bubble assistant">
      {hasThinking && (
        <div className="thinking-section">
          <button
            className="thinking-toggle"
            onClick={() => setThinkingOpen((v) => !v)}
            aria-expanded={thinkingOpen}
          >
            {thinkingOpen ? "▼ Thinking" : "▶ Thinking"}
          </button>
          {thinkingOpen && (
            <pre className="thinking-block">{item.thinking}</pre>
          )}
        </div>
      )}
      <span className="message-text">
        {item.text}
        {item.isStreaming && (
          <span className="streaming-cursor" aria-label="Streaming" />
        )}
      </span>
    </div>
  );
}

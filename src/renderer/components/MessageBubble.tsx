import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { AssistantViewItem, UserViewItem } from "../utils/session-view";

interface MessageBubbleProps {
  item: UserViewItem | AssistantViewItem;
}

export function MessageBubble({ item }: MessageBubbleProps): React.JSX.Element | null {
  const [thinkingOpen, setThinkingOpen] = useState(false);

  if (item.kind === "user") {
    return (
      <div className="message-bubble user">
        <span className="message-text">{item.text}</span>
      </div>
    );
  }

  // Nothing to show — pure tool-call message (no text, no thinking, not streaming)
  if (!item.thinking && !item.text && !item.isStreaming) {
    return null;
  }

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
      {item.isStreaming ? (
        // Plain text while streaming: avoids O(n²) markdown processor rebuilds
        // and keeps the cursor inline with the last character.
        // ReactMarkdown renders the fully-settled text once streaming ends.
        <span className="message-text">
          {item.text}
          <span className="streaming-cursor" aria-label="Streaming" />
        </span>
      ) : item.text ? (
        <div className="message-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {item.text}
          </ReactMarkdown>
        </div>
      ) : null}
    </div>
  );
}

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { AssistantViewItem, UserViewItem } from "../utils/session-view";

interface MessageBubbleProps {
  item: UserViewItem | AssistantViewItem;
}

// Open all markdown links in the OS browser, not inside Electron.
// The main process setWindowOpenHandler/will-navigate handlers are the safety
// net, but setting target + rel here makes the intent explicit.
// Images are disabled — agent output rarely contains them and allowing remote
// image loads in an Electron renderer is an unnecessary attack surface.
const markdownComponents = {
  a: ({ href, children }: React.ComponentProps<"a">) => (
    <a href={href} target="_blank" rel="noreferrer">{children}</a>
  ),
  img: () => null,
};

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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={markdownComponents}
          >
            {item.text}
          </ReactMarkdown>
        </div>
      ) : null}
    </div>
  );
}

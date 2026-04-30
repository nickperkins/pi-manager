import React, { useRef, useState } from "react";

interface PromptInputProps {
  isStreaming: boolean;
  onSubmit: (text: string) => void;
}

export function PromptInput({ isStreaming, onSubmit }: PromptInputProps): React.JSX.Element {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && !isStreaming) {
        onSubmit(trimmed);
        setValue("");
      }
    }
  }

  function handleSend(): void {
    const trimmed = value.trim();
    if (trimmed && !isStreaming) {
      onSubmit(trimmed);
      setValue("");
      textareaRef.current?.focus();
    }
  }

  return (
    <div className="prompt-area">
      <textarea
        ref={textareaRef}
        className="prompt-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isStreaming}
        placeholder={
          isStreaming
            ? "Agent is responding…"
            : "Send a message (Enter to send, Shift+Enter for newline)"
        }
        rows={1}
        aria-label="Prompt input"
      />
      <button
        className="btn-send"
        onClick={handleSend}
        disabled={isStreaming || !value.trim()}
        aria-label="Send"
      >
        ↑
      </button>
    </div>
  );
}

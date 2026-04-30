import React, { useState } from "react";
import type { ToolCallViewItem } from "../utils/session-view";

interface ToolCallBlockProps {
  item: ToolCallViewItem;
}

export function ToolCallBlock({ item }: ToolCallBlockProps): React.JSX.Element {
  const [argsOpen, setArgsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);

  return (
    <div className={`tool-call-block${item.isError ? " tool-call-error" : ""}`}>
      <div
        className="tool-call-header"
        onClick={() => setArgsOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setArgsOpen((v) => !v);
        }}
        aria-expanded={argsOpen}
        aria-label={`${argsOpen ? "Collapse" : "Expand"} arguments for ${item.name}`}
      >
        <span className="tool-call-toggle">{argsOpen ? "▼" : "▶"}</span>
        <span className="tool-call-name">{item.name}</span>
        {item.isRunning && (
          <span className="tool-call-spinner" aria-label="Running" />
        )}
      </div>

      {argsOpen && (
        <div className="tool-call-body">
          <div className="tool-call-section-label">args</div>
          <pre className="tool-call-code">{JSON.stringify(item.args, null, 2)}</pre>
        </div>
      )}

      {item.result !== null && (
        <div className="tool-call-result-section">
          <div
            className="tool-call-result-header"
            onClick={() => setResultOpen((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setResultOpen((v) => !v);
            }}
            aria-expanded={resultOpen}
            aria-label={`${resultOpen ? "Collapse" : "Expand"} ${item.isError ? "error" : "result"} for ${item.name}`}
          >
            <span className="tool-call-toggle">{resultOpen ? "▼" : "▶"}</span>
            <span className="tool-call-section-label">
              {item.isError ? "error" : "result"}
            </span>
          </div>
          {resultOpen && (
            <pre className="tool-call-code tool-call-result-code">{item.result}</pre>
          )}
        </div>
      )}
    </div>
  );
}

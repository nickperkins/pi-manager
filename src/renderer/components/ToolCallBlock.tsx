import { diffLines } from "diff";
import React, { useState } from "react";
import type { ToolCallViewItem } from "../utils/session-view";

interface ToolCallBlockProps {
  item: ToolCallViewItem;
}

interface ToolMeta {
  emoji: string;
  category: "shell" | "file-read" | "file-write" | "search" | "unknown";
}

function getToolMeta(name: string): ToolMeta {
  switch (name) {
    case "bash":  return { emoji: "⚡", category: "shell" };
    case "read":  return { emoji: "📖", category: "file-read" };
    case "write": return { emoji: "📝", category: "file-write" };
    case "edit":  return { emoji: "✏️",  category: "file-write" };
    case "grep":  return { emoji: "🔍", category: "search" };
    case "find":  return { emoji: "🔎", category: "search" };
    case "ls":    return { emoji: "📂", category: "search" };
    default:      return { emoji: "🔧", category: "unknown" };
  }
}

function getToolSummary(name: string, args: Record<string, unknown>): string | null {
  switch (name) {
    case "bash": {
      const cmd = typeof args.command === "string" ? args.command : null;
      if (!cmd) return null;
      const first = cmd.split("\n")[0].trim();
      return first.length > 60 ? first.slice(0, 60) + "…" : first;
    }
    case "read":
    case "write":
    case "edit":
    case "find":
    case "ls": {
      const p = typeof args.path === "string" ? args.path : null;
      if (!p) return null;
      return p.split("/").pop() ?? p;
    }
    case "grep": {
      const pattern = typeof args.pattern === "string" ? args.pattern : null;
      return pattern ? `/${pattern}/` : null;
    }
    default:
      return null;
  }
}

/** write and edit are always expandable because their content is in args from the start. */
function isExpandable(item: ToolCallViewItem): boolean {
  if (item.name === "write" || item.name === "edit") return true;
  return item.result !== null;
}

interface EditEntry {
  oldText: string;
  newText: string;
}

function EditDiff({ edits }: { edits: EditEntry[] }): React.JSX.Element {
  return (
    <div className="tool-call-diff">
      {edits.map((edit, i) => {
        const hunks = diffLines(edit.oldText, edit.newText);
        return (
          <div key={i} className="tool-call-diff-entry">
            {edits.length > 1 && (
              <div className="tool-call-diff-index">
                edit {i + 1} of {edits.length}
              </div>
            )}
            <pre className="tool-call-diff-body">
              {hunks.map((hunk, j) => {
                const lines = hunk.value.split("\n");
                // split("a\nb\n") → ["a","b",""] — drop the trailing empty element
                const trimmed =
                  lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
                const cls = hunk.added
                  ? "diff-line diff-line-add"
                  : hunk.removed
                    ? "diff-line diff-line-del"
                    : "diff-line diff-line-ctx";
                const prefix = hunk.added ? "+ " : hunk.removed ? "- " : "  ";
                return trimmed.map((line, k) => (
                  <span key={`${j}-${k}`} className={cls}>
                    {prefix}{line}{"\n"}
                  </span>
                ));
              })}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function ExpandedContent({ item }: { item: ToolCallViewItem }): React.JSX.Element {
  if (item.name === "write") {
    const content =
      typeof (item.args as Record<string, unknown>).content === "string"
        ? ((item.args as Record<string, unknown>).content as string)
        : "";
    return (
      <div className="tool-call-body">
        <div className="tool-call-section-label">written</div>
        <pre className="tool-call-code">{content}</pre>
      </div>
    );
  }

  if (item.name === "edit") {
    const rawEdits = (item.args as Record<string, unknown>).edits;
    const edits = Array.isArray(rawEdits) ? (rawEdits as EditEntry[]) : [];
    return (
      <div className="tool-call-body">
        <div className="tool-call-section-label">changes</div>
        <EditDiff edits={edits} />
      </div>
    );
  }

  return (
    <div className="tool-call-body">
      <div className="tool-call-section-label">
        {item.isError ? "error" : "result"}
      </div>
      <pre className="tool-call-code">{item.result}</pre>
    </div>
  );
}

export function ToolCallBlock({ item }: ToolCallBlockProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const { emoji, category } = getToolMeta(item.name);
  const summary = getToolSummary(item.name, item.args as Record<string, unknown>);
  const expandable = isExpandable(item);

  return (
    <div
      className={`tool-call-block${item.isError ? " tool-call-error" : ""}`}
      data-tool-category={category}
    >
      <div
        className={`tool-call-header${expandable ? " tool-call-header-clickable" : ""}`}
        onClick={() => { if (expandable) setOpen((v) => !v); }}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onKeyDown={(e) => {
          if (expandable && (e.key === "Enter" || e.key === " ")) setOpen((v) => !v);
        }}
        aria-expanded={expandable ? open : undefined}
        aria-label={
          expandable
            ? `${open ? "Collapse" : "Expand"} ${
                item.name === "write"
                  ? "written content"
                  : item.name === "edit"
                    ? "changes"
                    : item.isError
                      ? "error"
                      : "result"
              } for ${item.name}`
            : undefined
        }
      >
        <span className="tool-call-toggle">
          {expandable ? (open ? "▼" : "▶") : " "}
        </span>
        <span className="tool-call-emoji" aria-hidden="true">{emoji}</span>
        <span className="tool-call-name">{item.name}</span>
        {summary && (
          <span
            className="tool-call-summary"
            title={String(
              (item.args as Record<string, unknown>).path ??
              (item.args as Record<string, unknown>).command ??
              ""
            )}
          >
            {summary}
          </span>
        )}
        {item.isRunning && (
          <span className="tool-call-spinner" aria-label="Running" />
        )}
      </div>

      {open && expandable && <ExpandedContent item={item} />}
    </div>
  );
}

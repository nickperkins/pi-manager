import React, { useCallback, useEffect, useRef, useState } from "react";
import type { EventLogEntry, EventLogSource } from "../utils/debug-log";

interface DebugPanelProps {
  getEventLog: () => EventLogEntry[];
  onClose: () => void;
}

const SOURCE_COLORS: Record<EventLogSource, string> = {
  "ring-buffer":   "var(--debug-badge-ring)",
  "live":          "var(--debug-badge-live)",
  "pending-flush": "var(--debug-badge-pending)",
  "get_messages":  "var(--debug-badge-getmsg)",
};

function formatTs(base: number, receivedAt: number): string {
  const delta = receivedAt - base;
  return `+${delta.toFixed(0)}ms`;
}

function EntryRow({
  entry,
  baseTs,
}: {
  entry: EventLogEntry;
  baseTs: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const eventType = entry.event?.type ?? (entry.messages !== undefined ? "get_messages" : "?");
  const label = entry.label ? ` · ${entry.label}` : "";
  const badgeColor = SOURCE_COLORS[entry.source];

  const detail = entry.messages !== undefined
    ? { messageCount: entry.messages.length, messages: entry.messages }
    : entry.event;

  return (
    <div className="debug-entry">
      <div
        className="debug-entry-header"
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen((v) => !v); }}
      >
        <span className="debug-entry-seq">#{entry.seq}</span>
        <span className="debug-entry-time">{formatTs(baseTs, entry.receivedAt)}</span>
        <span className="debug-badge" style={{ background: badgeColor }}>{entry.source}</span>
        <span className="debug-entry-type">{eventType}{label}</span>
        <span className="debug-entry-chevron">{open ? "▼" : "▶"}</span>
      </div>
      {open && (
        <pre className="debug-entry-body">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function DebugPanel({ getEventLog, onClose }: DebugPanelProps): React.JSX.Element {
  const [entries, setEntries] = useState<EventLogEntry[]>(() => getEventLog());
  const [filter, setFilter] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);

  // Auto-refresh at 500ms while panel is open.
  useEffect(() => {
    const id = setInterval(() => {
      setEntries(getEventLog());
    }, 500);
    return () => clearInterval(id);
  }, [getEventLog]);

  // Stick to bottom when new entries arrive.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickyRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  function onScroll(): void {
    const el = listRef.current;
    if (!el) return;
    stickyRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  const copyJson = useCallback(() => {
    const data = JSON.stringify(getEventLog(), null, 2);
    void navigator.clipboard.writeText(data);
  }, [getEventLog]);

  const refresh = useCallback(() => setEntries(getEventLog()), [getEventLog]);

  const filtered = filter.trim()
    ? entries.filter(
        (e) =>
          (e.event?.type ?? "get_messages").includes(filter.trim()) ||
          (e.label ?? "").includes(filter.trim()) ||
          e.source.includes(filter.trim()),
      )
    : entries;

  const baseTs = entries[0]?.receivedAt ?? Date.now();

  return (
    <div className="debug-panel" role="complementary" aria-label="Debug event log">
      <div className="debug-panel-toolbar">
        <span className="debug-panel-title">🐛 Event Log ({entries.length})</span>
        <input
          className="debug-panel-filter"
          type="text"
          placeholder="filter by type / source / label…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter events"
        />
        <button className="debug-btn" onClick={refresh} title="Refresh">↺</button>
        <button className="debug-btn" onClick={copyJson} title="Copy all as JSON">⎘ Copy JSON</button>
        <button className="debug-btn debug-btn-close" onClick={onClose} title="Close" aria-label="Close debug panel">✕</button>
      </div>

      <div
        ref={listRef}
        className="debug-panel-list"
        onScroll={onScroll}
      >
        {filtered.length === 0 && (
          <div className="debug-empty">No events yet.</div>
        )}
        {filtered.map((entry) => (
          <EntryRow key={entry.seq} entry={entry} baseTs={baseTs} />
        ))}
      </div>
    </div>
  );
}

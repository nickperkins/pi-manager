import React, { useEffect, useRef, useState } from "react";
import type { DiscoveredSession } from "@shared/types";

interface SessionBrowserDialogProps {
  open: boolean;
  onClose: () => void;
  onOpened: (managerSessionId: string) => void;
}

export function SessionBrowserDialog({
  open,
  onClose,
  onOpened,
}: SessionBrowserDialogProps): React.JSX.Element | null {
  const [sessions, setSessions] = useState<DiscoveredSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const openingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setError(null);
    setLoading(true);
    window.api.manager
      .browse()
      .then((results) => {
        setSessions(results);
        setLoading(false);
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to browse sessions",
        );
        setLoading(false);
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  async function handleOpen(): Promise<void> {
    if (openingRef.current || !selected) return;
    openingRef.current = true;
    const session = sessions.find((s) => s.path === selected);
    if (!session) {
      openingRef.current = false;
      return;
    }
    setLoading(true);
    try {
      const id = await window.api.manager.open({
        sessionFile: session.path,
        cwd: session.cwd || ".",
        name: session.name,
      });
      onOpened(id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to open session",
      );
      setLoading(false);
    } finally {
      openingRef.current = false;
    }
  }

  return (
    <div
      className="dialog-overlay"
      data-testid="browser-overlay"
      onClick={onClose}
    >
      <div
        className="dialog-box session-browser-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-browser-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="session-browser-title" className="dialog-title">
          Open Session
        </h2>

        {loading && sessions.length === 0 && (
          <div className="session-browser-loading">
            <span className="loading-spinner" /> Loading sessions…
          </div>
        )}

        {error && <p className="dialog-error">{error}</p>}

        {!loading && sessions.length === 0 && !error && (
          <p className="session-browser-empty">No sessions found</p>
        )}

        {sessions.length > 0 && (
          <ul className="session-browser-list" role="listbox">
            {sessions.map((s) => (
              <li
                key={s.path}
                role="option"
                aria-selected={s.path === selected}
                className={`session-browser-item${s.path === selected ? " selected" : ""}`}
                onClick={() => setSelected(s.path)}
              >
                <span className="session-browser-name">
                  {s.name || s.id.slice(0, 8)}
                </span>
                <span className="session-browser-cwd" title={s.cwd}>
                  {s.cwd}
                </span>
                <span className="session-browser-meta">
                  {s.messageCount}{s.isCapped ? "+" : ""} msgs ·{" "}
                  {new Date(s.modified).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="dialog-actions">
          <button
            className="btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleOpen}
            disabled={!selected || loading}
          >
            {loading ? "Opening…" : "Open"}
          </button>
        </div>
      </div>
    </div>
  );
}

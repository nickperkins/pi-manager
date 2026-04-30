import React, { useEffect, useRef, useState } from "react";

interface NewSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (managerSessionId: string) => void;
}

export function NewSessionDialog({
  open,
  onClose,
  onCreated,
}: NewSessionDialogProps): React.JSX.Element | null {
  const [cwd, setCwd] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogBoxRef = useRef<HTMLDivElement>(null);

  // Reset state and move focus into the dialog when it opens
  useEffect(() => {
    if (open) {
      setCwd("");
      setName("");
      setError(null);
      setLoading(false);
      browseRef.current?.focus();
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  // Trap Tab focus within the dialog box
  function handleDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "Tab") return;
    const box = dialogBoxRef.current;
    if (!box) return;
    const focusable = Array.from(
      box.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  async function handleBrowse(): Promise<void> {
    const folder = await window.api.manager.pickFolder();
    if (folder !== null) {
      setCwd(folder);
      nameRef.current?.focus();
    }
  }

  async function handleCreate(): Promise<void> {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      const id = await window.api.manager.create({
        cwd,
        name: name.trim() || undefined,
      });
      onCreated(id);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to create session",
      );
      setLoading(false);
    }
  }

  return (
    <div
      className="dialog-overlay"
      data-testid="dialog-overlay"
      onClick={onClose}
    >
      <div
        ref={dialogBoxRef}
        className="dialog-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-session-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <h2 id="new-session-dialog-title" className="dialog-title">
          New Session
        </h2>

        <div className="dialog-field">
          <label className="dialog-label">Working directory</label>
          <div className="dialog-row">
            <input
              className="dialog-input"
              type="text"
              readOnly
              value={cwd}
              placeholder="No folder selected"
            />
            <button
              ref={browseRef}
              className="btn-browse"
              onClick={handleBrowse}
              disabled={loading}
            >
              Browse…
            </button>
          </div>
        </div>

        <div className="dialog-field">
          <label className="dialog-label" htmlFor="session-name-input">
            Session name{" "}
            <span className="dialog-optional">(optional)</span>
          </label>
          <input
            id="session-name-input"
            ref={nameRef}
            className="dialog-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Session name"
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && cwd) handleCreate();
            }}
          />
        </div>

        {error && <p className="dialog-error">{error}</p>}

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
            onClick={handleCreate}
            disabled={!cwd || loading}
          >
            {loading ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useRef } from "react";
import type { ManagerSessionRecord, SessionStatus } from "@shared/types";

interface ContextMenuAction {
  label: string;
  action: string;
  destructive?: boolean;
}

interface SessionContextMenuProps {
  record: ManagerSessionRecord;
  x: number;
  y: number;
  onAction: (action: string) => void;
  onClose: () => void;
}

function getActions(status: SessionStatus): ContextMenuAction[] {
  const isLive = !(
    ["stopped", "archived", "errored"] as const
  ).some((s) => s === status);
  const actions: ContextMenuAction[] = [];

  if (isLive) {
    actions.push({ label: "Close", action: "close" });
  } else {
    actions.push({ label: "Reopen", action: "reopen" });
  }
  actions.push({ label: "Delete", action: "delete", destructive: true });

  return actions;
}

export function SessionContextMenu({
  record,
  x,
  y,
  onAction,
  onClose,
}: SessionContextMenuProps): React.JSX.Element {
  const actions = getActions(record.status);
  const menuRef = useRef<HTMLUListElement>(null);

  // Clamp menu to viewport after mount so it never renders off-screen
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      el.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  return (
    <>
      <div
        className="context-menu-overlay"
        data-testid="context-menu-overlay"
        onClick={onClose}
      />
      <ul
        ref={menuRef}
        className="context-menu"
        role="menu"
        style={{ left: x, top: y }}
      >
        {actions.map((a) => (
          <li key={a.action} role="menuitem">
            <button
              className={`context-menu-item${a.destructive ? " destructive" : ""}`}
              onClick={() => onAction(a.action)}
            >
              {a.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

import React from "react";
import type { ManagerSessionRecord } from "@shared/types";
import { SessionItem } from "./SessionItem";

interface SidebarProps {
  sessions: ManagerSessionRecord[];
  activeId: string | null;
  onSelect: (managerSessionId: string) => void;
  onCreateRequest: () => void;
  onOpenSession: () => void;
  onAbout: () => void;
  onContextMenu?: (e: React.MouseEvent, record: ManagerSessionRecord) => void;
}

// errored sessions float to the top; otherwise newest first
export function sortSessions(
  sessions: ManagerSessionRecord[],
): ManagerSessionRecord[] {
  return [...sessions].sort((a, b) => {
    const aErr = a.status === "errored" ? 0 : 1;
    const bErr = b.status === "errored" ? 0 : 1;
    if (aErr !== bErr) return aErr - bErr;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onCreateRequest,
  onOpenSession,
  onAbout,
  onContextMenu,
}: SidebarProps): React.JSX.Element {
  const sorted = sortSessions(sessions);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Pi Manager</span>
        <button
          className="btn-about"
          onClick={onAbout}
          title="About Pi Manager"
          aria-label="About Pi Manager"
        >
          ⓘ
        </button>
      </div>
      <ul className="sidebar-list" role="list">
        {sorted.length === 0 && (
          <li className="sidebar-empty">No sessions yet</li>
        )}
        {sorted.map((s) => (
          <SessionItem
            key={s.managerSessionId}
            record={s}
            active={s.managerSessionId === activeId}
            onClick={() => onSelect(s.managerSessionId)}
            onContextMenu={onContextMenu}
          />
        ))}
      </ul>
      <div className="sidebar-footer">
        <button className="btn-new-session" onClick={onCreateRequest}>
          + New Session
        </button>
        <button className="btn-open-session" onClick={onOpenSession}>
          Open Session
        </button>
      </div>
    </aside>
  );
}

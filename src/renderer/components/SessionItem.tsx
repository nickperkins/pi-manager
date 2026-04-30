import React from "react";
import type { ManagerSessionRecord } from "@shared/types";

interface SessionItemProps {
  record: ManagerSessionRecord;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent, record: ManagerSessionRecord) => void;
}

export function SessionItem({
  record,
  active,
  onClick,
  onContextMenu,
}: SessionItemProps): React.JSX.Element {
  const shortCwd =
    record.cwd.length > 40 ? "…" + record.cwd.slice(-39) : record.cwd;

  return (
    <li>
      {/* button carries all interactive semantics; <li> keeps its listitem role */}
      <button
        className={`session-item${active ? " active" : ""}`}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu?.(e, record);
        }}
        aria-pressed={active}
      >
        <span
          className="status-dot"
          data-status={record.status}
          aria-hidden="true"
        />
        <span className="session-item-text">
          <span className="session-item-name">{record.name}</span>
          <span className="session-item-cwd" title={record.cwd}>
            {shortCwd}
          </span>
        </span>
      </button>
    </li>
  );
}

import React, { useEffect, useState } from "react";
import { useManagerSessions } from "./hooks/use-manager-sessions";
import { Sidebar } from "./components/Sidebar";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { SessionView } from "./components/SessionView";
import { SessionBrowserDialog } from "./components/SessionBrowserDialog";
import { SessionContextMenu } from "./components/SessionContextMenu";
import { ConfirmDialog } from "./components/ConfirmDialog";
import type { ManagerSessionRecord } from "@shared/types";

function App(): React.JSX.Element {
  const sessions = useManagerSessions();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    record: ManagerSessionRecord;
    x: number;
    y: number;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    destructive: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Auto-deselect if the active session disappears from the list.
  useEffect(() => {
    if (
      activeId !== null &&
      !sessions.find((s) => s.managerSessionId === activeId)
    ) {
      setActiveId(null);
    }
  }, [sessions, activeId]);

  const activeSession = sessions.find(
    (s) => s.managerSessionId === activeId,
  );

  // Context menu
  function handleContextMenu(
    e: React.MouseEvent,
    record: ManagerSessionRecord,
  ): void {
    setContextMenu({ record, x: e.clientX, y: e.clientY });
  }

  function handleContextAction(action: string): void {
    if (!contextMenu) return;
    const { record } = contextMenu;
    setContextMenu(null);

    switch (action) {
      case "close":
        void window.api.manager.close(record.managerSessionId);
        break;
      case "reopen":
        void window.api.manager.reopen(record.managerSessionId);
        setActiveId(record.managerSessionId);
        break;
      case "delete":
        setConfirm({
          title: "Delete Session",
          message: `Delete "${record.name}"? The session file will be kept.`,
          confirmLabel: "Delete",
          destructive: true,
          onConfirm: () => {
            setConfirm(null);
            void window.api.manager.delete(record.managerSessionId);
            if (activeId === record.managerSessionId) setActiveId(null);
          },
        });
        break;
    }
  }

  return (
    <div className="app-root">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onCreateRequest={() => setShowNewDialog(true)}
        onOpenSession={() => setShowBrowser(true)}
        onAbout={() => void window.api.dialog.showAbout()}
        onContextMenu={handleContextMenu}
      />
      <main className="session-area">
        {activeSession ? (
          <SessionView
            key={activeSession.managerSessionId}
            record={activeSession}
          />
        ) : (
          <div className="empty-state">Select or create a session</div>
        )}
      </main>
      <NewSessionDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        onCreated={(id) => {
          setActiveId(id);
          setShowNewDialog(false);
        }}
      />

      <SessionBrowserDialog
        open={showBrowser}
        onClose={() => setShowBrowser(false)}
        onOpened={(id) => {
          setActiveId(id);
          setShowBrowser(false);
        }}
      />

      {contextMenu && (
        <SessionContextMenu
          record={contextMenu.record}
          x={contextMenu.x}
          y={contextMenu.y}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={confirm?.confirmLabel}
        destructive={confirm?.destructive}
        onConfirm={() => confirm?.onConfirm()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

export default App;

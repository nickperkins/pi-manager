import React, { useState } from "react";
import type { ManagerSessionRecord, SessionStatus } from "@shared/types";
import { useSession } from "../hooks/use-session";
import { useSessionStats } from "../hooks/use-session-stats";
import { useStatusDetail } from "../hooks/use-status-detail";
import { useSessionHistory } from "../hooks/use-session-history";
import { MessageList } from "./MessageList";
import { PromptInput } from "./PromptInput";
import { DebugPanel } from "./DebugPanel";
import { StatsBar } from "./StatsBar";
import { StatusBanner } from "./StatusBanner";

interface SessionViewProps {
  record: ManagerSessionRecord;
}

/** Banner shown for archived/stopped sessions with a Reopen button. */
function ArchivedBanner({
  status,
  onReopen,
}: {
  status: string;
  onReopen: () => void;
}): React.JSX.Element {
  const label =
    status === "errored"
      ? "This session encountered an error"
      : status === "stopped"
        ? "This session was stopped"
        : "This session is archived";
  return (
    <div className="archived-banner" role="status">
      <span className="archived-banner-text">{label}</span>
      <button className="btn-reopen" onClick={onReopen}>
        Reopen
      </button>
    </div>
  );
}

export function SessionView({
  record,
}: SessionViewProps): React.JSX.Element {
  const liveStats = useSessionStats(record.managerSessionId);
  const detail = useStatusDetail(record.managerSessionId);
  const stats = liveStats ?? (record.lastStats ?? null);
  const [showDebug, setShowDebug] = useState(false);

  const terminalStatuses: readonly SessionStatus[] = ["archived", "stopped", "errored"];
  const isTerminal = terminalStatuses.includes(record.status);
  const hasSessionFile = !!record.sessionFile;

  // Live session path (unchanged from Phase 5)
  const liveSession = useSession(record.managerSessionId);
  const effectivelyStreaming =
    liveSession.isStreaming &&
    record.status !== "errored" &&
    record.status !== "stopped";

  // Offline history path (new in Phase 6)
  const history = useSessionHistory(
    record.sessionFile,
    isTerminal && hasSessionFile,
  );

  // Choose message source
  const items = isTerminal && hasSessionFile
    ? history.items
    : liveSession.items;
  const isLoading = isTerminal && hasSessionFile
    ? history.isLoading
    : liveSession.isLoading;
  const isStreaming = isTerminal ? false : effectivelyStreaming;

  return (
    <div className="session-view">
      <div className="session-view-header">
        <span className="session-view-name">{record.name}</span>
        <span
          className="status-dot"
          data-status={record.status}
          aria-hidden="true"
        />
        <span className="session-view-status">{record.status}</span>
        <button
          className="debug-toggle-btn"
          onClick={() => setShowDebug((v) => !v)}
          title="Toggle debug event log"
          aria-pressed={showDebug}
          aria-label="Toggle debug panel"
        >
          🐛
        </button>
      </div>

      <StatsBar stats={stats} />

      <StatusBanner
        status={record.status}
        detail={detail}
        errorMessage={record.errorMessage}
      />

      {isTerminal && hasSessionFile && (
        <ArchivedBanner
          status={record.status}
          onReopen={() =>
            window.api.manager.reopen(record.managerSessionId)
          }
        />
      )}

      {isLoading ? (
        <div className="session-loading" aria-label="Loading messages">
          <span className="loading-spinner" />
        </div>
      ) : (
        <MessageList items={items} isStreaming={isStreaming} />
      )}

      {showDebug && !isTerminal && (
        <DebugPanel
          getEventLog={liveSession.getEventLog}
          onClose={() => setShowDebug(false)}
        />
      )}

      {/* Only show prompt input for live sessions */}
      {!isTerminal && (
        <PromptInput
          isStreaming={effectivelyStreaming}
          onSubmit={liveSession.sendPrompt}
        />
      )}
    </div>
  );
}

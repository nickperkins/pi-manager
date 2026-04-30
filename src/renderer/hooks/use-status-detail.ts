import { useEffect, useState } from "react";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}

export interface StatusDetail {
  compactionReason?: "manual" | "threshold" | "overflow";
  retryInfo?: RetryInfo;
}

export function useStatusDetail(managerSessionId: string): StatusDetail {
  const [detail, setDetail] = useState<StatusDetail>({});

  useEffect(() => {
    const unsub = window.api.session.onEvent(
      (id: string, event: AgentSessionEvent) => {
        if (id !== managerSessionId) return;

        switch (event.type) {
          case "compaction_start":
            setDetail((prev) => ({
              ...prev,
              compactionReason: event.reason,
            }));
            break;
          case "compaction_end":
            setDetail((prev) => ({ ...prev, compactionReason: undefined }));
            break;
          case "auto_retry_start": {
            setDetail((prev) => ({
              ...prev,
              retryInfo: {
                attempt: event.attempt,
                maxAttempts: event.maxAttempts,
                delayMs: event.delayMs,
                errorMessage: event.errorMessage,
              },
            }));
            break;
          }
          case "auto_retry_end":
            setDetail((prev) => ({ ...prev, retryInfo: undefined }));
            break;
        }
      },
    );
    return () => unsub();
  }, [managerSessionId]);

  return detail;
}

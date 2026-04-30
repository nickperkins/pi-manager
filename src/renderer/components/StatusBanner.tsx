import React from "react";
import type { SessionStatus } from "@shared/types";
import type { StatusDetail } from "../hooks/use-status-detail";

interface StatusBannerProps {
  status: SessionStatus;
  detail: StatusDetail;
  errorMessage?: string;
}

export function StatusBanner({
  status,
  detail,
  errorMessage,
}: StatusBannerProps): React.JSX.Element | null {
  if (status === "compacting") {
    const reason = detail.compactionReason
      ? ` (${detail.compactionReason})`
      : "";
    return (
      <div className="status-banner status-banner-compacting" role="status">
        ⟳ Compacting context…{reason}
      </div>
    );
  }

  if (status === "retrying" && detail.retryInfo) {
    const { attempt, maxAttempts, errorMessage } = detail.retryInfo;
    return (
      <div className="status-banner status-banner-retrying" role="status">
        <span>↺ Retrying… attempt {attempt} / {maxAttempts}</span>
        {errorMessage && (
          <span className="status-banner-error-detail">{errorMessage}</span>
        )}
      </div>
    );
  }

  if (status === "errored") {
    const msg = errorMessage ?? "Unknown error";
    return (
      <div className="status-banner status-banner-errored" role="alert">
        ✕ Session error: {msg}
      </div>
    );
  }

  return null;
}

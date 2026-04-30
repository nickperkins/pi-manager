import React from "react";
import type { SessionStatsData } from "../hooks/use-session-stats";

interface StatsBarProps {
  stats: SessionStatsData | null;
}

function abbreviateTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function StatsBar({ stats }: StatsBarProps): React.JSX.Element | null {
  if (!stats) return null;

  const { tokens, cost, contextUsage } = stats;
  const pct = contextUsage?.percent ?? null;

  return (
    <div className="stats-bar" aria-label="Session statistics">
      <span className="stats-tokens">{abbreviateTokens(tokens.total)} tokens</span>
      {cost > 0 && (
        <span className="stats-cost">${cost.toFixed(4)}</span>
      )}
      {pct !== null && (
        <span className="stats-context" title={`${pct.toFixed(1)}% of context window`}>
          <span className="stats-context-bar-track" aria-hidden="true">
            <span
              className="stats-context-bar"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </span>
          <span className="stats-context-label">{Math.round(pct)}% ctx</span>
        </span>
      )}
    </div>
  );
}

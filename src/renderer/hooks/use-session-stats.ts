import { useEffect, useRef, useState } from "react";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export interface SessionStatsData {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
}

export function useSessionStats(managerSessionId: string): SessionStatsData | null {
  const [stats, setStats] = useState<SessionStatsData | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function fetchStats(): Promise<void> {
      try {
        const response = await window.api.session.command(managerSessionId, {
          type: "get_session_stats",
          id: crypto.randomUUID(),
        });
        if (cancelledRef.current) return;
        const s = (response as { data?: { stats?: SessionStatsData } })?.data?.stats;
        if (s) setStats(s);
      } catch {
        // swallow — stats are informational only
      }
    }

    // Fetch on mount (shows historical cost for reopened sessions)
    void fetchStats();

    // Re-fetch after each agent_end
    const unsub = window.api.session.onEvent(
      (id: string, event: AgentSessionEvent) => {
        if (id !== managerSessionId) return;
        if (event.type === "agent_end") void fetchStats();
      },
    );

    return () => {
      cancelledRef.current = true;
      unsub();
    };
  }, [managerSessionId]);

  return stats;
}

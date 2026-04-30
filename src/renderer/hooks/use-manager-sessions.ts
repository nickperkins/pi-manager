import { useEffect, useState } from "react";
import type { ManagerSessionRecord } from "@shared/types";

export function useManagerSessions(): ManagerSessionRecord[] {
  const [sessions, setSessions] = useState<ManagerSessionRecord[]>([]);

  useEffect(() => {
    let active = true;
    let hasPush = false;

    // Subscribe first so we never miss a push that arrives before list() resolves.
    const unsub = window.api.manager.onListChanged((incoming) => {
      hasPush = true;
      setSessions(incoming);
    });

    // Initial load — skip if a fresher push already arrived.
    window.api.manager
      .list()
      .then((incoming) => {
        if (active && !hasPush) setSessions(incoming);
      })
      .catch((err) =>
        console.error("[useManagerSessions] initial load failed:", err),
      );

    return () => {
      active = false;
      unsub();
    };
  }, []);

  return sessions;
}

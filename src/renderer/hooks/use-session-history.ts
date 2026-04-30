import { useEffect, useState } from "react";
import { buildViewItems, type MessageViewItem } from "../utils/session-view";

export interface SessionHistoryResult {
  items: MessageViewItem[];
  isLoading: boolean;
}

/**
 * Fetches offline conversation history for a session with no running host.
 * Reads the JSONL file directly via the main process (no SDK, no host).
 * Returns view items ready for MessageList rendering.
 *
 * Only intended for terminal-status sessions (archived, stopped, errored)
 * that have a sessionFile. Returns empty items for sessions without a file.
 */
export function useSessionHistory(
  sessionFile: string | undefined,
  isActive: boolean,
): SessionHistoryResult {
  const [items, setItems] = useState<MessageViewItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isActive || !sessionFile) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    window.api.session
      .readHistory(sessionFile)
      .then((messages) => {
        if (cancelled) return;
        setItems(
          buildViewItems(
            messages as Parameters<typeof buildViewItems>[0],
          ),
        );
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionFile, isActive]);

  return { items, isLoading };
}

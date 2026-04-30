import { readFile } from "node:fs/promises";

interface RawEntry {
  type: string;
  id: string;
  parentId: string | null;
  message?: unknown;
  [key: string]: unknown;
}

export type ReadFileFn = (path: string, encoding: string) => Promise<string>;

export interface SessionHistoryReader {
  readHistory(sessionFile: string): Promise<unknown[]>;
}

/**
 * Parse JSONL content and walk the entry tree to extract messages.
 * Pure function — no I/O.
 */
export function parseHistory(content: string): unknown[] {
  const lines = content.split("\n");
  if (lines.length < 2) return [];

  const entries: RawEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  if (entries.length === 0) return [];

  const byId = new Map<string, RawEntry>();
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry);
  }

  const leaf = entries[entries.length - 1];
  const messageChain: unknown[] = [];
  let current: RawEntry | undefined = leaf;

  const maxWalk = entries.length + 1;
  let steps = 0;
  while (current && steps < maxWalk) {
    steps++;
    if (current.type === "message" && current.message) {
      messageChain.push(current.message);
    }
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }

  messageChain.reverse();
  return messageChain;
}

export function createSessionHistoryReader(
  readFileFn: ReadFileFn = readFile as ReadFileFn,
): SessionHistoryReader {
  return {
    async readHistory(sessionFile: string): Promise<unknown[]> {
      let content: string;
      try {
        content = await readFileFn(sessionFile, "utf-8");
      } catch {
        return [];
      }
      return parseHistory(content);
    },
  };
}

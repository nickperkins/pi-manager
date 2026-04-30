import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DiscoveredSession } from "@shared/types";

interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

const MAX_SCAN_LINES = 200;
/** How many lines from the end of the file to scan for session_info name. */
const TAIL_SCAN_LINES = 200;

export type StatFn = (path: string) => Promise<{ mtime: Date }>;
export type ReadFileStringFn = (path: string, encoding: string) => Promise<string>;
export type ReaddirFn = (
  path: string,
  opts: { withFileTypes: true },
) => Promise<import("node:fs").Dirent[]>;

async function scanSession(
  filePath: string,
  statFn: StatFn,
  readFileFn: ReadFileStringFn,
): Promise<DiscoveredSession | null> {
  let fileStat;
  try {
    fileStat = await statFn(filePath);
  } catch {
    return null;
  }

  let content: string;
  try {
    content = await readFileFn(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n");
  // Count only non-empty lines to avoid trailing-newline false-positives
  // when computing isCapped. JSONL files typically end with "\n".
  const nonEmptyLineCount = lines.filter((l) => l.trim().length > 0).length;
  if (nonEmptyLineCount === 0) return null;

  let header: SessionHeader;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    return null;
  }

  if (header.type !== "session" || !header.id) return null;

  let name: string | undefined;
  let messageCount = 0;
  const scanLimit = Math.min(lines.length, MAX_SCAN_LINES);

  // Scan first MAX_SCAN_LINES for name and count
  for (let i = 1; i < scanLimit; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      messageCount++;
      if (entry.type === "session_info" && entry.name) {
        name = entry.name;
      }
    } catch {
      // skip malformed lines
    }
  }

  // If name not found in first N lines, scan the last TAIL_SCAN_LINES
  // (session_info often fires after the first agent turn completes)
  if (!name && nonEmptyLineCount > MAX_SCAN_LINES) {
    const tailStart = Math.max(MAX_SCAN_LINES + 1, lines.length - TAIL_SCAN_LINES);
    for (let i = tailStart; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "session_info" && entry.name) {
          name = entry.name;
          break;
        }
      } catch {
        // skip
      }
    }
  }

  // For files beyond scan limit, report capped count to avoid full-file iteration
  if (nonEmptyLineCount > MAX_SCAN_LINES) {
    messageCount = scanLimit - 1; // approximate (header excluded)
  }

  return {
    path: filePath,
    id: header.id,
    cwd: header.cwd ?? "",
    name,
    created: header.timestamp,
    modified: fileStat.mtime.toISOString(),
    messageCount,
    isCapped: nonEmptyLineCount > MAX_SCAN_LINES,
  };
}

export interface SessionBrowser {
  browse(agentDir: string): Promise<DiscoveredSession[]>;
}

export function createSessionBrowser(deps?: {
  readdir?: ReaddirFn;
  stat?: StatFn;
  readFile?: ReadFileStringFn;
}): SessionBrowser {
  const readdirFn = deps?.readdir ?? (readdir as unknown as ReaddirFn);
  const statFn = deps?.stat ?? stat;
  const readFileFn = deps?.readFile ?? (readFile as unknown as ReadFileStringFn);

  return {
    async browse(agentDir: string): Promise<DiscoveredSession[]> {
      const sessionsDir = join(agentDir, "sessions");

      // Find all .jsonl files recursively
      const files: string[] = [];
      async function walk(current: string): Promise<void> {
        let entries;
        try {
          entries = await readdirFn(current, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = join(current, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else if (entry.name.endsWith(".jsonl")) {
            files.push(full);
          }
        }
      }
      await walk(sessionsDir);

      const results = await Promise.all(
        files.map((f) => scanSession(f, statFn, readFileFn)),
      );
      const valid = results.filter(
        (r): r is DiscoveredSession => r !== null,
      );
      valid.sort((a, b) => b.modified.localeCompare(a.modified));
      return valid;
    },
  };
}

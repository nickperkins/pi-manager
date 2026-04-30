import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionBrowser } from "../../../src/main/session-browser";
import type { DiscoveredSession } from "@shared/types";
import type { SessionBrowser } from "../../../src/main/session-browser";

// ---------------------------------------------------------------------------
// Helpers to build JSONL content
// ---------------------------------------------------------------------------

function header(opts: { id?: string; cwd?: string; timestamp?: string } = {}): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: opts.id ?? "session-1",
    timestamp: opts.timestamp ?? "2026-01-01T00:00:00.000Z",
    cwd: opts.cwd ?? "/tmp/project",
  });
}

function sessionInfoEntry(name: string, parentId: string | null): string {
  return JSON.stringify({
    type: "session_info",
    id: "si1",
    parentId,
    timestamp: "2026-01-01T00:00:01.000Z",
    name,
  });
}

function messageEntry(id: string, parentId: string | null, role: string): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:02.000Z",
    message: { role, content: [{ type: "text", text: "hi" }], timestamp: Date.now() },
  });
}

function makeDirEntry(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir } as import("node:fs").Dirent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session-browser", () => {
  let readdirMock: ReturnType<typeof vi.fn>;
  let statMock: ReturnType<typeof vi.fn>;
  let readFileMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    readdirMock = vi.fn();
    statMock = vi.fn();
    readFileMock = vi.fn();
  });

  function createBrowser(): SessionBrowser {
    return createSessionBrowser({
      readdir: readdirMock as any,
      stat: statMock as any,
      readFile: readFileMock as any,
    });
  }

  it("returns empty array when sessions dir does not exist", async () => {
    readdirMock.mockRejectedValue(new Error("ENOENT"));
    const browser = createBrowser();
    const result = await browser.browse("/agent");
    expect(result).toEqual([]);
  });

  it("returns empty array for directory with no .jsonl files", async () => {
    readdirMock.mockResolvedValue([makeDirEntry("other.txt", false)]);
    const browser = createBrowser();
    const result = await browser.browse("/agent");
    expect(result).toEqual([]);
  });

  it("parses a valid session file and returns DiscoveredSession", async () => {
    const content = header() + "\n" + messageEntry("e1", null, "user") + "\n";

    readdirMock.mockResolvedValue([makeDirEntry("test.jsonl", false)]);
    statMock.mockResolvedValue({ mtime: new Date("2026-04-30T12:00:00Z") });
    readFileMock.mockResolvedValue(content);

    const browser = createBrowser();
    const result = await browser.browse("/agent");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("session-1");
    expect(result[0].cwd).toBe("/tmp/project");
    expect(result[0].messageCount).toBe(1);
    expect(result[0].modified).toBe("2026-04-30T12:00:00.000Z");
  });

  it("extracts name from session_info entry", async () => {
    const content = header() + "\n" + sessionInfoEntry("My Session", null) + "\n";

    readdirMock.mockResolvedValue([makeDirEntry("test.jsonl", false)]);
    statMock.mockResolvedValue({ mtime: new Date("2026-04-30T12:00:00Z") });
    readFileMock.mockResolvedValue(content);

    const browser = createBrowser();
    const result = await browser.browse("/agent");

    expect(result[0].name).toBe("My Session");
  });

  it("skips files with invalid JSON header", async () => {
    readdirMock.mockResolvedValue([makeDirEntry("bad.jsonl", false)]);
    statMock.mockResolvedValue({ mtime: new Date() });
    readFileMock.mockResolvedValue("not json\n");

    const browser = createBrowser();
    const result = await browser.browse("/agent");

    expect(result).toEqual([]);
  });

  it("skips files with non-session header type", async () => {
    readdirMock.mockResolvedValue([makeDirEntry("bad.jsonl", false)]);
    statMock.mockResolvedValue({ mtime: new Date() });
    readFileMock.mockResolvedValue(JSON.stringify({ type: "other", id: "x" }) + "\n");

    const browser = createBrowser();
    const result = await browser.browse("/agent");

    expect(result).toEqual([]);
  });

  it("counts messages correctly", async () => {
    const content = header() + "\n"
      + messageEntry("e1", null, "user") + "\n"
      + messageEntry("e2", "e1", "assistant") + "\n"
      + messageEntry("e3", "e2", "user") + "\n";

    readdirMock.mockResolvedValue([makeDirEntry("test.jsonl", false)]);
    statMock.mockResolvedValue({ mtime: new Date() });
    readFileMock.mockResolvedValue(content);

    const browser = createBrowser();
    const result = await browser.browse("/agent");

    expect(result[0].messageCount).toBe(3);
  });

  it("sorts results by modified date descending", async () => {
    const content1 = header({ id: "older" }) + "\n";
    const content2 = header({ id: "newer" }) + "\n";

    readdirMock.mockResolvedValue([
      makeDirEntry("older.jsonl", false),
      makeDirEntry("newer.jsonl", false),
    ]);
    statMock
      .mockResolvedValueOnce({ mtime: new Date("2026-01-01T00:00:00Z") })
      .mockResolvedValueOnce({ mtime: new Date("2026-06-01T00:00:00Z") });
    readFileMock
      .mockResolvedValueOnce(content1)
      .mockResolvedValueOnce(content2);

    const browser = createBrowser();
    const result = await browser.browse("/agent");

    expect(result[0].id).toBe("newer");
    expect(result[1].id).toBe("older");
  });

  it("recursively finds .jsonl files in nested directories", async () => {
    // First call: top-level sessions dir — returns subdir
    readdirMock
      .mockResolvedValueOnce([makeDirEntry("project-a", true)])
      .mockResolvedValueOnce([makeDirEntry("test.jsonl", false)]);

    statMock.mockResolvedValue({ mtime: new Date() });
    readFileMock.mockResolvedValue(header() + "\n");

    const browser = createBrowser();
    const result = await browser.browse("/agent");

    expect(result).toHaveLength(1);
    expect(readdirMock).toHaveBeenCalledTimes(2);
  });

  it("skips files that cannot be stat'd", async () => {
    readdirMock.mockResolvedValue([makeDirEntry("test.jsonl", false)]);
    statMock.mockRejectedValue(new Error("ENOENT"));

    const browser = createBrowser();
    const result = await browser.browse("/agent");

    expect(result).toEqual([]);
  });

  it("sets isCapped false for files with exactly 199 messages and trailing newline", async () => {
    // 199 message entries + trailing newline = 201 raw lines from split("\n")
    // but only 200 non-empty lines (header + 199 messages), so NOT capped
    const lines = [header()];
    for (let i = 0; i < 199; i++) {
      lines.push(messageEntry(`e${i}`, i === 0 ? null : `e${i - 1}`, "user"));
    }
    const content = lines.join("\n") + "\n"; // trailing newline
    readdirMock.mockResolvedValue([makeDirEntry("test.jsonl", false)]);
    statMock.mockResolvedValue({ mtime: new Date() });
    readFileMock.mockResolvedValue(content);

    const result = await createBrowser().browse("/agent");
    expect(result[0].isCapped).toBe(false);
    expect(result[0].messageCount).toBe(199);
  });

  it("sets isCapped true for files exceeding scan limit", async () => {
    const lines = [header()];
    for (let i = 0; i < 300; i++) {
      lines.push(messageEntry(`e${i}`, i === 0 ? null : `e${i - 1}`, "user"));
    }
    readdirMock.mockResolvedValue([makeDirEntry("test.jsonl", false)]);
    statMock.mockResolvedValue({ mtime: new Date() });
    readFileMock.mockResolvedValue(lines.join("\n"));

    const result = await createBrowser().browse("/agent");
    expect(result[0].isCapped).toBe(true);
  });

  it("sets isCapped false for small files", async () => {
    const content = header() + "\n" + messageEntry("e1", null, "user") + "\n";
    readdirMock.mockResolvedValue([makeDirEntry("test.jsonl", false)]);
    statMock.mockResolvedValue({ mtime: new Date() });
    readFileMock.mockResolvedValue(content);

    const result = await createBrowser().browse("/agent");
    expect(result[0].isCapped).toBe(false);
  });

  it("finds name from tail of large file when not in first 200 lines", async () => {
    // Build a file with 201 message entries, then a session_info at the end
    const lines = [header()];
    for (let i = 0; i < 201; i++) {
      lines.push(messageEntry(`e${i}`, i === 0 ? null : `e${i - 1}`, i % 2 === 0 ? "user" : "assistant"));
    }
    lines.push(sessionInfoEntry("Late Name", "e200"));

    readdirMock.mockResolvedValue([makeDirEntry("test.jsonl", false)]);
    statMock.mockResolvedValue({ mtime: new Date() });
    readFileMock.mockResolvedValue(lines.join("\n"));

    const browser = createBrowser();
    const result = await browser.browse("/agent");

    expect(result[0].name).toBe("Late Name");
  });

  it("caps message count for files exceeding scan limit", async () => {
    // Build a file with 300 message entries (301 lines total + header)
    const lines = [header()];
    for (let i = 0; i < 300; i++) {
      lines.push(messageEntry(`e${i}`, i === 0 ? null : `e${i - 1}`, "user"));
    }

    readdirMock.mockResolvedValue([makeDirEntry("test.jsonl", false)]);
    statMock.mockResolvedValue({ mtime: new Date() });
    readFileMock.mockResolvedValue(lines.join("\n"));

    const browser = createBrowser();
    const result = await browser.browse("/agent");

    // Should report capped count (200), not 300
    expect(result[0].messageCount).toBe(199); // MAX_SCAN_LINES - 1 (header excluded)
    expect(result[0].messageCount).toBeLessThan(300);
  });
});

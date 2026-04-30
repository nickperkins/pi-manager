import { describe, it, expect } from "vitest";
import { parseHistory, createSessionHistoryReader } from "../../../src/main/session-history-reader";

// ---------------------------------------------------------------------------
// Helpers to build JSONL content
// ---------------------------------------------------------------------------

function header(opts: { id?: string; cwd?: string } = {}): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: opts.id ?? "session-1",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: opts.cwd ?? "/tmp",
  });
}

function messageEntry(
  id: string,
  parentId: string | null,
  role: string,
  text: string,
): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: {
      role,
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  });
}

function otherEntry(type: string, id: string, parentId: string | null): string {
  return JSON.stringify({ type, id, parentId, timestamp: "2026-01-01T00:00:01.000Z" });
}

function toContent(lines: string[]): string {
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// parseHistory tests (pure function, no I/O)
// ---------------------------------------------------------------------------

describe("parseHistory", () => {
  it("returns empty array for content with only a header", () => {
    const result = parseHistory(toContent([header()]));
    expect(result).toEqual([]);
  });

  it("returns messages for a linear (non-branched) session", () => {
    const content = toContent([
      header(),
      messageEntry("e1", null, "user", "Hello"),
      messageEntry("e2", "e1", "assistant", "Hi there!"),
      messageEntry("e3", "e2", "user", "How are you?"),
    ]);

    const result = parseHistory(content);

    expect(result).toHaveLength(3);
    expect((result[0] as any).role).toBe("user");
    expect((result[1] as any).role).toBe("assistant");
    expect((result[2] as any).role).toBe("user");
  });

  it("follows the leaf path in a branched session", () => {
    const content = toContent([
      header(),
      messageEntry("e1", null, "user", "Hello"),
      messageEntry("e2", "e1", "assistant", "Hi!"),
      messageEntry("e3", "e2", "user", "Branch A question"),
      messageEntry("e4", "e2", "user", "Branch B question"), // leaf — last entry
    ]);

    const result = parseHistory(content);

    // Should only include messages on the leaf path: e1 → e2 → e4
    expect(result).toHaveLength(3);
    expect((result[0] as any).role).toBe("user");
    expect((result[1] as any).role).toBe("assistant");
    expect((result[2] as any).content[0].text).toBe("Branch B question");
  });

  it("skips non-message entries (compaction, model_change, etc.)", () => {
    const content = toContent([
      header(),
      messageEntry("e1", null, "user", "Hello"),
      otherEntry("model_change", "mc1", "e1"),
      otherEntry("thinking_level_change", "tl1", "mc1"),
      messageEntry("e2", "tl1", "assistant", "Response"),
      otherEntry("compaction", "c1", "e2"),
    ]);

    const result = parseHistory(content);

    expect(result).toHaveLength(2);
    expect((result[0] as any).role).toBe("user");
    expect((result[1] as any).role).toBe("assistant");
  });

  it("skips malformed lines without failing", () => {
    const content = toContent([
      header(),
      "this is not json",
      messageEntry("e1", null, "user", "Hello"),
      "",
      messageEntry("e2", "e1", "assistant", "Hi!"),
      "{broken json",
    ]);

    const result = parseHistory(content);

    expect(result).toHaveLength(2);
  });

  it("returns messages in chronological order (root first)", () => {
    const content = toContent([
      header(),
      messageEntry("e1", null, "user", "First"),
      messageEntry("e2", "e1", "assistant", "Second"),
      messageEntry("e3", "e2", "user", "Third"),
    ]);

    const result = parseHistory(content);

    expect((result[0] as any).content[0].text).toBe("First");
    expect((result[1] as any).content[0].text).toBe("Second");
    expect((result[2] as any).content[0].text).toBe("Third");
  });

  it("handles a session with many entries", () => {
    const lines = [header()];
    let parentId: string | null = null;
    for (let i = 0; i < 100; i++) {
      const id = `e${i}`;
      lines.push(messageEntry(id, parentId, i % 2 === 0 ? "user" : "assistant", `Msg ${i}`));
      parentId = id;
    }

    const result = parseHistory(toContent(lines));
    expect(result).toHaveLength(100);
  });

  it("returns empty array for empty content", () => {
    const result = parseHistory("");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createSessionHistoryReader tests (I/O wrapper)
// ---------------------------------------------------------------------------

describe("createSessionHistoryReader", () => {
  it("returns empty array when readFile rejects", async () => {
    const mockRead = async () => { throw new Error("ENOENT"); };
    const reader = createSessionHistoryReader(mockRead);
    const result = await reader.readHistory("/nonexistent.jsonl");
    expect(result).toEqual([]);
  });

  it("delegates to parseHistory with file content", async () => {
    const content = toContent([
      header(),
      messageEntry("e1", null, "user", "Hello"),
      messageEntry("e2", "e1", "assistant", "Hi!"),
    ]);
    const mockRead = async () => content;
    const reader = createSessionHistoryReader(mockRead);
    const result = await reader.readHistory("/test.jsonl");
    expect(result).toHaveLength(2);
  });
});

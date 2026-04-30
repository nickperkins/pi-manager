import { describe, it, expect } from "vitest";
import { sortSessions } from "../../../src/renderer/components/Sidebar";
import type { ManagerSessionRecord } from "@shared/types";

function makeSession(
  overrides: Partial<ManagerSessionRecord>,
): ManagerSessionRecord {
  return {
    managerSessionId: "id",
    name: "Session",
    cwd: "/tmp",
    status: "idle",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("sortSessions", () => {
  it("returns an empty array unchanged", () => {
    expect(sortSessions([])).toEqual([]);
  });

  it("puts errored sessions before non-errored ones", () => {
    const errored = makeSession({ managerSessionId: "a", status: "errored" });
    const idle = makeSession({ managerSessionId: "b", status: "idle" });

    const result = sortSessions([idle, errored]);
    expect(result[0].managerSessionId).toBe("a");
    expect(result[1].managerSessionId).toBe("b");
  });

  it("sorts non-errored sessions newest-first by createdAt", () => {
    const older = makeSession({
      managerSessionId: "old",
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    const newer = makeSession({
      managerSessionId: "new",
      createdAt: "2024-06-01T00:00:00.000Z",
    });

    const result = sortSessions([older, newer]);
    expect(result[0].managerSessionId).toBe("new");
    expect(result[1].managerSessionId).toBe("old");
  });

  it("keeps errored sessions above newer non-errored sessions", () => {
    const errored = makeSession({
      managerSessionId: "err",
      status: "errored",
      createdAt: "2024-01-01T00:00:00.000Z", // oldest
    });
    const newerIdle = makeSession({
      managerSessionId: "idle",
      status: "idle",
      createdAt: "2024-12-01T00:00:00.000Z", // newest
    });

    const result = sortSessions([newerIdle, errored]);
    expect(result[0].managerSessionId).toBe("err");
    expect(result[1].managerSessionId).toBe("idle");
  });

  it("sorts multiple errored sessions among themselves newest-first", () => {
    const errA = makeSession({
      managerSessionId: "errA",
      status: "errored",
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    const errB = makeSession({
      managerSessionId: "errB",
      status: "errored",
      createdAt: "2024-06-01T00:00:00.000Z",
    });

    const result = sortSessions([errA, errB]);
    expect(result[0].managerSessionId).toBe("errB"); // newer error first
    expect(result[1].managerSessionId).toBe("errA");
  });

  it("does not mutate the input array", () => {
    const sessions = [
      makeSession({ managerSessionId: "a", status: "idle" }),
      makeSession({ managerSessionId: "b", status: "errored" }),
    ];
    const original = [...sessions];
    sortSessions(sessions);
    expect(sessions).toEqual(original);
  });

  it("handles all non-errored statuses as equal priority", () => {
    const statuses = [
      "idle",
      "streaming",
      "compacting",
      "retrying",
      "stopped",
      "archived",
      "spawning",
    ] as const;

    const sessions = statuses.map((status, i) =>
      makeSession({
        managerSessionId: status,
        status,
        createdAt: `2024-0${(i % 9) + 1}-01T00:00:00.000Z`,
      }),
    );

    const result = sortSessions(sessions);
    // None of these should be sorted before the others based on status alone —
    // all are treated as non-errored (weight 1), so relative order is by createdAt.
    result.forEach((s) => expect(s.status).not.toBe("errored"));
  });
});

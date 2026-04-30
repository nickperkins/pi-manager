import { describe, it, expect, vi } from "vitest";
import { dispatchCommand } from "../../../src/host/dispatch";
import type { HostCommand } from "../../../src/shared/protocol";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    steer: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    setSessionName: vi.fn(),
    getSessionStats: vi.fn().mockReturnValue({ userMessages: 1, assistantMessages: 1 }),
    isStreaming: false,
    sessionFile: "/tmp/session.jsonl",
    sessionId: "sess-1",
    sessionName: "Test Session",
    model: { provider: "anthropic", id: "claude-opus-4-5" },
    messages: [{ role: "user", content: "hello" }],
    modelRegistry: {
      find: vi.fn().mockReturnValue({ provider: "anthropic", id: "claude-opus-4-5" }),
    },
    ...overrides,
  };
}

function makeRuntime(overrides: Record<string, unknown> = {}) {
  return {
    fork: vi.fn().mockResolvedValue({ cancelled: false }),
    newSession: vi.fn().mockResolvedValue({ cancelled: false }),
    ...overrides,
  };
}

const handleUiResponse = vi.fn();

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

describe("prompt", () => {
  it("calls session.prompt with source=rpc and returns success immediately", async () => {
    const session = makeSession();
    const cmd: HostCommand = { type: "prompt", id: "p1", message: "hello" };

    const result = await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(result).toEqual({ type: "response", id: "p1", success: true, data: undefined });
    expect(session.prompt).toHaveBeenCalledWith("hello", { source: "rpc" });
  });

  it("maps ImageRef fields to ImageContent (base64→data)", async () => {
    const session = makeSession();
    const cmd: HostCommand = {
      type: "prompt", id: "p2", message: "look",
      images: [{ mimeType: "image/png", base64: "abc123" }],
    };

    await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(session.prompt).toHaveBeenCalledWith("look", {
      source: "rpc",
      images: [{ type: "image", data: "abc123", mimeType: "image/png" }],
    });
  });

  it("does not await prompt (fire-and-start) — returns before prompt resolves", async () => {
    let promptResolved = false;
    const session = makeSession({
      prompt: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        promptResolved = true;
      }),
    });

    const cmd: HostCommand = { type: "prompt", id: "p3", message: "slow" };
    await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(promptResolved).toBe(false); // response returned before prompt resolved
  });

  it("calls onBackgroundError when session.prompt rejects", async () => {
    const session = makeSession({
      prompt: vi.fn().mockRejectedValue(new Error("no API key")),
    });
    const onBackgroundError = vi.fn();
    const cmd: HostCommand = { type: "prompt", id: "p4", message: "hi" };

    // Returns success immediately even though prompt will reject
    const result = await dispatchCommand(
      cmd, session as any, makeRuntime() as any, handleUiResponse, onBackgroundError,
    );
    expect(result?.success).toBe(true);

    // Flush microtasks so the .catch() fires
    await new Promise((r) => setTimeout(r, 0));
    expect(onBackgroundError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("does not throw when prompt rejects and no onBackgroundError is provided", async () => {
    const session = makeSession({
      prompt: vi.fn().mockRejectedValue(new Error("no API key")),
    });
    const cmd: HostCommand = { type: "prompt", id: "p5", message: "hi" };

    await expect(
      dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse)
        .then(() => new Promise((r) => setTimeout(r, 0))) // flush microtasks
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// steer
// ---------------------------------------------------------------------------

describe("steer", () => {
  it("awaits session.steer and returns success", async () => {
    const session = makeSession();
    const cmd: HostCommand = { type: "steer", id: "s1", message: "actually do X" };

    const result = await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(result).toEqual({ type: "response", id: "s1", success: true, data: undefined });
    expect(session.steer).toHaveBeenCalledWith("actually do X");
  });
});

// ---------------------------------------------------------------------------
// follow_up
// ---------------------------------------------------------------------------

describe("follow_up", () => {
  it("awaits session.followUp and returns success", async () => {
    const session = makeSession();
    const cmd: HostCommand = { type: "follow_up", id: "f1", message: "then do Y" };

    const result = await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(result).toEqual({ type: "response", id: "f1", success: true, data: undefined });
    expect(session.followUp).toHaveBeenCalledWith("then do Y");
  });
});

// ---------------------------------------------------------------------------
// abort
// ---------------------------------------------------------------------------

describe("abort", () => {
  it("awaits session.abort and returns success", async () => {
    const session = makeSession();
    const cmd: HostCommand = { type: "abort", id: "a1" };

    const result = await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(result).toEqual({ type: "response", id: "a1", success: true, data: undefined });
    expect(session.abort).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// get_state
// ---------------------------------------------------------------------------

describe("get_state", () => {
  it("returns derived session state", async () => {
    const session = makeSession();
    const cmd: HostCommand = { type: "get_state", id: "gs1" };

    const result = await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(result?.success).toBe(true);
    expect(result?.data).toEqual({
      isStreaming: false,
      sessionFile: "/tmp/session.jsonl",
      sessionId: "sess-1",
      sessionName: "Test Session",
      model: { provider: "anthropic", modelId: "claude-opus-4-5" },
    });
  });

  it("returns undefined model when session.model is undefined", async () => {
    const session = makeSession({ model: undefined });
    const cmd: HostCommand = { type: "get_state", id: "gs2" };

    const result = await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect((result?.data as any).model).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// get_messages
// ---------------------------------------------------------------------------

describe("get_messages", () => {
  it("returns session.messages", async () => {
    const session = makeSession();
    const cmd: HostCommand = { type: "get_messages", id: "gm1" };

    const result = await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(result?.success).toBe(true);
    expect((result?.data as any).messages).toEqual(session.messages);
  });
});

// ---------------------------------------------------------------------------
// get_session_stats
// ---------------------------------------------------------------------------

describe("get_session_stats", () => {
  it("returns stats from session.getSessionStats()", async () => {
    const session = makeSession();
    const cmd: HostCommand = { type: "get_session_stats", id: "gss1" };

    const result = await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(result?.success).toBe(true);
    expect((result?.data as any).stats).toEqual({ userMessages: 1, assistantMessages: 1 });
  });
});

// ---------------------------------------------------------------------------
// set_model
// ---------------------------------------------------------------------------

describe("set_model", () => {
  it("calls setModel when model is found in registry", async () => {
    const session = makeSession();
    const cmd: HostCommand = { type: "set_model", id: "sm1", provider: "anthropic", modelId: "claude-opus-4-5" };

    const result = await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(result?.success).toBe(true);
    expect(session.modelRegistry.find).toHaveBeenCalledWith("anthropic", "claude-opus-4-5");
    expect(session.setModel).toHaveBeenCalled();
  });

  it("returns error when model is not found", async () => {
    const session = makeSession({
      modelRegistry: { find: vi.fn().mockReturnValue(undefined) },
    });
    const cmd: HostCommand = { type: "set_model", id: "sm2", provider: "openai", modelId: "gpt-99" };

    const result = await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(result?.success).toBe(false);
    expect(result?.error).toMatch(/not found/i);
    expect(session.setModel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// set_session_name
// ---------------------------------------------------------------------------

describe("set_session_name", () => {
  it("calls setSessionName and returns success", async () => {
    const session = makeSession();
    const cmd: HostCommand = { type: "set_session_name", id: "ssn1", name: "My Project" };

    const result = await dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse);

    expect(result?.success).toBe(true);
    expect(session.setSessionName).toHaveBeenCalledWith("My Project");
  });
});

// ---------------------------------------------------------------------------
// fork
// ---------------------------------------------------------------------------

describe("fork", () => {
  it("calls runtime.fork with entryId and returns success", async () => {
    const runtime = makeRuntime();
    const cmd: HostCommand = { type: "fork", id: "fk1", entryId: "entry-abc" };

    const result = await dispatchCommand(cmd, makeSession() as any, runtime as any, handleUiResponse);

    expect(result?.success).toBe(true);
    expect(runtime.fork).toHaveBeenCalledWith("entry-abc");
  });
});

// ---------------------------------------------------------------------------
// new_session
// ---------------------------------------------------------------------------

describe("new_session", () => {
  it("calls runtime.newSession and returns success", async () => {
    const runtime = makeRuntime();
    const cmd: HostCommand = { type: "new_session", id: "ns1" };

    const result = await dispatchCommand(cmd, makeSession() as any, runtime as any, handleUiResponse);

    expect(result?.success).toBe(true);
    expect(runtime.newSession).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// extension_ui_response
// ---------------------------------------------------------------------------

describe("extension_ui_response", () => {
  it("calls handleUiResponse and returns null (no HostResponse)", async () => {
    const handler = vi.fn();
    const cmd: HostCommand = {
      type: "extension_ui_response",
      requestId: "req-1",
      value: "user chose this",
    };

    const result = await dispatchCommand(cmd, makeSession() as any, makeRuntime() as any, handler);

    expect(result).toBeNull();
    expect(handler).toHaveBeenCalledWith("req-1", "user chose this");
  });
});

// ---------------------------------------------------------------------------
// Unknown command
// ---------------------------------------------------------------------------

describe("unknown command", () => {
  it("returns error response when command has an id", async () => {
    const cmd = { type: "totally_unknown", id: "u1" } as unknown as HostCommand;

    const result = await dispatchCommand(cmd, makeSession() as any, makeRuntime() as any, handleUiResponse);

    expect(result?.success).toBe(false);
    expect(result?.id).toBe("u1");
    expect(result?.error).toMatch(/unknown command/i);
  });

  it("returns null when command has no id", async () => {
    const cmd = { type: "totally_unknown" } as unknown as HostCommand;

    const result = await dispatchCommand(cmd, makeSession() as any, makeRuntime() as any, handleUiResponse);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

describe("error propagation", () => {
  it("propagates errors from session methods as thrown exceptions (caller handles)", async () => {
    const session = makeSession({
      steer: vi.fn().mockRejectedValue(new Error("session exploded")),
    });
    const cmd: HostCommand = { type: "steer", id: "err1", message: "boom" };

    await expect(
      dispatchCommand(cmd, session as any, makeRuntime() as any, handleUiResponse)
    ).rejects.toThrow("session exploded");
  });
});

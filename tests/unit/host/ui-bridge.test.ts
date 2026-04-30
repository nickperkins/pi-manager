import { describe, it, expect, vi } from "vitest";
import { createUiBridge } from "../../../src/host/ui-bridge";
import type { HostEvent } from "../../../src/shared/protocol";

function setup() {
  const posted: HostEvent[] = [];
  const post = vi.fn((event: HostEvent) => { posted.push(event); });
  const bridge = createUiBridge(post);
  return { ...bridge, posted, post };
}

// ---------------------------------------------------------------------------
// Interactive methods
// ---------------------------------------------------------------------------

describe("select", () => {
  it("posts extension_ui_request with kind=select then resolves when response arrives", async () => {
    const { uiContext, handleResponse, posted } = setup();

    const promise = uiContext.select("Pick one", ["a", "b"]);

    expect(posted).toHaveLength(1);
    const req = posted[0] as Extract<HostEvent, { type: "extension_ui_request" }>;
    expect(req.type).toBe("extension_ui_request");
    expect(req.kind).toBe("select");
    expect(req.title).toBe("Pick one");
    expect(req.options).toEqual(["a", "b"]);

    handleResponse(req.requestId, "b");
    await expect(promise).resolves.toBe("b");
  });

  it("resolves undefined when response value is undefined", async () => {
    const { uiContext, handleResponse, posted } = setup();
    const promise = uiContext.select("Pick one", ["a"]);
    const req = posted[0] as Extract<HostEvent, { type: "extension_ui_request" }>;
    handleResponse(req.requestId, undefined);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("confirm", () => {
  it("posts extension_ui_request with kind=confirm and resolves with boolean", async () => {
    const { uiContext, handleResponse, posted } = setup();

    const promise = uiContext.confirm("Are you sure?", "This is permanent.");

    const req = posted[0] as Extract<HostEvent, { type: "extension_ui_request" }>;
    expect(req.kind).toBe("confirm");
    expect(req.title).toBe("Are you sure?");
    expect(req.message).toBe("This is permanent.");

    handleResponse(req.requestId, true);
    await expect(promise).resolves.toBe(true);
  });

  it("resolves false on timeout", async () => {
    const { uiContext, posted } = setup();

    const promise = uiContext.confirm("Sure?", "msg", { timeout: 10 });
    const req = posted[0] as Extract<HostEvent, { type: "extension_ui_request" }>;
    expect(req.dialogOptions?.timeout).toBe(10);

    await expect(promise).resolves.toBe(false);
  });

  it("resolves false when aborted via signal", async () => {
    const { uiContext } = setup();
    const controller = new AbortController();

    const promise = uiContext.confirm("Sure?", "msg", { signal: controller.signal });
    controller.abort();

    await expect(promise).resolves.toBe(false);
  });
});

describe("input", () => {
  it("resolves with string value from response", async () => {
    const { uiContext, handleResponse, posted } = setup();

    const promise = uiContext.input("Enter name", "placeholder text");

    const req = posted[0] as Extract<HostEvent, { type: "extension_ui_request" }>;
    expect(req.kind).toBe("input");
    expect(req.placeholder).toBe("placeholder text");

    handleResponse(req.requestId, "Nick");
    await expect(promise).resolves.toBe("Nick");
  });
});

describe("editor", () => {
  it("resolves with string value from response", async () => {
    const { uiContext, handleResponse, posted } = setup();

    const promise = uiContext.editor("Edit content", "initial text");

    const req = posted[0] as Extract<HostEvent, { type: "extension_ui_request" }>;
    expect(req.kind).toBe("editor");
    expect(req.prefill).toBe("initial text");

    handleResponse(req.requestId, "edited text");
    await expect(promise).resolves.toBe("edited text");
  });
});

// ---------------------------------------------------------------------------
// Fire-and-forget methods
// ---------------------------------------------------------------------------

describe("notify", () => {
  it("posts extension_ui_request with kind=notify immediately", () => {
    const { uiContext, posted } = setup();

    uiContext.notify("Something happened", "warning");

    expect(posted).toHaveLength(1);
    const req = posted[0] as Extract<HostEvent, { type: "extension_ui_request" }>;
    expect(req.kind).toBe("notify");
    expect(req.title).toBe("Something happened");
    expect(req.notifyType).toBe("warning");
  });
});

describe("setStatus", () => {
  it("posts extension_status with key and text", () => {
    const { uiContext, posted } = setup();

    uiContext.setStatus("my-ext", "working...");

    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({ type: "extension_status", key: "my-ext", text: "working..." });
  });

  it("posts extension_status with undefined text to clear", () => {
    const { uiContext, posted } = setup();

    uiContext.setStatus("my-ext", undefined);

    expect(posted[0]).toEqual({ type: "extension_status", key: "my-ext", text: undefined });
  });
});

describe("setTitle", () => {
  it("posts extension_title", () => {
    const { uiContext, posted } = setup();

    uiContext.setTitle("My New Title");

    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({ type: "extension_title", title: "My New Title" });
  });
});

// ---------------------------------------------------------------------------
// handleResponse edge cases
// ---------------------------------------------------------------------------

describe("handleResponse", () => {
  it("is a no-op for an unknown requestId", () => {
    const { handleResponse } = setup();
    expect(() => handleResponse("unknown-id", "value")).not.toThrow();
  });

  it("does not resolve the same promise twice", async () => {
    const { uiContext, handleResponse, posted } = setup();
    const promise = uiContext.select("Pick", ["a"]);
    const req = posted[0] as Extract<HostEvent, { type: "extension_ui_request" }>;

    handleResponse(req.requestId, "a");
    handleResponse(req.requestId, "b"); // second call — no-op

    await expect(promise).resolves.toBe("a");
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe("dispose", () => {
  it("rejects all pending interactive promises", async () => {
    const { uiContext, dispose } = setup();

    const p1 = uiContext.select("Pick", ["a"]);
    const p2 = uiContext.input("Enter");

    // Attach rejection handlers BEFORE dispose() to avoid unhandled-rejection warnings
    const check1 = expect(p1).rejects.toThrow("Host disposed");
    const check2 = expect(p2).rejects.toThrow("Host disposed");
    dispose();
    await Promise.all([check1, check2]);
  });

  it("is safe to call with no pending promises", () => {
    const { dispose } = setup();
    expect(() => dispose()).not.toThrow();
  });

  it("is safe to call twice", () => {
    const { uiContext, dispose } = setup();
    // Suppress unhandled rejection — we only care that dispose() doesn't throw
    uiContext.select("Pick", ["a"]).catch(() => {});
    expect(() => { dispose(); dispose(); }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// TUI stubs
// ---------------------------------------------------------------------------

describe("TUI stubs", () => {
  it("onTerminalInput returns a no-op unsubscribe function", () => {
    const { uiContext } = setup();
    const unsub = uiContext.onTerminalInput(() => {});
    expect(() => unsub()).not.toThrow();
  });

  it("getEditorText returns empty string", () => {
    const { uiContext } = setup();
    expect(uiContext.getEditorText()).toBe("");
  });

  it("getAllThemes returns empty array", () => {
    const { uiContext } = setup();
    expect(uiContext.getAllThemes()).toEqual([]);
  });

  it("getTheme returns undefined", () => {
    const { uiContext } = setup();
    expect(uiContext.getTheme("dark")).toBeUndefined();
  });

  it("setTheme returns { success: false }", () => {
    const { uiContext } = setup();
    expect(uiContext.setTheme("dark")).toEqual({ success: false });
  });

  it("getToolsExpanded returns false", () => {
    const { uiContext } = setup();
    expect(uiContext.getToolsExpanded()).toBe(false);
  });
});

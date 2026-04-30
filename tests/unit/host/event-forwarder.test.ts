import { describe, it, expect, vi } from "vitest";
import { toSerializable, subscribeToSession } from "../../../src/host/event-forwarder";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { HostEvent } from "../../../src/shared/protocol";

// ---------------------------------------------------------------------------
// toSerializable
// ---------------------------------------------------------------------------

describe("toSerializable", () => {
  it("passes plain objects through unchanged", () => {
    const event: AgentSessionEvent = { type: "agent_start" };
    const result = toSerializable(event);
    expect(result).toEqual(event);
  });

  it("strips undefined values (JSON round-trip behaviour)", () => {
    const event = { type: "agent_start", undefinedField: undefined } as unknown as AgentSessionEvent;
    const result = toSerializable(event) as Record<string, unknown>;
    expect(result.type).toBe("agent_start");
    expect("undefinedField" in result).toBe(false);
  });

  it("handles nested objects in agent_end", () => {
    const event: AgentSessionEvent = {
      type: "agent_end",
      messages: [
        { role: "user", content: "hello", timestamp: 1000 },
      ] as any,
    };
    const result = toSerializable(event);
    expect(result).toEqual(event);
  });

  it("returns the original event if JSON serialization fails", () => {
    const circular: any = {};
    circular.self = circular;
    const event = { type: "agent_start", bad: circular } as unknown as AgentSessionEvent;
    // Should not throw — returns the original event as fallback
    expect(() => toSerializable(event)).not.toThrow();
    const result = toSerializable(event);
    expect(result).toBe(event);
  });
});

// ---------------------------------------------------------------------------
// subscribeToSession
// ---------------------------------------------------------------------------

describe("subscribeToSession", () => {
  function makeSession() {
    let listener: ((event: AgentSessionEvent) => void) | undefined;
    return {
      subscribe: vi.fn((cb: (event: AgentSessionEvent) => void) => {
        listener = cb;
        return () => { listener = undefined; };
      }),
      emit: (event: AgentSessionEvent) => listener?.(event),
    };
  }

  it("calls post with an agent_event wrapper when the session emits", () => {
    const session = makeSession();
    const post = vi.fn<[HostEvent], void>();

    subscribeToSession(session as any, post);
    session.emit({ type: "agent_start" });

    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0][0]).toEqual({
      type: "agent_event",
      event: { type: "agent_start" },
    });
  });

  it("returns an unsubscribe function that stops forwarding", () => {
    const session = makeSession();
    const post = vi.fn<[HostEvent], void>();

    const unsub = subscribeToSession(session as any, post);
    unsub();
    session.emit({ type: "agent_start" });

    expect(post).not.toHaveBeenCalled();
  });

  it("calls onPostError when post throws (e.g. non-cloneable event)", () => {
    const session = makeSession();
    const post = vi.fn().mockImplementation(() => { throw new Error("DataCloneError"); });
    const onPostError = vi.fn();

    subscribeToSession(session as any, post, onPostError);
    session.emit({ type: "agent_start" });

    expect(onPostError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("is safe when post throws and no onPostError is provided", () => {
    const session = makeSession();
    const post = vi.fn().mockImplementation(() => { throw new Error("DataCloneError"); });

    subscribeToSession(session as any, post);
    expect(() => session.emit({ type: "agent_start" })).not.toThrow();
  });

  it("forwards multiple events in order", () => {
    const session = makeSession();
    const post = vi.fn<[HostEvent], void>();

    subscribeToSession(session as any, post);
    session.emit({ type: "agent_start" });
    session.emit({ type: "agent_end", messages: [] as any });

    expect(post).toHaveBeenCalledTimes(2);
    expect((post.mock.calls[0][0] as Extract<HostEvent, { type: "agent_event" }>).event.type)
      .toBe("agent_start");
    expect((post.mock.calls[1][0] as Extract<HostEvent, { type: "agent_event" }>).event.type)
      .toBe("agent_end");
  });
});

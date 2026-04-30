/**
 * dispatch.ts — Pure command dispatch logic for the session host.
 *
 * `dispatchCommand` accepts all its dependencies as parameters — no globals,
 * no `process.parentPort`, no `process.exit`. This makes it fully unit-testable
 * with plain mock objects.
 *
 * Returns a HostResponse to send back for commands that carry an id, or null
 * for `extension_ui_response` (which has no id and requires no reply).
 */

import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import type { HostCommand, HostResponse } from "@shared/protocol";

export async function dispatchCommand(
  cmd: HostCommand,
  session: AgentSession,
  runtime: AgentSessionRuntime,
  handleUiResponse: (requestId: string, value: string | boolean | undefined) => void,
  onBackgroundError?: (err: unknown) => void,
): Promise<HostResponse | null> {
  switch (cmd.type) {
    case "prompt": {
      // Fire-and-start: return immediately; streaming events arrive via agent_event.
      // Attach a catch so a rejected prompt (no model, no API key, rate-limit) surfaces
      // as a non-fatal host_error rather than an unhandled rejection that kills the host.
      session.prompt(cmd.message, {
        source: "rpc",
        ...(cmd.images?.length
          ? {
              images: cmd.images.map((i) => ({
                type: "image" as const,
                data: i.base64,
                mimeType: i.mimeType,
              })),
            }
          : {}),
      }).catch((err) => onBackgroundError?.(err));
      return ok(cmd.id);
    }

    case "steer": {
      await session.steer(cmd.message);
      return ok(cmd.id);
    }

    case "follow_up": {
      await session.followUp(cmd.message);
      return ok(cmd.id);
    }

    case "abort": {
      await session.abort();
      return ok(cmd.id);
    }

    case "get_state": {
      const model = session.model;
      return ok(cmd.id, {
        isStreaming: session.isStreaming,
        sessionFile: session.sessionFile,
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        model: model ? { provider: model.provider, modelId: model.id } : undefined,
      });
    }

    case "get_messages": {
      return ok(cmd.id, { messages: session.messages });
    }

    case "get_session_stats": {
      return ok(cmd.id, { stats: session.getSessionStats() });
    }

    case "set_model": {
      const target = session.modelRegistry.find(cmd.provider, cmd.modelId);
      if (!target) {
        return err(cmd.id, `Model not found: ${cmd.provider}/${cmd.modelId}`);
      }
      await session.setModel(target);
      return ok(cmd.id);
    }

    case "set_session_name": {
      session.setSessionName(cmd.name);
      return ok(cmd.id);
    }

    case "fork": {
      await runtime.fork(cmd.entryId);
      return ok(cmd.id);
    }

    case "new_session": {
      await runtime.newSession();
      return ok(cmd.id);
    }

    case "extension_ui_response": {
      // No HostResponse — this command carries no id.
      handleUiResponse(cmd.requestId, cmd.value);
      return null;
    }

    default: {
      const unknown = cmd as { type: string; id?: string };
      if (unknown.id) {
        return err(unknown.id, `Unknown command: ${unknown.type}`);
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(id: string, data?: unknown): HostResponse {
  return { type: "response", id, success: true, data };
}

function err(id: string, error: string): HostResponse {
  return { type: "response", id, success: false, error };
}

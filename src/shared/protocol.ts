import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Init (sent once by supervisor before any commands)
// ---------------------------------------------------------------------------

export type HostInit = {
  type: "init";
  managerSessionId: string;
  cwd: string;
  agentDir: string;
  sessionMode:
    | { kind: "new" }
    | { kind: "open"; sessionFile: string };
  initialName?: string;
};

// ---------------------------------------------------------------------------
// Commands (supervisor → host)
// ---------------------------------------------------------------------------

export type ImageRef = {
  mimeType: string;
  base64: string;
};

export type HostCommand =
  | { type: "prompt";            id: string; message: string; images?: ImageRef[] }
  | { type: "steer";             id: string; message: string }
  | { type: "follow_up";         id: string; message: string }
  | { type: "abort";             id: string }
  | { type: "get_state";         id: string }
  | { type: "get_messages";      id: string }
  | { type: "get_session_stats"; id: string }
  | { type: "set_model";         id: string; provider: string; modelId: string }
  | { type: "set_session_name";  id: string; name: string }
  | { type: "fork";              id: string; entryId: string }
  | { type: "new_session";       id: string }
  | { type: "extension_ui_response";
      requestId: string;
      value: string | boolean | undefined };

// ---------------------------------------------------------------------------
// Response (host → supervisor, one per command id)
// ---------------------------------------------------------------------------

export type HostResponse = {
  type: "response";
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
};

// ---------------------------------------------------------------------------
// Events (host → supervisor, spontaneous)
// ---------------------------------------------------------------------------

export type HostEvent =
  | {
      type: "host_ready";
      sessionFile: string | undefined;
      sessionId: string;
      sessionName: string | undefined;
    }
  | { type: "agent_event"; event: AgentSessionEvent }
  | {
      type: "extension_ui_request";
      requestId: string;
      kind: "select" | "confirm" | "input" | "editor" | "notify";
      title: string;
      message?: string;
      options?: string[];
      placeholder?: string;
      prefill?: string;
      notifyType?: "info" | "warning" | "error";
      dialogOptions?: { timeout?: number };
    }
  | { type: "extension_status"; key: string; text: string | undefined }
  | { type: "extension_title"; title: string }
  | { type: "host_error"; error: string; fatal: boolean };

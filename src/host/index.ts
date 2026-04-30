/**
 * src/host/index.ts — Session host entry point for utilityProcess.fork().
 *
 * This file is the composition root only. All testable logic lives in:
 *   - dispatch.ts      (command dispatch)
 *   - event-forwarder.ts (session event → IPC forwarding)
 *   - ui-bridge.ts    (ExtensionUIContext implementation)
 *
 * Lifecycle:
 *   1. Validate that process.parentPort exists (must be run as utilityProcess).
 *   2. Wait for a single HostInit message.
 *   3. Build SessionManager and AgentSessionRuntime.
 *   4. Subscribe to session events and bind the UI bridge.
 *   5. Post host_ready.
 *   6. Dispatch incoming HostCommand messages until the process is killed.
 */

import {
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  SessionManager,
  getAgentDir,
  type AgentSessionRuntime,
  type AgentSession,
  type CreateAgentSessionRuntimeFactory,
} from "@mariozechner/pi-coding-agent";
import type { HostInit, HostCommand, HostResponse, HostEvent } from "@shared/protocol";
import { subscribeToSession } from "./event-forwarder";
import { createUiBridge } from "./ui-bridge";
import { dispatchCommand } from "./dispatch";

// ---------------------------------------------------------------------------
// Validate environment
// ---------------------------------------------------------------------------

if (!process.parentPort) {
  console.error("[host] Must be run as a utilityProcess");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Post helpers (bound to the real parentPort)
// ---------------------------------------------------------------------------

function post(msg: HostEvent | HostResponse): void {
  process.parentPort.postMessage(msg);
}

function fatal(error: string): never {
  // Guard against a closed/crashed parent port — must not prevent process.exit(1).
  try { post({ type: "host_error", error, fatal: true }); } catch { /* port closed */ }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Global error handlers — registered at module level so they cover the full
// process lifetime, including async work during initialisation.
// ---------------------------------------------------------------------------

process.on("uncaughtException", (err: Error) => {
  console.error("[host] uncaughtException:", err);
  fatal(String(err));
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[host] unhandledRejection:", reason);
  fatal(String(reason));
});

// ---------------------------------------------------------------------------
// Wait for HostInit
// ---------------------------------------------------------------------------

process.parentPort.once("message", (msg: { data: unknown }) => {
  void (async () => {
    const init = msg.data as HostInit;

    if (!init || init.type !== "init") {
      fatal(`Expected HostInit, got: ${JSON.stringify(msg.data)}`);
    }

    const { cwd, agentDir: initAgentDir, sessionMode, initialName } = init;
    const agentDir = initAgentDir || getAgentDir();

    // Build SessionManager
    let sessionManager: SessionManager;
    try {
      sessionManager =
        sessionMode.kind === "open"
          ? SessionManager.open(sessionMode.sessionFile)
          : SessionManager.create(cwd);
    } catch (err) {
      fatal(`Failed to create SessionManager: ${String(err)}`);
    }

    // Build runtime factory
    const factory: CreateAgentSessionRuntimeFactory = async (opts) => {
      const services = await createAgentSessionServices({
        cwd: opts.cwd,
        agentDir: opts.agentDir,
      });
      const result = await createAgentSessionFromServices({
        services,
        sessionManager: opts.sessionManager,
        sessionStartEvent: opts.sessionStartEvent,
      });
      return { ...result, services, diagnostics: services.diagnostics };
    };

    // Create AgentSessionRuntime
    let runtime: AgentSessionRuntime;
    try {
      runtime = await createAgentSessionRuntime(factory, { cwd, agentDir, sessionManager });
    } catch (err) {
      fatal(`createAgentSessionRuntime failed: ${String(err)}`);
    }

    // UI bridge — inject post so bridge has no global dependency
    const { uiContext, handleResponse: handleUiResponse } = createUiBridge(post);

    // Non-fatal error reporter for background/post failures
    function reportNonFatal(err: unknown): void {
      try {
        post({ type: "host_error", error: String(err), fatal: false });
      } catch {
        console.error("[host] failed to post non-fatal error:", err);
      }
    }

    // Subscribe + bind for the current session
    let unsubscribeEvents: (() => void) | undefined;

    async function bindSession(session: AgentSession): Promise<void> {
      unsubscribeEvents?.();
      unsubscribeEvents = subscribeToSession(session, post, reportNonFatal);
      await session.bindExtensions({ uiContext });
    }

    await bindSession(runtime.session);

    if (initialName) {
      runtime.session.setSessionName(initialName);
    }

    // Rebind callback: fires after fork / newSession / switchSession
    runtime.setRebindSession(async (newSession: AgentSession) => {
      await bindSession(newSession);
      post({
        type: "host_ready",
        sessionFile: newSession.sessionFile,
        sessionId: newSession.sessionId,
        sessionName: newSession.sessionName,
      });
    });

    // Announce readiness
    post({
      type: "host_ready",
      sessionFile: runtime.session.sessionFile,
      sessionId: runtime.session.sessionId,
      sessionName: runtime.session.sessionName,
    });

    // Command dispatch
    process.parentPort.on("message", (cmdMsg: { data: unknown }) => {
      void (async () => {
        const cmd = cmdMsg.data as HostCommand;
        if (!cmd || typeof cmd !== "object" || !("type" in cmd)) return;

        try {
          const response = await dispatchCommand(
            cmd,
            runtime.session,
            runtime,
            handleUiResponse,
            reportNonFatal,
          );
          if (response) post(response);
        } catch (err) {
          const id = (cmd as { id?: string }).id;
          if (id) {
            post({ type: "response", id, success: false, error: String(err) });
          } else {
            post({ type: "host_error", error: String(err), fatal: false });
          }
        }
      })();
    });

    for (const d of runtime.diagnostics) {
      console.warn(`[host] diagnostic [${d.type}]: ${d.message}`);
    }
  })();
});

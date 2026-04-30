/**
 * scripts/test-host.ts — End-to-end test harness for the session host.
 *
 * Must be run as an Electron main process entry because utilityProcess is an
 * Electron-only API. Build with electron-vite and run:
 *
 *   npx electron out/main/test-host.js --no-sandbox
 *
 * Prerequisites:
 *   - ~/.pi/agent/auth.json must have at least one provider configured.
 *   - npm run build:host must have run first to produce out/host/index.js.
 *
 * Expected output:
 *   [test-host] PASS
 */

import { app, utilityProcess } from "electron";
import { join } from "node:path";
import type { HostInit, HostEvent, HostResponse } from "../src/shared/protocol";

// out/host/index.js relative to out/main/test-host.js
const HOST_PATH = join(__dirname, "../host/index.mjs");
const TEST_CWD = process.env["HOME"] ?? "/tmp";

async function runTest(): Promise<void> {
  const child = utilityProcess.fork(HOST_PATH, [], {
    serviceName: "test-host",
  });

  let hostReady = false;
  let agentEndReceived = false;
  const errors: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const initTimeout = setTimeout(() => {
      reject(new Error("Timeout: host_ready not received within 15 s"));
    }, 15_000);

    child.on("message", (data: HostEvent | HostResponse) => {
      const ev = data as HostEvent;
      console.log("[test-host] received:", JSON.stringify(data).slice(0, 200));

      if (ev.type === "host_error") {
        errors.push((ev as Extract<HostEvent, { type: "host_error" }>).error);
      }

      if (ev.type === "host_ready") {
        hostReady = true;
        clearTimeout(initTimeout);
        console.log("[test-host] host_ready — sending prompt");

        const agentTimeout = setTimeout(() => {
          reject(new Error("Timeout: agent_end not received within 60 s"));
        }, 60_000);

        child.on("message", (inner: HostEvent | HostResponse) => {
          const innerEv = inner as HostEvent;
          if (innerEv.type === "agent_event") {
            const agentEv = (innerEv as Extract<HostEvent, { type: "agent_event" }>).event;
            if (agentEv.type === "agent_end") {
              agentEndReceived = true;
              clearTimeout(agentTimeout);
              resolve();
            }
          }
          if (innerEv.type === "host_error") {
            errors.push((innerEv as Extract<HostEvent, { type: "host_error" }>).error);
          }
        });

        const promptCmd = {
          type: "prompt",
          id: "test-prompt-1",
          message: "Say hello in one word.",
        };
        child.postMessage(promptCmd);
      }
    });

    const init: HostInit = {
      type: "init",
      managerSessionId: "test-manager-session-1",
      cwd: TEST_CWD,
      agentDir: join(process.env["HOME"] ?? "/tmp", ".pi", "agent"),
      sessionMode: { kind: "new" },
      initialName: "test-session",
    };

    child.postMessage(init);
  });

  child.kill();

  if (errors.length > 0) {
    console.error("[test-host] host reported errors:", errors);
    throw new Error(`Host errors: ${errors.join("; ")}`);
  }
  if (!hostReady) throw new Error("host_ready never received");
  if (!agentEndReceived) throw new Error("agent_end never received");
}

app.whenReady().then(async () => {
  try {
    await runTest();
    console.log("[test-host] PASS");
  } catch (err) {
    console.error("[test-host] FAIL:", err);
  } finally {
    app.quit();
  }
});

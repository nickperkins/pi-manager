import { app, BrowserWindow } from "electron";

// Ensure correct app name in dock/taskbar (especially in dev mode where
// the binary is "Electron" and app.getName() would return "electron")
app.setName("Pi Manager");
import { join } from "node:path";
import { homedir } from "node:os";
import { is } from "@electron-toolkit/utils";
import { register as registerIpc, broadcastToAllWindows } from "./ipc";
import { supervisor } from "./supervisor";
import { createStore } from "./manager-session-store";
import { createSessionHistoryReader } from "./session-history-reader";
import { createSessionBrowser } from "./session-browser";

let shutdownComplete = false;

/**
 * Resolve the agent config directory without importing the ESM-only SDK.
 * Mirrors getAgentDir() from @mariozechner/pi-coding-agent/config:
 *   1. PI_CODING_AGENT_DIR env var (with ~ expansion)
 *   2. ~/.pi/agent
 */
function resolveAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) {
    if (envDir === "~") return homedir();
    if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
    return envDir;
  }
  return join(homedir(), ".pi", "agent");
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: "Pi Manager",
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: `© ${new Date().getFullYear()} Nick Perkins`,
  });

  const store = createStore();
  const agentDir = resolveAgentDir();
  registerIpc({ sv: supervisor, store, broadcast: broadcastToAllWindows, agentDir, historyReader: createSessionHistoryReader(), browser: createSessionBrowser() });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Graceful shutdown: kill all host processes before quitting
app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  supervisor
    .closeAll({ graceMs: 3000 })
    .catch((err) => console.error("[main] closeAll error:", err))
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
});

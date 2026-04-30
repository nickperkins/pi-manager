import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import { IPC } from "@shared/ipc-protocol";
import type { DiscoveredSession } from "@shared/types";
import type { ManagerSessionRecord } from "@shared/types";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { HostCommand, HostResponse } from "@shared/protocol";

contextBridge.exposeInMainWorld("api", {
  manager: {
    list: (): Promise<ManagerSessionRecord[]> =>
      ipcRenderer.invoke(IPC.MANAGER_LIST),

    create: (opts: { cwd: string; name?: string }): Promise<string> =>
      ipcRenderer.invoke(IPC.MANAGER_CREATE, opts),

    open: (opts: { sessionFile: string; cwd: string; name?: string }): Promise<string> =>
      ipcRenderer.invoke(IPC.MANAGER_OPEN, opts),

    close: (managerSessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.MANAGER_CLOSE, { managerSessionId }),

    reopen: (managerSessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.MANAGER_REOPEN, { managerSessionId }),

    delete: (
      managerSessionId: string,
      opts?: { deleteFile?: boolean },
    ): Promise<void> =>
      ipcRenderer.invoke(IPC.MANAGER_DELETE, {
        managerSessionId,
        ...opts,
      }),

    onListChanged: (
      cb: (sessions: ManagerSessionRecord[]) => void,
    ): (() => void) => {
      const handler = (
        _: IpcRendererEvent,
        sessions: ManagerSessionRecord[],
      ) => cb(sessions);
      ipcRenderer.on(IPC.MANAGER_LIST_CHANGED, handler);
      return () => ipcRenderer.off(IPC.MANAGER_LIST_CHANGED, handler);
    },

    pickFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.DIALOG_PICK_FOLDER),

    browse: (): Promise<DiscoveredSession[]> =>
      ipcRenderer.invoke(IPC.SESSIONS_BROWSE),
  },

  session: {
    command: (
      managerSessionId: string,
      cmd: HostCommand,
    ): Promise<HostResponse> =>
      ipcRenderer.invoke(IPC.SESSION_COMMAND, { managerSessionId, cmd }),

    attach: (
      managerSessionId: string,
    ): Promise<{ events: AgentSessionEvent[] }> =>
      ipcRenderer.invoke(IPC.SESSION_ATTACH, { managerSessionId }),

    detach: (managerSessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.SESSION_DETACH, { managerSessionId }),

    readHistory: (sessionFile: string): Promise<unknown[]> =>
      ipcRenderer.invoke(IPC.SESSION_READ_HISTORY, { sessionFile }),

    onEvent: (
      cb: (managerSessionId: string, event: AgentSessionEvent) => void,
    ): (() => void) => {
      const handler = (
        _: IpcRendererEvent,
        id: string,
        event: AgentSessionEvent,
      ) => cb(id, event);
      ipcRenderer.on(IPC.SESSION_EVENT, handler);
      return () => ipcRenderer.off(IPC.SESSION_EVENT, handler);
    },
  },
  dialog: {
    showAbout: (): Promise<void> =>
      ipcRenderer.invoke(IPC.DIALOG_SHOW_ABOUT),
  },
});

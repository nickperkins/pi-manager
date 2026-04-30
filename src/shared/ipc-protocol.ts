/**
 * IPC channel names for renderer ↔ main communication.
 * Use these constants in ipcMain.handle(), ipcRenderer.invoke(), and ipcRenderer.on().
 */

// Invoke channels (renderer → main, returns Promise)
export const IPC = {
  MANAGER_LIST: "manager:list",
  MANAGER_CREATE: "manager:create",
  MANAGER_OPEN: "manager:open",
  MANAGER_CLOSE: "manager:close",
  MANAGER_REOPEN: "manager:reopen",
  MANAGER_DELETE: "manager:delete",
  SESSION_COMMAND: "session:command",
  SESSION_READ_HISTORY: "session:readHistory",
  SESSIONS_BROWSE: "sessions:browse",
  DIALOG_SHOW_ABOUT: "dialog:showAbout",
  SESSION_ATTACH: "session:attach",
  SESSION_DETACH: "session:detach",
  DIALOG_PICK_FOLDER: "dialog:pickFolder",
  // Push channels (main → renderer)
  MANAGER_LIST_CHANGED: "manager:listChanged",
  SESSION_EVENT: "session:event",
} as const;

export type IpcInvokeChannel = (typeof IPC)[
  | "MANAGER_LIST"
  | "MANAGER_CREATE"
  | "MANAGER_OPEN"
  | "MANAGER_CLOSE"
  | "MANAGER_REOPEN"
  | "MANAGER_DELETE"
  | "SESSION_COMMAND"
  | "SESSION_READ_HISTORY"
  | "SESSIONS_BROWSE"
  | "DIALOG_SHOW_ABOUT"
  | "SESSION_ATTACH"
  | "SESSION_DETACH"
  | "DIALOG_PICK_FOLDER"
];

export type IpcPushChannel = (typeof IPC)["MANAGER_LIST_CHANGED" | "SESSION_EVENT"];

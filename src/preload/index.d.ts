import type { DiscoveredSession } from "@shared/types";
import type { ManagerSessionRecord } from "@shared/types";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { HostCommand, HostResponse } from "@shared/protocol";

export interface ManagerApi {
  list(): Promise<ManagerSessionRecord[]>;
  create(opts: { cwd: string; name?: string }): Promise<string>;
  open(opts: { sessionFile: string; cwd: string; name?: string }): Promise<string>;
  close(managerSessionId: string): Promise<void>;
  reopen(managerSessionId: string): Promise<void>;
  delete(managerSessionId: string, opts?: { deleteFile?: boolean }): Promise<void>;
  onListChanged(cb: (sessions: ManagerSessionRecord[]) => void): () => void;
  pickFolder(): Promise<string | null>;
  browse(): Promise<DiscoveredSession[]>;
}

export interface SessionApi {
  command(managerSessionId: string, cmd: HostCommand): Promise<HostResponse>;
  attach(managerSessionId: string): Promise<{ events: AgentSessionEvent[] }>;
  detach(managerSessionId: string): Promise<void>;
  readHistory(sessionFile: string): Promise<unknown[]>;
  onEvent(cb: (managerSessionId: string, event: AgentSessionEvent) => void): () => void;
}

export interface DialogApi {
  showAbout(): Promise<void>;
}

export interface Api {
  manager: ManagerApi;
  session: SessionApi;
  dialog: DialogApi;
}

declare global {
  interface Window {
    api: Api;
  }
}

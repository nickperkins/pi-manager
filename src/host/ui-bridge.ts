/**
 * ui-bridge.ts — Implements ExtensionUIContext for the utilityProcess host.
 *
 * Interactive methods (select, confirm, input, editor) post an extension_ui_request
 * event and return a Promise that resolves when handleResponse() is called.
 *
 * Fire-and-forget methods (notify, setStatus, setTitle) post directly.
 *
 * TUI-only methods (setWidget, setFooter, setHeader, etc.) are no-ops — they are
 * meaningful only in interactive terminal mode, which pi-manager does not use.
 */

import { randomUUID } from "node:crypto";
import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import type { HostEvent } from "@shared/protocol";

type PendingEntry = {
  resolve: (value: string | boolean | undefined) => void;
  reject: (reason?: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export function createUiBridge(post: (event: HostEvent) => void): {
  uiContext: ExtensionUIContext;
  handleResponse: (requestId: string, value: string | boolean | undefined) => void;
  dispose: () => void;
} {
  const pending = new Map<string, PendingEntry>();

  type UIRequestEvent = Extract<HostEvent, { type: "extension_ui_request" }>;

  function makeInteractiveRequest(
    kind: "select" | "confirm" | "input" | "editor",
    requestPayload: Omit<UIRequestEvent, "type" | "requestId" | "kind">,
    opts?: { timeout?: number; signal?: AbortSignal },
  ): Promise<string | boolean | undefined> {
    const requestId = randomUUID();

    return new Promise<string | boolean | undefined>((resolve, reject) => {
      const entry: PendingEntry = { resolve, reject };

      if (opts?.timeout && opts.timeout > 0) {
        entry.timer = setTimeout(() => {
          pending.delete(requestId);
          resolve(kind === "confirm" ? false : undefined);
        }, opts.timeout);
      }

      if (opts?.signal) {
        opts.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(entry.timer);
            pending.delete(requestId);
            resolve(kind === "confirm" ? false : undefined);
          },
          { once: true },
        );
      }

      pending.set(requestId, entry);

      post({
        type: "extension_ui_request",
        requestId,
        kind,
        ...requestPayload,
        dialogOptions: opts?.timeout ? { timeout: opts.timeout } : undefined,
      });
    });
  }

  // Minimal stub theme — satisfies the Theme type without depending on pi-tui internals.
  // A Proxy is used so that any property chain (e.g. ctx.ui.theme.primary.bg) returns
  // the proxy rather than throwing a TypeError. Extensions relying on actual colour
  // values in non-interactive (RPC) mode are unsupported.
  const stubTheme = new Proxy(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any,
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get(_target: any, _prop: string): any {
        return stubTheme;
      },
    },
  );

  // Build the uiContext. Methods that accept complex TUI/Theme/Component factory
  // arguments are typed with `any` parameters (noImplicitAny: false) since they are
  // intentional no-ops — the factory functions are never invoked in RPC mode.
  const uiContext = {
    // --- Interactive (forwarded to main process) ---
    async select(title: string, options: string[], opts?: { timeout?: number; signal?: AbortSignal }): Promise<string | undefined> {
      return makeInteractiveRequest("select", { title, options }, opts) as Promise<string | undefined>;
    },

    async confirm(title: string, message: string, opts?: { timeout?: number; signal?: AbortSignal }): Promise<boolean> {
      return makeInteractiveRequest("confirm", { title, message }, opts) as Promise<boolean>;
    },

    async input(title: string, placeholder?: string, opts?: { timeout?: number; signal?: AbortSignal }): Promise<string | undefined> {
      return makeInteractiveRequest("input", { title, placeholder }, opts) as Promise<string | undefined>;
    },

    async editor(title: string, prefill?: string): Promise<string | undefined> {
      return makeInteractiveRequest("editor", { title, prefill }) as Promise<string | undefined>;
    },

    // --- Fire-and-forget (forwarded as host events) ---
    notify(message: string, type?: "info" | "warning" | "error"): void {
      post({
        type: "extension_ui_request",
        requestId: randomUUID(),
        kind: "notify",
        title: message,
        notifyType: type,
      });
    },

    setStatus(key: string, text: string | undefined): void {
      post({ type: "extension_status", key, text });
    },

    setTitle(title: string): void {
      post({ type: "extension_title", title });
    },

    // --- TUI-only stubs (no-ops in RPC/host mode) ---
    onTerminalInput(): () => void {
      return () => {};
    },

    setWorkingMessage(_message?: string): void {},
    setWorkingVisible(_visible: boolean): void {},
    setWorkingIndicator(_options?: unknown): void {},
    setHiddenThinkingLabel(_label?: string): void {},

    // setWidget has two overloads; use any-typed params to satisfy both.
    setWidget(_key: string, _content: any, _options?: any): void {},
    setFooter(_factory: any): void {},
    setHeader(_factory: any): void {},

    custom(_factory: any, _options?: any): Promise<never> {
      return Promise.reject(new Error("custom() not supported in pi-manager host"));
    },

    pasteToEditor(_text: string): void {},
    setEditorText(_text: string): void {},
    getEditorText(): string { return ""; },
    setEditorComponent(_factory: any): void {},
    addAutocompleteProvider(_factory: any): void {},

    // --- Theme stubs ---
    // stubTheme is a recursive Proxy that returns itself for any property access,
    // preventing null-dereference errors in extension code that traverses theme properties.
    theme: stubTheme,
    getAllThemes(): { name: string; path: string | undefined }[] { return []; },
    getTheme(_name: string): undefined { return undefined; },
    setTheme(_theme: any): { success: boolean; error?: string } { return { success: false }; },

    // --- Tool display stubs ---
    getToolsExpanded(): boolean { return false; },
    setToolsExpanded(_expanded: boolean): void {},
  } as unknown as ExtensionUIContext;

  function handleResponse(requestId: string, value: string | boolean | undefined): void {
    const entry = pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.resolve(value);
  }

  function dispose(): void {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Host disposed before extension UI response arrived"));
    }
    pending.clear();
  }

  return { uiContext, handleResponse, dispose };
}

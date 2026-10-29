import type { DirectLink, DirectManager } from "@/lib/direct/manager";
import { DirectError, type DirectEvent } from "@/modules/atur-direct/src/types";

// One open terminal pane on the direct road: attaches the session on the manager's live
// connection, turns the core's events into the callbacks the pane screen already handles for the
// bridge, and attaches again whenever the manager reconnects (a new connection object), so the
// screen never remounts.

export interface DirectPaneHandlers {
  /** Every (re)attach starts with one; direct input needs no claim, so the keyboard is ours. */
  onHello?: (pane: { cols: number; rows: number; keyboard: boolean }) => void;
  onSnapshot?: (ansi: string) => void;
  onDiff?: (rows: [number, string][]) => void;
  onHistory?: (rows: string[], visible?: number) => void;
  /** A `requestHistory` was answered with an error: its reply is never coming. */
  onHistoryFailed?: () => void;
  onGeometry?: (size: { cols: number; rows: number }) => void;
  onError?: (message: string) => void;
  /** The computer accepted the attach (also after every reconnect). */
  onAttached?: () => void;
  /** The connection dropped; the manager is trying to get it back. */
  onLost?: () => void;
  /** The computer refused the attach (the session is gone, say). Not raised for a dropped link. */
  onFailed?: (message: string) => void;
  /** The session ended. */
  onExit?: () => void;
}

export interface DirectPaneSize {
  cols: number;
  rows: number;
}

export interface DirectPaneHandle {
  sendInput(data: string): boolean;
  sendPaste(text: string, submit: boolean): boolean;
  /** The last `lines` rows with scrollback, answered through `onHistory`. */
  requestHistory(lines: number): void;
  /** Lays the session out at this grid; also what a later reattach asks for. */
  requestResize(cols: number, rows: number): void;
  /** Nothing to claim on the direct road. */
  claimKeyboard(): void;
  close(): void;
}

const noop = () => {};

export function openDirectPane(
  manager: Pick<DirectManager, "subscribe" | "getSnapshot">,
  sessionId: string,
  handlers: DirectPaneHandlers,
  size: DirectPaneSize,
): DirectPaneHandle {
  let closed = false;
  let current: DirectLink | null = null;
  let unsubscribeEvents: (() => void) | null = null;
  let grid = { ...size };

  const detach = () => {
    unsubscribeEvents?.();
    unsubscribeEvents = null;
    const link = current;
    current = null;
    if (link && !link.isClosed) void link.detach(sessionId).catch(noop);
  };

  const onEvent = (link: DirectLink, event: DirectEvent) => {
    if (closed || link !== current) return;
    if ("session" in event && event.session !== sessionId) return;
    switch (event.t) {
      case "hello":
        handlers.onHello?.({ cols: event.cols, rows: event.rows, keyboard: true });
        break;
      case "snapshot":
        handlers.onSnapshot?.(event.ansi);
        break;
      case "diff":
        if (event.rows.length > 0) handlers.onDiff?.(event.rows);
        break;
      case "geometry":
        handlers.onGeometry?.({ cols: event.cols, rows: event.rows });
        break;
      case "ended":
        handlers.onExit?.();
        break;
    }
  };

  const attach = (link: DirectLink) => {
    current = link;
    // Before attaching: the hello and the first snapshot can beat the answer.
    unsubscribeEvents = link.subscribe((event) => onEvent(link, event));
    link
      .attach(sessionId, grid.cols, grid.rows)
      .then(() => {
        if (!closed && link === current) handlers.onAttached?.();
      })
      .catch((error: unknown) => {
        if (closed || link !== current) return;
        // A dropped link is the manager's to report (through its snapshot), not an attach failure.
        if (error instanceof DirectError && error.code === "Disconnected") return;
        handlers.onFailed?.(
          error instanceof DirectError ? error.reason || error.code : "attach failed",
        );
      });
  };

  const sync = () => {
    if (closed) return;
    const link = manager.getSnapshot().connection;
    if (link === current) return;
    const hadLink = current !== null;
    detach();
    if (link) attach(link);
    else if (hadLink) handlers.onLost?.();
  };

  const unsubscribeManager = manager.subscribe(sync);
  sync();

  return {
    sendInput: (data) => current?.input(sessionId, data) ?? false,
    sendPaste: (text, submit) => current?.paste(sessionId, text, submit) ?? false,
    requestHistory(lines) {
      const link = current;
      if (!link) return;
      link
        .history(sessionId, lines)
        .then((reply) => {
          if (!closed && link === current) handlers.onHistory?.(reply.rows, reply.visible);
        })
        .catch(() => {
          if (!closed && link === current) handlers.onHistoryFailed?.();
        });
    },
    requestResize(cols, rows) {
      grid = { cols, rows };
      current?.resize(sessionId, cols, rows);
    },
    claimKeyboard: noop,
    close() {
      if (closed) return;
      unsubscribeManager();
      detach();
      closed = true;
    },
  };
}

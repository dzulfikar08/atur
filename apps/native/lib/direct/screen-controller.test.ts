import { expect, test } from "bun:test";

import type { DirectLink, DirectSnapshot } from "@/lib/direct/manager";
import { RETRY_DELAYS_MS } from "@/lib/direct/manager";
import {
  openDirectScreen,
  SCREEN_MAX_ATTEMPTS,
  SCREEN_STABLE_MS,
  type DirectScreenOptions,
} from "@/lib/direct/screen-controller";
import { FakeLink, FakeTimers, flush } from "@/lib/direct/test-support";
import { DirectError } from "@/modules/atur-direct/src/types";

function fakeManager(initial: DirectLink | null = null) {
  let connection = initial;
  const listeners = new Set<() => void>();
  const snapshot = (): DirectSnapshot => ({
    loaded: true,
    state: connection ? "connected" : "offline",
    serverId: "srv-1",
    serverName: "Desk",
    connection,
    sessions: [],
    rttMs: null,
    hosts: [],
    rerouting: false,
    error: null,
    preferDirect: true,
    echoMode: "auto",
    transportPreference: "auto",
  });
  let current = snapshot();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    /** The manager's connection changed (a drop, a reconnect). */
    set(next: DirectLink | null) {
      connection = next;
      current = snapshot();
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

const ready = (width = 1920, height = 1080) =>
  ({ t: "screen", state: "ready", width, height, name: "wayland", reason: "" }) as const;
const closedBy = (reason: string) =>
  ({ t: "screen", state: "closed", width: 0, height: 0, name: "", reason }) as const;

function setup<L extends FakeLink | null = FakeLink>(
  link: L = new FakeLink() as L,
  options: Partial<DirectScreenOptions> = {},
) {
  const timers = new FakeTimers();
  const manager = fakeManager(link);
  const screen = openDirectScreen(manager, {
    h264: true,
    viewOnly: false,
    timers,
    ...options,
  });
  return { link, manager, timers, screen };
}

test("opens on the live connection with H.264 when the device can decode it", async () => {
  const { link, screen } = setup();
  await flush();
  expect(link.screenOpens).toEqual([{ viewOnly: false, h264: true }]);
  expect(screen.getState().phase).toBe("connecting");
  expect(screen.getState().h264).toBe(true);
});

test("without a hardware decoder it asks for plain pictures", async () => {
  const { link } = setup(new FakeLink(), { h264: false, viewOnly: true });
  await flush();
  expect(link.screenOpens).toEqual([{ viewOnly: true, h264: false }]);
});

test("the core's events drive ready, stats and the remote clipboard", async () => {
  const { link, screen } = setup();
  await flush();
  link.emit(ready(1280, 720));
  expect(screen.getState()).toMatchObject({
    phase: "ready",
    width: 1280,
    height: 720,
    name: "wayland",
  });
  link.emit({ t: "screenStats", codec: "h264", fps: 29.7, kbps: 840, dropped: 1, decodeMs: 3 });
  expect(screen.getState().stats).toEqual({
    codec: "h264",
    fps: 29.7,
    kbps: 840,
    dropped: 1,
    decodeMs: 3,
  });
  link.emit({ t: "screenClipboard", text: "from the desktop" });
  expect(screen.getState().clipboard).toBe("from the desktop");
  screen.clearClipboard();
  expect(screen.getState().clipboard).toBe("");
  // A resize arrives as another ready.
  link.emit(ready(800, 600));
  expect(screen.getState()).toMatchObject({ width: 800, height: 600 });
});

test("a ready event that beats the open answer is kept", async () => {
  const link = new FakeLink();
  const { screen } = setup(link);
  link.emit(ready());
  await flush();
  expect(screen.getState().phase).toBe("ready");
});

test("a closed event without a reason is ours and changes nothing", async () => {
  const { link, screen } = setup();
  await flush();
  link.emit(ready());
  link.emit(closedBy(""));
  expect(screen.getState().phase).toBe("ready");
});

test("notifies subscribers on every change and stops after unsubscribe", async () => {
  const { link, screen } = setup();
  await flush();
  let calls = 0;
  const off = screen.subscribe(() => calls++);
  link.emit(ready());
  expect(calls).toBe(1);
  off();
  link.emit({ t: "screenStats", codec: "zrle", fps: 5, kbps: 10, dropped: 0, decodeMs: 0 });
  expect(calls).toBe(1);
});

test("a refusal carries the server's reason verbatim and is not retried", async () => {
  const reason =
    "Screen sharing is not allowed for this phone. Allow it under Settings, Phones on the computer, or run `atur-term mobile screen <device> on`.";
  const link = new FakeLink();
  link.screenOpenResult = new DirectError("ScreenNotAllowed", reason);
  const { screen, timers } = setup(link);
  await flush();
  expect(screen.getState()).toMatchObject({ phase: "refused", reason });
  await timers.advance(60_000);
  expect(link.screenOpens).toHaveLength(1);
});

test("unavailable keeps the server's reason; unsupported says older server", async () => {
  const unavailable = new FakeLink();
  unavailable.screenOpenResult = new DirectError("ScreenUnavailable", "wayvnc is not installed");
  const first = setup(unavailable);
  await flush();
  expect(first.screen.getState()).toMatchObject({
    phase: "unavailable",
    reason: "wayvnc is not installed",
  });

  const old = new FakeLink();
  old.screenOpenResult = new DirectError("Unsupported", "");
  const second = setup(old);
  await flush();
  expect(second.screen.getState()).toMatchObject({ phase: "unsupported", reason: "older server" });
});

test("a server without the screen feature is unsupported without a request", async () => {
  const link = new FakeLink();
  link.screen = false;
  const { screen } = setup(link);
  await flush();
  expect(screen.getState()).toMatchObject({ phase: "unsupported", reason: "older server" });
  expect(link.screenOpens).toHaveLength(0);
});

test("a refusal without a reason falls back to words of our own", async () => {
  const link = new FakeLink();
  link.screenOpenResult = new DirectError("ScreenNotAllowed", "");
  const { screen } = setup(link);
  await flush();
  expect(screen.getState().phase).toBe("refused");
  expect(screen.getState().reason).not.toBe("");
});

test("a decoder error closes and reopens without H.264, once, and it stays off", async () => {
  const link = new FakeLink();
  const { screen, manager } = setup(link);
  await flush();
  link.emit(ready());
  screen.decoderFailed();
  await flush();
  expect(link.screenCloses).toBe(1);
  expect(link.screenOpens).toEqual([
    { viewOnly: false, h264: true },
    { viewOnly: false, h264: false },
  ]);
  expect(screen.getState().h264).toBe(false);
  // Plain pictures failing too is not ours to fix: no loop.
  screen.decoderFailed();
  await flush();
  expect(link.screenOpens).toHaveLength(2);
  // The next connection starts without H.264 as well.
  const next = new FakeLink();
  manager.set(next);
  await flush();
  expect(next.screenOpens).toEqual([{ viewOnly: false, h264: false }]);
});

test("reopens on the next connection after a drop, and says so meanwhile", async () => {
  const first = new FakeLink();
  const { screen, manager } = setup(first);
  await flush();
  first.emit(ready());
  expect(screen.getState().phase).toBe("ready");

  first.emit({ t: "disconnected" });
  manager.set(null);
  expect(screen.getState().phase).toBe("reconnecting");
  expect(first.listenerCount).toBe(0);

  const second = new FakeLink();
  manager.set(second);
  await flush();
  expect(second.screenOpens).toEqual([{ viewOnly: false, h264: true }]);
  expect(screen.getState().phase).toBe("reconnecting");
  second.emit(ready(1024, 768));
  expect(screen.getState()).toMatchObject({ phase: "ready", width: 1024, height: 768 });
});

test("a route swap moves the screen to the new connection with no gap in the manager", async () => {
  const first = new FakeLink();
  const { screen, manager } = setup(first);
  await flush();
  first.emit(ready());
  const second = new FakeLink();
  manager.set(second);
  await flush();
  expect(second.screenOpens).toHaveLength(1);
  // The old connection's late events are ignored.
  first.emit(closedBy("gone"));
  expect(screen.getState().phase).not.toBe("ended");
});

test("opened before the computer is connected: waits, then opens on arrival", async () => {
  const { screen, manager } = setup(null);
  expect(screen.getState().phase).toBe("connecting");
  const link = new FakeLink();
  manager.set(link);
  await flush();
  expect(link.screenOpens).toHaveLength(1);
});

test("the computer closing the viewer reopens with the same backoff as the pane transport", async () => {
  const link = new FakeLink();
  const { screen, timers } = setup(link);
  await flush();
  link.emit(ready());
  link.emit(closedBy("wayvnc stopped"));
  expect(screen.getState().phase).toBe("reconnecting");
  expect(link.screenOpens).toHaveLength(1);
  await timers.advance(RETRY_DELAYS_MS[0] - 1);
  expect(link.screenOpens).toHaveLength(1);
  await timers.advance(1);
  expect(link.screenOpens).toHaveLength(2);
});

test("repeated closes give up with the server's reason once the budget is spent", async () => {
  const link = new FakeLink();
  const { screen, timers } = setup(link);
  await flush();
  link.emit(ready());
  for (let i = 0; i < SCREEN_MAX_ATTEMPTS; i++) {
    link.emit(closedBy("another viewer took over"));
    expect(screen.getState().phase).toBe("reconnecting");
    await timers.advance(60_000);
  }
  link.emit(closedBy("another viewer took over"));
  expect(screen.getState()).toMatchObject({ phase: "ended", reason: "another viewer took over" });
  await timers.advance(60_000);
  expect(link.screenOpens).toHaveLength(1 + SCREEN_MAX_ATTEMPTS);
});

test("a screen that stays up earns a fresh budget", async () => {
  const link = new FakeLink();
  const { screen, timers } = setup(link);
  await flush();
  link.emit(ready());
  link.emit(closedBy("hiccup"));
  expect(screen.getState().attempt).toBe(1);
  await timers.advance(RETRY_DELAYS_MS[0]);
  link.emit(ready());
  await timers.advance(SCREEN_STABLE_MS);
  expect(screen.getState().attempt).toBe(0);
});

test("an open that fails for another reason is retried, then reported", async () => {
  const link = new FakeLink();
  link.screenOpenResult = new DirectError("Timeout", "");
  const { screen, timers } = setup(link);
  await flush();
  expect(screen.getState().phase).toBe("connecting");
  for (let i = 0; i < SCREEN_MAX_ATTEMPTS; i++) await timers.advance(60_000);
  await flush();
  expect(link.screenOpens).toHaveLength(1 + SCREEN_MAX_ATTEMPTS);
  expect(screen.getState().phase).toBe("failed");
  expect(screen.getState().reason).not.toBe("");
});

test("a dropped link during the open is the manager's to report", async () => {
  const link = new FakeLink();
  link.closed = true;
  const { screen, timers } = setup(link);
  await flush();
  expect(screen.getState().phase).toBe("connecting");
  await timers.advance(60_000);
  expect(link.screenOpens).toHaveLength(1);
});

test("retry opens again at once after a refusal", async () => {
  const link = new FakeLink();
  link.screenOpenResult = new DirectError("ScreenNotAllowed", "no");
  const { screen } = setup(link);
  await flush();
  expect(screen.getState().phase).toBe("refused");
  link.screenOpenResult = undefined;
  screen.retry();
  await flush();
  expect(link.screenOpens).toHaveLength(2);
  expect(screen.getState().phase).toBe("connecting");
  link.emit(ready());
  expect(screen.getState().phase).toBe("ready");
});

test("input goes to the connection in framebuffer terms, and nothing without one", async () => {
  const link = new FakeLink();
  const { screen, manager } = setup(link);
  await flush();
  expect(screen.pointer(10, 20, 1)).toBe(true);
  expect(screen.scroll(10, 20, 0, 2)).toBe(true);
  expect(screen.key(0xff0d, true)).toBe(true);
  expect(screen.type("ok")).toBe(true);
  expect(screen.clipboard("copy")).toBe(true);
  expect(screen.refresh()).toBe(true);
  expect(screen.releaseAll()).toBe(true);
  expect(link.screenSent).toEqual([
    { method: "screenPointer", args: [10, 20, 1] },
    { method: "screenScroll", args: [10, 20, 0, 2] },
    { method: "screenKey", args: [0xff0d, true] },
    { method: "screenType", args: ["ok"] },
    { method: "screenClipboard", args: ["copy"] },
    { method: "screenRefresh", args: [] },
    { method: "screenReleaseAll", args: [] },
  ]);
  manager.set(null);
  expect(screen.pointer(1, 1, 0)).toBe(false);
  expect(screen.type("x")).toBe(false);
  expect(screen.refresh()).toBe(false);
});

test("view only sends no input, tells the core, and lets go of what was held", async () => {
  const link = new FakeLink();
  const { screen } = setup(link);
  await flush();
  screen.setViewOnly(true);
  expect(screen.getState().viewOnly).toBe(true);
  expect(link.screenSent).toEqual([
    { method: "screenViewOnly", args: [true] },
    { method: "screenReleaseAll", args: [] },
  ]);
  expect(screen.pointer(1, 1, 1)).toBe(false);
  expect(screen.key(1, true)).toBe(false);
  expect(screen.type("x")).toBe(false);
  expect(screen.clipboard("x")).toBe(false);
  screen.setViewOnly(false);
  expect(screen.pointer(1, 1, 1)).toBe(true);
});

test("view only chosen before the connection is what the open asks for", async () => {
  const { screen, manager } = setup(null);
  screen.setViewOnly(true);
  const link = new FakeLink();
  manager.set(link);
  await flush();
  expect(link.screenOpens).toEqual([{ viewOnly: true, h264: true }]);
});

test("close releases input, closes the channel and silences everything", async () => {
  const link = new FakeLink();
  const { screen, manager, timers } = setup(link);
  await flush();
  link.emit(ready());
  screen.close();
  expect(screen.getState().phase).toBe("closed");
  expect(link.screenCloses).toBe(1);
  expect(link.screenSent).toEqual([{ method: "screenReleaseAll", args: [] }]);
  expect(link.listenerCount).toBe(0);
  expect(manager.listenerCount).toBe(0);

  link.emit({ t: "screenStats", codec: "h264", fps: 1, kbps: 1, dropped: 0, decodeMs: 0 });
  expect(screen.getState().stats).toBeNull();
  manager.set(new FakeLink());
  await timers.advance(60_000);
  expect(screen.getState().phase).toBe("closed");
  expect(screen.pointer(1, 1, 0)).toBe(false);
  screen.close();
  expect(link.screenCloses).toBe(1);
});

test("a late open failure after close does not report", async () => {
  const link = new FakeLink();
  link.screenOpenResult = new DirectError("ScreenNotAllowed", "no");
  const { screen } = setup(link);
  screen.close();
  await flush();
  expect(screen.getState().phase).toBe("closed");
});

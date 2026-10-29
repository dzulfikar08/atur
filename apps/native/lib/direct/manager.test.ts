import { expect, test } from "bun:test";

import { createCredentialStore } from "@/lib/direct/credentials";
import {
  BACKGROUND_GRACE_MS,
  DirectManager,
  PING_INTERVAL_MS,
  RESTART_DELAY_MS,
  retryDelay,
} from "@/lib/direct/manager";
import { createDirectPrefs } from "@/lib/direct/prefs";
import {
  FakeAppState,
  FakeLink,
  FakeNative,
  FakeTimers,
  credential,
  flush,
  memoryStorage,
  session,
} from "@/lib/direct/test-support";
import { DirectError } from "@/modules/atur-direct/src/types";

async function setup(
  options: { stored?: boolean; native?: FakeNative; unsupported?: boolean } = {},
) {
  const storage = memoryStorage();
  const credentials = createCredentialStore(storage);
  const prefs = createDirectPrefs(storage);
  if (options.stored ?? true) await credentials.save(credential());
  const native = options.native ?? new FakeNative();
  const timers = new FakeTimers();
  const appState = new FakeAppState();
  const manager = new DirectManager({
    native: options.unsupported ? null : native,
    credentials,
    prefs,
    appState,
    timers,
  });
  return { manager, native, storage, credentials, prefs, timers, appState };
}

const unreachable = () => new DirectError("Unreachable", "no route");

test("the retry delays are 1 s, 2 s, 5 s, then every 10 s", () => {
  expect([1, 2, 3, 4, 5, 20].map(retryDelay)).toEqual([1000, 2000, 5000, 10_000, 10_000, 10_000]);
});

test("without a native module the manager is unsupported and does nothing", async () => {
  const { manager } = await setup({ unsupported: true });
  await manager.start();
  expect(manager.getSnapshot().state).toBe("unsupported");
  expect(manager.getSnapshot().connection).toBeNull();
});

test("nothing stored: unpaired, no connect", async () => {
  const { manager, native } = await setup({ stored: false });
  await manager.start();
  expect(manager.getSnapshot().state).toBe("unpaired");
  expect(native.connects).toHaveLength(0);
});

test("a stored credential connects at start and mirrors the computer", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  link.sessionList = [session("1")];
  native.script = [link];
  const { manager } = await setup({ native });
  await manager.start();
  await flush();

  const snapshot = manager.getSnapshot();
  expect(snapshot.state).toBe("connected");
  expect(snapshot.connection).toBe(link);
  expect(snapshot.serverName).toBe("Desk");
  expect(snapshot.sessions.map((s) => s.id)).toEqual(["1"]);
  expect(snapshot.rttMs).toBe(12);
  expect(snapshot.preferDirect).toBe(true);
  expect(native.connects[0]?.serverId).toBe("srv-1");
});

test("a stored 'prefer direct' off survives a restart", async () => {
  const { manager, prefs } = await setup();
  await prefs.savePreferDirect(false);
  await manager.start();
  expect(manager.getSnapshot().preferDirect).toBe(false);
});

test("setPreferDirect persists and notifies", async () => {
  const { manager, prefs } = await setup();
  await manager.start();
  let notified = 0;
  manager.subscribe(() => notified++);
  await manager.setPreferDirect(false);
  expect(manager.getSnapshot().preferDirect).toBe(false);
  expect(await prefs.loadPreferDirect()).toBe(false);
  expect(notified).toBe(1);
});

test("the snapshot object is stable until something changes", async () => {
  const { manager } = await setup();
  await manager.start();
  const before = manager.getSnapshot();
  await manager.setPreferDirect(true);
  expect(manager.getSnapshot()).toBe(before);
  await manager.setPreferDirect(false);
  expect(manager.getSnapshot()).not.toBe(before);
});

test("failed connects retry after 1 s, 2 s, 5 s, then every 10 s", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  native.script = [unreachable(), unreachable(), unreachable(), unreachable(), unreachable(), link];
  const { manager, timers } = await setup({ native });
  await manager.start();
  expect(native.connects).toHaveLength(1);
  expect(manager.getSnapshot().state).toBe("offline");
  expect(manager.getSnapshot().error?.code).toBe("Unreachable");

  await timers.advance(999);
  expect(native.connects).toHaveLength(1);
  await timers.advance(1);
  expect(native.connects).toHaveLength(2);
  await timers.advance(1999);
  expect(native.connects).toHaveLength(2);
  await timers.advance(1);
  expect(native.connects).toHaveLength(3);
  await timers.advance(4999);
  expect(native.connects).toHaveLength(3);
  await timers.advance(1);
  expect(native.connects).toHaveLength(4);
  await timers.advance(9999);
  expect(native.connects).toHaveLength(4);
  await timers.advance(1);
  expect(native.connects).toHaveLength(5);
  await timers.advance(10_000);
  expect(native.connects).toHaveLength(6);
  expect(manager.getSnapshot().state).toBe("connected");
  expect(manager.getSnapshot().error).toBeNull();
});

test("an error that is not a DirectError counts as unreachable and is retried", async () => {
  const native = new FakeNative();
  native.connect = async () => {
    throw new Error("socket closed");
  };
  const { manager, timers } = await setup({ native });
  await manager.start();
  expect(manager.getSnapshot().state).toBe("offline");
  expect(manager.getSnapshot().error?.code).toBe("Unreachable");
  expect(timers.pending).toBe(1);
});

for (const [code, state] of [
  ["Unauthorized", "needs-pairing"],
  ["IdentityMismatch", "needs-pairing"],
  ["InvalidCredential", "needs-pairing"],
  ["IncompatibleVersion", "incompatible"],
] as const) {
  test(`${code} stops the retries and ends in ${state}`, async () => {
    const native = new FakeNative();
    native.script = [new DirectError(code, "x")];
    const { manager, timers, appState } = await setup({ native });
    await manager.start();
    expect(manager.getSnapshot().state).toBe(state);
    expect(manager.getSnapshot().error?.code).toBe(code);

    await timers.advance(120_000);
    appState.set(false);
    appState.set(true);
    await flush();
    expect(native.connects).toHaveLength(1);
    expect(manager.getSnapshot().state).toBe(state);
  });
}

test("connect() is also the user's way to try again after a fatal error", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  native.script = [new DirectError("Unauthorized", ""), link];
  const { manager } = await setup({ native });
  await manager.start();
  await manager.connect();
  expect(manager.getSnapshot().state).toBe("connected");
});

test("an unexpected disconnect goes offline and reconnects after the first backoff step", async () => {
  const native = new FakeNative();
  const first = new FakeLink();
  const second = new FakeLink();
  native.script = [first, second];
  const { manager, timers } = await setup({ native });
  await manager.start();

  first.emit({ t: "disconnected" });
  expect(manager.getSnapshot().state).toBe("offline");
  expect(manager.getSnapshot().connection).toBeNull();
  expect(first.listenerCount).toBe(0);

  await timers.advance(999);
  expect(native.connects).toHaveLength(1);
  await timers.advance(1);
  expect(manager.getSnapshot().state).toBe("connected");
  expect(manager.getSnapshot().connection).toBe(second);
});

test("a link that was already closed when connect returned counts as a drop", async () => {
  const native = new FakeNative();
  const dead = new FakeLink();
  dead.closed = true;
  const live = new FakeLink();
  native.script = [dead, live];
  const { manager, timers } = await setup({ native });
  await manager.start();
  expect(manager.getSnapshot().state).toBe("offline");
  await timers.advance(1000);
  expect(manager.getSnapshot().connection).toBe(live);
});

test("restarting retries after about 2 s", async () => {
  const native = new FakeNative();
  const first = new FakeLink();
  const second = new FakeLink();
  native.script = [first, second];
  const { manager, timers } = await setup({ native });
  await manager.start();

  first.emit({ t: "restarting" });
  expect(manager.getSnapshot().state).toBe("offline");
  expect(first.disconnects).toBe(1);
  await timers.advance(RESTART_DELAY_MS - 1);
  expect(native.connects).toHaveLength(1);
  await timers.advance(1);
  expect(manager.getSnapshot().connection).toBe(second);
});

test("events of a link that was replaced are ignored", async () => {
  const native = new FakeNative();
  const first = new FakeLink();
  const second = new FakeLink();
  native.script = [first, second];
  const { manager, timers } = await setup({ native });
  await manager.start();
  first.emit({ t: "disconnected" });
  await timers.advance(1000);
  first.emit({ t: "disconnected" });
  expect(manager.getSnapshot().connection).toBe(second);
});

test("session, catalog and activity events refetch the sessions; others do not", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  link.sessionList = [session("1")];
  native.script = [link];
  const { manager } = await setup({ native });
  await manager.start();
  await flush();
  expect(link.sessionsCalls).toBe(1);

  link.sessionList = [session("1"), session("2")];
  link.emit({ t: "sessions" });
  await flush();
  expect(link.sessionsCalls).toBe(2);
  expect(manager.getSnapshot().sessions.map((s) => s.id)).toEqual(["1", "2"]);

  link.sessionList = [session("2")];
  link.emit({ t: "catalog" });
  await flush();
  expect(link.sessionsCalls).toBe(3);
  expect(manager.getSnapshot().sessions.map((s) => s.id)).toEqual(["2"]);

  link.emit({ t: "activity" });
  await flush();
  expect(link.sessionsCalls).toBe(4);

  link.emit({ t: "git", projectId: "p1" });
  link.emit({ t: "title", session: "2", title: "t", directory: "/" });
  await flush();
  expect(link.sessionsCalls).toBe(4);
});

test("a burst of session events costs one more fetch, not one each", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  native.script = [link];
  const { manager } = await setup({ native });
  await manager.start();
  await flush();
  expect(link.sessionsCalls).toBe(1);

  link.emit({ t: "sessions" });
  link.emit({ t: "sessions" });
  link.emit({ t: "sessions" });
  await flush();
  expect(link.sessionsCalls).toBe(3);
});

test("the cached sessions survive a drop", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  link.sessionList = [session("7")];
  native.script = [link, new FakeLink()];
  const { manager } = await setup({ native });
  await manager.start();
  await flush();
  link.emit({ t: "disconnected" });
  expect(manager.getSnapshot().sessions.map((s) => s.id)).toEqual(["7"]);
});

test("latency is measured at connect and every 30 s while connected", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  native.script = [link];
  const { manager, timers } = await setup({ native });
  await manager.start();
  await flush();
  expect(link.pingCalls).toBe(1);
  expect(manager.getSnapshot().rttMs).toBe(12);

  link.pingMs = 40.4;
  await timers.advance(PING_INTERVAL_MS);
  expect(link.pingCalls).toBe(2);
  expect(manager.getSnapshot().rttMs).toBe(40);

  link.emit({ t: "disconnected" });
  expect(manager.getSnapshot().rttMs).toBeNull();
  await timers.advance(PING_INTERVAL_MS);
  expect(link.pingCalls).toBe(2);
});

test("backgrounded for the grace period: the connection is let go", async () => {
  const native = new FakeNative();
  const first = new FakeLink();
  const second = new FakeLink();
  native.script = [first, second];
  const { manager, timers, appState } = await setup({ native });
  await manager.start();

  appState.set(false);
  await timers.advance(BACKGROUND_GRACE_MS - 1);
  expect(manager.getSnapshot().state).toBe("connected");
  await timers.advance(1);
  expect(manager.getSnapshot().state).toBe("idle");
  expect(manager.getSnapshot().connection).toBeNull();
  expect(first.closed).toBe(true);

  // Back in front: connects at once, no waiting.
  appState.set(true);
  await flush();
  expect(manager.getSnapshot().state).toBe("connected");
  expect(manager.getSnapshot().connection).toBe(second);
});

test("coming back inside the grace period keeps the connection", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  native.script = [link];
  const { manager, timers, appState } = await setup({ native });
  await manager.start();

  appState.set(false);
  await timers.advance(10_000);
  appState.set(true);
  await timers.advance(120_000);
  expect(manager.getSnapshot().connection).toBe(link);
  expect(link.disconnects).toBe(0);
  expect(native.connects).toHaveLength(1);
});

test("no retries while in the background; foreground connects immediately", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  native.script = [unreachable(), unreachable(), link];
  const { manager, timers, appState } = await setup({ native });
  await manager.start();
  expect(manager.getSnapshot().state).toBe("offline");

  appState.set(false);
  await timers.advance(120_000);
  expect(native.connects).toHaveLength(1);

  appState.set(true);
  await flush();
  expect(native.connects).toHaveLength(2);
  // The next retry starts the backoff over: 1 s.
  await timers.advance(1000);
  expect(manager.getSnapshot().connection).toBe(link);
});

test("starting in the background waits for the foreground", async () => {
  const { manager, native, appState } = await setup();
  appState.active = false;
  await manager.start();
  expect(manager.getSnapshot().state).toBe("idle");
  expect(native.connects).toHaveLength(0);
  appState.set(true);
  await flush();
  expect(manager.getSnapshot().state).toBe("connected");
});

test("forget disconnects, deletes the credential and stops reconnecting", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  link.sessionList = [session("1")];
  native.script = [link];
  const { manager, credentials, timers } = await setup({ native });
  await manager.start();
  await flush();

  await manager.forget();
  const snapshot = manager.getSnapshot();
  expect(snapshot.state).toBe("unpaired");
  expect(snapshot.connection).toBeNull();
  expect(snapshot.sessions).toEqual([]);
  expect(snapshot.serverName).toBeNull();
  expect(link.closed).toBe(true);
  expect(await credentials.serverIds()).toEqual([]);

  await timers.advance(120_000);
  expect(native.connects).toHaveLength(1);
});

test("forgetting while a connect is in flight drops the connection that arrives", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  native.script = [link];
  native.hold();
  const { manager } = await setup({ native });
  const started = manager.start();
  await flush();
  expect(manager.getSnapshot().state).toBe("connecting");

  await manager.forget();
  native.release();
  await started;
  await flush();
  expect(link.disconnects).toBe(1);
  expect(manager.getSnapshot().state).toBe("unpaired");
  expect(manager.getSnapshot().connection).toBeNull();
});

test("pair parses, pairs, stores, replaces the old computer and connects", async () => {
  const native = new FakeNative();
  const old = new FakeLink("srv-1");
  const fresh = new FakeLink("srv-2");
  native.script = [old, fresh];
  native.pairResult = credential("srv-2");
  const { manager, credentials } = await setup({ native });
  await manager.start();

  const result = await manager.pair("link-text", "My phone");
  expect(result.serverName).toBe("Desk");
  expect(native.pairs).toEqual([{ link: "link-text", deviceName: "My phone" }]);
  expect(await credentials.serverIds()).toEqual(["srv-2"]);
  expect(old.closed).toBe(true);
  expect(native.connects.at(-1)?.serverId).toBe("srv-2");
  expect(manager.getSnapshot().state).toBe("connected");
  expect(manager.getSnapshot().connection).toBe(fresh);
});

test("pairing from a fresh install leaves the phone paired and connected", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  native.script = [link];
  const { manager, credentials } = await setup({ stored: false, native });
  await manager.start();
  expect(manager.getSnapshot().state).toBe("unpaired");

  await manager.pair("link-text", "My phone");
  expect(await credentials.serverIds()).toEqual(["srv-1"]);
  expect(manager.getSnapshot().connection).toBe(link);
});

test("an invalid link is refused before any pairing happens", async () => {
  const native = new FakeNative();
  native.parseResult = new DirectError("InvalidLink", "bad");
  const { manager, credentials } = await setup({ stored: false, native });
  await manager.start();

  await expect(manager.pair("nope", "My phone")).rejects.toBeInstanceOf(DirectError);
  expect(native.pairs).toHaveLength(0);
  expect(await credentials.serverIds()).toEqual([]);
  expect(manager.getSnapshot().state).toBe("unpaired");
});

test("a refused pairing leaves the old computer connected", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  native.script = [link];
  native.pairResult = new DirectError("Unauthorized", "code expired");
  const { manager } = await setup({ native });
  await manager.start();

  await expect(manager.pair("link-text", "My phone")).rejects.toMatchObject({
    code: "Unauthorized",
  });
  expect(manager.getSnapshot().connection).toBe(link);
  expect(link.disconnects).toBe(0);
});

test("pair rejects as unsupported without a native module", async () => {
  const { manager } = await setup({ unsupported: true });
  await expect(manager.pair("x", "y")).rejects.toMatchObject({ code: "Unsupported" });
});

test("subscribers hear about state changes", async () => {
  const { manager } = await setup();
  const states: string[] = [];
  manager.subscribe(() => states.push(manager.getSnapshot().state));
  await manager.start();
  expect(states).toContain("connecting");
  expect(states.at(-1)).toBe("connected");
});

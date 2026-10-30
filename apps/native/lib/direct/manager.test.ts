import { expect, test } from "bun:test";

import { createCredentialStore } from "@/lib/direct/credentials";
import {
  BACKGROUND_GRACE_MS,
  DirectManager,
  NETWORK_SETTLE_MS,
  PING_INTERVAL_MS,
  RESTART_DELAY_MS,
  ROUTE_CHECK_MS,
  measureRtt,
  retryDelay,
  shouldSwap,
  type DirectLink,
} from "@/lib/direct/manager";
import { createDirectPrefs } from "@/lib/direct/prefs";
import {
  FakeAppState,
  FakeLink,
  FakeNative,
  FakeNetwork,
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
  const network = new FakeNetwork();
  const manager = new DirectManager({
    native: options.unsupported ? null : native,
    credentials,
    prefs,
    appState,
    network,
    timers,
  });
  return { manager, native, storage, credentials, prefs, timers, appState, network };
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

test("loaded says when the saved pairing has been read", async () => {
  const { manager } = await setup({ stored: true });
  expect(manager.getSnapshot().loaded).toBe(false);
  await manager.start();
  expect(manager.getSnapshot().loaded).toBe(true);
  expect(manager.getSnapshot().state).not.toBe("unpaired");

  const empty = await setup({ stored: false });
  expect(empty.manager.getSnapshot().loaded).toBe(false);
  await empty.manager.start();
  expect(empty.manager.getSnapshot().loaded).toBe(true);
  expect(empty.manager.getSnapshot().state).toBe("unpaired");

  const none = await setup({ unsupported: true });
  expect(none.manager.getSnapshot().loaded).toBe(true);
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

test("echo mode and transport default to auto and are read from the saved prefs", async () => {
  const { manager, prefs } = await setup();
  await manager.start();
  expect(manager.getSnapshot().echoMode).toBe("auto");
  expect(manager.getSnapshot().transportPreference).toBe("auto");

  const second = await setup();
  await second.prefs.saveEchoMode("never");
  await second.prefs.saveTransport("tls");
  await second.manager.start();
  expect(second.manager.getSnapshot().echoMode).toBe("never");
  expect(second.manager.getSnapshot().transportPreference).toBe("tls");
  expect(second.native.connectOptions).toEqual(["tls"]);
  expect(await prefs.loadEchoMode()).toBe("auto");
});

test("the saved echo mode is applied right after connect", async () => {
  const link = new FakeLink();
  const native = new FakeNative();
  native.script = [link];
  const { manager, prefs } = await setup({ native });
  await prefs.saveEchoMode("always");
  await manager.start();
  expect(link.echoModes).toEqual(["always"]);
});

test("a reconnect applies the saved echo mode to the new connection", async () => {
  const first = new FakeLink();
  const second = new FakeLink();
  const native = new FakeNative();
  native.script = [first, second];
  const { manager, timers } = await setup({ native });
  await manager.start();
  await manager.setEchoMode("never");
  expect(first.echoModes).toEqual(["auto", "never"]);
  first.emit({ t: "disconnected" });
  await timers.advance(1000);
  expect(manager.getSnapshot().connection).toBe(second);
  expect(second.echoModes).toEqual(["never"]);
});

test("setEchoMode persists, notifies and reaches the live connection", async () => {
  const { manager, prefs, native } = await setup();
  await manager.start();
  await manager.setEchoMode("always");
  expect(manager.getSnapshot().echoMode).toBe("always");
  expect(await prefs.loadEchoMode()).toBe("always");
  const link = manager.getSnapshot().connection as FakeLink;
  expect(link.echoModes.at(-1)).toBe("always");
  expect(native.connects).toHaveLength(1);
});

test("setTransport saves the preference and reconnects with it", async () => {
  const first = new FakeLink();
  const second = new FakeLink();
  second.transport = "udp";
  const native = new FakeNative();
  native.script = [first, second];
  const { manager, prefs } = await setup({ native });
  await manager.start();
  expect(native.connectOptions).toEqual(["auto"]);

  await manager.setTransport("tls");
  expect(await prefs.loadTransport()).toBe("tls");
  expect(first.disconnects).toBe(1);
  expect(native.connectOptions).toEqual(["auto", "tls"]);
  expect(manager.getSnapshot().state).toBe("connected");
  expect(manager.getSnapshot().connection).toBe(second);
  expect(second.echoModes).toEqual(["auto"]);

  // Asking for what is already chosen changes nothing.
  await manager.setTransport("tls");
  expect(native.connects).toHaveLength(2);
});

test("setTransport while unpaired only saves the preference", async () => {
  const { manager, native, prefs } = await setup({ stored: false });
  await manager.start();
  await manager.setTransport("tls");
  expect(await prefs.loadTransport()).toBe("tls");
  expect(native.connects).toHaveLength(0);
});

// --- route: racing the addresses again ------------------------------------------------------

/** A link on the phone-hosted hotspot's bad path: through Tailscale's relay at 120 ms. */
function relayed(ms = 120): FakeLink {
  const link = new FakeLink();
  link.route = { host: "100.64.0.1", kind: "tailscale", ms };
  link.pingMs = ms;
  return link;
}

/** The same computer over the hotspot's own link at 3 ms. */
function direct(ms = 3): FakeLink {
  const link = new FakeLink();
  link.route = { host: "10.184.172.228", kind: "local", ms };
  link.pingMs = ms;
  return link;
}

test("a connection must be 30% and 20 ms faster to replace the live one", () => {
  expect(shouldSwap(120, 3)).toBe(true);
  expect(shouldSwap(100, 70)).toBe(true);
  expect(shouldSwap(100, 71)).toBe(false);
  // 60% faster but only 15 ms.
  expect(shouldSwap(25, 10)).toBe(false);
  expect(shouldSwap(30, 10)).toBe(true);
  expect(shouldSwap(50, 50)).toBe(false);
  expect(shouldSwap(50, 80)).toBe(false);
  expect(shouldSwap(null, 90)).toBe(true);
  expect(shouldSwap(90, null)).toBe(false);
  expect(shouldSwap(null, null)).toBe(false);
});

test("the round trip of a connection is the median of its answered pings", async () => {
  const link = new FakeLink();
  const times = [30, 10, 20];
  link.ping = async () => times.shift() ?? 0;
  expect(await measureRtt(link, 3)).toBe(20);

  const lossy = new FakeLink();
  lossy.pingFails = true;
  expect(await measureRtt(lossy, 3)).toBeNull();

  const two = new FakeLink();
  const answers: (number | Error)[] = [10, new Error("lost"), 30];
  two.ping = async () => {
    const next = answers.shift();
    if (next instanceof Error || next === undefined) throw new DirectError("Timeout", "");
    return next;
  };
  expect(await measureRtt(two, 3)).toBe(20);
});

test("reroute moves to a clearly faster connection and the old one is closed", async () => {
  const live = relayed();
  const better = direct();
  const native = new FakeNative();
  native.script = [live, better];
  const { manager } = await setup({ native });
  await manager.start();
  await flush();
  expect(manager.getSnapshot().connection).toBe(live);
  expect(manager.getSnapshot().rttMs).toBe(120);

  // Whoever watches the snapshot never sees the connection go missing.
  const seen: (DirectLink | null)[] = [];
  manager.subscribe(() => seen.push(manager.getSnapshot().connection));
  expect(await manager.reroute()).toBe("swapped");
  await flush();

  const snapshot = manager.getSnapshot();
  expect(snapshot.state).toBe("connected");
  expect(snapshot.connection).toBe(better);
  expect(snapshot.rerouting).toBe(false);
  expect(snapshot.rttMs).toBe(3);
  expect(seen.every((connection) => connection !== null)).toBe(true);
  expect(seen.at(-1)).toBe(better);
  expect(live.closed).toBe(true);
  expect(live.listenerCount).toBe(0);
  expect(better.closed).toBe(false);
  expect(better.listenerCount).toBe(1);
  expect(better.echoModes).toEqual(["auto"]);
  expect(native.connects).toHaveLength(2);
  expect(better.sessionsCalls).toBeGreaterThan(0);

  // The new connection's events drive the manager; the old one's are ignored.
  better.sessionList = [session("7")];
  better.emit({ t: "sessions" });
  await flush();
  expect(manager.getSnapshot().sessions.map((s) => s.id)).toEqual(["7"]);
  live.emit({ t: "disconnected" });
  expect(manager.getSnapshot().state).toBe("connected");
});

test("reroute keeps the live connection unless the new one is clearly better", async () => {
  const live = relayed(40);
  const slightly = direct(30);
  const native = new FakeNative();
  native.script = [live, slightly];
  const { manager } = await setup({ native });
  await manager.start();
  await flush();

  expect(await manager.reroute()).toBe("kept");
  expect(manager.getSnapshot().connection).toBe(live);
  expect(live.closed).toBe(false);
  expect(slightly.closed).toBe(true);
  expect(manager.getSnapshot().rttMs).toBe(40);
  expect(manager.getSnapshot().rerouting).toBe(false);

  // Faster by a share but not by 20 ms.
  const tiny = relayed(25);
  const quick = direct(10);
  const small = new FakeNative();
  small.script = [tiny, quick];
  const second = await setup({ native: small });
  await second.manager.start();
  await flush();
  expect(await second.manager.reroute()).toBe("kept");
  expect(second.manager.getSnapshot().connection).toBe(tiny);
  expect(quick.closed).toBe(true);
});

test("reroute keeps the live connection when the new one cannot connect or answer", async () => {
  const live = relayed();
  const native = new FakeNative();
  native.script = [live, unreachable()];
  const { manager } = await setup({ native });
  await manager.start();
  await flush();
  expect(await manager.reroute()).toBe("failed");
  expect(manager.getSnapshot().connection).toBe(live);
  expect(manager.getSnapshot().state).toBe("connected");

  const mute = direct();
  mute.pingFails = true;
  native.script = [mute];
  expect(await manager.reroute()).toBe("kept");
  expect(mute.closed).toBe(true);
  expect(manager.getSnapshot().connection).toBe(live);
});

test("reroute replaces a live connection that no longer answers", async () => {
  const live = relayed();
  const better = direct();
  const native = new FakeNative();
  native.script = [live, better];
  const { manager } = await setup({ native });
  await manager.start();
  await flush();
  live.pingFails = true;
  expect(await manager.reroute()).toBe("swapped");
  expect(manager.getSnapshot().connection).toBe(better);
});

test("only one reroute runs at a time", async () => {
  const live = relayed();
  const better = direct();
  const native = new FakeNative();
  native.script = [live, better];
  const { manager } = await setup({ native });
  await manager.start();
  await flush();

  native.hold();
  const first = manager.reroute();
  const second = manager.reroute();
  expect(second).toBe(first);
  expect(manager.getSnapshot().rerouting).toBe(true);
  native.release();
  expect(await first).toBe("swapped");
  expect(native.connects).toHaveLength(2);
  expect(manager.getSnapshot().rerouting).toBe(false);

  // Done: the next request runs again.
  native.script = [direct()];
  expect(await manager.reroute()).toBe("kept");
  expect(native.connects).toHaveLength(3);
});

test("reroute does nothing without a live connection", async () => {
  const none = await setup({ stored: false });
  await none.manager.start();
  expect(await none.manager.reroute()).toBe("skipped");

  const bare = await setup({ unsupported: true });
  await bare.manager.start();
  expect(await bare.manager.reroute()).toBe("skipped");

  const native = new FakeNative();
  native.script = [unreachable()];
  const offline = await setup({ native });
  await offline.manager.start();
  expect(offline.manager.getSnapshot().state).toBe("offline");
  expect(await offline.manager.reroute()).toBe("skipped");
  expect(native.connects).toHaveLength(1);
});

test("a reroute does not outlive its connection: the new one is dropped", async () => {
  const live = relayed();
  const better = direct();
  const native = new FakeNative();
  native.script = [live, better];
  const { manager } = await setup({ native });
  await manager.start();
  await flush();

  native.hold();
  const pending = manager.reroute();
  live.emit({ t: "disconnected" });
  expect(manager.getSnapshot().state).toBe("offline");
  native.release();
  expect(await pending).toBe("skipped");
  expect(better.closed).toBe(true);
  expect(manager.getSnapshot().connection).toBeNull();

  // Forgetting the computer mid-reroute drops the new connection too.
  const second = await setup({
    native: Object.assign(new FakeNative(), { script: [relayed(), direct()] }),
  });
  await second.manager.start();
  await flush();
  second.native.hold();
  const racing = second.manager.reroute();
  await second.manager.forget();
  second.native.release();
  expect(await racing).toBe("skipped");
  expect(second.manager.getSnapshot().connection).toBeNull();
});

test("the addresses a connection learned are kept, shown and used the next time", async () => {
  const learned = ["10.184.172.228", "100.64.0.1", "desk.local"];
  const live = relayed();
  live.addresses = learned;
  const next = direct();
  next.addresses = learned;
  const native = new FakeNative();
  native.script = [live, next];
  const { manager, credentials, timers } = await setup({ native });
  await manager.start();
  await flush();

  expect(manager.getSnapshot().hosts).toEqual(learned);
  expect((await credentials.load("srv-1"))?.hosts).toEqual(learned);
  expect((await credentials.load("srv-1"))?.token).toBe(credential().token);

  // A drop reconnects with what was learned, not with what pairing wrote.
  live.emit({ t: "disconnected" });
  await timers.advance(1000);
  expect(native.connects[1]?.hosts).toEqual(learned);
  expect(manager.getSnapshot().connection).toBe(next);
});

test("addresses learned by a reroute are kept even when the connection is not", async () => {
  const live = relayed(40);
  const candidate = direct(35);
  candidate.addresses = ["192.168.43.7", "100.64.0.1", "desk.local"];
  const native = new FakeNative();
  native.script = [live, candidate];
  const { manager, credentials } = await setup({ native });
  await manager.start();
  await flush();

  expect(await manager.reroute()).toBe("kept");
  await flush();
  expect(manager.getSnapshot().hosts).toEqual(["192.168.43.7", "100.64.0.1", "desk.local"]);
  expect((await credentials.load("srv-1"))?.hosts).toEqual([
    "192.168.43.7",
    "100.64.0.1",
    "desk.local",
  ]);
});

test("a core that reports no addresses leaves the stored ones alone", async () => {
  const { manager, credentials } = await setup();
  await manager.start();
  await flush();
  expect(manager.getSnapshot().hosts).toEqual(credential().hosts);
  expect((await credentials.load("srv-1"))?.hosts).toEqual(credential().hosts);
});

test("a network change races again once it has settled, and only for a route worth improving", async () => {
  const live = relayed();
  const better = direct();
  const native = new FakeNative();
  native.script = [live, better];
  const { manager, network, timers } = await setup({ native });
  await manager.start();
  await flush();
  expect(network.listenerCount).toBe(1);

  // Several events in a row are one change.
  network.change();
  await timers.advance(NETWORK_SETTLE_MS - 1);
  network.change();
  await timers.advance(NETWORK_SETTLE_MS - 1);
  expect(native.connects).toHaveLength(1);
  await timers.advance(1);
  expect(native.connects).toHaveLength(2);
  expect(manager.getSnapshot().connection).toBe(better);

  // Now local and fast: a change leaves it alone.
  network.change();
  await timers.advance(NETWORK_SETTLE_MS * 3);
  expect(native.connects).toHaveLength(2);
});

test("a network change while offline or in the background does not start a reroute", async () => {
  const native = new FakeNative();
  native.script = [relayed(), direct()];
  const { manager, network, timers, appState } = await setup({ native });
  await manager.start();
  await flush();
  appState.set(false);
  network.change();
  await timers.advance(NETWORK_SETTLE_MS * 2);
  expect(native.connects).toHaveLength(1);
});

test("coming back to the front races again when the route is poor", async () => {
  const native = new FakeNative();
  native.script = [relayed(), direct()];
  const { manager, appState } = await setup({ native });
  await manager.start();
  await flush();

  appState.set(false);
  appState.set(true);
  await flush();
  expect(native.connects).toHaveLength(2);
  expect(manager.getSnapshot().connection?.route?.kind).toBe("local");
});

test("a route that is not local is raced again every minute until it is", async () => {
  const live = relayed();
  const stubborn = relayed(110);
  const better = direct();
  const native = new FakeNative();
  native.script = [live, stubborn, better];
  const { manager, timers } = await setup({ native });
  await manager.start();
  await flush();

  await timers.advance(ROUTE_CHECK_MS - 1);
  expect(native.connects).toHaveLength(1);
  await timers.advance(1);
  expect(native.connects).toHaveLength(2);
  expect(manager.getSnapshot().connection).toBe(live);

  await timers.advance(ROUTE_CHECK_MS);
  expect(native.connects).toHaveLength(3);
  expect(manager.getSnapshot().connection).toBe(better);

  // Local and fast: the timer stops.
  await timers.advance(ROUTE_CHECK_MS * 10);
  expect(native.connects).toHaveLength(3);
});

test("a local route that is fast is never raced again by the timer", async () => {
  const native = new FakeNative();
  native.script = [direct()];
  const { manager, timers } = await setup({ native });
  await manager.start();
  await flush();
  await timers.advance(ROUTE_CHECK_MS * 5);
  expect(native.connects).toHaveLength(1);
});

test("a slow ping on a core that reports no route also starts the timer", async () => {
  const link = new FakeLink();
  link.pingMs = 150;
  const native = new FakeNative();
  native.script = [link, direct()];
  const { manager, timers } = await setup({ native });
  await manager.start();
  await flush();
  expect(manager.getSnapshot().rttMs).toBe(150);
  await timers.advance(ROUTE_CHECK_MS);
  expect(native.connects).toHaveLength(2);
  expect(manager.getSnapshot().connection?.route?.kind).toBe("local");
});

test("forgetting or being sent to the background leaves no route timers behind", async () => {
  const native = new FakeNative();
  native.script = [relayed(), direct()];
  const { manager, timers, network } = await setup({ native });
  await manager.start();
  await flush();
  network.change();
  await manager.forget();
  expect(timers.pending).toBe(0);
  await timers.advance(ROUTE_CHECK_MS * 3);
  expect(native.connects).toHaveLength(1);
});

test("looking at a session acknowledges only its completions, and nothing when there are none", async () => {
  const native = new FakeNative();
  const link = new FakeLink();
  const event = (id: string, session: string, kind: "attention" | "completed") => ({
    id,
    session,
    projectId: "p1",
    provider: "omp",
    timestamp: 1,
    kind,
  });
  link.activityEvents = [
    event("7", "1", "completed"),
    event("8", "2", "completed"),
    event("9", "1", "attention"),
  ];
  native.script = [link];
  const { manager } = await setup({ native });
  await manager.start();
  await flush();
  await manager.acknowledge("1");
  expect(link.acknowledged).toEqual([["7"]]);
  await manager.acknowledge("3");
  expect(link.acknowledged).toHaveLength(1);
});

import { expect, test } from "bun:test";

import { connectJson, createDirect, parsePrompts, type NativeAturDirect } from "./connection";
import { DirectError, type DirectCredential } from "./types";

const credential: DirectCredential = {
  serverId: "srv-1",
  serverName: "Desk",
  hosts: ["100.64.0.1"],
  port: 7419,
  fingerprint: "ab".repeat(32),
  deviceId: "dev-1",
  token: "cd".repeat(32),
};

function fakeNative(answer: object) {
  const connects: string[] = [];
  const native: NativeAturDirect = {
    parseLink: async () => "{}",
    pair: async () => "{}",
    connect: async (_id, json) => {
      connects.push(json);
      return JSON.stringify({ ok: answer });
    },
    call: async () => JSON.stringify({ ok: null }),
    fire: () => JSON.stringify({ ok: null }),
    disconnect: async () => {},
    addListener: () => ({ remove() {} }),
  };
  return { native, connects };
}

test("the transport preference is merged into the credential JSON, auto by default", () => {
  expect(JSON.parse(connectJson(credential))).toEqual({ ...credential, transport: "auto" });
  expect(JSON.parse(connectJson(credential, "tls"))).toEqual({ ...credential, transport: "tls" });
});

test("connect passes the preference and exposes the transport and the note of the answer", async () => {
  const udp = fakeNative({
    serverId: "s",
    serverName: "Desk",
    serverVersion: "3",
    transport: "udp",
    udpNote: "",
  });
  const direct = createDirect(udp.native);
  const connection = await direct.connect(credential, { transport: "auto" });
  expect(JSON.parse(udp.connects[0] ?? "{}").transport).toBe("auto");
  expect(connection.transport).toBe("udp");
  expect(connection.udpNote).toBe("");

  const tls = fakeNative({
    serverId: "s",
    serverName: "Desk",
    serverVersion: "2",
    transport: "tls",
    udpNote: "older server",
  });
  const fallback = await createDirect(tls.native).connect(credential);
  expect(JSON.parse(tls.connects[0] ?? "{}").transport).toBe("auto");
  expect(fallback.transport).toBe("tls");
  expect(fallback.udpNote).toBe("older server");
});

test("an answer without a transport (an older core) is TLS", async () => {
  const old = fakeNative({ serverId: "s", serverName: "Desk", serverVersion: "2" });
  const connection = await createDirect(old.native).connect(credential, { transport: "tls" });
  expect(connection.transport).toBe("tls");
  expect(connection.udpNote).toBe("");
});

test("connect exposes the route and the addresses to keep, and ignores what is malformed", async () => {
  const route = { host: "10.184.172.54", kind: "local" as const, ms: 3.2 };
  const modern = fakeNative({
    serverId: "s",
    serverName: "Desk",
    serverVersion: "3",
    transport: "tls",
    udpNote: "turned off",
    route,
    addresses: ["10.184.172.54", "100.64.0.1"],
  });
  const connection = await createDirect(modern.native).connect(credential);
  expect(connection.route).toEqual(route);
  expect(connection.addresses).toEqual(["10.184.172.54", "100.64.0.1"]);

  const old = fakeNative({ serverId: "s", serverName: "Desk", serverVersion: "2" });
  const plain = await createDirect(old.native).connect(credential);
  expect(plain.route).toBeNull();
  expect(plain.addresses).toEqual([]);

  const broken = fakeNative({
    serverId: "s",
    serverName: "Desk",
    serverVersion: "3",
    route: { host: "10.0.0.1", kind: "carrier-pigeon", ms: 1 },
    addresses: ["10.0.0.1", 7, "", null],
  });
  const odd = await createDirect(broken.native).connect(credential);
  expect(odd.route).toBeNull();
  expect(odd.addresses).toEqual(["10.0.0.1"]);
});

test("history prompts default to none and keep only ascending indices inside the rows", async () => {
  const answers = [
    { rows: ["a", "b", "c"], visible: 1 },
    { rows: ["a", "b", "c"], visible: 1, prompts: [0, 2] },
    { rows: ["a", "b", "c"], visible: 1, prompts: [2, 1, 1, -1, 3, 1.5, "0", 2] },
  ];
  const replies: object[] = [];
  const { native } = fakeNative({ serverId: "s", serverName: "Desk", serverVersion: "3" });
  native.call = async () => JSON.stringify({ ok: answers.shift() });
  const connection = await createDirect(native).connect(credential);
  for (let i = 0; i < 3; i++) replies.push(await connection.history("1", 100));
  expect(replies).toEqual([
    { rows: ["a", "b", "c"], visible: 1, prompts: [] },
    { rows: ["a", "b", "c"], visible: 1, prompts: [0, 2] },
    { rows: ["a", "b", "c"], visible: 1, prompts: [2] },
  ]);
  expect(parsePrompts("nope", 5)).toEqual([]);
});

const info = { serverId: "s", serverName: "Desk", serverVersion: "3" };

test("connect reports whether the server has the screen feature; an older core says nothing", async () => {
  const on = await createDirect(fakeNative({ ...info, screen: true }).native).connect(credential);
  expect(on.screen).toBe(true);
  const off = await createDirect(fakeNative({ ...info, screen: false }).native).connect(credential);
  expect(off.screen).toBe(false);
  const old = await createDirect(fakeNative(info).native).connect(credential);
  expect(old.screen).toBe(false);
  const odd = await createDirect(fakeNative({ ...info, screen: "yes" }).native).connect(credential);
  expect(odd.screen).toBe(false);
});

test("screenH264 is the module constant, false where it is missing", () => {
  const { native } = fakeNative(info);
  expect(createDirect(native).screenH264).toBe(false);
  expect(createDirect({ ...native, screenH264: true }).screenH264).toBe(true);
  expect(createDirect({ ...native, screenH264: false }).screenH264).toBe(false);
});

test("screen requests go out under their core names: open and close as calls, input as fires", async () => {
  const calls: { method: string; args: unknown }[] = [];
  const fires: { method: string; args: unknown }[] = [];
  const { native } = fakeNative(info);
  native.call = async (_id, method, args) => {
    calls.push({ method, args: JSON.parse(args) });
    return JSON.stringify({ ok: {} });
  };
  native.fire = (_id, method, args) => {
    fires.push({ method, args: JSON.parse(args) });
    return JSON.stringify({ ok: null });
  };
  const connection = await createDirect(native).connect(credential);

  await connection.screenOpen({ viewOnly: true, h264: false });
  await connection.screenClose();
  expect(connection.screenPointer(10.4, 20.6, 1)).toBe(true);
  expect(connection.screenScroll(5, 6, 0, -2)).toBe(true);
  expect(connection.screenKey(0xff0d, true)).toBe(true);
  expect(connection.screenType("hi")).toBe(true);
  expect(connection.screenViewOnly(false)).toBe(true);
  expect(connection.screenClipboard("copied")).toBe(true);
  expect(connection.screenReleaseAll()).toBe(true);
  expect(connection.screenRefresh()).toBe(true);

  expect(calls).toEqual([
    { method: "screenOpen", args: { viewOnly: true, h264: false } },
    { method: "screenClose", args: {} },
  ]);
  expect(fires).toEqual([
    { method: "screenPointer", args: { x: 10, y: 21, buttons: 1 } },
    { method: "screenScroll", args: { x: 5, y: 6, dx: 0, dy: -2 } },
    { method: "screenKey", args: { keysym: 0xff0d, down: true } },
    { method: "screenType", args: { text: "hi" } },
    { method: "screenViewOnly", args: { viewOnly: false } },
    { method: "screenClipboard", args: { text: "copied" } },
    { method: "screenReleaseAll", args: {} },
    { method: "screenRefresh", args: {} },
  ]);
});

test("the screen refusal codes keep the server's reason, and an unknown code is Internal", async () => {
  const answers = [
    {
      error: { code: "ScreenNotAllowed", reason: "Screen sharing is not allowed for this phone." },
    },
    { error: { code: "ScreenUnavailable", reason: "wayvnc is not installed" } },
    { error: { code: "Unsupported", reason: "" } },
    { error: { code: "ScreenSomethingNew", reason: "x" } },
  ];
  const { native } = fakeNative(info);
  native.call = async () => JSON.stringify(answers.shift());
  const connection = await createDirect(native).connect(credential);
  const failures: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    await connection.screenOpen({ viewOnly: false, h264: true }).catch((e: unknown) => {
      failures.push(e instanceof DirectError ? { code: e.code, reason: e.reason } : e);
    });
  }
  expect(failures).toEqual([
    { code: "ScreenNotAllowed", reason: "Screen sharing is not allowed for this phone." },
    { code: "ScreenUnavailable", reason: "wayvnc is not installed" },
    { code: "Unsupported", reason: "" },
    { code: "Internal", reason: "x" },
  ]);
});

test("screen requests fire nothing once the connection is gone", async () => {
  const fires: string[] = [];
  const { native } = fakeNative(info);
  native.fire = (_id, method) => {
    fires.push(method);
    return JSON.stringify({ ok: null });
  };
  const connection = await createDirect(native).connect(credential);
  await connection.disconnect();
  expect(connection.screenKey(1, true)).toBe(false);
  expect(fires).toEqual([]);
});

test("screen events reach the connection's subscribers like any other", async () => {
  let push: (payload: { connection: string; json: string }) => void = () => {};
  const { native } = fakeNative(info);
  native.addListener = (_event, listener) => {
    push = listener;
    return { remove() {} };
  };
  const direct = createDirect(native);
  const connection = await direct.connect(credential);
  const seen: unknown[] = [];
  connection.subscribe((event) => seen.push(event));
  const ready = { t: "screen", state: "ready", width: 1920, height: 1080, name: "wl", reason: "" };
  const stats = { t: "screenStats", codec: "h264", fps: 30, kbps: 900, dropped: 0, decodeMs: 2 };
  push({ connection: connection.id, json: JSON.stringify(ready) });
  push({ connection: connection.id, json: JSON.stringify(stats) });
  push({ connection: connection.id, json: JSON.stringify({ t: "screenClipboard", text: "hi" }) });
  expect(seen).toEqual([ready, stats, { t: "screenClipboard", text: "hi" }]);
});

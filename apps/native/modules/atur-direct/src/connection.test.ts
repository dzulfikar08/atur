import { expect, test } from "bun:test";

import { connectJson, createDirect, parsePrompts, type NativeAturDirect } from "./connection";
import type { DirectCredential } from "./types";

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

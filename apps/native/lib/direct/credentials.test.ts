import { expect, test } from "bun:test";

import { createCredentialStore, type KeyValueStorage } from "@/lib/direct/credentials";
import { createDirectPrefs } from "@/lib/direct/prefs";
import { credential, memoryStorage } from "@/lib/direct/test-support";

test("a credential round-trips through the store", async () => {
  const store = createCredentialStore(memoryStorage());
  await store.save(credential("srv-1"));
  expect(await store.load("srv-1")).toEqual(credential("srv-1"));
  expect(await store.serverIds()).toEqual(["srv-1"]);
});

test("it is kept under its own key with the this-device-only flag", async () => {
  const writes: { key: string; thisDeviceOnly?: boolean }[] = [];
  const inner = memoryStorage();
  const storage: KeyValueStorage = {
    ...inner,
    setItem: async (key, value, options) => {
      writes.push({ key, thisDeviceOnly: options?.thisDeviceOnly });
      await inner.setItem(key, value, options);
    },
  };
  await createCredentialStore(storage).save(credential("srv-9"));
  expect(writes.find((w) => w.key === "direct.credential.srv-9")?.thisDeviceOnly).toBe(true);
  expect(inner.data.has("direct.credential.srv-9")).toBe(true);
});

test("one credential per computer, newest first, replaced in place", async () => {
  const store = createCredentialStore(memoryStorage());
  await store.save(credential("a"));
  await store.save(credential("b"));
  expect(await store.serverIds()).toEqual(["b", "a"]);

  await store.save({ ...credential("a"), serverName: "Renamed" });
  expect(await store.serverIds()).toEqual(["a", "b"]);
  expect((await store.load("a"))?.serverName).toBe("Renamed");
  expect((await store.loadAll()).map((c) => c.serverId)).toEqual(["a", "b"]);
});

test("clear removes one computer and the index once empty", async () => {
  const storage = memoryStorage();
  const store = createCredentialStore(storage);
  await store.save(credential("a"));
  await store.save(credential("b"));

  await store.clear("a");
  expect(await store.load("a")).toBeNull();
  expect(await store.serverIds()).toEqual(["b"]);

  await store.clear("b");
  expect(await store.serverIds()).toEqual([]);
  expect(storage.data.size).toBe(0);
});

test("unreadable or incomplete entries are skipped, not trusted", async () => {
  const storage = memoryStorage();
  const store = createCredentialStore(storage);
  await store.save(credential("good"));
  storage.data.set("direct.credential.index", JSON.stringify(["bad", "short", "good", "gone"]));
  storage.data.set("direct.credential.bad", "{not json");
  storage.data.set(
    "direct.credential.short",
    JSON.stringify({ ...credential("short"), token: "abcd" }),
  );

  expect((await store.loadAll()).map((c) => c.serverId)).toEqual(["good"]);
  expect(await store.load("bad")).toBeNull();
  expect(await store.load("short")).toBeNull();
});

test("a damaged index reads as empty", async () => {
  const storage = memoryStorage();
  storage.data.set("direct.credential.index", "nope");
  expect(await createCredentialStore(storage).serverIds()).toEqual([]);
});

test("a keystore that drops the write makes save fail instead of pretending", async () => {
  const storage: KeyValueStorage = {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  };
  await expect(createCredentialStore(storage).save(credential())).rejects.toThrow();
});

test("prefer-direct is unset until chosen, then remembered", async () => {
  const prefs = createDirectPrefs(memoryStorage());
  expect(await prefs.loadPreferDirect()).toBeUndefined();
  await prefs.savePreferDirect(false);
  expect(await prefs.loadPreferDirect()).toBe(false);
  await prefs.savePreferDirect(true);
  expect(await prefs.loadPreferDirect()).toBe(true);
});

test("updateHosts replaces only the addresses and keeps the rest and the position", async () => {
  const storage = memoryStorage();
  const store = createCredentialStore(storage);
  await store.save(credential("a"));
  await store.save(credential("b"));

  expect(await store.updateHosts("a", ["10.184.172.228", "100.64.0.1", "desk.local"])).toBe(true);
  const updated = await store.load("a");
  expect(updated).toEqual({
    ...credential("a"),
    hosts: ["10.184.172.228", "100.64.0.1", "desk.local"],
  });
  // `a` was saved first and stays second: the newest saved computer is still `b`.
  expect(await store.serverIds()).toEqual(["b", "a"]);
  expect((await store.load("b"))?.hosts).toEqual(credential("b").hosts);
});

test("updateHosts leaves a credential alone when there is nothing to change", async () => {
  const storage = memoryStorage();
  const store = createCredentialStore(storage);
  await store.save(credential("a"));
  const before = storage.data.get("direct.credential.a");

  expect(await store.updateHosts("a", credential("a").hosts)).toBe(false);
  expect(await store.updateHosts("a", [])).toBe(false);
  expect(await store.updateHosts("a", ["", "  "])).toBe(false);
  expect(await store.updateHosts("missing", ["10.0.0.1"])).toBe(false);
  expect(storage.data.get("direct.credential.a")).toBe(before);
  expect(storage.data.has("direct.credential.missing")).toBe(false);
});

test("updateHosts keeps each address once and at most eight, in the order given", async () => {
  const store = createCredentialStore(memoryStorage());
  await store.save(credential("a"));
  const many = Array.from({ length: 12 }, (_, i) => `10.0.0.${i + 1}`);
  expect(await store.updateHosts("a", [" Desk.local ", "desk.LOCAL", ...many])).toBe(true);
  expect((await store.load("a"))?.hosts).toEqual(["Desk.local", ...many.slice(0, 7)]);
});

test("updateHosts fails loudly when the keystore drops the write", async () => {
  const inner = memoryStorage();
  const store = createCredentialStore(inner);
  await store.save(credential("a"));
  const lossy = createCredentialStore({ ...inner, setItem: async () => {} });
  await expect(lossy.updateHosts("a", ["10.0.0.1"])).rejects.toThrow();
  expect((await store.load("a"))?.hosts).toEqual(credential("a").hosts);
});

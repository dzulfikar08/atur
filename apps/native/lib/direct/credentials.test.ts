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

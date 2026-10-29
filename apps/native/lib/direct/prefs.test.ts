import { expect, test } from "bun:test";

import { createDirectPrefs } from "@/lib/direct/prefs";
import { memoryStorage } from "@/lib/direct/test-support";

test("echo mode defaults to auto and persists", async () => {
  const storage = memoryStorage();
  const prefs = createDirectPrefs(storage);
  expect(await prefs.loadEchoMode()).toBe("auto");
  await prefs.saveEchoMode("never");
  expect(await createDirectPrefs(storage).loadEchoMode()).toBe("never");
  await prefs.saveEchoMode("always");
  expect(await prefs.loadEchoMode()).toBe("always");
});

test("a stored echo mode or transport nobody knows reads as the default", async () => {
  const storage = memoryStorage();
  storage.data.set("atur.direct.echoMode", "sometimes");
  storage.data.set("atur.direct.transport", "carrier-pigeon");
  const prefs = createDirectPrefs(storage);
  expect(await prefs.loadEchoMode()).toBe("auto");
  expect(await prefs.loadTransport()).toBe("auto");
});

test("transport defaults to auto and persists", async () => {
  const storage = memoryStorage();
  const prefs = createDirectPrefs(storage);
  expect(await prefs.loadTransport()).toBe("auto");
  await prefs.saveTransport("tls");
  expect(await createDirectPrefs(storage).loadTransport()).toBe("tls");
});

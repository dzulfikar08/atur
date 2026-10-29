import { expect, test } from "bun:test";

import { startRoute } from "@/lib/direct/start-route";

test("waits for the session to be read", () => {
  expect(startRoute({ status: "loading", hasCredential: true })).toBe("wait");
  expect(startRoute({ status: "loading", hasCredential: false })).toBe("wait");
});

test("signed in opens the app, paired or not", () => {
  expect(startRoute({ status: "authed", hasCredential: false })).toBe("app");
  expect(startRoute({ status: "authed", hasCredential: true })).toBe("app");
});

test("signed out opens Direct when a computer is paired, sign-in otherwise", () => {
  expect(startRoute({ status: "anon", hasCredential: true })).toBe("direct");
  expect(startRoute({ status: "anon", hasCredential: false })).toBe("login");
});

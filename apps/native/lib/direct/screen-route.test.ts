import { expect, test } from "bun:test";

import { directScreenAvailable, screenRoute } from "@/lib/direct/screen-route";
import { FakeLink } from "@/lib/direct/test-support";

const connected = (screen: boolean) => {
  const link = new FakeLink();
  link.screen = screen;
  return { state: "connected", connection: link } as const;
};
const offline = { state: "offline", connection: null } as const;

test("Direct is used when the computer is connected and has the screen feature", () => {
  expect(directScreenAvailable(connected(true))).toBe(true);
  expect(screenRoute(connected(true), false)).toBe("/direct-screen");
  expect(screenRoute(connected(true), true)).toBe("/direct-screen");
});

test("without screen support or a connection the cloud screen is the owner's only road", () => {
  expect(directScreenAvailable(connected(false))).toBe(false);
  expect(screenRoute(connected(false), true)).toBe("/screen");
  expect(screenRoute(offline, true)).toBe("/screen");
  expect(screenRoute(offline, false)).toBeNull();
  expect(screenRoute(connected(false), false)).toBeNull();
});

test("a connection that is not connected does not count", () => {
  const link = new FakeLink();
  expect(directScreenAvailable({ state: "connecting", connection: link })).toBe(false);
  expect(directScreenAvailable({ state: "connected", connection: null })).toBe(false);
});

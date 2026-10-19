import { expect, test } from "bun:test";

import {
  MAX_RECONNECT_ATTEMPTS,
  reconnectDelay,
  SCREEN_CLOSE,
  shouldAutoReconnect,
} from "./screen-session";

test("the first retry is immediate and the backoff caps at 5 s", () => {
  expect(reconnectDelay(1)).toBe(0);
  expect(reconnectDelay(2)).toBeLessThan(reconnectDelay(3));
  expect(reconnectDelay(MAX_RECONNECT_ATTEMPTS)).toBe(5000);
});

test("drops are retried until the attempt budget runs out", () => {
  expect(shouldAutoReconnect(1011, 0)).toBe(true);
  expect(shouldAutoReconnect(SCREEN_CLOSE.timedOut, 5)).toBe(true);
  expect(shouldAutoReconnect(undefined, MAX_RECONNECT_ATTEMPTS - 1)).toBe(true);
  expect(shouldAutoReconnect(undefined, MAX_RECONNECT_ATTEMPTS)).toBe(false);
});

test("a session another viewer took over stays ended", () => {
  expect(shouldAutoReconnect(SCREEN_CLOSE.replaced, 0)).toBe(false);
  expect(shouldAutoReconnect(SCREEN_CLOSE.tooManyViewers, 0)).toBe(false);
});

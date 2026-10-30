import { expect, test } from "bun:test";

import { KEYSYM } from "@/lib/screen-keys";
import { replayInput, SENTINEL, tapKey, type ScreenKeys } from "@/lib/direct/screen-typing";

function recorder() {
  const log: string[] = [];
  const keys: ScreenKeys = {
    key: (keysym, down) => {
      log.push(`${down ? "v" : "^"}${keysym.toString(16)}`);
      return true;
    },
    type: (text) => {
      log.push(`type:${text}`);
      return true;
    },
  };
  return { keys, log };
}

test("a key row key is press and release", () => {
  const { keys, log } = recorder();
  tapKey(keys, KEYSYM.Escape);
  expect(log).toEqual(["vff1b", "^ff1b"]);
});

test("modifiers wrap the key and come off in reverse", () => {
  const { keys, log } = recorder();
  tapKey(keys, 0x63, { ctrl: true, shift: true });
  expect(log).toEqual(["vffe3", "vffe1", "v63", "^63", "^ffe1", "^ffe3"]);
});

test("typed characters go as one type call", () => {
  const { keys, log } = recorder();
  expect(replayInput(keys, `${SENTINEL}hello`, {})).toBe(false);
  expect(log).toEqual(["type:hello"]);
});

test("deleting from the sentinel is Backspace", () => {
  const { keys, log } = recorder();
  replayInput(keys, SENTINEL.slice(0, 1), {});
  expect(log).toEqual(["vff08", "^ff08"]);
});

test("with a modifier down each character is its own chord, and the modifier is used up", () => {
  const { keys, log } = recorder();
  expect(replayInput(keys, `${SENTINEL}ab`, { ctrl: true })).toBe(true);
  expect(log).toEqual(["vffe3", "v61", "^61", "^ffe3", "vffe3", "v62", "^62", "^ffe3"]);
});

test("characters with no keysym are dropped; nothing typed means nothing sent", () => {
  const { keys, log } = recorder();
  expect(replayInput(keys, `${SENTINEL}\u0001`, { ctrl: true })).toBe(false);
  expect(replayInput(keys, SENTINEL, {})).toBe(false);
  expect(log).toEqual([]);
});

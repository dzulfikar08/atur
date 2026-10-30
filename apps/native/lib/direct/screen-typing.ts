import { charToKeysym, diffInput, KEYSYM } from "@/lib/screen-keys";

// The soft keyboard and the key row of the direct screen, as `screenKey` / `screenType` calls.

export interface ScreenMods {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  super?: boolean;
}

/** The part of the screen handle typing needs. */
export interface ScreenKeys {
  key(keysym: number, down: boolean): boolean;
  type(text: string): boolean;
}

/** The soft keyboard's hidden input always holds this, so Backspace has something to delete. */
export const SENTINEL = "\u200b\u200b";

const MOD_KEYSYMS: [keyof ScreenMods, number][] = [
  ["ctrl", 0xffe3],
  ["alt", 0xffe9],
  ["shift", 0xffe1],
  ["super", 0xffeb],
];

export const anyMods = (mods: ScreenMods): boolean => Object.values(mods).some(Boolean);

/** One key press and release, wrapped in the modifiers that are down. */
export function tapKey(keys: ScreenKeys, keysym: number, mods: ScreenMods = {}): void {
  const down = MOD_KEYSYMS.filter(([name]) => mods[name]);
  for (const [, sym] of down) keys.key(sym, true);
  keys.key(keysym, true);
  keys.key(keysym, false);
  for (const [, sym] of [...down].reverse()) keys.key(sym, false);
}

/**
 * Replays what the hidden input did since it held the sentinel: deletions are Backspace, new
 * characters are typed (each wrapped in the modifiers, when any is down). Returns whether the
 * modifiers were used, so the caller can release them.
 */
export function replayInput(keys: ScreenKeys, next: string, mods: ScreenMods): boolean {
  const { deleted, inserted } = diffInput(SENTINEL, next);
  for (let i = 0; i < deleted; i++) tapKey(keys, KEYSYM.BackSpace);
  const chars = Array.from(inserted).filter((ch) => charToKeysym(ch) !== null);
  if (chars.length === 0) return false;
  if (anyMods(mods)) {
    for (const ch of chars) tapKey(keys, charToKeysym(ch) ?? 0, mods);
    return true;
  }
  keys.type(chars.join(""));
  return false;
}

/** Ctrl+V, after the computer's clipboard has the text. */
export const PASTE_KEYSYM = 0x76;

// charToKeysym/diffInput mirror apps/app/src/client/lib/screenKeys.ts (the web
// Screen page); keep the two in step, the native app cannot import from the
// web workspace. KEYSYM also carries the native extended key row's keys.

export const KEYSYM = {
  BackSpace: 0xff08,
  Tab: 0xff09,
  Return: 0xff0d,
  Escape: 0xff1b,
  Home: 0xff50,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
  Print: 0xff61,
  Insert: 0xff63,
  Delete: 0xffff,
  /** F1; F(n) is F1 + n - 1, up to F12. */
  F1: 0xffbe,
} as const;

/** Keysym for one typed character; null for characters with no keysym (control chars). */
export function charToKeysym(ch: string): number | null {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return null;
  if (ch === "\n" || ch === "\r") return KEYSYM.Return;
  if (ch === "\t") return KEYSYM.Tab;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return null;
  // Latin-1 keysyms equal their code points; everything else is Unicode-mapped.
  return cp < 0x100 ? cp : 0x01000000 + cp;
}

/**
 * What the soft keyboard's hidden input did between two values: how many
 * characters were deleted from the end and which were inserted. The input is
 * reset to a sentinel after every change, so `prev` is that sentinel.
 */
export function diffInput(prev: string, next: string): { deleted: number; inserted: string } {
  let common = 0;
  const max = Math.min(prev.length, next.length);
  while (common < max && prev[common] === next[common]) common++;
  return { deleted: prev.length - common, inserted: next.slice(common) };
}

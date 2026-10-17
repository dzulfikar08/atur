/** X11 keysyms used by the Screen page's typed-text, soft-keyboard and extra-key paths. */
export const KEYSYM = {
  BackSpace: 0xff08,
  Tab: 0xff09,
  Return: 0xff0d,
  Escape: 0xff1b,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  ShiftL: 0xffe1,
  ControlL: 0xffe3,
  AltL: 0xffe9,
  SuperL: 0xffeb,
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
 * What the soft keyboard's hidden textarea did between two values: how many
 * characters were deleted from the end and which were inserted. The textarea
 * is reset to a sentinel after every input event, so `prev` is that sentinel.
 */
export function diffInput(prev: string, next: string): { deleted: number; inserted: string } {
  let common = 0;
  const max = Math.min(prev.length, next.length);
  while (common < max && prev[common] === next[common]) common++;
  return { deleted: prev.length - common, inserted: next.slice(common) };
}

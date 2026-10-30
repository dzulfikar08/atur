// Strict semver, mirroring the client's version comparison (no leading zeros in
// release numbers, build metadata ignored) so "latest" means the same on both sides.

const NUMERIC = /^\d+$/;
const IDENTIFIER = /^[0-9A-Za-z-]+$/;

interface Parsed {
  release: [number, number, number];
  pre: string[] | null;
}

function identifiers(value: string, rejectLeadingZero: boolean): string[] | null {
  const parts = value.split(".");
  for (const part of parts) {
    if (!IDENTIFIER.test(part)) return null;
    if (rejectLeadingZero && NUMERIC.test(part) && part.length > 1 && part.startsWith("0")) {
      return null;
    }
  }
  return parts;
}

function parse(value: string): Parsed | null {
  let rest = value;
  const plus = rest.indexOf("+");
  if (plus >= 0) {
    if (!identifiers(rest.slice(plus + 1), false)) return null;
    rest = rest.slice(0, plus);
  }
  let pre: string[] | null = null;
  const dash = rest.indexOf("-");
  if (dash >= 0) {
    pre = identifiers(rest.slice(dash + 1), true);
    if (!pre) return null;
    rest = rest.slice(0, dash);
  }
  const parts = rest.split(".");
  if (parts.length !== 3) return null;
  const release: number[] = [];
  for (const part of parts) {
    if (!NUMERIC.test(part) || (part.length > 1 && part.startsWith("0"))) return null;
    const number = Number(part);
    if (!Number.isSafeInteger(number)) return null;
    release.push(number);
  }
  return { release: release as Parsed["release"], pre };
}

export function isSemver(value: string): boolean {
  return parse(value) !== null;
}

function comparePre(left: string[], right: string[]): number {
  for (let i = 0; ; i++) {
    const a = left[i];
    const b = right[i];
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumeric = NUMERIC.test(a);
    const bNumeric = NUMERIC.test(b);
    let order: number;
    if (aNumeric && bNumeric) order = a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
    else if (aNumeric) order = -1;
    else if (bNumeric) order = 1;
    else order = a < b ? -1 : a > b ? 1 : 0;
    if (order !== 0) return order;
  }
}

/** Orders two valid semver strings; throws on an invalid one. */
export function compareSemver(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) throw new Error(`invalid version: ${left ? b : a}`);
  for (let i = 0; i < 3; i++) {
    const order = (left.release[i] as number) - (right.release[i] as number);
    if (order !== 0) return order;
  }
  if (!left.pre && !right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return comparePre(left.pre, right.pre);
}

export function highest(versions: string[]): string | null {
  let best: string | null = null;
  for (const version of versions) {
    if (best === null || compareSemver(version, best) > 0) best = version;
  }
  return best;
}

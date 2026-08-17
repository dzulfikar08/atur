import type { Env } from "./env";

// Soft, per-window rate limiter backed by the RATE_LIMIT KV namespace.
// KV is eventually consistent, so limits are approximate — good enough to
// blunt spam from the public feedback endpoints. Returns true when allowed.
//
// Key layout: "<scope>:<windowStart>". We bucket by floor(now/window) so every
// request inside the same window shares one counter; the entry is written with
// a KV expiration so stale buckets self-clean.

export async function rateLimit(
  env: Env,
  key: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  const kv = env.RATE_LIMIT;
  if (!kv) return true; // KV not bound (e.g. some test envs) — fail open.

  const nowSeconds = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSeconds / windowSec);
  const kvKey = `${key}:${bucket}`;

  const raw = await kv.get(kvKey);
  const count = raw ? parseInt(raw, 10) : 0;

  if (count >= max) return false;

  // First hit in the bucket sets a TTL so the key disappears after the window.
  const ttl = count === 0 ? windowSec * 2 : undefined;
  await kv.put(kvKey, String(count + 1), ttl !== undefined ? { expirationTtl: ttl } : undefined);
  return true;
}

// Sign in with Apple (native) helpers. Pure WebCrypto — no env, no JWT lib.
// The app obtains an identity token from the OS sheet and posts it to
// POST /auth/apple/native; this file verifies it against Apple's published
// keys. The identity token is an RS256 JWT:
//   iss = https://appleid.apple.com, aud = the app's bundle id,
//   nonce = SHA-256 hex of the raw nonce the app generated (the app hands the
//   hash to Apple and the raw value to us, so a stolen token can't be replayed
//   by a party that doesn't hold the raw nonce).

export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_JWKS_URL = `${APPLE_ISSUER}/auth/keys`;
export const APPLE_TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
export const APPLE_REVOKE_URL = `${APPLE_ISSUER}/auth/revoke`;
// Bundle id of the Atur iOS app — the audience of its identity tokens.
export const DEFAULT_APPLE_AUDIENCE = "com.diatur.app";

const JWKS_TTL_MS = 60 * 60 * 1000;
// A token naming an unknown kid forces a refetch; cap how often so a flood of
// crafted kids can't turn into a flood of requests to Apple.
const JWKS_MISS_REFETCH_MS = 60 * 1000;
// Tolerated clock drift when checking iat (exp is checked strictly).
const IAT_SKEW_MS = 5 * 60 * 1000;

export type AppleAuthErrorCode = "invalid_token" | "invalid_nonce" | "jwks_unavailable";

export class AppleAuthError extends Error {
  constructor(
    public code: AppleAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppleAuthError";
  }
}

export type AppleIdentity = {
  /** Stable per-user, per-team Apple identifier. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  isPrivateEmail: boolean;
};

export type AppleJwk = JsonWebKey & { kid: string };

/** Source of Apple's signing keys; injectable so tests need no network. */
export type AppleJwks = { key(kid: string): Promise<AppleJwk | null> };

export async function fetchAppleKeys(): Promise<AppleJwk[]> {
  let res: Response;
  try {
    res = await fetch(APPLE_JWKS_URL);
  } catch (err) {
    throw new AppleAuthError("jwks_unavailable", `Apple JWKS fetch failed: ${String(err)}`);
  }
  if (!res.ok) throw new AppleAuthError("jwks_unavailable", `Apple JWKS ${res.status}`);
  const body = (await res.json().catch(() => null)) as { keys?: AppleJwk[] } | null;
  if (!body || !Array.isArray(body.keys)) {
    throw new AppleAuthError("jwks_unavailable", "Apple JWKS malformed");
  }
  return body.keys;
}

/** In-memory JWKS cache: 1h TTL, throttled refetch when a kid is unknown. */
export function createAppleJwks(
  fetchKeys: () => Promise<AppleJwk[]> = fetchAppleKeys,
  now: () => number = Date.now,
): AppleJwks {
  let keys: AppleJwk[] = [];
  let fetchedAt = 0;
  return {
    async key(kid) {
      const t = now();
      const stale = keys.length === 0 || t - fetchedAt > JWKS_TTL_MS;
      const found = keys.find((k) => k.kid === kid);
      if (found && !stale) return found;
      if (!stale && t - fetchedAt < JWKS_MISS_REFETCH_MS) return null;
      keys = await fetchKeys();
      fetchedAt = t;
      return keys.find((k) => k.kid === kid) ?? null;
    },
  };
}

export const appleJwks = createAppleJwks();

function fromBase64Url(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(segment: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(segment)));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  throw new AppleAuthError("invalid_token", "Malformed identity token");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyOptions = {
  /** Accepted `aud` value(s): the iOS bundle id. */
  audience: string | string[];
  /** The raw (un-hashed) nonce the app generated for this sign-in. */
  rawNonce: string;
  jwks?: AppleJwks;
  now?: () => number;
};

/**
 * Verifies an Apple identity token: RS256 signature against Apple's JWKS,
 * issuer, audience, expiry, and nonce. Throws AppleAuthError on any failure.
 */
export async function verifyAppleIdentityToken(
  token: string,
  { audience, rawNonce, jwks = appleJwks, now = Date.now }: VerifyOptions,
): Promise<AppleIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new AppleAuthError("invalid_token", "Malformed identity token");
  }
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJson(h);
  // Pin the algorithm: never let the token pick (alg=none / HS256 confusion).
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new AppleAuthError("invalid_token", "Unsupported token header");
  }

  const jwk = await jwks.key(header.kid);
  if (!jwk) throw new AppleAuthError("invalid_token", "Unknown signing key");

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromBase64Url(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new AppleAuthError("invalid_token", "Bad token signature");

  const claims = decodeJson(p);
  const nowMs = now();
  if (claims.iss !== APPLE_ISSUER) throw new AppleAuthError("invalid_token", "Wrong issuer");
  const accepted = Array.isArray(audience) ? audience : [audience];
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some((a) => typeof a === "string" && accepted.includes(a))) {
    throw new AppleAuthError("invalid_token", "Wrong audience");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs) {
    throw new AppleAuthError("invalid_token", "Token expired");
  }
  if (typeof claims.iat === "number" && claims.iat * 1000 > nowMs + IAT_SKEW_MS) {
    throw new AppleAuthError("invalid_token", "Token issued in the future");
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new AppleAuthError("invalid_token", "Token has no subject");
  }
  if (
    !rawNonce ||
    typeof claims.nonce !== "string" ||
    !safeEqual(claims.nonce, await sha256Hex(rawNonce))
  ) {
    throw new AppleAuthError("invalid_nonce", "Nonce mismatch");
  }

  return {
    sub: claims.sub,
    email: typeof claims.email === "string" && claims.email ? claims.email.toLowerCase() : null,
    // Apple sends booleans or the strings "true"/"false" depending on flow.
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    isPrivateEmail: claims.is_private_email === true || claims.is_private_email === "true",
  };
}

// ── Token revocation (account deletion) ──────────────────────────────────────
// Apple requires an app that offers Sign in with Apple to revoke the user's
// token when the account is deleted. That needs a client_secret JWT signed with
// a Sign in with Apple key (.p8) — optional config; without it revocation is
// skipped and the user can still remove the app from Settings > Apple ID.

export type AppleSiwaConfig = {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  /** Bundle id the authorization code / refresh token were issued to. */
  clientId: string;
};

export type AppleSiwaEnv = {
  APPLE_TEAM_ID?: string;
  APPLE_SIWA_KEY_ID?: string;
  APPLE_SIWA_PRIVATE_KEY?: string;
  APPLE_BUNDLE_ID?: string;
};

export function appleAudience(env: AppleSiwaEnv): string {
  return env.APPLE_BUNDLE_ID?.trim() || DEFAULT_APPLE_AUDIENCE;
}

/** null when the Sign in with Apple key is not configured. */
export function appleSiwaConfig(env: AppleSiwaEnv): AppleSiwaConfig | null {
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_SIWA_KEY_ID?.trim();
  const privateKeyPem = env.APPLE_SIWA_PRIVATE_KEY?.trim();
  if (!teamId || !keyId || !privateKeyPem) return null;
  return { teamId, keyId, privateKeyPem, clientId: appleAudience(env) };
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  // Secrets are sometimes stored with literal "\n" sequences.
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ES256 client_secret JWT for Apple's /auth/token and /auth/revoke. */
export async function buildAppleClientSecret(
  config: AppleSiwaConfig,
  nowMs: number = Date.now(),
): Promise<string> {
  const enc = new TextEncoder();
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: "ES256", kid: config.keyId, typ: "JWT" };
  const claims = {
    iss: config.teamId,
    iat,
    exp: iat + 300,
    aud: APPLE_ISSUER,
    sub: config.clientId,
  };
  const signingInput = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(
    enc.encode(JSON.stringify(claims)),
  )}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(config.privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto ECDSA emits raw r||s, which is what JWS ES256 expects.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput)),
  );
  return `${signingInput}.${b64url(signature)}`;
}

function postForm(url: string, params: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

/**
 * Redeems the one-shot authorization code the app got alongside the identity
 * token and returns the long-lived refresh token (stored so the grant can be
 * revoked when the account is deleted). Throws on any failure.
 */
export async function exchangeAppleAuthorizationCode(
  config: AppleSiwaConfig,
  code: string,
): Promise<string> {
  const res = await postForm(APPLE_TOKEN_URL, {
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: await buildAppleClientSecret(config),
  });
  if (!res.ok) throw new Error(`apple token exchange failed: ${res.status}`);
  const tokens = (await res.json()) as { refresh_token?: string };
  if (!tokens.refresh_token) throw new Error("apple token exchange returned no refresh token");
  return tokens.refresh_token;
}

/** Revokes a refresh token so Atur disappears from the user's Apple ID list. */
export async function revokeAppleRefreshToken(
  config: AppleSiwaConfig,
  refreshToken: string,
): Promise<void> {
  const res = await postForm(APPLE_REVOKE_URL, {
    client_id: config.clientId,
    client_secret: await buildAppleClientSecret(config),
    token: refreshToken,
    token_type_hint: "refresh_token",
  });
  if (!res.ok) throw new Error(`apple revoke failed: ${res.status}`);
}

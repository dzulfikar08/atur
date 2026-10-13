import type { DbClient } from "../db/index";
import {
  GoogleAuthError,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  OAUTH_STATE_TTL_SECONDS,
} from "../lib/oauth";
import { generateToken } from "../lib/token";
import * as usersRepo from "../repositories/users";
import * as accountsRepo from "../repositories/accounts";
import { usernameFromEmail, rotateSession } from "./auth";
import { sessionExpiryISO } from "../lib/session";

const PROVIDER = "google";

// What Google's userinfo endpoint tells us about the person signing in.
export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

// Profile + the credentials from the token exchange, as consumed by the
// account-resolution step (the tokens are stored on the accounts row).
export type GoogleSignInProfile = GoogleProfile & {
  accessToken: string;
  idToken: string | null;
};

export type GoogleAuthResult = {
  user: { id: string; email: string; username: string };
  token: string;
};

// ── OAuth state (KV, single-use) ─────────────────────────────────────────────
// Key naming follows services/auth.ts `auth:otp:<email>`. The state carries the
// PKCE verifier so the two are bound without exposing either to the browser.

export const oauthStateKey = (state: string) => `auth:oauth:google:${state}`;

// Single-use native-app exchange code, stored in the same KV (RATE_LIMIT) under
// a distinct prefix. Short TTL: the app exchanges it seconds after the
// callback redirect.
export const NATIVE_CODE_TTL_SECONDS = 120;

export type OAuthState = { verifier: string; nativeChallenge: string | null };

export async function saveState(
  kv: KVNamespace,
  state: string,
  verifier: string,
  nativeChallenge: string | null = null,
): Promise<void> {
  await kv.put(oauthStateKey(state), JSON.stringify({ verifier, nativeChallenge }), {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });
}

// Single-use: delete BEFORE the caller trusts the value, so a replayed callback
// (double-tap, refresh) can't ride the same state twice — same discipline as
// verifyLoginOtp. NB: KV get-then-delete is not atomic and KV is eventually
// consistent across colos, so a near-simultaneous replay inside the
// propagation window can still validate; the route's state-cookie binding and
// the 600s TTL bound the blast radius to an extra session, never a mutation.
export async function consumeState(kv: KVNamespace, state: string): Promise<OAuthState | null> {
  const key = oauthStateKey(state);
  const raw = await kv.get(key);
  if (!raw) return null;
  await kv.delete(key);
  try {
    const parsed = JSON.parse(raw) as { verifier?: string; nativeChallenge?: string | null };
    if (typeof parsed.verifier !== "string") return null;
    return { verifier: parsed.verifier, nativeChallenge: parsed.nativeChallenge ?? null };
  } catch {
    return null;
  }
}

// ── Native one-time exchange codes (KV, single-use) ──────────────────────────
// The native callback must not set a session cookie (the OS browser holding it
// is not the app), so it mints a one-time code and 302s to atur://auth/callback;
// the app then swaps code + its PKCE verifier for the session token.

export const nativeCodeKey = (code: string) => `auth:native:google:${code}`;

export async function saveNativeCode(
  kv: KVNamespace,
  code: string,
  value: { token: string; challenge: string },
): Promise<void> {
  await kv.put(nativeCodeKey(code), JSON.stringify(value), {
    expirationTtl: NATIVE_CODE_TTL_SECONDS,
  });
}

// Single-use, same delete-before-trust discipline as consumeState.
export async function consumeNativeCode(
  kv: KVNamespace,
  code: string,
): Promise<{ token: string; challenge: string } | null> {
  const key = nativeCodeKey(code);
  const raw = await kv.get(key);
  if (!raw) return null;
  await kv.delete(key);
  try {
    const parsed = JSON.parse(raw) as { token?: string; challenge?: string };
    if (typeof parsed.token !== "string" || typeof parsed.challenge !== "string") return null;
    return { token: parsed.token, challenge: parsed.challenge };
  } catch {
    return null;
  }
}

// ── Google network half ──────────────────────────────────────────────────────

export async function exchangeCode(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<{ accessToken: string; idToken: string | null }> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Without this Google may reply urlencoded instead of JSON.
      Accept: "application/json",
    },
    body: new URLSearchParams({
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      grant_type: "authorization_code",
      code_verifier: args.verifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GoogleAuthError(
      "token_exchange_failed",
      `Google token endpoint ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  // Parse either shape — JSON when the server honors Accept, urlencoded when
  // it doesn't.
  const text = await res.text();
  let data: { access_token?: string; id_token?: string };
  try {
    data = JSON.parse(text) as { access_token?: string; id_token?: string };
  } catch {
    data = Object.fromEntries(new URLSearchParams(text));
  }
  if (!data.access_token) {
    throw new GoogleAuthError(
      "token_exchange_failed",
      "Google token response missing access_token",
    );
  }
  return { accessToken: data.access_token, idToken: data.id_token ?? null };
}

// Identity comes from the userinfo endpoint over TLS — no JWT verification
// needed (the repo has no JWT lib, and id_token is stored only for debugging).
export async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GoogleAuthError(
      "userinfo_failed",
      `Google userinfo ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!data.sub || !data.email) {
    throw new GoogleAuthError("userinfo_failed", "Google profile missing sub/email");
  }
  return {
    sub: data.sub,
    email: data.email.toLowerCase(),
    emailVerified: data.email_verified === true,
    name: data.name ?? null,
    picture: data.picture ?? null,
  };
}

// ── Account resolution + session mint ────────────────────────────────────────
// Ladder: existing link → link-by-verified-email → brand-new user. The email
// link is what "syncs" a current account: same user id, so every workspace,
// issue and API key stays attached.

export async function signInWithGoogle(
  db: DbClient,
  rawProfile: GoogleSignInProfile,
): Promise<GoogleAuthResult> {
  // Normalize once at the boundary so lookups, the created row and the stored
  // metadata all agree on casing (fetchProfile already lowercases; this also
  // covers any other caller).
  const profile: GoogleSignInProfile = {
    ...rawProfile,
    email: rawProfile.email.toLowerCase(),
  };
  const linked = await accountsRepo.findByProvider(db, PROVIDER, profile.sub);

  if (linked) {
    const user = await usersRepo.findById(db, linked.userId);
    if (!user || !user.isActive || user.deletedAt) {
      throw new GoogleAuthError("account_disabled", "Account is not active");
    }
    // Best-effort refresh of the stored token/metadata; never blocks sign-in.
    await accountsRepo
      .updateTokens(db, linked.id, {
        accessToken: profile.accessToken,
        idToken: profile.idToken,
        metadata: metadataJson(profile),
      })
      .catch(() => {});
    return mintSession(db, user.id, user.email, user.username);
  }

  if (!profile.emailVerified) {
    throw new GoogleAuthError("email_unverified", "Google email is not verified");
  }

  const existing = await usersRepo.findByEmailCaseInsensitive(db, profile.email);
  if (existing) {
    if (!existing.isActive || existing.deletedAt) {
      throw new GoogleAuthError("account_disabled", "Account is not active");
    }
    // Link the Google identity to the existing (password or OTP) account.
    // Keep the account's stored email spelling — never rewrite it here.
    await accountsRepo.create(db, {
      provider: PROVIDER,
      providerAccountId: profile.sub,
      userId: existing.id,
      accessToken: profile.accessToken,
      idToken: profile.idToken,
      metadata: metadataJson(profile),
    });
    return mintSession(db, existing.id, existing.email, existing.username);
  }

  // Brand-new user: passwordless, email pre-verified by Google.
  const username = await usernameFromEmail(db, profile.email);
  const token = generateToken();
  const created = await usersRepo.createUser(db, {
    email: profile.email,
    username,
    passwordHash: null,
    token,
    sessionExpiresAt: sessionExpiryISO(),
    displayName: profile.name,
    avatar: profile.picture,
    isEmailVerified: 1,
  });
  if (!created) throw new GoogleAuthError("oauth_failed", "Failed to create user");
  await accountsRepo.create(db, {
    provider: PROVIDER,
    providerAccountId: profile.sub,
    userId: created.id,
    accessToken: profile.accessToken,
    idToken: profile.idToken,
    metadata: metadataJson(profile),
  });
  return {
    user: { id: created.id, email: created.email, username: created.username },
    token,
  };
}

// Every successful path funnels here for existing users: fresh opaque token +
// 24h sliding window — the shared rotateSession invariant, same as login/OTP.
// isEmailVerified is stamped 1 — Google already verified the address.
async function mintSession(
  db: DbClient,
  userId: string,
  email: string,
  username: string,
): Promise<GoogleAuthResult> {
  const token = await rotateSession(db, userId, { isEmailVerified: 1 });
  return { user: { id: userId, email, username }, token };
}

const metadataJson = (p: GoogleProfile) =>
  JSON.stringify({ email: p.email, name: p.name, picture: p.picture });

import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware, extractToken } from "../middleware/auth";
import * as authService from "../services/auth";
import * as billingService from "../services/billing";
import * as usersRepo from "../repositories/users";
import * as sessionsRepo from "../repositories/sessions";
import * as appleAuthService from "../services/appleAuth";
import {
  AppleAuthError,
  appleAudience,
  appleSiwaConfig,
  exchangeAppleAuthorizationCode,
  verifyAppleIdentityToken,
} from "../lib/appleAuth";
import { SESSION_TTL_SECONDS } from "../lib/session";
import { z } from "zod";
import {
  GoogleAuthError,
  GOOGLE_ERROR_MESSAGES,
  OAUTH_STATE_TTL_SECONDS,
  googleAuthorizeUrl,
  pkcePair,
  randomToken,
  sha256Base64Url,
  type GoogleErrorCode,
} from "../lib/oauth";
import * as googleAuth from "../services/googleAuth";

const SESSION_COOKIE = "plane-session";
const SESSION_MAX_AGE = SESSION_TTL_SECONDS;

type C = Context<{ Bindings: Env }>;

function userAgentOf(c: C): string | null {
  return c.req.header("User-Agent") ?? null;
}

// Browsers reject Secure cookies over plain HTTP, which would silently drop the
// session on local dev (http://localhost). Only mark Secure when really on HTTPS.
// Single source of truth for the request scheme — cookies and the OAuth
// redirect_uri must never disagree about it.
function requestProto(c: C): string {
  // Some proxies hand the worker an http:// url; trust the forwarded proto —
  // but only when it's a clean single value, never a chained/malformed one
  // (Google rejects a redirect_uri that doesn't match the registration).
  const fwd = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  if (fwd === "http" || fwd === "https") return fwd;
  return new URL(c.req.url).protocol.replace(":", "");
}

function isHttps(c: C): boolean {
  return requestProto(c) === "https";
}

function setSessionCookie(c: C, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

function clearSessionCookie(c: C) {
  setCookie(c, SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Strict",
    path: "/",
    maxAge: 0,
  });
}

// ── Google OAuth ─────────────────────────────────────────────────────────────
// The SPA route that finishes the flow (App.tsx /auth/callback/:provider).
const GOOGLE_SPA_CALLBACK = "/auth/callback/google";
// Carries the OAuth state back to the callback so the code/state pair is bound
// to the browser that started the flow (login-CSRF defense). SameSite=Lax on
// purpose: Strict cookies are NOT sent on the cross-site redirect back from
// Google, while Lax ones are (top-level GET navigation).
const OAUTH_STATE_COOKIE = "plane-oauth-state";

// ── Native app flow (atur:// scheme) ─────────────────────────────────────────
// Hard-coded target: the app opens /auth/google?native_challenge=... in a
// Custom Tab (expo-web-browser) and the callback 302s here. Never derived from
// request input — no open-redirect surface.
const NATIVE_CALLBACK = "atur://auth/callback";
// A native_challenge is base64url(sha256(verifier)): exactly 43 unpadded
// base64url chars, same shape pkcePair() produces for S256.
const NATIVE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const nativeExchangeSchema = z.object({
  code: z.string().min(1),
  verifier: z.string().min(1),
});

// Native failures are also navigations — back to the app via its custom scheme,
// same codes/copy as the web SPA callback.
function redirectNativeError(c: C, code: GoogleErrorCode): Response {
  const q = new URLSearchParams({
    error: code,
    error_description: GOOGLE_ERROR_MESSAGES[code],
  });
  return c.redirect(`${NATIVE_CALLBACK}?${q.toString()}`, 302);
}

// redirect_uri must be byte-identical between the authorize request and the
// token exchange, and pre-registered in the Google OAuth client (prod host +
// http://localhost:5173 for dev). Built in one place for exactly that reason.
function originOf(c: C): string {
  return `${requestProto(c)}://${new URL(c.req.url).host}`;
}

function googleRedirectUri(c: C): string {
  return `${originOf(c)}/auth/google/callback`;
}

// OAuth failures are navigations, not JSON: bounce to the SPA callback page,
// which toasts error_description (OAuthCallbackPage.tsx). Internal details
// stay in the server log only — never in the redirect URL.
function redirectGoogleError(c: C, code: GoogleErrorCode): Response {
  const q = new URLSearchParams({
    error: code,
    error_description: GOOGLE_ERROR_MESSAGES[code],
  });
  return c.redirect(`${GOOGLE_SPA_CALLBACK}?${q.toString()}`, 302);
}

export const authRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .post("/register", async (c) => {
    const db = getDb(c.env.DB);
    const body = authService.registerSchema.parse(await c.req.json());
    const result = await authService.register(db, body, userAgentOf(c));
    setSessionCookie(c, result.token);
    return c.json({ session_token: result.token, user: result.user });
  })
  .post("/sign-in", async (c) => {
    const db = getDb(c.env.DB);
    const body = authService.loginSchema.parse(await c.req.json());
    const result = await authService.login(db, body, userAgentOf(c));
    setSessionCookie(c, result.token);
    return c.json({ session_token: result.token, user: result.user });
  })
  .post("/sign-out", async (c) => {
    const db = getDb(c.env.DB);
    // Native clients hold no cookie — accept Authorization: Bearer /
    // X-API-Key too (extractToken falls back to the cookie).
    const token = extractToken(c);
    // API keys (pk_live_*) live in api_keys, not user_sessions — never present
    // them to the session paths. Sign-out ends THIS device's session only; a
    // token that isn't a session row is a legacy users.token and is cleared the
    // old way.
    if (token && !token.startsWith("pk_live_")) {
      const removed = await sessionsRepo.deleteByToken(db, token);
      if (!removed) await usersRepo.clearToken(db, token);
    }
    clearSessionCookie(c);
    return c.json({ message: "Signed out" });
  })
  .post("/forgot-password", async (c) => {
    return c.json({ message: "If the email exists, a reset link will be sent" });
  })
  .post("/reset-password", async (c) => {
    return c.json({ message: "Not implemented" }, 501);
  })
  .post("/magic-link", async (c) => {
    return c.json({ message: "Not implemented" }, 501);
  })
  .post("/otp/request", async (c) => {
    const kv = c.env.RATE_LIMIT;
    if (!kv) throw new HTTPException(500, { message: "KV namespace not configured" });
    const db = getDb(c.env.DB);
    const body = authService.requestOtpSchema.parse(await c.req.json());
    const result = await authService.requestLoginOtp(db, kv, c.env, body);
    return c.json(result);
  })
  .post("/otp/verify", async (c) => {
    const kv = c.env.RATE_LIMIT;
    if (!kv) throw new HTTPException(500, { message: "KV namespace not configured" });
    const db = getDb(c.env.DB);
    const body = authService.verifyOtpSchema.parse(await c.req.json());
    const result = await authService.verifyLoginOtp(db, kv, body, userAgentOf(c));
    setSessionCookie(c, result.token);
    return c.json({ session_token: result.token, user: result.user });
  })
  .get("/get-csrf-token", (c) => {
    return c.json({ csrf_token: "stub" });
  })
  .get("/me", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const profile = await authService.getProfile(db, user.sub);
    const me = await usersRepo.findById(db, user.sub);
    const billing = await billingService.billingFor(db, c.env, {
      id: profile.id,
      email: profile.email,
      isSuperuser: me?.isSuperuser,
    });
    return c.json({ ...profile, billing });
  })
  .get("/github", (c) => c.json({ url: "" }))
  .get("/github/callback", (c) => c.json({ error: "Not implemented" }, 501))
  // Start the Google flow: issue state + PKCE verifier into KV, bind the state
  // to this browser via cookie, 302 to accounts.google.com. This is a browser
  // navigation (routed to the worker by the isOAuthNav check in index.ts), so
  // failures must redirect — never a JSON error page or a thrown 500.
  .get("/google", async (c) => {
    const kv = c.env.RATE_LIMIT;
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;
    // Native intent is signaled by the presence of native_challenge; a present
    // but malformed one must bounce back to the app, not to the web SPA.
    const nativeChallengeParam = c.req.query("native_challenge");
    const isNative = nativeChallengeParam != null;
    const nativeChallenge =
      isNative && NATIVE_CHALLENGE_RE.test(nativeChallengeParam) ? nativeChallengeParam : null;
    const fail = (code: GoogleErrorCode) =>
      isNative ? redirectNativeError(c, code) : redirectGoogleError(c, code);
    if (!kv || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return fail("oauth_disabled");
    }
    if (isNative && !nativeChallenge) {
      return fail("oauth_failed");
    }
    try {
      const state = randomToken(32);
      const { verifier, challenge } = await pkcePair();
      await googleAuth.saveState(kv, state, verifier, nativeChallenge);
      setCookie(c, OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: isHttps(c),
        sameSite: "Lax",
        path: "/",
        maxAge: OAUTH_STATE_TTL_SECONDS,
      });
      return c.redirect(
        googleAuthorizeUrl({
          clientId: GOOGLE_CLIENT_ID,
          redirectUri: googleRedirectUri(c),
          state,
          challenge,
        }),
        302,
      );
    } catch (err) {
      console.error("google oauth start failed:", err);
      return fail("oauth_failed");
    }
  })
  .get("/google/callback", async (c) => {
    const db = getDb(c.env.DB);
    const kv = c.env.RATE_LIMIT;
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;
    if (!kv || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return redirectGoogleError(c, "oauth_disabled");
    }

    // Native intent is only knowable once the state is consumed (the stored
    // nativeChallenge); until then failures fall back to the web redirect.
    let nativeFail: ((code: GoogleErrorCode) => Response) | null = null;
    try {
      // Google can bounce back with its own error (user cancelled consent, etc.).
      const providerError = c.req.query("error");
      if (providerError) {
        if (providerError === "access_denied") return redirectGoogleError(c, "oauth_cancelled");
        console.error("google oauth provider error:", providerError);
        return redirectGoogleError(c, "oauth_failed");
      }
      const code = c.req.query("code");
      const state = c.req.query("state");
      // Login-CSRF guard: the state must be the one issued to THIS browser
      // (cookie set on /auth/google). Without this, a crafted callback URL
      // with an attacker's code+state would sign the victim in as the
      // attacker. Compare then clear — the state is single-use.
      const boundState = getCookie(c, OAUTH_STATE_COOKIE);
      if (!code || !state || boundState !== state) {
        return redirectGoogleError(c, "state_invalid");
      }
      deleteCookie(c, OAUTH_STATE_COOKIE);

      // Consume first (single-use) so a replayed callback can't reuse the
      // state. Note: KV get-then-delete is not atomic across colos, so a
      // near-simultaneous replay within the consistency window can slip
      // through — bounded to at most one extra session (no account mutation).
      const verifierState = await googleAuth.consumeState(kv, state);
      if (!verifierState) return redirectGoogleError(c, "state_invalid");
      const { verifier, nativeChallenge } = verifierState;
      if (nativeChallenge != null) {
        nativeFail = (code) => redirectNativeError(c, code);
      }
      const isNative = nativeChallenge != null;

      const tokens = await googleAuth.exchangeCode({
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        code,
        redirectUri: googleRedirectUri(c),
        verifier,
      });
      const profile = await googleAuth.fetchProfile(tokens.accessToken);
      const result = await googleAuth.signInWithGoogle(
        db,
        {
          ...profile,
          accessToken: tokens.accessToken,
          idToken: tokens.idToken,
        },
        userAgentOf(c),
      );
      if (!isNative) {
        setSessionCookie(c, result.token);
        // Same-origin hop: the browser carries the fresh cookie to the SPA page,
        // which fetches the user and continues to the original destination.
        return c.redirect(GOOGLE_SPA_CALLBACK, 302);
      }
      // Native: the Custom Tab would own the cookie, not the app — mint a
      // one-time code bound to the app's challenge instead. The app swaps
      // code + verifier at POST /auth/native/exchange.
      const nativeCode = randomToken(32);
      await googleAuth.saveNativeCode(kv, nativeCode, {
        token: result.token,
        challenge: nativeChallenge,
      });
      const q = new URLSearchParams({ code: nativeCode });
      return c.redirect(`${NATIVE_CALLBACK}?${q.toString()}`, 302);
    } catch (err) {
      console.error("google oauth failed:", err);
      const code: GoogleErrorCode = err instanceof GoogleAuthError ? err.code : "oauth_failed";
      return nativeFail ? nativeFail(code) : redirectGoogleError(c, code);
    }
  })
  // Native app code-for-token swap (expo-web-browser flow). JSON, not a
  // navigation — the app calls it directly with the one-time code from the
  // atur:// redirect plus its own PKCE verifier. No cookie is set.
  .post("/native/exchange", async (c) => {
    const kv = c.env.RATE_LIMIT;
    if (!kv) throw new HTTPException(500, { message: "KV namespace not configured" });
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request", message: "Body must be JSON" }, 400);
    }
    const parsed = nativeExchangeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: "code and verifier are required" }, 400);
    }
    const stored = await googleAuth.consumeNativeCode(kv, parsed.data.code);
    if (!stored) {
      return c.json({ error: "invalid_code", message: "Unknown or expired code" }, 400);
    }
    const challenge = await sha256Base64Url(parsed.data.verifier);
    if (challenge !== stored.challenge) {
      return c.json({ error: "verifier_mismatch", message: "PKCE verifier does not match" }, 400);
    }
    // Same user shape as /auth/sign-in — resolve the freshly minted session
    // token back to its owner (per-device session, legacy users.token fallback).
    const exchangeDb = getDb(c.env.DB);
    const user =
      (await sessionsRepo.findByToken(exchangeDb, stored.token)) ??
      (await usersRepo.findByToken(exchangeDb, stored.token));
    if (!user) {
      return c.json({ error: "invalid_code", message: "Session no longer valid" }, 400);
    }
    return c.json({
      session_token: stored.token,
      user: { id: user.id, email: user.email, username: user.username },
    });
  })
  // Native Sign in with Apple. JSON, no cookie, no browser hop: the iOS app gets
  // an identity token from the OS sheet and posts it with the raw nonce it
  // hashed into the request. Same { session_token, user } shape as /sign-in.
  .post("/apple/native", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request", message: "Body must be JSON" }, 400);
    }
    const parsed = appleAuthService.appleNativeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", message: "identity_token and nonce are required" },
        400,
      );
    }
    let identity;
    try {
      identity = await verifyAppleIdentityToken(parsed.data.identity_token, {
        audience: appleAudience(c.env),
        rawNonce: parsed.data.nonce,
      });
    } catch (err) {
      if (!(err instanceof AppleAuthError)) throw err;
      console.error("apple sign-in rejected:", err.code, err.message);
      if (err.code === "jwks_unavailable") {
        return c.json(
          { error: "apple_unavailable", message: "Could not reach Apple. Try again." },
          502,
        );
      }
      return c.json({ error: err.code, message: "Apple sign-in failed. Please try again." }, 401);
    }

    // Best-effort: keep the Apple grant so it can be revoked on account
    // deletion. A failed exchange never blocks sign-in.
    let refreshToken: string | null = null;
    const siwa = appleSiwaConfig(c.env);
    if (siwa && parsed.data.authorization_code) {
      try {
        refreshToken = await exchangeAppleAuthorizationCode(siwa, parsed.data.authorization_code);
      } catch (err) {
        console.error("apple authorization code exchange failed:", err);
      }
    }

    const result = await appleAuthService.signInWithApple(getDb(c.env.DB), identity, {
      fullName: parsed.data.full_name,
      refreshToken,
      userAgent: userAgentOf(c),
    });
    return c.json({ session_token: result.token, user: result.user });
  })
  .get("/gitlab", (c) => c.json({ url: "" }))
  .get("/gitlab/callback", (c) => c.json({ error: "Not implemented" }, 501))
  .post("/login", async (c) => {
    const db = getDb(c.env.DB);
    const body = authService.loginSchema.parse(await c.req.json());
    const result = await authService.login(db, body, userAgentOf(c));
    setSessionCookie(c, result.token);
    return c.json(result);
  });

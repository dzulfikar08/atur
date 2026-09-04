import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import * as authService from "../services/auth";
import * as usersRepo from "../repositories/users";
import { SESSION_TTL_SECONDS } from "../lib/session";
import {
  GoogleAuthError,
  GOOGLE_ERROR_MESSAGES,
  OAUTH_STATE_TTL_SECONDS,
  googleAuthorizeUrl,
  pkcePair,
  randomToken,
  type GoogleErrorCode,
} from "../lib/oauth";
import * as googleAuth from "../services/googleAuth";

const SESSION_COOKIE = "plane-session";
const SESSION_MAX_AGE = SESSION_TTL_SECONDS;

type C = Context<{ Bindings: Env }>;

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
    const result = await authService.register(db, body);
    setSessionCookie(c, result.token);
    return c.json({ session_token: result.token, user: result.user });
  })
  .post("/sign-in", async (c) => {
    const db = getDb(c.env.DB);
    const body = authService.loginSchema.parse(await c.req.json());
    const result = await authService.login(db, body);
    setSessionCookie(c, result.token);
    return c.json({ session_token: result.token, user: result.user });
  })
  .post("/sign-out", async (c) => {
    const db = getDb(c.env.DB);
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      await usersRepo.clearToken(db, token);
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
    const result = await authService.verifyLoginOtp(db, kv, body);
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
    return c.json(profile);
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
    if (!kv || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return redirectGoogleError(c, "oauth_disabled");
    }
    try {
      const state = randomToken(32);
      const { verifier, challenge } = await pkcePair();
      await googleAuth.saveState(kv, state, verifier);
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
      return redirectGoogleError(c, "oauth_failed");
    }
  })
  .get("/google/callback", async (c) => {
    const db = getDb(c.env.DB);
    const kv = c.env.RATE_LIMIT;
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;
    if (!kv || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return redirectGoogleError(c, "oauth_disabled");
    }

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
      const verifier = await googleAuth.consumeState(kv, state);
      if (!verifier) return redirectGoogleError(c, "state_invalid");

      const tokens = await googleAuth.exchangeCode({
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        code,
        redirectUri: googleRedirectUri(c),
        verifier,
      });
      const profile = await googleAuth.fetchProfile(tokens.accessToken);
      const result = await googleAuth.signInWithGoogle(db, {
        ...profile,
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
      });
      setSessionCookie(c, result.token);
      // Same-origin hop: the browser carries the fresh cookie to the SPA page,
      // which fetches the user and continues to the original destination.
      return c.redirect(GOOGLE_SPA_CALLBACK, 302);
    } catch (err) {
      console.error("google oauth failed:", err);
      return redirectGoogleError(c, err instanceof GoogleAuthError ? err.code : "oauth_failed");
    }
  })
  .get("/gitlab", (c) => c.json({ url: "" }))
  .get("/gitlab/callback", (c) => c.json({ error: "Not implemented" }, 501))
  .post("/login", async (c) => {
    const db = getDb(c.env.DB);
    const body = authService.loginSchema.parse(await c.req.json());
    const result = await authService.login(db, body);
    setSessionCookie(c, result.token);
    return c.json(result);
  });

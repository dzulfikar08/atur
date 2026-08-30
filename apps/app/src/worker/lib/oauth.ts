// OAuth (Google) authorization-code + PKCE helpers. Pure: no env, no fetch —
// the network half lives in services/googleAuth.ts so this file stays trivially
// unit-testable outside the Workers runtime.

export const OAUTH_STATE_TTL_SECONDS = 600; // same bound as the OTP code TTL

// GET paths that are browser navigations but must reach the worker (see the
// isOAuthNav check in index.ts). Kept next to the OAuth constants so adding a
// provider doesn't require remembering a second file.
export const OAUTH_NAV_PATHS = ["/auth/google", "/auth/google/callback"];

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

// Stable machine-readable codes the SPA can branch on. Human text travels in
// the error_description query param.
export type GoogleErrorCode =
  | "oauth_disabled"
  | "state_invalid"
  | "token_exchange_failed"
  | "userinfo_failed"
  | "email_unverified"
  | "account_disabled"
  | "oauth_cancelled"
  | "oauth_failed";

export class GoogleAuthError extends Error {
  constructor(
    public code: GoogleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

// Default copy for the SPA toast; OAuthCallbackPage shows error_description ?? fallback.
export const GOOGLE_ERROR_MESSAGES: Record<GoogleErrorCode, string> = {
  oauth_disabled: "Google sign-in is not configured yet",
  state_invalid: "Sign-in session expired. Please try again",
  token_exchange_failed: "Could not complete Google sign-in. Please try again",
  userinfo_failed: "Could not read your Google profile. Please try again",
  email_unverified: "Your Google email is not verified. Verify it with Google and retry",
  account_disabled: "This account is not active",
  oauth_cancelled: "Google sign-in was cancelled",
  oauth_failed: "Google sign-in failed. Please try again",
};

// base64url, unpadded — unlike generateToken() (standard base64) this is valid
// as an RFC 7636 code_verifier and safe to embed in URLs without escaping.
export function toBase64Url(raw: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < raw.length; i++) bin += String.fromCharCode(raw[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toBase64Url(new Uint8Array(digest));
}

// S256 PKCE pair: 43+ char verifier, challenge = base64url(sha256(verifier)).
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48);
  return { verifier, challenge: await sha256Base64Url(verifier) };
}

export function googleAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const q = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    // Online access only — we never call Google APIs on the user's behalf, so
    // no refresh token is issued and none is stored.
    access_type: "online",
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${q.toString()}`;
}

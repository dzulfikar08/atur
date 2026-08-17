// Session lifetime constants + helpers for users.token (main-app sessions).
// The session is a SLIDING window: any authenticated request that lands in the
// back half of the TTL extends the session back to a full SESSION_TTL_SECONDS.
// authMiddleware performs the check + extension; auth flows (login/register/
// OTP) stamp a fresh expiry via sessionExpiryISO().

export const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24h

// Extension happens when less than half the TTL remains, keeping the effective
// lifetime at 24h of activity (a purely idle session dies 24h after last
// refresh). 12h matches the cookie Max-Age so the browser cookie and the DB
// expiry never disagree about when the session ends.
export const SESSION_REFRESH_THRESHOLD_SECONDS = SESSION_TTL_SECONDS / 2;

export function sessionExpiryISO(): string {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
}

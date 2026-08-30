export type Env = {
  DB: D1Database;
  R2: R2Bucket;
  ASSETS: Fetcher;
  RATE_LIMIT?: KVNamespace;
  // Cloudflare Email (send_email binding) delivers portal OTP. Absent in local
  // dev → the code is logged + returned in the response instead of being sent.
  SEND_EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  // Google OAuth ("Continue with Google"). Set via `wrangler secret put` in
  // prod and .dev.vars locally. Absent → /auth/google redirects the browser
  // back with error=oauth_disabled instead of starting the flow.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

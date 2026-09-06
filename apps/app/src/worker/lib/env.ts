export type Env = {
  DB: D1Database;
  R2: R2Bucket;
  // Daily D1 → R2 backups (services/backup.ts). Bucket: atur-backups.
  BACKUPS: R2Bucket;
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
  // Herdr execution-plane bridge (ATUR-2): the local dev daemon on the dev box
  // (127.0.0.1:7601) or a https:// tunnel hostname in prod. Set via
  // `wrangler secret put` in prod and .dev.vars locally. Absent → /api/panes
  // and /api/panes/attach respond 502 (execution plane unreachable).
  HERDR_BRIDGE_URL?: string;
  // Optional shared secret; when set, proxied requests carry the
  // x-bridge-token header the bridge validates. Never in wrangler vars.
  HERDR_BRIDGE_TOKEN?: string;
};

/**
 * Dev-only convenience: auto-login the seeded local dev user.
 *
 * Local dev D1 carries a dev user (dev@atur.local) whose session token is
 * "dev-token-00000000000000000000000000". Seeding that token as the session
 * cookie lets `bun run dev` open straight into the app instead of bouncing
 * logged-out visitors to https://diatur.com.
 *
 * If your local DB doesn't have the user yet, create it once:
 *
 *   bunx wrangler d1 execute atur-db --local --command \
 *     "INSERT OR IGNORE INTO users (id, email, token, created_at, updated_at)
 *      VALUES ('00000000-0000-4000-8000-000000000001', 'dev@atur.local',
 *              'dev-token-00000000000000000000000000',
 *              datetime('now'), datetime('now'));"
 *
 * No-op in production builds (import.meta.env.DEV is statically false there,
 * so bundlers tree-shake the effect away). If the token is invalid the auth
 * check still fails normally and you land on /auth/login.
 */
const DEV_TOKEN = "dev-token-00000000000000000000000000";

export function initDevAuth(): void {
  if (!import.meta.env.DEV) return;
  if (document.cookie.includes("plane-session")) return;
  document.cookie = `plane-session=${DEV_TOKEN}; path=/; SameSite=Lax`;
}

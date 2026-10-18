# Deploy runbook — Atur

> **Monorepo note:** the app Worker lives in `apps/app/`, the marketing/blog
> site in `apps/web/`. The package manager is **bun** (workspaces `apps/*`,
> `packages/*`); run app scripts from `apps/app/` or via the root
> `bun --filter @atur/app …` aliases.

## 0. Prereqs

```bash
bunx wrangler login
bunx wrangler whoami   # confirm logged in
```

## 1. Deploy the app (app.diatur.com)

```bash
bun run deploy:app
```

This runs typecheck, builds the SPA + worker (vite cloudflare plugin), and
deploys the `atur-hono` worker to `app.diatur.com`.

### Secrets

```bash
cd apps/app
bunx wrangler secret put EMAIL_FROM   # e.g. noreply@diatur.com (must match send_email verified_address)
```

### Google OAuth ("Continue with Google")

Create an OAuth client in Google Cloud Console (**APIs & Services → Credentials
→ Create credentials → OAuth client ID → Web application**) and register BOTH
redirect URIs (must match what the worker derives from the request origin,
byte-for-byte):

- `https://app.diatur.com/auth/google/callback` (prod)
- `http://localhost:5173/auth/google/callback` (vite dev server)

Then store the client id + secret as worker secrets, and locally in
`apps/app/.dev.vars` (gitignored):

```bash
cd apps/app
bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET
```

```
# apps/app/.dev.vars
GOOGLE_CLIENT_ID=1234...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

If the secrets are absent, the login button's flow starts but immediately
bounces back with `error=oauth_disabled` (the user sees a "not configured"
toast). While testing locally, note that `client/lib/dev-auth.ts` auto-stamps a
dev session cookie — clear cookies first or the OAuth flow appears to be
skipped.

### Sign in with Apple + account deletion (iOS app)

`POST /auth/apple/native` verifies the identity token the iOS app gets from the
OS sheet against Apple's public keys (`https://appleid.apple.com/auth/keys`,
cached 1h): RS256 signature, issuer, audience, expiry and nonce. **No secret and
no migration is needed** — the audience defaults to the bundle id
`com.diatur.app` (override with the `APPLE_BUNDLE_ID` var).

`DELETE /api/users/me` (body `{"confirm":"DELETE"}`, session auth only — API keys
get 403) erases the account: scrubs name/email/avatar, revokes sessions, API keys
and provider links, removes memberships, hands owned workspaces to the
earliest-joined admin (else member) or soft-deletes them when the owner was the
only member. Public instructions live at `https://diatur.com/privacy#delete-account`
(the Play Console "Data deletion" URL and the App Store privacy-policy URL).

Apple also requires the Sign in with Apple grant to be revoked when the account is
deleted. That needs a Sign in with Apple key (Apple Developer → Keys → "Sign in
with Apple", Primary App ID `com.diatur.app`) stored as worker secrets; without
them sign-in and deletion still work, the grant just isn't revoked at Apple:

```bash
cd apps/app
bunx wrangler secret put APPLE_TEAM_ID          # 10-char Team ID
bunx wrangler secret put APPLE_SIWA_KEY_ID      # Key ID of the .p8
bunx wrangler secret put APPLE_SIWA_PRIVATE_KEY # contents of AuthKey_XXXX.p8
```

With these set, the app's one-shot authorization code is redeemed at sign-in and
the refresh token is kept on the `accounts` row, then revoked at deletion.

### Polar integration

The Polar integration (payments → CRM import) stores its credentials
**per-workspace in the `polar_settings` table**, entered by a workspace member
in **Integrations → Polar** (access token + webhook secret). No worker secrets
are needed. The signed webhook endpoint is
`https://app.diatur.com/webhooks/polar/<workspace-slug>` — register it in Polar
with the workspace's webhook secret.

## 2. Deploy the marketing site (diatur.com)

```bash
bun run deploy:web
```

Builds the Astro site and deploys to Cloudflare Pages (`atur-web` project,
`main` branch). If the Pages project doesn't exist yet:

```bash
cd apps/web
CLOUDFLARE_ACCOUNT_ID=b7e6f8457bd39fa37a7eea5249799754 bunx wrangler pages project create atur-web --production-branch main
```

## 3. Domain cutover (do once, order matters)

Both workers/sites were split on 2026-08-17. The old `diatur.com/*` route on
`atur-hono` was replaced with `app.diatur.com/*`; `diatur.com` is served by the
Pages site. The cutover order (no downtime):

1. **Deploy the Pages site first** (`bun run deploy:web`). Preview it at the
   `*.pages.dev` URL and confirm the landing, blog, and "Open App" links work.
2. **Add the custom domain `diatur.com`** to the Pages project (Workers & Pages
   → atur-web → Custom domains). Cloudflare auto-creates a `diatur.com`
   CNAME/redirect.
3. **Remove the `diatur.com/*` route from `atur-hono`** if it still exists
   (Workers & Pages → atur-hono → Settings → Domains & Routes) — after the
   Pages site owns the domain.
4. **Verify**: `https://diatur.com/` renders the Astro landing;
   `https://app.diatur.com/auth/login` loads the app; `https://app.diatur.com/mcp`
   responds to an MCP `initialize` handshake.

> If you need to roll back: re-add `[[routes]] pattern = "diatur.com/*"` to
> `apps/app/wrangler.toml` and `bun run deploy:app`, and remove the Pages
> custom domain.

## 4. DB migrations (when schema changes)

```bash
cd apps/app
bun run db:generate        # create migration from schema diff
bun run db:migrate:remote  # apply to the remote D1 database
```

## 5. Smoke checks

- `https://app.diatur.com/health` → `{ "ok": true }` (or 200).
- Register / sign in at `https://app.diatur.com/auth/login` → lands in a
  workspace.
- Logged-out `https://app.diatur.com/` redirects to `https://diatur.com`.
- Issue-notification and reminder emails link to `https://app.diatur.com/...`.
- The feedback widget snippet (`<script src="https://app.diatur.com/widget.js" …>`)
  loads and posts to `app.diatur.com/public/feedback/...`.
- MCP: `mcp__atur__list_workspaces` works from Claude Code / Cursor with the
  `X-API-Key` header against `https://app.diatur.com/mcp`.

## 6. Screen (desktop sharing)

`https://app.diatur.com/screen` shows and controls the ThinkPad desktop in the
browser (noVNC). Platform superusers only; every session is a `pane_audit` row
with `pane_id = 'screen:desktop'` (`attached_at` / `detached_at`).

Path: browser → Worker `/api/screen/ws` (superuser gate + audit) → tunnel →
`atur-bridge` `/screen` (`x-bridge-token`) → loopback wayvnc.

- The bridge owns wayvnc: it starts it on the first viewer and stops it 15 s
  after the last leaves (`SCREEN_GRACE_MS`). It always binds `127.0.0.1:5900`
  (`SCREEN_VNC_PORT`) with no VNC auth, so nothing but the bridge can reach it,
  and it refuses to relay to a listener it didn't start.
- wayvnc is the user-level extract at `~/.local/opt/wayvnc` (override with
  `SCREEN_WAYVNC_BIN` / `SCREEN_WAYVNC_LIBDIR`). Needs the Wayland session
  (`WAYLAND_DISPLAY`, default `wayland-1`).
- Each viewer connect/disconnect fires a `notify-send` on the desktop.
- `GET /api/screen/status` (superuser) → `{available, running, viewers}`.
- Restarting `atur-bridge` ends open viewer sessions (wayvnc lives in its
  cgroup); herdr panes are unaffected.

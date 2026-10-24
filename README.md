# Atur

Mission control for your AI coding agents. Agents pick up issues over MCP, work
on a branch and post the proof on the issue. You watch their live terminal panes
from the web or your phone, answer when they ask, get a push when one finishes or
needs you, and merge when you are satisfied. Token and cost usage is tracked per
agent, model and issue.

Around the agents sits a full workspace: projects, sprints, support tickets,
deals, pages and timesheets. It is a single Cloudflare Worker serving a React SPA
and a Hono API, with a separate Astro marketing/blog site.

## Ways to run Atur

| Option              | Price       | What you get                                                                                              |
| ------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| Self-host           | Free        | The whole app on your own Cloudflare account, under AGPL-3.0. See [docs/self-host.md](docs/self-host.md). |
| Atur Cloud (web)    | Free        | The web app at https://app.diatur.com.                                                                    |
| Atur Cloud **Solo** | $9 / month  | The iOS and Android app for one person: live agent panes, push alerts, dictation.                         |
| Atur Cloud **Team** | $29 / month | The same app for everyone in the workspaces the subscriber owns.                                          |

Plans and checkout: https://diatur.com/#pricing. The store app only talks to
Atur Cloud. If you self-host, build the phone app against your own server
(see [docs/self-host.md](docs/self-host.md)). The terminal bridge that powers live
panes is described in [docs/bridge.md](docs/bridge.md).

## Stack

- **App** (`apps/app`): Vite 8 · React 19 · Hono · Cloudflare Workers · D1 +
  Drizzle ORM · R2 · KV · Capacitor (iOS/Android) · Tailwind v4
- **Web** (`apps/web`): Astro 7 · MDX · sitemap (marketing/blog site for SEO)
- **Native** (`apps/native`): Expo SDK 57 · React Native 0.86 · expo-router ·
  Unistyles · TanStack Query — Android/iOS client for the same API
- **Tooling**: bun workspaces · TypeScript 7 · Oxlint / Oxfmt · GitHub Actions

## Setup

```bash
# from the repo root
bun install                                 # install all workspace deps
bun run dev:app                             # app: worker + SPA on one origin
bun run dev:web                             # marketing site dev server
bun run dev:native                          # Expo dev server for the mobile app
```

DB scripts live in `apps/app/` (not exposed at the root); run them from there:

```bash
cd apps/app
bun run db:generate       # generate migration SQL from schema (if changed)
bun run db:migrate        # apply pending migrations to remote (prod) D1
bun run db:migrate:local  # rebuild local D1 from baseline + dev seed
```

## Scripts

Root scripts (run from repo root; delegate to the app/web workspaces):

| Script                       | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `dev:app`                    | Vite dev server for the app (worker + SPA, one origin)       |
| `dev:web`                    | Dev server for the marketing site (`apps/web`)               |
| `dev:native`                 | Expo dev server for the mobile app (`apps/native`)           |
| `build`                      | Production build (app + web)                                 |
| `build:app`                  | Production build of the app (`dist/client` SPA, worker)      |
| `build:web`                  | Production build of the marketing site                       |
| `deploy:app`                 | Build + deploy the app Worker to `app.diatur.com`            |
| `deploy:web`                 | Deploy the marketing site to Cloudflare Pages (`diatur.com`) |
| `typecheck`                  | `tsc --noEmit` for app (worker + client), bridge, native     |
| `test`                       | Vitest (client tests)                                        |
| `lint` / `fmt` / `fmt:check` | Oxlint / Oxfmt                                               |

App scripts (run from `apps/app/`):

| Script                    | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `dev`                     | Vite dev server (worker + SPA via cloudflare plugin) |
| `build`                   | Production build (client → `dist/client`, worker)    |
| `deploy`                  | Build + `wrangler deploy` to `app.diatur.com`        |
| `db:generate`             | drizzle-kit generate migrations                      |
| `db:migrate`              | drizzle-kit migrate (apply pending to prod D1)       |
| `db:migrate:local`        | rebuild local D1 from baseline + seed                |
| `db:migrate:remote`       | drizzle-kit migrate (alias for `db:migrate`)         |
| `cf-typegen`              | regenerate Cloudflare bindings types                 |
| `test`                    | Vitest run                                           |
| `cap:sync` / `cap:open:*` | Capacitor native builds                              |

## Mobile app (`apps/native`)

Expo / React Native client: Home (decisions, needs-you, in-progress across all
workspaces), Projects → issue lists, issue detail (state, priority, assignees,
labels, comments), new issue, search, inbox, profile.

- **Auth**: email + password, email code (OTP), or Google. Google uses
  `GET /auth/google?native_challenge=…` → `atur://auth/callback?code=…` →
  `POST /auth/native/exchange { code, verifier }` (PKCE; the one-time code is
  useless without the app's verifier). The session token is stored in
  SecureStore and sent as `Authorization: Bearer`.
- **API target**: `EXPO_PUBLIC_SERVER_URL` (default `https://app.diatur.com`).
  For local dev, `EXPO_PUBLIC_SERVER_URL=http://localhost:5173 bun run web` in
  `apps/native` previews it in the browser against `bun run dev:app`.
- **Device**: `cd apps/native && bunx expo run:android` (dev client).
- **Release**: Atur ships through Google Play and the App Store only (no sideload
  APK). `scripts/build-native-aab.sh` builds the Play AAB; CI does it in
  `release-android.yml` (see `docs/native-release.md`). v1.0.x sideload users must
  uninstall and install from Play: the signing key can differ under Play App Signing.

## Domains

| Domain           | Served by                                       |
| ---------------- | ----------------------------------------------- |
| `diatur.com`     | Astro marketing/blog site (Cloudflare Pages)    |
| `app.diatur.com` | App Worker (`atur-hono`) — SPA + Hono API + MCP |

The MCP endpoint is `https://app.diatur.com/mcp`.

**Platform console**: `https://app.diatur.com/admin` (also "Platform admin" in the account
menu) is a read-only view across every workspace: totals and daily charts, users, workspaces,
the activity feed, and agent token/cost usage. Access requires `users.is_superuser = 1`; the
API lives under `/api/admin/*` and 403s everyone else. Grant it in D1:
`UPDATE users SET is_superuser = 1 WHERE email = '<email>';`

**Analytics**: `diatur.com` loads the Revklik tag (site "Atur",
`954201cb-3d15-47ae-857b-6e32c79e1f4c`, set in `apps/web/src/layouts/BaseLayout.astro`).
Sign-in and signup links carry `data-revklik-goal` attributes. The app itself is not tracked.

## Cloudflare resources

| Resource      | Binding      | Value / name                                       | Where in `apps/app/wrangler.toml` |
| ------------- | ------------ | -------------------------------------------------- | --------------------------------- |
| Account       | —            | `b7e6f8457bd39fa37a7eea5249799754`                 | `account_id`                      |
| D1 database   | `DB`         | `atur-db` / `08a18888-5e9a-4384-8ec2-03e73adab633` | `d1_databases[0]`                 |
| KV namespace  | `RATE_LIMIT` | `767d9b9dfa0e4f79a70f7f3c3e205f69`                 | `kv_namespaces[0]`                |
| R2 bucket     | `R2`         | `atur-assets`                                      | `r2_buckets[0]`                   |
| Custom domain | —            | `app.diatur.com`                                   | `routes[0]`                       |
| Static assets | `ASSETS`     | `./dist/client` (SPA)                              | `assets`                          |
| Email service | `SEND_EMAIL` | sender domain `noreply@diatur.com`                 | `send_email`                      |

### Where to find each resource in the Cloudflare dashboard

- **Account ID** — dashboard home page, right sidebar under **API** → _Account
  ID_. It is not a secret; never commit an **API token**.
- **D1 database** — **Workers & Pages → D1 → SQL databases**, select `atur-db`.
- **KV namespace** — **Workers & Pages → KV**, select `RATE_LIMIT`.
- **R2 bucket** — **R2 → Object storage**, bucket `atur-assets`.
- **Custom domain** — **Workers & Pages → your Worker (`atur-hono`) → Settings →
  Domains & Routes**: the `app.diatur.com` custom domain and its zone.
- **Email sender domain** — **Email → Email Service → sender domains**; the
  sender domain must be verified before the `SEND_EMAIL` binding can send.

### Re-creating the resources from scratch

Only needed if the account or the project is rebuilt; the current IDs are
already committed in `apps/app/wrangler.toml`:

```bash
bunx wrangler login
bunx wrangler d1 create atur-db                    # copy database_id into wrangler.toml
bunx wrangler kv namespace create RATE_LIMIT       # copy id into wrangler.toml
bunx wrangler r2 bucket create atur-assets         # name only, no id needed
bunx wrangler d1 migrations apply atur-db --remote # apply schema to the D1 database
```

Full deploy runbook (domain cutover, secrets, order): see
[docs/DEPLOY.md](docs/DEPLOY.md).

## MCP

Atur exposes a built-in MCP server (Streamable HTTP) at
`https://app.diatur.com/mcp`. It requires an `X-API-Key` (or session token);
keys are minted in the app UI (Settings → API keys). See `CLAUDE.md` for usage
and registration commands.

## License

AGPL-3.0-only (see `LICENSE`). You can self-host Atur for free, including the
phone app, which you build yourself (see [docs/self-host.md](docs/self-host.md)).
The Atur name, logo and the hosted service at https://app.diatur.com are covered
by `NOTICE`, and contributions need `CLA.md`. The Solo and Team plans pay for the
store app on Atur Cloud; they are not a license to the code.

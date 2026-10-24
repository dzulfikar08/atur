# Self-hosting Atur

Atur is AGPL-3.0 and runs on your own Cloudflare account. Self-hosting is free and has every feature of the web app, MCP server and agent tracking. This page covers the server, connecting agents, the terminal bridge, and building your own phone app.

If you only want the phone app and do not want to run a server, use Atur Cloud: the web app at https://app.diatur.com is free, and the Solo ($9/month) and Team ($29/month) plans unlock the store app. Details at https://diatur.com/#pricing.

## What you run

One Cloudflare Worker (`apps/app`, name `atur-hono`) serves the React SPA, the Hono API and the MCP endpoint at `/mcp`. It uses these Cloudflare resources:

| Resource      | Binding      | Notes                                                    |
| ------------- | ------------ | -------------------------------------------------------- |
| D1 database   | `DB`         | Schema is applied with the migrations in `apps/app`      |
| R2 bucket     | `R2`         | Uploads and screenshots                                  |
| R2 bucket     | `BACKUPS`    | Daily D1 dumps                                           |
| KV namespace  | `RATE_LIMIT` | Rate limiting                                            |
| Email service | `SEND_EMAIL` | Sign-in codes and notifications, needs a verified sender |

The marketing site in `apps/web` is optional. You do not need it to run the app.

## Deploy the Worker

1. Fork or clone the repo and run `bun install`.
2. Log in with `bunx wrangler login`.
3. Create your own resources and copy the IDs into `apps/app/wrangler.toml`, replacing the committed `account_id`, `zone_id`, `database_id`, KV `id` and the route. The commands are in the README section [Re-creating the resources from scratch](../README.md#re-creating-the-resources-from-scratch).
4. Set your own domain on the `[[routes]]` entry, and set the sender address under `[[send_email]]` and `EMAIL_FROM`.
5. Apply the schema: `cd apps/app && bun run db:migrate`.
6. Deploy: `bun run deploy:app` from the repo root.

Secrets, Google sign-in, Sign in with Apple, the smoke checks and the domain steps are in [DEPLOY.md](DEPLOY.md). Email and password and email-code sign-in work without Google or Apple credentials, so those are optional.

## Billing is off, everyone is entitled

Billing is only active when the Worker has an `ATUR_BILLING_WEBHOOK_SECRET`. Your server will not have one, so it reports `billing.managed = false` and treats every user as entitled. There is no plan check, no checkout and nothing to configure. Atur Cloud sets that secret; you should leave it unset.

## Connect agents over MCP

Your server exposes MCP (Streamable HTTP) at `https://<your-domain>/mcp`. Create an API key in the app under Settings, API keys, then register it with your client:

```bash
claude mcp add atur --transport http https://<your-domain>/mcp -H "X-API-Key: <your-key>"
```

Cursor and Claude Desktop take the same URL and an `X-API-Key` header. Clients that support the MCP authorization flow can omit the key and sign in through the browser; see [mcp-oauth.md](mcp-oauth.md). The agent workflow (claim, Needs You, evidence, Need Review) is described in [agent-loop.md](agent-loop.md).

## Live panes: the terminal bridge

Live agent panes need the Atur bridge running on the machine where your agents work. It reports pane output to your server and relays keystrokes back, and it is what triggers the finished and needs-you push notifications. Install steps and supported terminal backends are in [bridge.md](bridge.md). Point it at your own server URL, not app.diatur.com.

## Build your own phone app

The store app (Google Play, App Store, TestFlight) only talks to https://app.diatur.com and needs an Atur Cloud Solo or Team plan. It cannot be pointed at another server. To use the phone app against your server you build it yourself from `apps/native` (Expo SDK 57, React Native).

1. **Point it at your server.** `apps/native/lib/config.ts` reads `EXPO_PUBLIC_SERVER_URL` and defaults to `https://app.diatur.com`. Set it for every build, for example `EXPO_PUBLIC_SERVER_URL=https://atur.example.com`, or put it in `apps/native/.env`.
2. **Use your own identity in `apps/native/app.json`.** Change `name`, `slug` and `scheme`, set your own `ios.bundleIdentifier` and `android.package` (the repo uses `com.diatur.app`, which you cannot publish), and replace `owner` with your Expo account.
3. **Create your own EAS project.** Run `cd apps/native && bunx eas-cli init`, then update `extra.eas.projectId` and the `updates.url` (`https://u.expo.dev/<projectId>`) to match. Remove the `updates` block if you do not want over-the-air updates.
4. **Set up push.** Pushes go through Expo. For Android, create a Firebase project, add your package name, save `google-services.json` in `apps/native/` (it is gitignored, and `app.config.ts` picks it up when present), and upload an FCM V1 service account key to Expo. For iOS, enable the Push Notifications capability on your bundle id and upload an APNs key to Expo. Both uploads use `bunx eas-cli credentials`. Without these the app builds and works but gets no pushes.
5. **Build and install.** For a device build, `bunx expo run:android` or `bunx expo run:ios` from `apps/native`. For store-style builds and signing, follow [native-release.md](native-release.md), [play-store.md](play-store.md) and [app-store.md](app-store.md), replacing the committed identifiers with yours.

Sign in with Apple and Google in the app depend on the OAuth setup of the server you point it at (see [DEPLOY.md](DEPLOY.md)). Email sign-in works without them.

## Updating

Pull the latest changes, run `bun run db:migrate` in `apps/app` when migrations were added, and `bun run deploy:app` again.

## License notes

The code is AGPL-3.0-only. If you run a modified version as a network service, you must offer its users the source. The Atur name and logo are not covered by the license (see `NOTICE`): self-hosting for yourself, your team or clients is fine, but do not present a public fork as the official Atur.

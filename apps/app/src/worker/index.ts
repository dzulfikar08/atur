import { createApp } from "./app";
import { runDueDateReminders } from "./services/reminders";
import { OAUTH_NAV_PATHS } from "./lib/oauth";
import type { Env } from "./lib/env";

const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    // Worker handles the JSON API. Everything else is served by the [assets]
    // binding, whose "single-page-application" fallback returns index.html for
    // unknown paths (so client-side routes like /auth/login resolve to the SPA).
    //
    // Note: /auth/* is shared between SPA pages (GET /auth/login, /auth/register,
    // /auth/callback/*) and API mutations (POST /auth/sign-in, /auth/register,
    // /auth/sign-out). Route /auth/* to the API only for non-GET requests so the
    // browser-navigated auth pages fall through to the SPA.
    //
    // Exception: Google OAuth is browser-navigated GET but must reach the
    // worker — GET /auth/google 302s to accounts.google.com and
    // GET /auth/google/callback consumes the code, sets the session cookie,
    // then bounces to the SPA at /auth/callback/google. The path list lives in
    // lib/oauth.ts (OAUTH_NAV_PATHS) next to the provider config so a new
    // provider only has to be added once. GitHub/GitLab GETs still fall
    // through to the SPA until their handlers exist.
    const trimmedPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    const isOAuthNav =
      method === "GET" && OAUTH_NAV_PATHS.some((p) => p === trimmedPath);
    const isApiPath =
      pathname.startsWith("/api/") ||
      pathname === "/health" ||
      pathname === "/readiness" ||
      pathname.startsWith("/mcp") ||
      pathname === "/widget.js" || // embeddable feedback widget (application/javascript)
      pathname.startsWith("/public/") || // public feedback board API (token-keyed, no session)
      pathname.startsWith("/webhooks/polar"); // Polar webhook receiver (per-workspace, signed)
    const isAuthApi = (pathname.startsWith("/auth/") && method !== "GET") || isOAuthNav;

    // Portal: the same /portal/:slug/... paths serve BOTH the customer-facing
    // SPA pages (browser GET navigations) and the JSON API (fetch GET/POST —
    // e.g. /portal/:slug/tickets/:seqId is a page AND an API GET). Split on
    // Sec-Fetch-Mode so XHR/fetch reaches the app while page loads hit the SPA.
    const accept = request.headers.get("accept")?.toLowerCase() ?? "";
    const isDocumentNav =
      request.headers.get("sec-fetch-mode") === "navigate" || accept.startsWith("text/html");
    const isPortalApi = pathname.startsWith("/portal/") && method !== "OPTIONS" && !isDocumentNav;

    if (isApiPath || isAuthApi || isPortalApi) {
      return app.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },

  // Cron trigger (see wrangler.toml [triggers]): daily due-date reminder emails
  // for issue followers. Runs at 08:00 UTC; each recipient's local day is
  // derived from users.user_timezone for the dedup date.
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runDueDateReminders(env));
  },
} satisfies ExportedHandler<Env>;

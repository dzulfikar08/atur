import { createApp } from './app'
import type { Env } from './lib/env'

const app = createApp()

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url
    const method = request.method.toUpperCase()

    // Worker handles the JSON API. Everything else is served by the [assets]
    // binding, whose "single-page-application" fallback returns index.html for
    // unknown paths (so client-side routes like /auth/login resolve to the SPA).
    //
    // Note: /auth/* is shared between SPA pages (GET /auth/login, /auth/register,
    // /auth/callback/*) and API mutations (POST /auth/sign-in, /auth/register,
    // /auth/sign-out). Route /auth/* to the API only for non-GET requests so the
    // browser-navigated auth pages fall through to the SPA.
    const isApiPath =
      pathname.startsWith('/api/') ||
      pathname === '/health' ||
      pathname === '/readiness' ||
      pathname.startsWith('/mcp')
    const isAuthApi = pathname.startsWith('/auth/') && method !== 'GET'

    if (isApiPath || isAuthApi) {
      return app.fetch(request, env, ctx)
    }

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

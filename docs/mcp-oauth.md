# MCP browser sign-in (OAuth 2.1)

The Atur MCP endpoint, `https://app.diatur.com/mcp`, implements the
[MCP authorization spec (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).
Clients that support it (omp, Claude Code, Cursor…) can sign in through the browser
instead of pasting an API key. `pk_live_` API keys and session tokens still work on the
same endpoint, unchanged.

## Connect a client

MCP URL: **`https://app.diatur.com/mcp`**

```bash
# omp (slash commands inside the TUI; config lives in ~/.omp/agent/mcp.json)
#   1. delete the stale "headers": { "X-API-Key": ... } entry from the "atur" server
#   2. /mcp reauth atur        (or /mcp add → http → https://app.diatur.com/mcp)

# Claude Code (browser sign-in: run /mcp inside Claude Code → atur → Authenticate)
claude mcp add atur --transport http https://app.diatur.com/mcp -s user
```

Do not pass an `X-API-Key` header when you want browser sign-in. Remove any stale
`headers` entry (or the revoked key) from the client config first; the client then
receives `401` with a `WWW-Authenticate` challenge and starts the flow.

What happens: the client discovers the authorization server, registers itself
(Dynamic Client Registration), opens `https://app.diatur.com/oauth/authorize?...` in
your browser. If you are not signed in to Atur you are sent to the normal login page
(password, email code or Google) and then back. The consent screen shows the client
name, who you are signed in as, the workspaces the grant reaches, and where you will
be redirected; **Allow access** redirects to the client's callback with a one-time code.

The grant acts as you in every workspace you belong to (the same reach as an API key).
Per-workspace narrowing is not offered.

## Endpoints

| Purpose                                       | URL                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Protected resource metadata (RFC 9728)        | `/.well-known/oauth-protected-resource` (also `/.well-known/oauth-protected-resource/mcp`) |
| Authorization server metadata (RFC 8414)      | `/.well-known/oauth-authorization-server`                                                  |
| Dynamic client registration (RFC 7591)        | `POST /oauth/register`                                                                     |
| Authorization (browser)                       | `GET/POST /oauth/authorize`                                                                |
| Token (`authorization_code`, `refresh_token`) | `POST /oauth/token`                                                                        |
| Revocation (RFC 7009)                         | `POST /oauth/revoke` (`token`, `client_id`)                                                |

Unauthenticated `POST /mcp` answers `401` with
`WWW-Authenticate: Bearer resource_metadata="https://app.diatur.com/.well-known/oauth-protected-resource"`
(plus `error="invalid_token"` when a credential was sent but is bad).

## Rules

- Public clients only (`token_endpoint_auth_method: none`). **PKCE with `S256` is
  required**; `plain` and missing challenges are rejected.
- Redirect URIs must be registered exactly. Exceptions: `http://localhost`,
  `http://127.0.0.1`, `http://[::1]` match on any port (native clients); private-use
  custom schemes (`cursor://…`) and `https://` are accepted at registration; plain `http`
  for other hosts, `javascript:`, `data:`, `file:` and fragments are refused.
- Tokens are opaque, audience-bound to `<origin>/mcp` (RFC 8707 `resource`): an OAuth
  token is rejected by the REST API and by any other origin.
- Access token: 1 hour (`atur_at_…`). Refresh token (`atur_rt_…`): rotated on every use,
  30 days idle window. Replaying a rotated refresh token, or an authorization code,
  revokes the whole grant. Codes live 2 minutes and are single use.
- Storage (migration `0026_mcp_oauth.sql`): `oauth_clients`, `oauth_codes`,
  `oauth_tokens`. Codes and tokens are stored as SHA-256 digests only.
- `/oauth/register` is rate limited per IP (30/hour) when the `RATE_LIMIT` KV is bound.
- The consent POST is only accepted same-origin with the session cookie, and the page
  cannot be framed.

## Revoking access

Clients should call `POST /oauth/revoke`. Operator-side, in D1:

```bash
wrangler d1 execute atur-db --remote --command \
  "UPDATE oauth_tokens SET revoked_at = strftime('%s','now')*1000 WHERE user_id = '<user-uuid>' AND revoked_at IS NULL;"
```

## Deploy

The change adds a D1 migration. Apply it before (or with) the code deploy:

```bash
cd apps/app
bun run db:migrate:remote      # drizzle-kit migrate → 0026_mcp_oauth.sql
bun run deploy
```

# Hono.js Server — Design Spec

**Date:** 2026-07-12
**Status:** Approved

## Context

The Atur project has a Rust/axum VPS server (`crates/server/`) and a Rust WASM Cloudflare Worker (`crates/atur-worker/`). Both are complex to maintain and deploy. A new Hono.js-based server will provide a simpler, Cloudflare-native deployment option that serves the same API surface plus the static frontend.

## Architecture

- **Standalone** — new `server-js/` directory, coexists with existing Rust code
- **Layered pattern** — routes → services → repositories
- **Cloudflare Workers** — single Worker deployable via `wrangler deploy`
- **D1 + R2** — existing D1 database and R2 bucket for storage
- **JWT auth** — same JWT approach as the Rust server
- **Static frontend** — served via CF `[assets]` binding (already configured)

## Directory Layout

```
server-js/
  package.json
  tsconfig.json
  wrangler.toml
  drizzle.config.ts
  src/
    index.ts           # Hono app mount, export fetch handler
    app.ts             # Hono app factory (testable)
    routes/            # thin handlers — parse, validate, call service, respond
      auth.ts
      issues.ts
      projects.ts
      workspaces.ts
      cycles.ts
      modules.ts
      pages.ts
      instances.ts
      states.ts
      labels.ts
      members.ts
      sprints.ts
      custom_fields.ts
      notifications.ts
      webhooks.ts
      integrations.ts
      exports.ts
      imports.ts
      search.ts
      assets.ts
      health.ts
      mcp/
        index.ts       # sub-routes for MCP protocol
    services/          # business logic, validation, orchestration
      auth.ts
      issues.ts
      projects.ts
      workspaces.ts
      cycles.ts
      modules.ts
      pages.ts
      notifications.ts
      webhooks.ts
      search.ts
      mcp.ts
    repositories/      # D1 queries via Drizzle
      users.ts
      issues.ts
      projects.ts
      workspaces.ts
      cycles.ts
      modules.ts
      pages.ts
      states.ts
      labels.ts
      notifications.ts
      webhooks.ts
      assets.ts
    db/
      schema.ts        # Drizzle schema (38 tables)
      index.ts         # D1 client init
    middleware/
      auth.ts          # JWT verification, set c.var.user
      cors.ts          # CORS headers
      error.ts         # global error handler
    lib/
      jwt.ts           # sign, verify
      password.ts      # hash, compare (bcryptjs)
      mcp.ts           # MCP protocol helpers
      pagination.ts    # offset/limit, cursor pagination
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Cloudflare Workers |
| Framework | Hono v4 |
| Database | D1 via Drizzle ORM |
| File storage | R2 |
| Auth | JWT (hono/jwt) + bcryptjs |
| Validation | Zod |
| Testing | Vitest |
| Static serving | `[assets]` binding (CDN edge) |

## API Routes

Mount pattern in `src/index.ts`:

```ts
const app = new Hono()
  .route('/api/auth', authRoutes)
  .route('/api/workspaces', workspaceRoutes)
  .route('/api/search', searchRoutes)
  .route('/api/notifications', notificationRoutes)
  .route('/api/upload', assetRoutes)
  .route('/health', healthRoutes)
  .route('/mcp', mcpRoutes)
```

Nested routes use Hono sub-apps:

```ts
// src/routes/workspaces.ts
const workspaceRoutes = new Hono()
  .route('/:slug/projects', projectRoutes)
  .route('/:slug/members', memberRoutes)
  // ...
```

Full route list mirrors the existing Rust server — see Section 2 of the brainstorming session.

## Database Schema

Reuses the D1 schema from `crates/atur-worker/schema.sql` (38 tables). Drizzle definitions mirror this schema exactly. Key entities:

- `users`, `workspaces`, `workspace_members`, `projects`, `project_members`
- `issues`, `issue_assignees`, `issue_labels`, `issue_comments`, `issue_relations`
- `states`, `labels`, `cycles`, `cycle_issues`, `modules`, `module_issues`, `module_members`
- `pages`, `page_versions`, `notifications`, `webhooks`, `file_assets`
- `imports`, `api_logs`, `integration_tokens`, `custom_fields`, `api_keys`
- `estimates`, `estimate_points`, `issue_activities`, `issue_subscribers`, `issue_attachments`, `issue_links`, `issue_reactions`, `issue_sequences`
- `accounts`, `profiles`, `workspace_invites`, `notification_preferences`

## Auth Flow

```
POST /api/auth/register → hash password (bcryptjs), insert user → return JWT
POST /api/auth/login    → verify password, generate JWT (sub: user_id, exp: 7d)
POST /api/auth/refresh  → verify refresh token, issue new JWT
GET  /api/auth/me       → verify JWT, return user profile
```

JWT middleware: extract `Authorization: Bearer <token>`, verify with `hono/jwt`, set `c.set('user', payload)`.

## Static Frontend

`[assets]` binding in `wrangler.toml` with `run_worker_first = true`:

```toml
[assets]
directory = "static-app"
not_found_handling = "single-page-application"
binding = "ASSETS"
run_worker_first = true
```

API routes hit the worker. Asset requests go direct to CF CDN. SPA fallback handled automatically.

## Deployment

```bash
wrangler dev           # local development
wrangler deploy        # production
```

Single `wrangler.toml` at `server-js/wrangler.toml` with D1, R2, KV bindings pointing to existing resources.

## Non-Goals

- Real-time collaboration (collab crate) — requires WebSocket/Durable Objects, deferred
- Email sending — requires external service, deferred
- Background tasks (tasks crate) — requires Queues or scheduled events, deferred

## Success Criteria

- All existing API routes functional
- JWT auth works end-to-end
- Static frontend served at root
- Deployable via single `wrangler deploy`
- Passes existing frontend integration tests

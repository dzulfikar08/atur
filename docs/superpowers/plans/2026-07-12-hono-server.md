# Hono.js Server — Implementation Plan

> **For agentic workers:** Use inline execution. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build a Hono.js server on Cloudflare Workers with all existing API routes, D1+R2 storage, JWT auth, serving static frontend.

**Architecture:** Layered Hono app — routes → services → repositories. Drizzle ORM for D1. JWT auth middleware.

**Tech Stack:** Hono v4, Drizzle ORM, D1, R2, Zod, bcryptjs, Vitest

## Global Constraints

- Cloudflare Workers runtime (no Node.js APIs)
- D1 + R2 already provisioned (existing bindings)
- Static frontend at `../static-app/` (built Vite SPA)
- All 38 D1 tables from `crates/atur-worker/schema.sql`
- JWT auth matching Rust server behavior

---

### Task 1: Project scaffolding

**Files:**
- Create: `server-js/package.json`
- Create: `server-js/tsconfig.json`
- Create: `server-js/wrangler.toml`
- Create: `server-js/src/index.ts`
- Create: `server-js/src/app.ts`

**Interfaces:**
- Produces: `app` (Hono app factory), `fetch` (CF Worker entrypoint)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "atur-hono",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "drizzle-orm": "^0.38.0",
    "drizzle-kit": "^0.30.0",
    "zod": "^3.24.0",
    "bcryptjs": "^2.4.3",
    "@types/bcryptjs": "^2.4.6",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241022.0",
    "wrangler": "^3.84.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create wrangler.toml**

```toml
name = "atur-hono"
main = "src/index.ts"
compatibility_date = "2026-04-08"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "atur-db"
database_id = "08a18888-5e9a-4384-8ec2-03e73adab633"

[[r2_buckets]]
binding = "R2"
bucket_name = "atur-assets"

[observability]
enabled = true

[assets]
directory = "../static-app"
not_found_handling = "single-page-application"
binding = "ASSETS"
run_worker_first = true
```

- [ ] **Step 4: Create src/app.ts**

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { errorMiddleware } from './middleware/error'
import { healthRoutes } from './routes/health'

export function createApp(): Hono {
  const app = new Hono()

  app.use('*', cors())
  app.use('*', logger())
  app.use('*', errorMiddleware)

  app.route('/health', healthRoutes)

  return app
}
```

- [ ] **Step 5: Create src/index.ts**

```ts
import { createApp } from './app'

const app = createApp()

export default app
```

- [ ] **Step 6: Create src/middleware/error.ts**

```ts
import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'

export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next()
  } catch (err) {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status)
    }
    console.error('Unhandled error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
}
```

- [ ] **Step 7: Create src/routes/health.ts**

```ts
import { Hono } from 'hono'

export const healthRoutes = new Hono()
  .get('/', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))
```

- [ ] **Step 8: Install dependencies**

Run: `cd server-js && npm install`

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 10: Commit**

```bash
git add server-js/
git commit -m "feat: scaffold Hono.js server with health endpoint"
```

---

### Task 2: Database schema with Drizzle

**Files:**
- Create: `server-js/src/db/schema.ts`
- Create: `server-js/src/db/index.ts`
- Create: `server-js/drizzle.config.ts`

**Interfaces:**
- Consumes: D1 binding from wrangler.toml
- Produces: `getDb(c.env.DB)` → DrizzleClient, all table schemas exported

- [ ] **Step 1: Create drizzle.config.ts**

```ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    databaseId: '08a18888-5e9a-4384-8ec2-03e73adab633',
    accountId: 'b7e6f8457bd39fa37a7eea5249799754',
  },
} satisfies Config
```

- [ ] **Step 2: Create src/db/schema.ts** — all 38 tables

```ts
import { sqliteTable, text, integer, real, blob, uniqueIndex, index } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  passwordHash: text('password_hash'),
  avatar: text('avatar'),
  token: text('token'),
  userTimezone: text('user_timezone').default('UTC'),
  isActive: integer('is_active').notNull().default(1),
  isSuperuser: integer('is_superuser').notNull().default(0),
  isEmailVerified: integer('is_email_verified').notNull().default(0),
  isBot: integer('is_bot').notNull().default(0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_users_email').on(table.email),
  index('idx_users_token').on(table.token),
  index('idx_users_deleted_at').on(table.deletedAt),
])

// ... (all remaining 37 tables following same pattern)
```

- [ ] **Step 3: Create src/db/index.ts**

```ts
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema })
}

export type DbClient = ReturnType<typeof getDb>
```

- [ ] **Step 4: Typecheck and commit**

---

### Task 3: Auth middleware and JWT utilities

**Files:**
- Create: `server-js/src/lib/jwt.ts`
- Create: `server-js/src/lib/password.ts`
- Create: `server-js/src/middleware/auth.ts`
- Create: `server-js/src/lib/env.ts`

**Interfaces:**
- Consumes: `users` table schema
- Produces: `signJwt(payload)`, `verifyJwt(token)`, `hashPassword(pw)`, `comparePassword(pw, hash)`, `authMiddleware`, `Env` type

- [ ] **Step 1: Create src/lib/env.ts**

```ts
export type Env = {
  DB: D1Database
  R2: R2Bucket
  ASSETS: { fetch: (req: Request) => Promise<Response> }
  JWT_SECRET: string
}
```

- [ ] **Step 2: Create src/lib/password.ts**

```ts
import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
```

- [ ] **Step 3: Create src/lib/jwt.ts**

```ts
import { sign, verify } from 'hono/jwt'

export interface JwtPayload {
  sub: string   // user_id
  exp?: number
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  return sign({ ...payload, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }, secret)
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  return verify(token, secret) as Promise<JwtPayload>
}
```

- [ ] **Step 4: Create src/middleware/auth.ts**

```ts
import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { verifyJwt, type JwtPayload } from '../lib/jwt'
import type { Env } from '../lib/env'

declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload
  }
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing or invalid Authorization header' })
  }
  const token = authHeader.slice(7)
  try {
    const payload = await verifyJwt(token, c.env.JWT_SECRET)
    c.set('user', payload)
    await next()
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' })
  }
}
```

- [ ] **Step 5: Typecheck and commit**

---

### Task 4: Auth routes (register, login, me, refresh)

**Files:**
- Create: `server-js/src/repositories/users.ts`
- Create: `server-js/src/services/auth.ts`
- Create: `server-js/src/routes/auth.ts`
- Modify: `server-js/src/app.ts` (mount auth routes)

**Interfaces:**
- Consumes: `getDb`, `users` schema, `hashPassword`, `comparePassword`, `signJwt`, `verifyJwt`, `authMiddleware`
- Produces: `authRoutes` mounted at `/api/auth`

- [ ] **Step 1: Create src/repositories/users.ts** — `findByEmail`, `findById`, `create`

- [ ] **Step 2: Create src/services/auth.ts** — `register`, `login`, `getProfile`

- [ ] **Step 3: Create src/routes/auth.ts** — POST `/register`, POST `/login`, GET `/me`, POST `/refresh`

- [ ] **Step 4: Mount in app.ts**

- [ ] **Step 5: Typecheck and commit**

---

### Task 5–18: Remaining routes (workspaces, projects, issues, cycles, modules, pages, states, labels, members, sprints, custom fields, notifications, webhooks, integrations, exports/imports, search, assets, MCP)

Each task follows the same pattern:
1. Create repository (Drizzle queries)
2. Create service (business logic + Zod validation)
3. Create route handler
4. Mount in app.ts

---

### Task 19: Static frontend passthrough + integration

**Files:**
- Modify: `server-js/src/index.ts`

Ensure assets binding falls through. With `run_worker_first = true`, the worker handles API requests and assets binding handles static files.

---

### Task 20: Final integration test & deploy

- [ ] Typecheck: `npx tsc --noEmit`
- [ ] Local test: `npx wrangler dev`
- [ ] Verify health endpoint
- [ ] Verify auth flow
- [ ] Deploy: `npx wrangler deploy`

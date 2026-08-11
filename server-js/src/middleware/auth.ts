import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie } from 'hono/cookie'
import { and, eq, isNull } from 'drizzle-orm'
import type { Env } from '../lib/env'
import type { AuthUser } from '../lib/token'
import { getDb, type DbClient } from '../db/index'
import * as schema from '../db/schema'
import * as usersRepo from '../repositories/users'

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function extractToken(c: Context<{ Bindings: Env }>): string | null {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  const apiKey = c.req.header('X-API-Key')
  if (apiKey) {
    return apiKey
  }
  return getCookie(c, 'plane-session') ?? null
}

type ResolvedUser = {
  id: string
  email: string
  displayName: string | null
  avatar: string | null
  isActive: number | null
  deletedAt?: string | null
}

// Resolve a raw token to a user. Two paths:
//  1. pk_live_* API key → sha256-hashed lookup against api_keys. Long-lived,
//     minted via POST /me/api-keys. Active, non-expired, non-deleted only.
//  2. anything else → opaque session token stored on users.token.
async function resolveUserByToken(db: DbClient, token: string): Promise<ResolvedUser | null> {
  if (token.startsWith('pk_live_')) {
    const keyHash = await sha256Hex(token)
    const now = new Date().toISOString()
    const [key] = await db.select({
      id: schema.apiKeys.id,
      userId: schema.apiKeys.userId,
      expiresAt: schema.apiKeys.expiresAt,
    })
      .from(schema.apiKeys)
      .where(and(
        eq(schema.apiKeys.keyHash, keyHash),
        eq(schema.apiKeys.isActive, 1),
        isNull(schema.apiKeys.deletedAt),
      ))
      .limit(1)
    if (!key) return null
    if (key.expiresAt && key.expiresAt <= now) return null
    const user = await usersRepo.findById(db, key.userId)
    if (!user || !user.isActive || user.deletedAt) return null
    // Best-effort last-used stamp; never block the request on it.
    db.update(schema.apiKeys).set({ lastUsedAt: now }).where(eq(schema.apiKeys.id, key.id)).catch(() => {})
    return user
  }
  return usersRepo.findByToken(db, token)
}

function toAuthUser(user: ResolvedUser): AuthUser {
  return {
    sub: user.id,
    email: user.email,
    displayName: user.displayName,
    avatar: user.avatar,
  }
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const token = extractToken(c)
  if (!token) {
    throw new HTTPException(401, { message: 'Missing or invalid token' })
  }
  const db = getDb(c.env.DB)
  const user = await resolveUserByToken(db, token)
  if (!user) {
    throw new HTTPException(401, { message: 'Invalid or expired token' })
  }
  c.set('user', toAuthUser(user))
  await next()
}

export async function optionalAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const token = extractToken(c)
  if (token) {
    const db = getDb(c.env.DB)
    const user = await resolveUserByToken(db, token)
    if (user) {
      c.set('user', toAuthUser(user))
    }
  }
  await next()
}

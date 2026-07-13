import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie } from 'hono/cookie'
import type { Env } from '../lib/env'
import type { AuthUser } from '../lib/token'
import { getDb } from '../db/index'
import * as usersRepo from '../repositories/users'

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
  }
}

function extractToken(c: Context<{ Bindings: Env }>): string | null {
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

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const token = extractToken(c)
  if (!token) {
    throw new HTTPException(401, { message: 'Missing or invalid token' })
  }
  const db = getDb(c.env.DB)
  const user = await usersRepo.findByToken(db, token)
  if (!user) {
    throw new HTTPException(401, { message: 'Invalid or expired token' })
  }
  c.set('user', {
    sub: user.id,
    email: user.email,
    displayName: user.displayName,
    avatar: user.avatar,
  })
  await next()
}

export async function optionalAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const token = extractToken(c)
  if (token) {
    const db = getDb(c.env.DB)
    const user = await usersRepo.findByToken(db, token)
    if (user) {
      c.set('user', {
        sub: user.id,
        email: user.email,
        displayName: user.displayName,
        avatar: user.avatar,
      })
    }
  }
  await next()
}

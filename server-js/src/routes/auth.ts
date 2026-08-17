import { Hono, type Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../lib/env'
import { getDb } from '../db/index'
import { authMiddleware } from '../middleware/auth'
import * as authService from '../services/auth'
import * as usersRepo from '../repositories/users'
import { SESSION_TTL_SECONDS } from '../lib/session'

const SESSION_COOKIE = 'plane-session'
const SESSION_MAX_AGE = SESSION_TTL_SECONDS

type C = Context<{ Bindings: Env }>

// Browsers reject Secure cookies over plain HTTP, which would silently drop the
// session on local dev (http://localhost). Only mark Secure when really on HTTPS.
function isHttps(c: C): boolean {
  return c.req.url.startsWith('https://')
}

function setSessionCookie(c: C, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
}

function clearSessionCookie(c: C) {
  setCookie(c, SESSION_COOKIE, '', {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Strict',
    path: '/',
    maxAge: 0,
  })
}

export const authRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .post('/register', async (c) => {
    const db = getDb(c.env.DB)
    const body = authService.registerSchema.parse(await c.req.json())
    const result = await authService.register(db, body)
    setSessionCookie(c, result.token)
    return c.json({ session_token: result.token, user: result.user })
  })
  .post('/sign-in', async (c) => {
    const db = getDb(c.env.DB)
    const body = authService.loginSchema.parse(await c.req.json())
    const result = await authService.login(db, body)
    setSessionCookie(c, result.token)
    return c.json({ session_token: result.token, user: result.user })
  })
  .post('/sign-out', async (c) => {
    const db = getDb(c.env.DB)
    const token = getCookie(c, SESSION_COOKIE)
    if (token) {
      await usersRepo.clearToken(db, token)
    }
    clearSessionCookie(c)
    return c.json({ message: 'Signed out' })
  })
  .post('/forgot-password', async (c) => {
    return c.json({ message: 'If the email exists, a reset link will be sent' })
  })
  .post('/reset-password', async (c) => {
    return c.json({ message: 'Not implemented' }, 501)
  })
  .post('/magic-link', async (c) => {
    return c.json({ message: 'Not implemented' }, 501)
  })
  .post('/otp/request', async (c) => {
    const kv = c.env.RATE_LIMIT
    if (!kv) throw new HTTPException(500, { message: 'KV namespace not configured' })
    const db = getDb(c.env.DB)
    const body = authService.requestOtpSchema.parse(await c.req.json())
    const result = await authService.requestLoginOtp(db, kv, c.env, body)
    return c.json(result)
  })
  .post('/otp/verify', async (c) => {
    const kv = c.env.RATE_LIMIT
    if (!kv) throw new HTTPException(500, { message: 'KV namespace not configured' })
    const db = getDb(c.env.DB)
    const body = authService.verifyOtpSchema.parse(await c.req.json())
    const result = await authService.verifyLoginOtp(db, kv, body)
    setSessionCookie(c, result.token)
    return c.json({ session_token: result.token, user: result.user })
  })
  .get('/get-csrf-token', (c) => {
    return c.json({ csrf_token: 'stub' })
  })
  .get('/me', authMiddleware, async (c) => {
    const db = getDb(c.env.DB)
    const user = c.get('user')
    const profile = await authService.getProfile(db, user.sub)
    return c.json(profile)
  })
  .get('/github', (c) => c.json({ url: '' }))
  .get('/github/callback', (c) => c.json({ error: 'Not implemented' }, 501))
  .get('/google', (c) => c.json({ url: '' }))
  .get('/google/callback', (c) => c.json({ error: 'Not implemented' }, 501))
  .get('/gitlab', (c) => c.json({ url: '' }))
  .get('/gitlab/callback', (c) => c.json({ error: 'Not implemented' }, 501))
  .post('/login', async (c) => {
    const db = getDb(c.env.DB)
    const body = authService.loginSchema.parse(await c.req.json())
    const result = await authService.login(db, body)
    setSessionCookie(c, result.token)
    return c.json(result)
  })

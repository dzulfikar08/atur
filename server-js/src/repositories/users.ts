import { and, eq, isNull } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import { users } from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'

export async function findByEmail(db: DbClient, email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  return user
}
export async function findByUsername(db: DbClient, username: string) {
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1)
  return user
}

export async function findById(db: DbClient, id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return user
}

// Opaque-token lookup — matches Rust worker: token = ? AND is_active AND deleted_at IS NULL.
export async function findByToken(db: DbClient, token: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      isActive: users.isActive,
    })
    .from(users)
    .where(and(eq(users.token, token), eq(users.isActive, 1), isNull(users.deletedAt)))
    .limit(1)
  return user ?? null
}

export async function createUser(
  db: DbClient,
  data: { email: string; username: string; passwordHash: string; token: string }
) {
  const id = uuid()
  const now = nowISO()
  await db.insert(users).values({
    id,
    email: data.email,
    username: data.username,
    passwordHash: data.passwordHash,
    token: data.token,
    userTimezone: 'UTC',
    isActive: 1,
    isSuperuser: 0,
    isEmailVerified: 0,
    isBot: 0,
    createdAt: now,
    updatedAt: now,
  })
  return findById(db, id)
}

export async function updateUser(db: DbClient, id: string, data: Partial<typeof users.$inferInsert>) {
  await db.update(users).set({ ...data, updatedAt: nowISO() }).where(eq(users.id, id))
  return findById(db, id)
}

// Invalidate a session token (sign-out). Best-effort: returns nothing.
export async function clearToken(db: DbClient, token: string) {
  await db
    .update(users)
    .set({ token: null, updatedAt: nowISO() })
    .where(eq(users.token, token))
}

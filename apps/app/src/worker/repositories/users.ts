import { and, eq, isNull, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { users } from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export async function findByEmail(db: DbClient, email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}

// Case-insensitive lookup. Emails are stored exactly as typed at registration,
// so "Dzul@Foo.com" and "dzul@foo.com" are different rows today (the unique
// index is case-sensitive) — an OAuth identity (Google always reports a
// verified, lowercase-normalized address) must still resolve to the right
// account when linking. The email-match is not index-backed (lower() on the
// column) and case-variant duplicates are possible, so order deterministically
// and take the oldest row rather than letting storage pick one at random.
export async function findByEmailCaseInsensitive(db: DbClient, email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .orderBy(users.createdAt)
    .limit(1);
  return user ?? null;
}
export async function findByUsername(db: DbClient, username: string) {
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return user;
}

export async function findById(db: DbClient, id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

// Legacy opaque-token lookup (sessions minted before user_sessions existed):
// token = ? AND is_active AND deleted_at IS NULL. New sessions live in
// repositories/sessions.ts.
export async function findByToken(db: DbClient, token: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      isActive: users.isActive,
      sessionExpiresAt: users.sessionExpiresAt,
    })
    .from(users)
    .where(and(eq(users.token, token), eq(users.isActive, 1), isNull(users.deletedAt)))
    .limit(1);
  return user ?? null;
}

export async function createUser(
  db: DbClient,
  data: {
    email: string;
    username: string;
    passwordHash: string | null;
    displayName?: string | null;
    avatar?: string | null;
    isEmailVerified?: 0 | 1;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(users).values({
    id,
    email: data.email,
    username: data.username,
    passwordHash: data.passwordHash,
    displayName: data.displayName ?? null,
    avatar: data.avatar ?? null,
    userTimezone: "UTC",
    isActive: 1,
    isSuperuser: 0,
    isEmailVerified: data.isEmailVerified ?? 0,
    isBot: 0,
    createdAt: now,
    updatedAt: now,
  });
  return findById(db, id);
}

export async function updateUser(
  db: DbClient,
  id: string,
  data: Partial<typeof users.$inferInsert>,
) {
  await db
    .update(users)
    .set({ ...data, updatedAt: nowISO() })
    .where(eq(users.id, id));
  return findById(db, id);
}

// Invalidate a session token (sign-out). Best-effort: returns nothing.
export async function clearToken(db: DbClient, token: string) {
  await db
    .update(users)
    .set({ token: null, sessionExpiresAt: null, updatedAt: nowISO() })
    .where(eq(users.token, token));
}

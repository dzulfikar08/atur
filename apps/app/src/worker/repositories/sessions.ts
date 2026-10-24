import { and, eq, gt, isNull } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { DbClient } from "../db/index";
import { userSessions, users } from "../db/schema";
import { sha256Hex } from "../lib/identify";
import { sessionExpiryISO } from "../lib/session";
import { generateToken } from "../lib/token";

const USER_AGENT_MAX = 200;

// Per-device sessions. The raw token is returned once (to the client) and only
// its SHA-256 hex is persisted, so a database read can't be replayed as a login.

/** Create a session for `userId` and return the RAW token (never stored). */
export async function createSession(
  db: DbClient,
  userId: string,
  userAgent?: string | null,
): Promise<string> {
  const token = generateToken();
  const now = new Date().toISOString();
  await db.insert(userSessions).values({
    id: uuid(),
    userId,
    tokenHash: await sha256Hex(token),
    createdAt: now,
    expiresAt: sessionExpiryISO(),
    lastUsedAt: now,
    userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
  });
  return token;
}

/**
 * Resolve a raw token to its live session + owning user: row exists, not
 * expired, user active and not deleted. Null when nothing matches (the caller
 * then tries the legacy users.token path).
 */
export async function findByToken(db: DbClient, token: string) {
  const [row] = await db
    .select({
      sessionId: userSessions.id,
      sessionExpiresAt: userSessions.expiresAt,
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      isActive: users.isActive,
    })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(
      and(
        eq(userSessions.tokenHash, await sha256Hex(token)),
        gt(userSessions.expiresAt, new Date().toISOString()),
        eq(users.isActive, 1),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Slide the window: push expiry out to a full TTL and stamp last use. */
export async function renew(db: DbClient, sessionId: string, expiresAt: string) {
  await db
    .update(userSessions)
    .set({ expiresAt, lastUsedAt: new Date().toISOString() })
    .where(eq(userSessions.id, sessionId));
}

/** Sign-out of one device. Returns whether a session row was removed. */
export async function deleteByToken(db: DbClient, token: string): Promise<boolean> {
  const removed = await db
    .delete(userSessions)
    .where(eq(userSessions.tokenHash, await sha256Hex(token)))
    .returning({ id: userSessions.id });
  return removed.length > 0;
}

export async function deleteByUser(db: DbClient, userId: string) {
  await db.delete(userSessions).where(eq(userSessions.userId, userId));
}

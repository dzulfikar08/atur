import { and, eq, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { DbClient } from "../db/index";
import { pushTokens } from "../db/schema";
import { nowISO } from "../lib/pagination";

// D1 caps a statement at 100 bound params.
const IN_CHUNK = 90;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) out.push(items.slice(i, i + IN_CHUNK));
  return out;
}

/** Register a device token; a token already held by another user moves to this one. */
export async function upsert(db: DbClient, userId: string, token: string, platform: string) {
  const now = nowISO();
  await db
    .insert(pushTokens)
    .values({ id: uuid(), userId, token, platform, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform, updatedAt: now } });
}

/** Only the caller's own row is removed; a missing row is not an error. */
export async function remove(db: DbClient, userId: string, token: string) {
  await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
}

export async function tokensForUsers(db: DbClient, userIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const part of chunks([...new Set(userIds)])) {
    const rows = await db
      .select({ token: pushTokens.token })
      .from(pushTokens)
      .where(inArray(pushTokens.userId, part));
    for (const r of rows) out.push(r.token);
  }
  return out;
}

/** Prune tokens Expo reported as no longer registered. */
export async function removeTokens(db: DbClient, tokens: string[]) {
  for (const part of chunks([...new Set(tokens)])) {
    await db.delete(pushTokens).where(inArray(pushTokens.token, part));
  }
}

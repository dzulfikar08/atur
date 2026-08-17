import { eq, and, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { issueSubscribers, users } from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export interface SubscriberWithUser {
  id: string;
  subscriberId: string;
  createdAt: string | null;
  user: {
    id: string;
    email: string;
    username: string;
    display_name: string | null;
    avatar: string | null;
    is_email_verified: number;
    is_active: number;
    user_timezone: string | null;
  } | null;
}

// Followers of an issue, joined with the user row so notification dispatch has
// the email / verification flags it needs without a second query.
export async function listByIssue(db: DbClient, issueId: string): Promise<SubscriberWithUser[]> {
  const rows = await db
    .select({
      id: issueSubscribers.id,
      subscriberId: issueSubscribers.subscriberId,
      createdAt: issueSubscribers.createdAt,
      user: {
        id: users.id,
        email: users.email,
        username: users.username,
        display_name: users.displayName,
        avatar: users.avatar,
        is_email_verified: users.isEmailVerified,
        is_active: users.isActive,
        user_timezone: users.userTimezone,
      },
    })
    .from(issueSubscribers)
    .leftJoin(users, eq(users.id, issueSubscribers.subscriberId))
    .where(and(eq(issueSubscribers.issueId, issueId), isNull(issueSubscribers.deletedAt)));
  return rows;
}

export async function isSubscribed(
  db: DbClient,
  issueId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: issueSubscribers.id })
    .from(issueSubscribers)
    .where(
      and(
        eq(issueSubscribers.issueId, issueId),
        eq(issueSubscribers.subscriberId, userId),
        isNull(issueSubscribers.deletedAt),
      ),
    )
    .limit(1);
  return !!row;
}

export async function subscribe(db: DbClient, issueId: string, userId: string) {
  const now = nowISO();
  const [existing] = await db
    .select({ id: issueSubscribers.id })
    .from(issueSubscribers)
    .where(and(eq(issueSubscribers.issueId, issueId), eq(issueSubscribers.subscriberId, userId)))
    .limit(1);

  if (existing) {
    // Re-activate a previously soft-deleted subscription.
    await db
      .update(issueSubscribers)
      .set({ deletedAt: null, updatedAt: now })
      .where(eq(issueSubscribers.id, existing.id));
    return;
  }

  await db.insert(issueSubscribers).values({
    id: uuid(),
    issueId,
    subscriberId: userId,
    createdAt: now,
    updatedAt: now,
  });
}

export async function unsubscribe(db: DbClient, issueId: string, userId: string) {
  await db
    .update(issueSubscribers)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(
      and(
        eq(issueSubscribers.issueId, issueId),
        eq(issueSubscribers.subscriberId, userId),
        isNull(issueSubscribers.deletedAt),
      ),
    );
}

// Idempotent auto-follow used by issue create / comment / assign hooks.
export async function autoFollow(db: DbClient, issueId: string, userId: string) {
  if (!userId) return;
  await subscribe(db, issueId, userId);
}

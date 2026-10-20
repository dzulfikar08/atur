import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { appleSiwaConfig, revokeAppleRefreshToken, type AppleSiwaEnv } from "../lib/appleAuth";
import { nowISO } from "../lib/pagination";
import * as accountsRepo from "../repositories/accounts";
import * as usersRepo from "../repositories/users";
import * as workspaceRepo from "../repositories/workspaces";

// The typed confirmation guards against a misclick, not against a stolen
// session — the bearer token already proves who is asking.
export const DELETE_CONFIRMATION = "DELETE";

export const deleteAccountSchema = z.object({
  confirm: z.literal(DELETE_CONFIRMATION),
});

const ADMIN_ROLE = 20;

export type SuccessorCandidate = { memberId: string; role: number; joinedAt: string | null };

// Who inherits a workspace when its owner deletes their account: the
// earliest-joined admin, else the earliest-joined member. Pure so the rule is
// testable without a database.
export function pickSuccessor(candidates: SuccessorCandidate[]): SuccessorCandidate | null {
  const byJoined = [...candidates].sort((a, b) =>
    (a.joinedAt ?? "9999").localeCompare(b.joinedAt ?? "9999"),
  );
  return byJoined.find((c) => c.role >= ADMIN_ROLE) ?? byJoined[0] ?? null;
}

// The scrubbed identity. Unique per user so users.email / users.username
// (both UNIQUE) never collide, and the original address is free to sign up
// again. `.invalid` is reserved (RFC 6761): it can never receive mail.
export const deletedEmail = (userId: string) => `deleted-${userId}@deleted.invalid`;
export const deletedUsername = (userId: string) => `deleted-${userId.replace(/-/g, "")}`;

// Erases an account. Sequential, not transactional (D1 via drizzle has no
// interactive transaction), so it is ordered to be safely re-runnable: every
// step is idempotent and the user row — the thing that authenticates a retry —
// is scrubbed last.
export async function deleteAccount(
  db: DbClient,
  userId: string,
  env: AppleSiwaEnv = {},
): Promise<void> {
  const user = await usersRepo.findById(db, userId);
  if (!user || user.deletedAt) throw new HTTPException(404, { message: "User not found" });

  await settleOwnedWorkspaces(db, userId);

  const now = nowISO();
  const gone = { deletedAt: now, updatedAt: now };
  await db
    .update(schema.workspaceMembers)
    .set({ ...gone, isActive: 0 })
    .where(
      and(eq(schema.workspaceMembers.memberId, userId), isNull(schema.workspaceMembers.deletedAt)),
    );
  await db
    .update(schema.projectMembers)
    .set({ ...gone, isActive: 0 })
    .where(
      and(eq(schema.projectMembers.memberId, userId), isNull(schema.projectMembers.deletedAt)),
    );

  // Personal, non-shared rows are erased outright.
  await db.delete(schema.issueAssignees).where(eq(schema.issueAssignees.assigneeId, userId));
  await db.delete(schema.issueSubscribers).where(eq(schema.issueSubscribers.subscriberId, userId));
  await db.delete(schema.moduleMembers).where(eq(schema.moduleMembers.memberId, userId));
  await db.delete(schema.notifications).where(eq(schema.notifications.receiverId, userId));
  await db
    .delete(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.userId, userId));
  await db
    .delete(schema.userHiddenWorkspaces)
    .where(eq(schema.userHiddenWorkspaces.userId, userId));
  await db.delete(schema.integrationTokens).where(eq(schema.integrationTokens.userId, userId));
  await db.delete(schema.notes).where(eq(schema.notes.userId, userId));
  await db.delete(schema.profiles).where(eq(schema.profiles.userId, userId));
  // Portal sessions of this user's customer contacts (a separate auth path).
  await db
    .update(schema.customers)
    .set({ sessionToken: null })
    .where(eq(schema.customers.userId, userId));
  // CRM ownership falls back to unassigned rather than a dead user.
  await db
    .update(schema.companies)
    .set({ ownerId: null })
    .where(eq(schema.companies.ownerId, userId));

  await revokeAppleGrants(db, userId, env);
  await accountsRepo.deleteByUser(db, userId);

  await db
    .update(schema.apiKeys)
    .set({ isActive: 0, ...gone })
    .where(and(eq(schema.apiKeys.userId, userId), isNull(schema.apiKeys.deletedAt)));

  await db
    .update(schema.users)
    .set({
      email: deletedEmail(userId),
      username: deletedUsername(userId),
      displayName: "Deleted user",
      avatar: null,
      passwordHash: null,
      token: null,
      sessionExpiresAt: null,
      isActive: 0,
      isEmailVerified: 0,
      userTimezone: "UTC",
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.users.id, userId));
}

// Owned workspaces either hand over to a remaining member or, when nobody else
// is left, are soft-deleted with the account.
async function settleOwnedWorkspaces(db: DbClient, userId: string): Promise<void> {
  const owned = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.ownerId, userId), isNull(schema.workspaces.deletedAt)));

  for (const { id: workspaceId } of owned) {
    const rows = await db
      .select({
        id: schema.workspaceMembers.id,
        memberId: schema.workspaceMembers.memberId,
        role: schema.workspaceMembers.role,
        joinedAt: schema.workspaceMembers.createdAt,
      })
      .from(schema.workspaceMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.memberId))
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, workspaceId),
          ne(schema.workspaceMembers.memberId, userId),
          eq(schema.workspaceMembers.isActive, 1),
          isNull(schema.workspaceMembers.deletedAt),
          eq(schema.users.isActive, 1),
          isNull(schema.users.deletedAt),
        ),
      )
      .orderBy(asc(schema.workspaceMembers.createdAt));

    const successor = pickSuccessor(rows);
    if (!successor) {
      await workspaceRepo.softDelete(db, workspaceId);
      continue;
    }
    await workspaceRepo.update(db, workspaceId, { ownerId: successor.memberId });
    if (successor.role < ADMIN_ROLE) {
      const membership = rows.find((r) => r.memberId === successor.memberId);
      if (membership) {
        await db
          .update(schema.workspaceMembers)
          .set({ role: ADMIN_ROLE, updatedAt: nowISO() })
          .where(eq(schema.workspaceMembers.id, membership.id));
      }
    }
  }
}

// Apple requires the Sign in with Apple grant be revoked on deletion. Needs the
// optional APPLE_SIWA_* key and a refresh token stored at sign-in; otherwise
// nothing to do. A failure is logged, never fatal: blocking erasure on a third
// party outage would be worse, and the user can still remove the app in
// Settings > Apple ID.
async function revokeAppleGrants(db: DbClient, userId: string, env: AppleSiwaEnv): Promise<void> {
  const config = appleSiwaConfig(env);
  if (!config) return;
  const linked = await accountsRepo.listByUser(db, userId);
  for (const account of linked) {
    if (account.provider !== "apple" || !account.refreshToken) continue;
    try {
      await revokeAppleRefreshToken(config, account.refreshToken);
    } catch (err) {
      console.error("apple grant revocation failed:", err);
    }
  }
}

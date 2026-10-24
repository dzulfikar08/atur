import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { billingSubscriptions, users, workspaceMembers, workspaces } from "../db/schema";

export type BillingSubscriptionRow = typeof billingSubscriptions.$inferSelect;
export type BillingSubscriptionInsert = typeof billingSubscriptions.$inferInsert;

export async function findById(db: DbClient, id: string) {
  const [row] = await db
    .select()
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.polarSubscriptionId, id))
    .limit(1);
  return row ?? null;
}

export async function upsert(db: DbClient, row: BillingSubscriptionInsert) {
  const { polarSubscriptionId: _id, createdAt: _created, ...set } = row;
  await db
    .insert(billingSubscriptions)
    .values(row)
    .onConflictDoUpdate({ target: billingSubscriptions.polarSubscriptionId, set });
}

export async function findUserIdByEmail(db: DbClient, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .orderBy(users.createdAt)
    .limit(1);
  return row?.id ?? null;
}

export async function userExists(db: DbClient, id: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return !!row;
}

/** Subscriptions linked to the user by id or by (case-insensitive) customer email. */
export async function listForUser(db: DbClient, userId: string, email: string) {
  return db
    .select()
    .from(billingSubscriptions)
    .where(
      sql`${billingSubscriptions.userId} = ${userId} or lower(${billingSubscriptions.customerEmail}) = ${email.toLowerCase()}`,
    );
}

/** Owners of the live workspaces the user is an active member of (the user's own ones included). */
export async function workspaceOwnersForMember(db: DbClient, userId: string) {
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .innerJoin(users, eq(workspaces.ownerId, users.id))
    .where(
      and(
        eq(workspaceMembers.memberId, userId),
        eq(workspaceMembers.isActive, 1),
        sql`${workspaceMembers.deletedAt} is null`,
        sql`${workspaces.deletedAt} is null`,
      ),
    );
  return [...new Map(rows.map((r) => [r.id, r])).values()];
}

export async function listTeamForOwners(
  db: DbClient,
  owners: { id: string; email: string }[],
): Promise<BillingSubscriptionRow[]> {
  const out: BillingSubscriptionRow[] = [];
  for (let i = 0; i < owners.length; i += 45) {
    const part = owners.slice(i, i + 45);
    const emails = part.map((o) => o.email.toLowerCase());
    out.push(
      ...(await db
        .select()
        .from(billingSubscriptions)
        .where(
          and(
            eq(billingSubscriptions.plan, "team"),
            sql`(${inArray(
              billingSubscriptions.userId,
              part.map((o) => o.id),
            )} or lower(${billingSubscriptions.customerEmail}) in (${sql.join(
              emails.map((e) => sql`${e}`),
              sql`, `,
            )}))`,
          ),
        )),
    );
  }
  return out;
}

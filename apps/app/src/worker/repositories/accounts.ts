import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { accounts } from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

// Linked OAuth identities (see schema.accounts). One user may hold rows for
// several providers; (provider, providerAccountId) is unique.
export async function findByProvider(db: DbClient, provider: string, providerAccountId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.provider, provider),
        eq(accounts.providerAccountId, providerAccountId),
        isNull(accounts.deletedAt),
      ),
    )
    .limit(1);
  return account ?? null;
}

// Insert the (provider, providerAccountId) link. Idempotent on purpose: the
// unique index uq_accounts_provider turns a concurrent duplicate (double
// callback, two tabs finishing the flow at once) into a no-op instead of a 500.
export async function create(
  db: DbClient,
  data: {
    provider: string;
    providerAccountId: string;
    userId: string;
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
    metadata?: string | null;
  },
) {
  const now = nowISO();
  await db
    .insert(accounts)
    .values({
      id: uuid(),
      provider: data.provider,
      providerAccountId: data.providerAccountId,
      userId: data.userId,
      accessToken: data.accessToken ?? null,
      refreshToken: data.refreshToken ?? null,
      idToken: data.idToken ?? null,
      metadata: data.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

export async function updateTokens(
  db: DbClient,
  id: string,
  data: {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
    metadata?: string | null;
  },
) {
  await db
    .update(accounts)
    .set({ ...data, updatedAt: nowISO() })
    .where(eq(accounts.id, id));
}

export async function listByUser(db: DbClient, userId: string) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)));
}

// Hard delete (account erasure): the stored provider tokens are credentials,
// and dropping the row frees (provider, providerAccountId) so the same
// identity can sign up again as a brand-new user.
export async function deleteByUser(db: DbClient, userId: string) {
  await db.delete(accounts).where(eq(accounts.userId, userId));
}

import { and, eq, desc, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

// ── mayar_settings ──

export async function getSettings(db: DbClient, workspaceId: string) {
  const [row] = await db
    .select()
    .from(schema.mayarSettings)
    .where(eq(schema.mayarSettings.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function upsertSettings(
  db: DbClient,
  workspaceId: string,
  data: {
    apiKey?: string;
    apiVersion?: string;
    lastSyncedAt?: string | null;
  },
) {
  const now = nowISO();
  const set: Record<string, unknown> = { updatedAt: now };
  if (data.apiKey !== undefined) set.apiKey = data.apiKey;
  if (data.apiVersion !== undefined) set.apiVersion = data.apiVersion;
  if (data.lastSyncedAt !== undefined) set.lastSyncedAt = data.lastSyncedAt;

  await db
    .update(schema.mayarSettings)
    .set(set)
    .where(eq(schema.mayarSettings.workspaceId, workspaceId));
  return getSettings(db, workspaceId);
}

export async function createSettings(
  db: DbClient,
  workspaceId: string,
  data: { apiKey: string; apiVersion?: string },
) {
  const now = nowISO();
  await db.insert(schema.mayarSettings).values({
    workspaceId,
    apiKey: data.apiKey,
    apiVersion: data.apiVersion ?? "v1",
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return getSettings(db, workspaceId);
}

// ── mayar_transactions ──

export async function findByMayarId(db: DbClient, workspaceId: string, mayarTransactionId: string) {
  const [row] = await db
    .select()
    .from(schema.mayarTransactions)
    .where(
      and(
        eq(schema.mayarTransactions.workspaceId, workspaceId),
        eq(schema.mayarTransactions.mayarTransactionId, mayarTransactionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function upsertTransaction(
  db: DbClient,
  data: {
    workspaceId: string;
    mayarTransactionId: string;
    paymentLinkTransactionId?: string | null;
    credit: number | null;
    status: string;
    balanceHistoryType: string | null;
    paymentMethod: string | null;
    customerId?: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    amount: number | null;
    fee: string | null;
    paymentLinkId?: string | null;
    paymentLinkName?: string | null;
    subscriptionId?: string | null;
  },
) {
  const now = nowISO();
  const existing = await findByMayarId(db, data.workspaceId, data.mayarTransactionId);

  if (existing) {
    await db
      .update(schema.mayarTransactions)
      .set({
        paymentLinkTransactionId: data.paymentLinkTransactionId ?? null,
        credit: data.credit,
        status: data.status,
        balanceHistoryType: data.balanceHistoryType ?? null,
        paymentMethod: data.paymentMethod ?? null,
        customerId: data.customerId ?? null,
        customerName: data.customerName ?? null,
        customerEmail: data.customerEmail ?? null,
        amount: data.amount,
        fee: data.fee ?? null,
        paymentLinkId: data.paymentLinkId ?? null,
        paymentLinkName: data.paymentLinkName ?? null,
        subscriptionId: data.subscriptionId ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mayarTransactions.workspaceId, data.workspaceId),
          eq(schema.mayarTransactions.mayarTransactionId, data.mayarTransactionId),
        ),
      );
    return findByMayarId(db, data.workspaceId, data.mayarTransactionId);
  }

  await db.insert(schema.mayarTransactions).values({
    id: uuid(),
    workspaceId: data.workspaceId,
    mayarTransactionId: data.mayarTransactionId,
    paymentLinkTransactionId: data.paymentLinkTransactionId ?? null,
    credit: data.credit ?? 0,
    status: data.status,
    balanceHistoryType: data.balanceHistoryType ?? null,
    paymentMethod: data.paymentMethod ?? null,
    customerId: data.customerId ?? null,
    customerName: data.customerName ?? null,
    customerEmail: data.customerEmail ?? null,
    amount: data.amount ?? 0,
    fee: data.fee ?? null,
    paymentLinkId: data.paymentLinkId ?? null,
    paymentLinkName: data.paymentLinkName ?? null,
    subscriptionId: data.subscriptionId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return findByMayarId(db, data.workspaceId, data.mayarTransactionId);
}

export async function listByWorkspace(
  db: DbClient,
  workspaceId: string,
  options?: { status?: string; limit?: number; offset?: number },
) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const where = options?.status
    ? and(
        eq(schema.mayarTransactions.workspaceId, workspaceId),
        eq(schema.mayarTransactions.status, options.status),
      )
    : eq(schema.mayarTransactions.workspaceId, workspaceId);

  return db
    .select()
    .from(schema.mayarTransactions)
    .where(where)
    .orderBy(desc(schema.mayarTransactions.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function countByWorkspace(db: DbClient, workspaceId: string, status?: string) {
  const where = status
    ? and(
        eq(schema.mayarTransactions.workspaceId, workspaceId),
        eq(schema.mayarTransactions.status, status),
      )
    : eq(schema.mayarTransactions.workspaceId, workspaceId);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mayarTransactions)
    .where(where);
  return Number(count);
}

export async function removeByMayarId(
  db: DbClient,
  workspaceId: string,
  mayarTransactionId: string,
) {
  await db
    .delete(schema.mayarTransactions)
    .where(
      and(
        eq(schema.mayarTransactions.workspaceId, workspaceId),
        eq(schema.mayarTransactions.mayarTransactionId, mayarTransactionId),
      ),
    );
}

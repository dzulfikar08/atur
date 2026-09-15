import { and, eq, desc, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

// ── paywuz_settings ──

export async function getSettings(db: DbClient, workspaceId: string) {
  const [row] = await db
    .select()
    .from(schema.paywuzSettings)
    .where(eq(schema.paywuzSettings.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function upsertSettings(
  db: DbClient,
  workspaceId: string,
  data: {
    apiKey?: string;
    environment?: string;
    lastSyncedAt?: string | null;
  },
) {
  const now = nowISO();
  const set: Record<string, unknown> = { updatedAt: now };
  if (data.apiKey !== undefined) set.apiKey = data.apiKey;
  if (data.environment !== undefined) set.environment = data.environment;
  if (data.lastSyncedAt !== undefined) set.lastSyncedAt = data.lastSyncedAt;

  await db
    .update(schema.paywuzSettings)
    .set(set)
    .where(eq(schema.paywuzSettings.workspaceId, workspaceId));
  return getSettings(db, workspaceId);
}

export async function createSettings(
  db: DbClient,
  workspaceId: string,
  data: { apiKey: string; environment: string },
) {
  const now = nowISO();
  await db.insert(schema.paywuzSettings).values({
    workspaceId,
    apiKey: data.apiKey,
    environment: data.environment,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return getSettings(db, workspaceId);
}

// ── paywuz_transactions ──

export async function findByOrderId(db: DbClient, workspaceId: string, orderId: string) {
  const [row] = await db
    .select()
    .from(schema.paywuzTransactions)
    .where(
      and(
        eq(schema.paywuzTransactions.workspaceId, workspaceId),
        eq(schema.paywuzTransactions.orderId, orderId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function upsertTransaction(
  db: DbClient,
  data: {
    workspaceId: string;
    orderId: string;
    transactionId: string;
    status: string;
    amount: number;
    totalPayment: number | null;
    fee: number | null;
    paymentMethod: string | null;
    paymentNumber: string | null;
    paymentUrl: string | null;
    expiredAt: string | null;
    paidAt: string | null;
    metadata?: string | null;
  },
) {
  const now = nowISO();
  const existing = await findByOrderId(db, data.workspaceId, data.orderId);

  if (existing) {
    await db
      .update(schema.paywuzTransactions)
      .set({
        transactionId: data.transactionId,
        status: data.status,
        amount: data.amount,
        totalPayment: data.totalPayment,
        fee: data.fee,
        paymentMethod: data.paymentMethod,
        paymentNumber: data.paymentNumber,
        paymentUrl: data.paymentUrl,
        expiredAt: data.expiredAt,
        paidAt: data.paidAt,
        metadata: data.metadata ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.paywuzTransactions.workspaceId, data.workspaceId),
          eq(schema.paywuzTransactions.orderId, data.orderId),
        ),
      );
    return findByOrderId(db, data.workspaceId, data.orderId);
  }

  await db.insert(schema.paywuzTransactions).values({
    id: uuid(),
    workspaceId: data.workspaceId,
    orderId: data.orderId,
    transactionId: data.transactionId,
    status: data.status,
    amount: data.amount,
    totalPayment: data.totalPayment,
    fee: data.fee,
    paymentMethod: data.paymentMethod,
    paymentNumber: data.paymentNumber,
    paymentUrl: data.paymentUrl,
    expiredAt: data.expiredAt,
    paidAt: data.paidAt,
    metadata: data.metadata ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return findByOrderId(db, data.workspaceId, data.orderId);
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
        eq(schema.paywuzTransactions.workspaceId, workspaceId),
        eq(schema.paywuzTransactions.status, options.status),
      )
    : eq(schema.paywuzTransactions.workspaceId, workspaceId);

  return db
    .select()
    .from(schema.paywuzTransactions)
    .where(where)
    .orderBy(desc(schema.paywuzTransactions.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function countByWorkspace(db: DbClient, workspaceId: string, status?: string) {
  const where = status
    ? and(
        eq(schema.paywuzTransactions.workspaceId, workspaceId),
        eq(schema.paywuzTransactions.status, status),
      )
    : eq(schema.paywuzTransactions.workspaceId, workspaceId);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.paywuzTransactions)
    .where(where);
  return Number(count);
}

export async function removeByOrderId(db: DbClient, workspaceId: string, orderId: string) {
  await db
    .delete(schema.paywuzTransactions)
    .where(
      and(
        eq(schema.paywuzTransactions.workspaceId, workspaceId),
        eq(schema.paywuzTransactions.orderId, orderId),
      ),
    );
}

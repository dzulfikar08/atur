import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as paywuzRepo from "../repositories/paywuz";

// ── Paywuz API client ──────────────────────────────────────────────
// Base URL: https://api.paywuz.id/v1
// Auth: Authorization: Bearer <api_key>

const PAYWUZ_API_BASE = "https://api.paywuz.id/v1";

interface PaywuzTransactionResponse {
  data?: {
    id: string;
    orderId: string;
    transactionId: string;
    status: string;
    amount: number;
    totalPayment: number | null;
    fee: number;
    paymentMethod: string;
    paymentNumber: string | null;
    paymentUrl: string | null;
    expiredAt: string | null;
    createdAt: string;
    paidAt: string | null;
  };
  error?: string;
  message?: string;
}

async function paywuzFetch(
  apiKey: string,
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<unknown> {
  const url = `${PAYWUZ_API_BASE}${path}`;
  const res = await fetch(url, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    throw new HTTPException(res.status as ContentfulStatusCode, {
      message: `Paywuz API error: ${res.statusText}`,
    });
  }

  return res.json();
}

// ── Service functions ──────────────────────────────────────────────

export interface PaywuzSyncResult {
  orderId: string;
  status: string;
  amount: number;
  totalPayment: number | null;
  fee: number | null;
  paymentMethod: string | null;
  paidAt: string | null;
}

export async function syncTransaction(
  db: DbClient,
  workspaceId: string,
  apiKey: string,
  orderId: string,
): Promise<PaywuzSyncResult> {
  const response = (await paywuzFetch(
    apiKey,
    `/transactions/${orderId}`,
  )) as PaywuzTransactionResponse;

  if (!response.data || response.error) {
    throw new HTTPException(404, {
      message: `Paywuz transaction not found: ${orderId}`,
    });
  }

  const data = response.data;
  const result = await paywuzRepo.upsertTransaction(db, {
    workspaceId,
    orderId: data.orderId,
    transactionId: data.transactionId,
    status: data.status,
    amount: data.amount,
    totalPayment: data.totalPayment,
    fee: data.fee ?? null,
    paymentMethod: data.paymentMethod ?? null,
    paymentNumber: data.paymentNumber,
    paymentUrl: data.paymentUrl,
    expiredAt: data.expiredAt,
    paidAt: data.paidAt,
  });

  return {
    orderId: result.orderId,
    status: result.status,
    amount: result.amount,
    totalPayment: result.totalPayment,
    fee: result.fee,
    paymentMethod: result.paymentMethod,
    paidAt: result.paidAt,
  };
}

export async function syncAllTransactions(
  db: DbClient,
  workspaceId: string,
  apiKey: string,
  orderIds: string[],
): Promise<PaywuzSyncResult[]> {
  const results: PaywuzSyncResult[] = [];
  for (const orderId of orderIds) {
    try {
      const result = await syncTransaction(db, workspaceId, apiKey, orderId);
      results.push(result);
    } catch {
      // Skip failed orders
    }
  }
  return results;
}

export async function getSettings(db: DbClient, workspaceId: string) {
  return paywuzRepo.getSettings(db, workspaceId);
}

// Partial update: omitted fields keep their stored value — a settings PUT
// without api_key must not wipe the stored key.
export async function saveSettings(
  db: DbClient,
  workspaceId: string,
  data: { apiKey?: string; environment?: string },
) {
  const existing = await paywuzRepo.getSettings(db, workspaceId);
  if (existing) {
    return paywuzRepo.upsertSettings(db, workspaceId, data);
  }
  return paywuzRepo.createSettings(db, workspaceId, {
    apiKey: data.apiKey ?? "",
    environment: data.environment ?? "sandbox",
  });
}

export async function listTransactions(
  db: DbClient,
  workspaceId: string,
  options?: { status?: string; limit?: number; offset?: number },
) {
  const rows = await paywuzRepo.listByWorkspace(db, workspaceId, options);
  const total = await paywuzRepo.countByWorkspace(db, workspaceId, options?.status);
  return { rows, total };
}

export async function getRevenueSummary(db: DbClient, workspaceId: string) {
  const [totalRow] = await db
    .select({ total: sql<number>`coalesce(sum(paywuz_transactions.amount), 0)` })
    .from(schema.paywuzTransactions)
    .where(eq(schema.paywuzTransactions.workspaceId, workspaceId));

  const [paidRow] = await db
    .select({ total: sql<number>`coalesce(sum(paywuz_transactions.amount), 0)` })
    .from(schema.paywuzTransactions)
    .where(
      and(
        eq(schema.paywuzTransactions.workspaceId, workspaceId),
        eq(schema.paywuzTransactions.status, "success"),
      ),
    );

  const [successRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.paywuzTransactions)
    .where(
      and(
        eq(schema.paywuzTransactions.workspaceId, workspaceId),
        eq(schema.paywuzTransactions.status, "success"),
      ),
    );

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.paywuzTransactions)
    .where(eq(schema.paywuzTransactions.workspaceId, workspaceId));

  return {
    totalRevenue: Number(totalRow?.total ?? 0),
    paidRevenue: Number(paidRow?.total ?? 0),
    totalTransactions: Number(countRow?.count ?? 0),
    paidTransactions: Number(successRow?.count ?? 0),
  };
}

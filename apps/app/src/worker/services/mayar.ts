import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as mayarRepo from "../repositories/mayar";
import { nowISO } from "../lib/pagination";

// ── Mayar API client ───────────────────────────────────────────────
// Base URL: https://api.mayar.id/hl/v1 (V1) or /hl/v2 (V2)
// Auth: Authorization: Bearer <api_key>
// V1 deprecated 1 Oct 2026; use V2 where possible

const MAYAR_API_BASE_V1 = "https://api.mayar.id/hl/v1";
const MAYAR_API_BASE_V2 = "https://api.mayar.id/hl/v2";

interface MayarTransactionResponse {
  statusCode: number;
  messages: string;
  hasMore: boolean;
  pageCount: number;
  pageSize: number;
  page: number;
  data: MayarTransaction[];
}

interface MayarTransaction {
  id: string;
  credit: number;
  status: string;
  balanceHistoryType: string;
  paymentMethod: string;
  customerId: string;
  createdAt: number;
  paymentLinkTransactionId: string | null;
  fee: MayarFee[];
  paymentLinkId: string | null;
  subscriptionId: string | null;
  xenditTransactionId: string | null;
  paymentLink: {
    id: string;
    name: string;
  } | null;
  customer: {
    id: string;
    name: string;
    email: string;
    mobile: string;
  } | null;
  amount?: number;
}

interface MayarFee {
  id: string;
  balanceHistoryType: string;
  debit: number;
}

interface MayarDailyResponse {
  statusCode: number;
  messages: string;
  data: MayarDaily[];
}

interface MayarDaily {
  date: string;
  income: number;
  expense: number;
  netIncome: number;
  count: number;
}

interface MayarAccountBalance {
  statusCode: number;
  messages: string;
  data: {
    balance: number;
    pendingBalance: number;
    currency: string;
  };
}

async function mayarFetch(
  apiKey: string,
  path: string,
  apiVersion?: string,
  options?: { method?: string; body?: unknown },
): Promise<unknown> {
  const base = apiVersion === "v2" ? MAYAR_API_BASE_V2 : MAYAR_API_BASE_V1;
  const url = `${base}${path}`;
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
      message: `Mayar API error: ${res.statusText}`,
    });
  }

  return res.json();
}

// ── Service functions ──────────────────────────────────────────────

export interface MayarSyncResult {
  synced: number;
  failed: number;
}

export async function syncPaidTransactions(
  db: DbClient,
  workspaceId: string,
  apiKey: string,
  apiVersion: string = "v1",
): Promise<MayarSyncResult> {
  const response = (await mayarFetch(
    apiKey,
    "/transactions",
    apiVersion,
  )) as MayarTransactionResponse;
  const transactions = response.data as MayarTransaction[];

  let synced = 0;
  let failed = 0;

  for (const txn of transactions) {
    try {
      await mayarRepo.upsertTransaction(db, {
        workspaceId,
        mayarTransactionId: txn.id,
        paymentLinkTransactionId: txn.paymentLinkTransactionId,
        credit: txn.credit,
        status: txn.status,
        balanceHistoryType: txn.balanceHistoryType,
        paymentMethod: txn.paymentMethod,
        customerId: txn.customerId,
        customerName: txn.customer?.name ?? null,
        customerEmail: txn.customer?.email ?? null,
        paymentLinkId: txn.paymentLinkId,
        paymentLinkName: txn.paymentLink?.name ?? null,
        subscriptionId: txn.subscriptionId,
        amount: txn.amount ?? txn.credit,
        fee: txn.fee ? JSON.stringify(txn.fee) : null,
      });
      synced++;
    } catch {
      failed++;
    }
  }

  await mayarRepo.upsertSettings(db, workspaceId, { lastSyncedAt: nowISO() });
  return { synced, failed };
}

export async function syncDailyTransactions(
  db: DbClient,
  workspaceId: string,
  apiKey: string,
  apiVersion: string = "v1",
): Promise<MayarDaily[]> {
  const response = (await mayarFetch(
    apiKey,
    "/transaction/dailytransaction",
    apiVersion,
  )) as MayarDailyResponse;
  return response.data as MayarDaily[];
}

export async function getAccountBalance(
  db: DbClient,
  apiKey: string,
  apiVersion: string = "v1",
): Promise<MayarAccountBalance> {
  const response = (await mayarFetch(apiKey, "/accountbalance", apiVersion)) as MayarAccountBalance;
  return response;
}

export async function getSettings(db: DbClient, workspaceId: string) {
  return mayarRepo.getSettings(db, workspaceId);
}

// Partial update: omitted fields keep their stored value — a settings PUT
// without api_key must not wipe the stored key.
export async function saveSettings(
  db: DbClient,
  workspaceId: string,
  data: { apiKey?: string; apiVersion?: string },
) {
  const existing = await mayarRepo.getSettings(db, workspaceId);
  if (existing) {
    return mayarRepo.upsertSettings(db, workspaceId, data);
  }
  return mayarRepo.createSettings(db, workspaceId, {
    apiKey: data.apiKey ?? "",
    apiVersion: data.apiVersion ?? "v1",
  });
}

export async function listTransactions(
  db: DbClient,
  workspaceId: string,
  options?: { status?: string; limit?: number; offset?: number },
) {
  const rows = await mayarRepo.listByWorkspace(db, workspaceId, options);
  const total = await mayarRepo.countByWorkspace(db, workspaceId, options?.status);
  return { rows, total };
}

export async function getRevenueSummary(db: DbClient, workspaceId: string) {
  const [totalRow] = await db
    .select({ total: sql<number>`coalesce(sum(amount), 0)` })
    .from(schema.mayarTransactions)
    .where(eq(schema.mayarTransactions.workspaceId, workspaceId));

  const [paidRow] = await db
    .select({ total: sql<number>`coalesce(sum(amount), 0)` })
    .from(schema.mayarTransactions)
    .where(
      and(
        eq(schema.mayarTransactions.workspaceId, workspaceId),
        eq(schema.mayarTransactions.status, "settled"),
      ),
    );

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mayarTransactions)
    .where(eq(schema.mayarTransactions.workspaceId, workspaceId));

  const [paidCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.mayarTransactions)
    .where(
      and(
        eq(schema.mayarTransactions.workspaceId, workspaceId),
        eq(schema.mayarTransactions.status, "settled"),
      ),
    );

  return {
    totalRevenue: Number(totalRow?.total ?? 0),
    paidRevenue: Number(paidRow?.total ?? 0),
    totalTransactions: Number(countRow?.count ?? 0),
    paidTransactions: Number(paidCountRow?.count ?? 0),
  };
}

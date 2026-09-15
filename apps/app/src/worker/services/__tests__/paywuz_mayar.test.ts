import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/paywuz", () => ({
  getSettings: vi.fn(),
  createSettings: vi.fn(),
  upsertSettings: vi.fn(),
  upsertTransaction: vi.fn(),
  listByWorkspace: vi.fn(),
  countByWorkspace: vi.fn(),
  findByOrderId: vi.fn(),
  removeByOrderId: vi.fn(),
}));

vi.mock("../../repositories/mayar", () => ({
  getSettings: vi.fn(),
  createSettings: vi.fn(),
  upsertSettings: vi.fn(),
  upsertTransaction: vi.fn(),
  listByWorkspace: vi.fn(),
  countByWorkspace: vi.fn(),
  findByMayarId: vi.fn(),
  removeByMayarId: vi.fn(),
}));

import * as paywuzRepo from "../../repositories/paywuz";
import * as mayarRepo from "../../repositories/mayar";
import * as paywuzService from "../paywuz";
import * as mayarService from "../mayar";

const paywuzUpsert = vi.mocked(paywuzRepo.upsertTransaction);
const mayarUpsert = vi.mocked(mayarRepo.upsertTransaction);
const mayarUpsertSettings = vi.mocked(mayarRepo.upsertSettings);

const db = {} as never;

// Minimal fetch mock: the services only read status + json body.
function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("paywuz syncTransaction", () => {
  it("maps the API payload into the stored transaction row", async () => {
    const apiTx = {
      id: "txn-1",
      orderId: "INV-001",
      transactionId: "tx-uuid",
      status: "success",
      amount: 50000,
      totalPayment: 50640,
      fee: 640,
      paymentMethod: "QRIS",
      paymentNumber: "00020101",
      paymentUrl: "https://paywuz.id/pay/INV-001",
      expiredAt: "2026-09-16T00:00:00.000Z",
      createdAt: "2026-09-15T00:00:00.000Z",
      paidAt: "2026-09-15T01:00:00.000Z",
    };
    vi.stubGlobal("fetch", mockFetch(200, { data: apiTx }));
    paywuzUpsert.mockResolvedValue({
      workspaceId: "ws-1",
      ...apiTx,
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z",
      metadata: null,
    } as never);

    const result = await paywuzService.syncTransaction(db, "ws-1", "pk_live_abc", "INV-001");

    // Authorization travels as a Bearer project key.
    expect(fetch).toHaveBeenCalledWith(
      "https://api.paywuz.id/v1/transactions/INV-001",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer pk_live_abc" }),
      }),
    );
    // The revenue-bearing fields are what get persisted.
    expect(paywuzUpsert).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        workspaceId: "ws-1",
        orderId: "INV-001",
        status: "success",
        amount: 50000,
        totalPayment: 50640,
        fee: 640,
        paidAt: "2026-09-15T01:00:00.000Z",
      }),
    );
    expect(result).toMatchObject({ orderId: "INV-001", status: "success", amount: 50000 });
  });

  it("404s when Paywuz answers without data (unknown order)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(200, { error: "not_found", message: "order tidak ditemukan" }),
    );
    await expect(
      paywuzService.syncTransaction(db, "ws-1", "pk_live_abc", "MISSING"),
    ).rejects.toMatchObject({ status: 404 });
    expect(paywuzUpsert).not.toHaveBeenCalled();
  });

  it("surfaces upstream HTTP failures", async () => {
    vi.stubGlobal("fetch", mockFetch(401, { error: "unauthorized" }));
    await expect(
      paywuzService.syncTransaction(db, "ws-1", "pk_live_bad", "INV-001"),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("syncAllTransactions skips failing orders instead of aborting the batch", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        call++;
        if (call === 2) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "not_found" }), { status: 200 }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                id: `txn-${call}`,
                orderId: `INV-${call}`,
                transactionId: `tx-${call}`,
                status: "success",
                amount: 1000,
                totalPayment: 1000,
                fee: 0,
                paymentMethod: "QRIS",
                paymentNumber: null,
                paymentUrl: null,
                expiredAt: null,
                createdAt: "2026-09-15T00:00:00.000Z",
                paidAt: "2026-09-15T00:00:00.000Z",
              },
            }),
            { status: 200 },
          ),
        );
      }),
    );
    paywuzUpsert.mockImplementation(async (_db, data) => ({ ...data }) as never);

    const results = await paywuzService.syncAllTransactions(db, "ws-1", "pk_live_abc", [
      "INV-1",
      "INV-2",
      "INV-3",
    ]);

    expect(results.map((r) => r.orderId)).toEqual(["INV-1", "INV-3"]);
    expect(paywuzUpsert).toHaveBeenCalledTimes(2);
  });
});

describe("mayar syncPaidTransactions", () => {
  it("stores each paid transaction, serializes fees, stamps lastSyncedAt", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(200, {
        statusCode: 200,
        messages: "success",
        hasMore: false,
        pageCount: 1,
        pageSize: 10,
        page: 1,
        data: [
          {
            id: "mayar-txn-1",
            credit: 1059,
            status: "settled",
            balanceHistoryType: "digital_product",
            paymentMethod: "QRIS",
            customerId: "cust-1",
            createdAt: 1755012459984,
            paymentLinkTransactionId: "plt-1",
            fee: [
              { id: "f1", balanceHistoryType: "xendit_fee", debit: 6 },
              { id: "f2", balanceHistoryType: "mayar_fee", debit: 53 },
            ],
            paymentLinkId: "pl-1",
            subscriptionId: null,
            customer: { id: "cust-1", name: "Budi", email: "budi@example.com", mobile: "0812" },
            paymentLink: { id: "pl-1", name: "Produk Digital" },
          },
        ],
      }),
    );
    mayarUpsert.mockResolvedValue({ id: "row-1" } as never);

    const result = await mayarService.syncPaidTransactions(db, "ws-1", "sk_mayar", "v1");

    expect(fetch).toHaveBeenCalledWith(
      "https://api.mayar.id/hl/v1/transactions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_mayar" }),
      }),
    );
    expect(mayarUpsert).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        workspaceId: "ws-1",
        mayarTransactionId: "mayar-txn-1",
        status: "settled",
        credit: 1059,
        amount: 1059,
        customerName: "Budi",
        customerEmail: "budi@example.com",
        paymentLinkName: "Produk Digital",
        // Fee array survives as JSON so per-fee breakdown stays queryable.
        fee: JSON.stringify([
          { id: "f1", balanceHistoryType: "xendit_fee", debit: 6 },
          { id: "f2", balanceHistoryType: "mayar_fee", debit: 53 },
        ]),
      }),
    );
    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(mayarUpsertSettings).toHaveBeenCalledWith(db, "ws-1", {
      lastSyncedAt: expect.any(String),
    });
  });

  it("counts rows that fail to persist without aborting the run", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(200, {
        statusCode: 200,
        messages: "success",
        hasMore: false,
        pageCount: 1,
        pageSize: 10,
        page: 1,
        data: [
          {
            id: "ok-1",
            credit: 100,
            status: "settled",
            fee: [],
            customer: null,
            paymentLink: null,
          },
          {
            id: "bad-1",
            credit: 200,
            status: "settled",
            fee: [],
            customer: null,
            paymentLink: null,
          },
        ],
      }),
    );
    mayarUpsert
      .mockResolvedValueOnce({ id: "row-1" } as never)
      .mockRejectedValueOnce(new Error("db write failed"));

    const result = await mayarService.syncPaidTransactions(db, "ws-1", "sk_mayar", "v2");

    expect(result).toEqual({ synced: 1, failed: 1 });
    // V2 base URL honored.
    expect(fetch).toHaveBeenCalledWith(
      "https://api.mayar.id/hl/v2/transactions",
      expect.anything(),
    );
  });
});

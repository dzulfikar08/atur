import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/deals", () => ({
  aggregateByStageCurrency: vi.fn(),
  aggregateTerminalSince: vi.fn(),
}));

import { pipelineStats } from "../crm";
import * as dealsRepo from "../../repositories/deals";

const aggregateByStageCurrency = vi.mocked(dealsRepo.aggregateByStageCurrency);
const aggregateTerminalSince = vi.mocked(dealsRepo.aggregateTerminalSince);

const db = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pipelineStats", () => {
  it("buckets open per currency, excludes terminal groups, and keeps null group open", async () => {
    aggregateByStageCurrency.mockResolvedValue([
      { stateId: "s1", stateGroup: "started", currency: "USD", totalCents: 100000, count: 2 },
      { stateId: "s1", stateGroup: "started", currency: "IDR", totalCents: 500000, count: 1 },
      { stateId: "s2", stateGroup: "completed", currency: "USD", totalCents: 250000, count: 1 },
      { stateId: "s3", stateGroup: "cancelled", currency: "USD", totalCents: 10000, count: 1 },
      // No state (null group) still counts as open.
      { stateId: null, stateGroup: null, currency: "USD", totalCents: 50000, count: 1 },
    ] as any);
    aggregateTerminalSince.mockImplementation(async (_db, _p, group) =>
      group === "completed"
        ? [{ currency: "USD", totalCents: 250000, count: 1 }]
        : [{ currency: "USD", totalCents: 10000, count: 1 }],
    );

    const stats = await pipelineStats(db, "p1");

    expect(stats.by_stage).toHaveLength(5);
    expect(stats.by_stage[0]).toEqual({
      state_id: "s1",
      currency: "USD",
      total_cents: 100000,
      count: 2,
    });

    // Open: USD = 100000 (started) + 50000 (null state) — won/lost excluded.
    expect(stats.totals.open).toEqual([
      { currency: "USD", total_cents: 150000, count: 3 },
      { currency: "IDR", total_cents: 500000, count: 1 },
    ]);
    expect(stats.totals.won_this_month).toEqual([
      { currency: "USD", total_cents: 250000, count: 1 },
    ]);
    expect(stats.totals.lost).toEqual([{ currency: "USD", total_cents: 10000, count: 1 }]);

    // "Won this month" uses a start-of-UTC-month cutoff; lost is all-time.
    expect(aggregateTerminalSince).toHaveBeenCalledWith(db, "p1", "completed", expect.any(String));
    expect(aggregateTerminalSince).toHaveBeenCalledWith(db, "p1", "cancelled", "");
  });

  it("empty pipeline → empty buckets, no NaNs", async () => {
    aggregateByStageCurrency.mockResolvedValue([]);
    aggregateTerminalSince.mockResolvedValue([]);

    const stats = await pipelineStats(db, "p1");
    expect(stats).toEqual({
      by_stage: [],
      totals: { open: [], won_this_month: [], lost: [] },
    });
  });
});

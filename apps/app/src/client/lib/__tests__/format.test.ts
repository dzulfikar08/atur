import { describe, expect, it } from "vitest";
import { CURRENCIES, formatCurrencyTotals, isOpenGroup, money } from "../format";

describe("money", () => {
  it("formats cents as currency", () => {
    expect(money(125000)).toBe("$1,250.00");
    expect(money(125000, "EUR")).toContain("1,250.00");
  });

  it("falls back to a fixed-decimal number for unknown ISO codes", () => {
    expect(money(1250, "NOT_A_CODE")).toBe("NOT_A_CODE 12.50");
  });
});

describe("formatCurrencyTotals", () => {
  it("renders an em dash for empty totals", () => {
    expect(formatCurrencyTotals([])).toBe("—");
  });

  it("single currency renders one amount", () => {
    expect(formatCurrencyTotals([{ currency: "USD", total_cents: 120000 }])).toBe("$1,200.00");
  });

  it("multiple currencies never cross-sum — one amount per currency, joined", () => {
    const out = formatCurrencyTotals([
      { currency: "USD", total_cents: 120000 },
      { currency: "IDR", total_cents: 5400000 },
    ]);
    const parts = out.split(" · ");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("$1,200.00");
    // en-US renders IDR code-style ("IDR 54,000") — no cross-sum, separate entry.
    expect(parts[1]).toContain("54,000");
  });
});

describe("isOpenGroup", () => {
  it("terminal groups are closed", () => {
    expect(isOpenGroup("completed")).toBe(false);
    expect(isOpenGroup("cancelled")).toBe(false);
  });

  it("backlog/started/null are open", () => {
    expect(isOpenGroup("backlog")).toBe(true);
    expect(isOpenGroup("started")).toBe(true);
    expect(isOpenGroup(null)).toBe(true);
    expect(isOpenGroup(undefined)).toBe(true);
  });
});

describe("CURRENCIES", () => {
  it("is a non-empty unique list of 3-letter codes", () => {
    expect(CURRENCIES.length).toBeGreaterThan(5);
    expect(new Set(CURRENCIES).size).toBe(CURRENCIES.length);
    for (const c of CURRENCIES) expect(c).toMatch(/^[A-Z]{3}$/);
  });
});

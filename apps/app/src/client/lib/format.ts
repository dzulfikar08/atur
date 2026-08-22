// Shared money/currency helpers for the CRM UI. Currencies are never
// cross-summed — mixed totals render as separate amounts.

export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "IDR",
  "SGD",
  "AUD",
  "CAD",
  "CHF",
  "INR",
  "AED",
  "CNY",
  "KRW",
  "BRL",
  "MYR",
] as const;

export function money(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    // Unknown ISO code — Intl throws; degrade to a fixed-decimal number.
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export interface CurrencyTotal {
  currency: string;
  total_cents: number;
  count?: number;
}

// Single currency → one amount; multiple → "USD $1,200 · IDR Rp 5.400.000".
export function formatCurrencyTotals(totals: CurrencyTotal[]): string {
  if (!totals.length) return "—";
  return totals.map((t) => money(t.total_cents, t.currency)).join(" · ");
}

// Terminal state groups — deals there are closed (Won/Lost).
export function isOpenGroup(group?: string | null): boolean {
  return group !== "completed" && group !== "cancelled";
}

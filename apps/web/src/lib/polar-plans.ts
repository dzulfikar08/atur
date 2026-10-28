// Atur Cloud plan prices, read from Polar when the site builds.
//
// With POLAR_ACCESS_TOKEN set (an organization access token with products:read
// for joyo-digitama-solusi), the build fetches both products, fails if either
// is archived or no longer a single monthly USD price, and refreshes
// src/data/polar-plans.json. Without a token (CI, forks) it uses that snapshot,
// so the committed file is always what the last real build saw.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type PlanKey = "solo" | "team";

export interface Plan {
  productId: string;
  name: string;
  amount: number; // smallest currency unit
  currency: string;
  interval: string;
}

const PRODUCT_IDS: Record<PlanKey, string> = {
  solo: "c86b15e8-e91b-464e-a6d0-e5d3f70d7b83",
  team: "ddd252b0-6cf2-4a91-8757-2fd057f8bf51",
};

// Resolved from the app root (astro build runs in apps/web); import.meta.url
// points into the bundle at build time.
const SNAPSHOT = resolve("src/data/polar-plans.json");

interface PolarPrice {
  amount_type: string;
  price_amount?: number;
  price_currency: string;
  is_archived: boolean;
}
interface PolarProduct {
  id: string;
  name: string;
  is_archived: boolean;
  recurring_interval: string | null;
  prices: PolarPrice[];
}

async function fetchPlan(token: string, key: PlanKey): Promise<Plan> {
  const id = PRODUCT_IDS[key];
  const res = await fetch(`https://api.polar.sh/v1/products/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Polar product ${key} (${id}): HTTP ${res.status}`);
  const p = (await res.json()) as PolarProduct;
  const prices = p.prices.filter((x) => !x.is_archived);
  const price = prices[0];
  if (
    p.is_archived ||
    p.recurring_interval !== "month" ||
    prices.length !== 1 ||
    price.amount_type !== "fixed" ||
    price.price_currency !== "usd" ||
    typeof price.price_amount !== "number"
  ) {
    throw new Error(
      `Polar product ${key} (${id}) is no longer one active monthly USD price; update the site before deploying.`,
    );
  }
  return {
    productId: id,
    name: p.name,
    amount: price.price_amount,
    currency: "usd",
    interval: "month",
  };
}

async function loadPlans(): Promise<Record<PlanKey, Plan>> {
  // apps/web/.env (gitignored) or the shell environment.
  const token = import.meta.env?.POLAR_ACCESS_TOKEN ?? process.env.POLAR_ACCESS_TOKEN;
  const snapshot = await readFile(SNAPSHOT, "utf8");
  if (!token) {
    console.warn("[polar-plans] POLAR_ACCESS_TOKEN not set: using src/data/polar-plans.json");
    return JSON.parse(snapshot);
  }
  const plans = { solo: await fetchPlan(token, "solo"), team: await fetchPlan(token, "team") };
  const fresh = `${JSON.stringify(plans, null, 2)}\n`;
  if (fresh !== snapshot) {
    await writeFile(SNAPSHOT, fresh);
    console.warn(
      "[polar-plans] prices changed in Polar: refreshed src/data/polar-plans.json, commit it",
    );
  }
  return plans;
}

export const PLANS = await loadPlans();

/** "$9" for whole amounts, "$9.50" otherwise. */
export const formatPrice = (plan: Plan) =>
  `$${plan.amount % 100 === 0 ? plan.amount / 100 : (plan.amount / 100).toFixed(2)}`;

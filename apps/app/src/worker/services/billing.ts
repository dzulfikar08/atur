// Atur Cloud plans (Solo $9 / Team $29) unlock the iOS/Android store app.
// Polar owns payment; this module mirrors subscription webhooks into
// billing_subscriptions and derives entitlement from them.
import type { DbClient } from "../db/index";
import type { Env } from "../lib/env";
import { nowISO } from "../lib/pagination";
import type { PolarEvent } from "../lib/polar";
import * as repo from "../repositories/billing";

export type Plan = "solo" | "team";

export interface Billing {
  plan: Plan | null;
  status: string | null;
  entitled: boolean;
  managed: boolean;
}

export const BILLING_EVENT_TYPES = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.revoked",
  "subscription.past_due",
]);

export type ApplyResult = "ignored" | "stale" | "applied";

type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose => (v && typeof v === "object" ? (v as Loose) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Map a Polar subscription payload to a row; null when it isn't an Atur plan. */
export function mapSubscription(data: unknown) {
  const sub = obj(data);
  const product = obj(sub.product);
  const meta = obj(product.metadata);
  const plan = str(meta.plan);
  if (meta.app !== "atur" || (plan !== "solo" && plan !== "team")) return null;
  const id = str(sub.id);
  const status = str(sub.status);
  const customer = obj(sub.customer);
  if (!id || !status) return null;
  return {
    polarSubscriptionId: id,
    plan: plan as Plan,
    status,
    customerEmail: str(customer.email) ?? "",
    customerExternalId: str(customer.external_id),
    referenceId: str(obj(sub.metadata).reference_id),
    currentPeriodEnd: str(sub.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0,
    modifiedAt: str(sub.modified_at) ?? str(sub.created_at),
  };
}

async function resolveUserId(
  db: DbClient,
  m: { referenceId: string | null; customerExternalId: string | null; customerEmail: string },
): Promise<string | null> {
  for (const candidate of [m.referenceId, m.customerExternalId]) {
    if (candidate && (await repo.userExists(db, candidate))) return candidate;
  }
  return m.customerEmail ? repo.findUserIdByEmail(db, m.customerEmail) : null;
}

/** Idempotent and out-of-order safe: an event older than the stored one is dropped. */
export async function applySubscriptionEvent(
  db: DbClient,
  event: PolarEvent,
): Promise<ApplyResult> {
  if (!BILLING_EVENT_TYPES.has(event.type)) return "ignored";
  const m = mapSubscription(event.data);
  if (!m) return "ignored";

  const existing = await repo.findById(db, m.polarSubscriptionId);
  if (
    existing?.modifiedAt &&
    m.modifiedAt &&
    Date.parse(m.modifiedAt) < Date.parse(existing.modifiedAt)
  ) {
    return "stale";
  }

  const userId = (await resolveUserId(db, m)) ?? existing?.userId ?? null;
  const now = nowISO();
  await repo.upsert(db, {
    polarSubscriptionId: m.polarSubscriptionId,
    userId,
    customerEmail: m.customerEmail,
    customerExternalId: m.customerExternalId,
    plan: m.plan,
    status: m.status,
    currentPeriodEnd: m.currentPeriodEnd,
    cancelAtPeriodEnd: m.cancelAtPeriodEnd,
    modifiedAt: m.modifiedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  return "applied";
}

type SubState = Pick<
  repo.BillingSubscriptionRow,
  "status" | "currentPeriodEnd" | "cancelAtPeriodEnd"
>;

export function subscriptionGrantsAccess(sub: SubState, now = Date.now()): boolean {
  if (sub.status === "active" || sub.status === "trialing") return true;
  return (
    sub.status === "canceled" &&
    !!sub.cancelAtPeriodEnd &&
    !!sub.currentPeriodEnd &&
    Date.parse(sub.currentPeriodEnd) > now
  );
}

// Better plan first, then entitled before not.
const rank = (s: repo.BillingSubscriptionRow) =>
  (subscriptionGrantsAccess(s) ? 2 : 0) + (s.plan === "team" ? 1 : 0);

export async function billingFor(
  db: DbClient,
  env: Pick<Env, "ATUR_BILLING_WEBHOOK_SECRET">,
  user: { id: string; email: string; isSuperuser?: boolean | number | null },
): Promise<Billing> {
  if (!env.ATUR_BILLING_WEBHOOK_SECRET) {
    return { plan: null, status: null, entitled: true, managed: false };
  }
  const own = (await repo.listForUser(db, user.id, user.email)).sort((a, b) => rank(b) - rank(a));
  const best = own[0] ?? null;
  const base = {
    plan: (best?.plan as Plan | undefined) ?? null,
    status: best?.status ?? null,
    managed: true,
  };

  if (user.isSuperuser) return { ...base, entitled: true };
  if (own.some((s) => subscriptionGrantsAccess(s))) return { ...base, entitled: true };

  const owners = (await repo.workspaceOwnersForMember(db, user.id)).filter((o) => o.id !== user.id);
  if (owners.length) {
    const team = await repo.listTeamForOwners(db, owners);
    if (team.some((s) => subscriptionGrantsAccess(s))) return { ...base, entitled: true };
  }
  return { ...base, entitled: false };
}

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { waitlist } from "../db/schema";
import { nowISO } from "../lib/pagination";
import { verifyWebhookEvent } from "../lib/polar";
import { rateLimit } from "../lib/rateLimit";
import * as billingService from "../services/billing";

// Public Polar webhook receiver for Atur Cloud plans. Mounted at
// /webhooks/atur-billing, outside the /api auth gate: the signature is the credential.
export const billingWebhookRoutes = new Hono<{ Bindings: Env }>({ strict: false }).post(
  "/",
  async (c) => {
    const secret = c.env.ATUR_BILLING_WEBHOOK_SECRET;
    if (!secret) throw new HTTPException(503, { message: "Billing is not configured" });

    const raw = await c.req.text();
    let event;
    try {
      event = await verifyWebhookEvent(secret, raw, c.req.header());
    } catch {
      throw new HTTPException(403, { message: "Invalid signature" });
    }

    const result = await billingService.applySubscriptionEvent(getDb(c.env.DB), event);
    // Other Polar products (and other event types) share the org: acknowledge, don't process.
    if (result === "ignored") return c.json({ ok: true, ignored: true }, 202);
    return c.json({ ok: true, result });
  },
);

const waitlistSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  plan: z.enum(["solo", "team"]).optional(),
  source: z.string().trim().max(64).optional(),
});

// Public waitlist signup (diatur.com pricing and the /billing page) while paid
// checkout is closed. Upsert by email so repeat signups only refresh the row.
export const waitlistRoutes = new Hono<{ Bindings: Env }>({ strict: false }).post(
  "/",
  async (c) => {
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    if (!(await rateLimit(c.env, `waitlist:${ip}`, 5, 60))) {
      throw new HTTPException(429, { message: "Too many requests" });
    }
    const parsed = waitlistSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "A valid email is required" });
    const { email, plan, source } = parsed.data;
    const now = nowISO();
    await getDb(c.env.DB)
      .insert(waitlist)
      .values({ email, plan: plan ?? null, source: source ?? null, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: waitlist.email,
        set: { plan: plan ?? null, source: source ?? null, updatedAt: now },
      });
    return c.json({ ok: true });
  },
);

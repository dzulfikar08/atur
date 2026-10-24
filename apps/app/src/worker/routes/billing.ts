import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { verifyWebhookEvent } from "../lib/polar";
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

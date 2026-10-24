import type { Context, Next } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as usersRepo from "../repositories/users";
import * as billingService from "../services/billing";

// Endpoints a signed-in but unentitled native client still needs: reading its
// own profile/plan, deleting the account, and unregistering its push token on
// sign-out. (/auth/sign-out lives outside /api and is never gated.)
function isExempt(method: string, path: string): boolean {
  const p = path.replace(/\/+$/, "");
  if (p === "/api/users/me" && (method === "GET" || method === "DELETE")) return true;
  if (p === "/api/me/push-tokens" && method === "DELETE") return true;
  return false;
}

/**
 * The store app only works with a paid Atur Cloud plan. The web SPA and API-key
 * clients (no `X-Atur-Client: native` header) are never gated. Runs after
 * authMiddleware; entitlement is computed once per request.
 */
export async function requirePlanForNative(c: Context<{ Bindings: Env }>, next: Next) {
  if (c.req.header("x-atur-client")?.toLowerCase() !== "native") return next();
  if (isExempt(c.req.method, c.req.path)) return next();
  const db = getDb(c.env.DB);
  // Ticket-authed WS upgrades skip authMiddleware, so there may be no user here.
  const auth = c.get("user");
  if (!auth) return next();
  const user = await usersRepo.findById(db, auth.sub);
  if (!user) return next();
  const billing = await billingService.billingFor(db, c.env, user);
  if (!billing.entitled) return c.json({ error: "plan_required" }, 402);
  return next();
}

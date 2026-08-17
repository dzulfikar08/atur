import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as customersRepo from "../repositories/customers";
import * as portalService from "../services/portal";

declare module "hono" {
  interface ContextVariableMap {
    customer: portalService.PortalCustomer;
  }
}

export const PORTAL_COOKIE = "portal-session";
const PORTAL_MAX_AGE = 7 * 24 * 60 * 60;

function isHttps(c: Context<{ Bindings: Env }>): boolean {
  return c.req.url.startsWith("https://");
}

export function setPortalCookie(c: Context<{ Bindings: Env }>, token: string) {
  setCookie(c, PORTAL_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Strict",
    path: "/",
    maxAge: PORTAL_MAX_AGE,
  });
}

export function clearPortalCookie(c: Context<{ Bindings: Env }>) {
  setCookie(c, PORTAL_COOKIE, "", {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Strict",
    path: "/",
    maxAge: 0,
  });
}

// Portal sessions live in customers.session_token — isolated from the main
// app's users.token, so a portal customer cannot reach /api/*.
export async function portalAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const token = getCookie(c, PORTAL_COOKIE);
  if (!token) {
    throw new HTTPException(401, { message: "Not signed in to the portal" });
  }
  const db = getDb(c.env.DB);
  const row = await customersRepo.findBySessionToken(db, token);
  if (!row) {
    throw new HTTPException(401, { message: "Invalid or expired portal session" });
  }
  c.set("customer", portalService.toPortalCustomer(row));
  await next();
}

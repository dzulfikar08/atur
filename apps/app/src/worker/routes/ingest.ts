import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { rateLimit } from "../lib/rateLimit";
import { parseOr400, publicJsonError } from "../lib/validate";
import * as ingest from "../services/ingest";

// POST /api/ingest/:ingestKey — log/error ingest for servers and error loggers.
// The per-project key in the path is the credential (no session). Mounted before
// the global /api/* auth gate in app.ts.
export const ingestRoutes = new Hono<{ Bindings: Env }>({ strict: false });
ingestRoutes.onError(publicJsonError);

ingestRoutes.post("/", async (c) => {
  const key = c.req.param("ingestKey")!;
  // Per key, not per IP: loggers share egress IPs and a runaway loop on one
  // service must not starve (or be starved by) other projects.
  const ok = await rateLimit(c.env, `ingest:${key}`, 120, 60);
  if (!ok) return c.json({ message: "Rate limit exceeded" }, 429);
  const body = parseOr400(ingest.ingestSchema, await c.req.json().catch(() => undefined));
  return c.json(await ingest.ingest(getDb(c.env.DB), key, body));
});

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { paginationParams, paginatedResponse } from "../lib/pagination";
import { parseOr400 } from "../lib/validate";
import { resolveWorkspaceForCaller } from "../middleware/workspace";
import * as threadsService from "../services/threads";

// CRM Threads inbox. Mounted under /api/workspaces/:slug/threads (session
// gated); each handler resolves the caller's workspace membership.
export const threadsRoutes = new Hono<{ Bindings: Env }>({ strict: false });

const origin = (url: string) => new URL(url).origin;

threadsRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const account = await threadsService.getAccount(db, ws.id);
  return c.json({
    configured: !!c.env.THREADS_APP_ID && !!c.env.THREADS_APP_SECRET,
    account: threadsService.publicAccount(account),
  });
});

threadsRoutes.get("/connect-url", async (c) => {
  const ws = await resolveWorkspaceForCaller(c);
  const url = await threadsService.connectUrl(c.env, origin(c.req.url), ws.slug, c.get("user").sub);
  return c.json({ url });
});

threadsRoutes.post("/connect", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const body = parseOr400(threadsService.connectSchema, await c.req.json());
  const slug = await threadsService.verifyState(
    c.env.THREADS_APP_SECRET ?? "",
    body.state,
    c.get("user").sub,
  );
  if (slug !== ws.slug) {
    throw new HTTPException(400, { message: "Connect link expired or belongs to someone else" });
  }
  const account = await threadsService.connect(
    db,
    c.env,
    origin(c.req.url),
    ws.id,
    c.get("user").sub,
    body.code,
  );
  return c.json({ account: threadsService.publicAccount(account) });
});

threadsRoutes.delete("/account", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  await threadsService.disconnect(db, ws.id);
  return c.body(null, 204);
});

threadsRoutes.post("/sync", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const account = await threadsService.getAccount(db, ws.id);
  if (!account) throw new HTTPException(409, { message: "Connect a Threads account first" });
  const inserted = await threadsService.syncAccount(db, account);
  return c.json({ inserted });
});

threadsRoutes.get("/inbox", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const { offset, limit } = paginationParams(c);
  const { rows, total } = await threadsService.listInbox(db, ws.id, {
    status: c.req.query("status"),
    replied:
      c.req.query("replied") === "yes" ? "yes" : c.req.query("replied") === "no" ? "no" : undefined,
    offset,
    limit,
  });
  return c.json(paginatedResponse(rows, total, offset, limit));
});

threadsRoutes.post("/inbox/:id/reply", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const body = parseOr400(threadsService.replySchema, await c.req.json());
  const item = await threadsService.reply(
    db,
    ws.id,
    c.req.param("id")!,
    c.get("user").sub,
    body.text,
  );
  return c.json(item);
});

threadsRoutes.post("/inbox/:id/lead", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const item = await threadsService.makeLead(db, ws.id, c.req.param("id")!, c.get("user").sub);
  return c.json(item);
});

threadsRoutes.post("/inbox/:id/hide", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  return c.json(await threadsService.hide(db, ws.id, c.req.param("id")!));
});

threadsRoutes.patch("/inbox/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const body = parseOr400(threadsService.statusSchema, await c.req.json());
  return c.json(await threadsService.setStatus(db, ws.id, c.req.param("id")!, body.status));
});

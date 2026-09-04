import { Hono } from "hono";
import type { ExecutionContext } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Env } from "../lib/env";
import { getDb, type DbClient } from "../db/index";
import * as schema from "../db/schema";
import { isWorkspaceMember } from "../repositories/members";

// Herdr execution-plane proxy (ATUR-2). The bridge daemon (apps/bridge) runs
// on the dev box and owns the real terminal panes; these routes relay its JSON
// list and WebSocket protocol to authenticated Atur users. Frames are piped
// verbatim in both directions — the Worker never parses pane traffic.
//
// Per-pane authz (DEV-32): a pane binds to the Atur workspace whose
// workspace_links.local_path contains the pane's cwd (git worktrees resolve
// to their main repo via the bridge, so crew panes inherit the repo's
// binding). Observers must be members of that workspace; unbound panes are
// not observable.
export const paneRoutes = new Hono<{ Bindings: Env }>({ strict: false });

interface BridgePane {
  pane_id: string;
  cwd: string | null;
}

async function fetchBridgePanes(
  env: Env,
): Promise<{ ok: true; panes: BridgePane[] } | { ok: false }> {
  const base = bridgeBase(env);
  if (!base) return { ok: false };
  let res: Response;
  try {
    res = await fetch(`${base}/panes`, { headers: bridgeHeaders(env) });
  } catch {
    return { ok: false };
  }
  if (!res.ok) return { ok: false };
  const body = (await res.json()) as { panes?: BridgePane[] };
  return { ok: true, panes: body.panes ?? [] };
}

// The Atur workspace slug whose bound checkout contains `cwd`, or null.
function matchWorkspaceSlug(
  links: { workspaceSlug: string; localPath: string | null }[],
  cwd: string,
): string | null {
  // Longest path wins so /repos/x wins over /repos when both are bound.
  let best: { slug: string; len: number } | null = null;
  for (const link of links) {
    const base = link.localPath?.replace(/\/+$/, "");
    if (!base) continue;
    if (cwd === base || cwd.startsWith(`${base}/`)) {
      if (!best || base.length > best.len) best = { slug: link.workspaceSlug, len: base.length };
    }
  }
  return best?.slug ?? null;
}

// Resolve a bridge pane to its Atur workspace slug (see header comment) or
// null when unbound/bridge-down.
async function paneWorkspaceSlug(
  db: DbClient,
  env: Env,
  paneId: string,
): Promise<string | null> {
  const bridge = await fetchBridgePanes(env);
  if (!bridge.ok) return null;
  const pane = bridge.panes.find((p) => p.pane_id === paneId);
  if (!pane) return null;

  const links = await db
    .select({ workspaceSlug: schema.workspaceLinks.workspaceSlug, localPath: schema.workspaceLinks.localPath })
    .from(schema.workspaceLinks);
  const byCwd = pane.cwd ? matchWorkspaceSlug(links, pane.cwd) : null;
  if (byCwd) return byCwd;

  // Worktree fallback: ask the bridge for the pane's main repository and
  // match against that (crew worktrees live outside the bound checkout).
  const base = bridgeBase(env);
  if (!base) return null;
  try {
    const res = await fetch(
      `${base}/pane-repo?pane=${encodeURIComponent(paneId)}`,
      { headers: bridgeHeaders(env) },
    );
    if (!res.ok) return null;
    const { path } = (await res.json()) as { path?: string | null };
    return path ? matchWorkspaceSlug(links, path) : null;
  } catch {
    return null;
  }
}

// Base URL without a trailing slash so `${base}/panes` never doubles up.
function bridgeBase(env: Env): string | null {
  const raw = env.HERDR_BRIDGE_URL;
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

// Optional shared secret; the bridge validates x-bridge-token when configured.
function bridgeHeaders(env: Env): Headers {
  const headers = new Headers();
  if (env.HERDR_BRIDGE_TOKEN) headers.set("x-bridge-token", env.HERDR_BRIDGE_TOKEN);
  return headers;
}

paneRoutes.get("/", async (c) => {
  const bridge = await fetchBridgePanes(c.env);
  if (!bridge.ok) return c.json({ error: "execution plane unreachable" }, 502);
  // Info-surface trim: only panes bound to workspaces the viewer belongs to.
  // herdr's pane.list ignores the workspace filter, so the bridge multiplies
  // panes once per workspace — dedupe by id.
  const db = getDb(c.env.DB);
  const user = c.get("user");
  const links = await db
    .select({ workspaceSlug: schema.workspaceLinks.workspaceSlug, localPath: schema.workspaceLinks.localPath })
    .from(schema.workspaceLinks);
  const seen = new Set<string>();
  const visible: BridgePane[] = [];
  const slugCache = new Map<string, boolean>();
  for (const pane of bridge.panes) {
    if (seen.has(pane.pane_id)) continue;
    seen.add(pane.pane_id);
    const slug = pane.cwd ? matchWorkspaceSlug(links, pane.cwd) : null;
    if (!slug) continue;
    let member = slugCache.get(slug);
    if (member === undefined) {
      member = await isMemberOfSlug(db, slug, user.sub);
      slugCache.set(slug, member);
    }
    if (member) visible.push(pane);
  }
  return c.json({ panes: visible });
});

// Workspace slug → membership check (slug is the binding key; membership is
// workspace-id scoped, so resolve through the workspaces table).
async function isMemberOfSlug(
  db: DbClient,
  slug: string,
  userId: string,
): Promise<boolean> {
  const [ws] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug))
    .limit(1);
  if (!ws) return false;
  return isWorkspaceMember(db, ws.id, userId);
}

paneRoutes.get("/attach", async (c) => {
  const pane = c.req.query("pane");
  if (!pane) throw new HTTPException(400, { message: "pane is required" });
  // The relay below answers with a WebSocket; without an upgrade request
  // (e.g. a stray curl) workerd would reject the 101 as a 500 — be explicit.
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    throw new HTTPException(426, { message: "websocket upgrade required" });
  }
  const user = c.get("user");

  // Per-pane authz (DEV-32) before any upgrade: the viewer must be a member
  // of the workspace the pane is bound to. Unbound panes are not observable.
  const db = getDb(c.env.DB);
  const slug = await paneWorkspaceSlug(db, c.env, pane);
  if (!slug) {
    throw new HTTPException(403, {
      message: "pane is not bound to an atur workspace",
    });
  }
  if (!(await isMemberOfSlug(db, slug, user.sub))) {
    throw new HTTPException(403, {
      message: "not a member of the pane's workspace",
    });
  }

  const base = bridgeBase(c.env);
  if (!base) return c.json({ error: "execution plane unreachable" }, 502);
  const headers = bridgeHeaders(c.env);
  headers.set("Upgrade", "websocket");
  let upgrade: Response;
  try {
    upgrade = await fetch(`${base}/attach?pane=${encodeURIComponent(pane)}`, { headers });
  } catch {
    return c.json({ error: "execution plane unreachable" }, 502);
  }

  // Bridge refused the upgrade (e.g. unknown pane) — surface its JSON reply.
  if (upgrade.status !== 101 || !upgrade.webSocket) {
    return new Response(upgrade.body, {
      status: upgrade.status,
      headers: { "content-type": upgrade.headers.get("content-type") ?? "application/json" },
    });
  }

  // Audit before the response so the row exists even for instant disconnects.
  const auditId = uuid();
  try {
    await db.insert(schema.paneAudit).values({
      id: auditId,
      userId: user.sub,
      paneId: pane,
      attachedAt: Date.now(),
      detachedAt: null,
    });
  } catch (err) {
    console.error("pane_audit insert failed:", err);
  }

  const origin = upgrade.webSocket; // bridge side
  origin.accept();

  const pair = new WebSocketPair();
  const server = pair[1]; // browser side of the relay
  server.accept();

  // Text frames only, verbatim both directions (see protocol in the issue).
  origin.addEventListener("message", (event) => {
    if (typeof event.data === "string") server.send(event.data);
  });
  server.addEventListener("message", (event) => {
    if (typeof event.data === "string") origin.send(event.data);
  });

  // Either side closing (or erroring) tears the relay down and stamps the
  // audit row. waitUntil: the execution context may end once both sockets
  // close, which would cancel a plain await.
  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    try {
      origin.close();
    } catch {
      /* already closed */
    }
    try {
      server.close();
    } catch {
      /* already closed */
    }
    let execCtx: ExecutionContext;
    try {
      execCtx = c.executionCtx;
    } catch {
      return; // no Workers execution context (unit tests) — skip the stamp
    }
    execCtx.waitUntil(
      db
        .update(schema.paneAudit)
        .set({ detachedAt: Date.now() })
        .where(eq(schema.paneAudit.id, auditId)),
    );
  };
  origin.addEventListener("close", detach);
  origin.addEventListener("error", detach);
  server.addEventListener("close", detach);
  server.addEventListener("error", detach);

  return new Response(null, { status: 101, webSocket: pair[0] });
});

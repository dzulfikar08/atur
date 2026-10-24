import { Hono } from "hono";
import type { Context, ExecutionContext } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Env } from "../lib/env";
import { getDb, type DbClient } from "../db/index";
import * as schema from "../db/schema";
import { relayStub } from "../lib/relay";
import { prefixPanes, splitPaneId } from "../lib/relayProtocol";
import type {
  RelayPane,
  RelayPaneList,
  RelayPaneMachine,
  RelayResponse,
} from "../lib/relayProtocol";
import { isWorkspaceMember, findMembership } from "../repositories/members";
import { normalizeAbsolutePath } from "../lib/panePaths";
import * as machines from "../services/bridgeMachines";

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

export interface BridgePane {
  pane_id: string;
  cwd: string | null;
  workspace_id?: string;
  workspace_label?: string;
  /** Atur workspace the pane's cwd is bound to; set by the Worker on rows it returns. */
  workspace_slug?: string;
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

// Resolve a pane (id + cwd) to its Atur workspace slug (see header comment) or
// null when unbound/bridge-down. Also used by the bridge agent-events route,
// which already knows the pane and must not re-list panes from the bridge.
export async function workspaceSlugForPane(
  db: DbClient,
  env: Env,
  pane: BridgePane,
): Promise<string | null> {
  const links = await db
    .select({
      workspaceSlug: schema.workspaceLinks.workspaceSlug,
      localPath: schema.workspaceLinks.localPath,
    })
    .from(schema.workspaceLinks);
  const byCwd = pane.cwd ? matchWorkspaceSlug(links, pane.cwd) : null;
  if (byCwd) return byCwd;

  // Worktree fallback: ask the bridge for the pane's main repository and
  // match against that (crew worktrees live outside the bound checkout).
  const base = bridgeBase(env);
  if (!base) return null;
  try {
    const res = await fetch(`${base}/pane-repo?pane=${encodeURIComponent(pane.pane_id)}`, {
      headers: bridgeHeaders(env),
    });
    if (!res.ok) return null;
    const { path } = (await res.json()) as { path?: string | null };
    return path ? matchWorkspaceSlug(links, path) : null;
  } catch {
    return null;
  }
}

async function paneWorkspaceSlug(db: DbClient, env: Env, paneId: string): Promise<string | null> {
  const bridge = await fetchBridgePanes(env);
  if (!bridge.ok) return null;
  const pane = bridge.panes.find((p) => p.pane_id === paneId);
  return pane ? workspaceSlugForPane(db, env, pane) : null;
}

// Base URL without a trailing slash so `${base}/panes` never doubles up.
export function bridgeBase(env: Env): string | null {
  const raw = env.HERDR_BRIDGE_URL;
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

// Optional shared secret; the bridge validates x-bridge-token when configured.
export function bridgeHeaders(env: Env): Headers {
  const headers = new Headers();
  if (env.HERDR_BRIDGE_TOKEN) headers.set("x-bridge-token", env.HERDR_BRIDGE_TOKEN);
  return headers;
}

// Panes of the env-configured bridge the caller may see: bound to an Atur
// workspace they belong to. Bridges that predate the pane.list fix repeat
// panes once per workspace, so dedupe by id. Null = bridge down.
async function visibleLegacyPanes(
  db: DbClient,
  env: Env,
  userId: string,
): Promise<BridgePane[] | null> {
  const bridge = await fetchBridgePanes(env);
  if (!bridge.ok) return null;
  const links = await db
    .select({
      workspaceSlug: schema.workspaceLinks.workspaceSlug,
      localPath: schema.workspaceLinks.localPath,
    })
    .from(schema.workspaceLinks);
  const visible: BridgePane[] = [];
  const seen = new Set<string>();
  const slugCache = new Map<string, boolean>();
  for (const pane of bridge.panes) {
    if (seen.has(pane.pane_id)) continue;
    seen.add(pane.pane_id);
    const slug = pane.cwd ? matchWorkspaceSlug(links, pane.cwd) : null;
    if (!slug) continue;
    let member = slugCache.get(slug);
    if (member === undefined) {
      member = await isMemberOfSlug(db, slug, userId);
      slugCache.set(slug, member);
    }
    // The bound Atur workspace travels with the row: the app shows its logo.
    if (member) visible.push({ ...pane, workspace_slug: slug });
  }
  return visible;
}

paneRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const user = c.get("user");
  const owned = await machines.listActive(db, user.sub);
  const legacy = await visibleLegacyPanes(db, c.env, user.sub);
  // The env-configured bridge being down only fails the request when the
  // caller has no relay machines to show instead.
  if (!legacy && owned.length === 0) {
    return c.json({ error: "execution plane unreachable" }, 502);
  }

  // Info-surface trim: only panes bound to workspaces the viewer belongs to.
  const visible: unknown[] = [...(legacy ?? [])];
  visible.push(...(await fetchRelayPanes(c.env, user.sub, owned)));
  return c.json({ panes: visible });
});

// Panes of the caller's own connected machines, ids namespaced `<machine>~<pane>`.
// Machine ownership is the whole authz: the relay DO is per user and the panes
// are the caller's own terminals, so no workspace binding applies. A machine
// that fails to answer is skipped, never fatal.
async function fetchRelayPanes(env: Env, userId: string, owned: machines.BridgeMachine[]) {
  const stub = owned.length > 0 ? relayStub(env, userId) : null;
  if (!stub) return [];
  let lists: RelayPaneList[];
  try {
    lists = await stub.listPanes();
  } catch (err) {
    console.error("relay pane list failed:", err);
    return [];
  }
  const byId = new Map(owned.map((m) => [m.id, m]));
  const panes: RelayPane[] = [];
  for (const { machineId, body } of lists) {
    const machine = byId.get(machineId);
    if (!machine || body === null) continue;
    try {
      const parsed = JSON.parse(body) as { panes?: unknown };
      panes.push(...prefixPanes({ id: machine.id, name: machine.name }, parsed.panes));
    } catch {
      /* malformed list from one machine: skip it */
    }
  }
  return panes;
}

// WebSocket stream (attach / observe) to a pane on a customer's machine, relayed
// through the owner's BridgeRelay DO. Frames are piped verbatim like the legacy
// path; the DO stamps the pane_audit row when the stream ends.
async function relayStream(
  c: Context<{ Bindings: Env }>,
  kind: "attach" | "observe",
  pane: string,
  target: { machineId: string; paneId: string },
): Promise<Response> {
  const user = c.get("user");
  const db = getDb(c.env.DB);
  if (!(await machines.findOwned(db, user.sub, target.machineId))) {
    throw new HTTPException(403, { message: "not one of your machines" });
  }
  const stub = relayStub(c.env, user.sub);
  if (!stub) return c.json({ error: "execution plane unreachable" }, 502);

  // Audit before the response so the row exists even for instant disconnects
  // (attach only: observe has no audit row, see the legacy /observe route).
  let auditId: string | null = null;
  if (kind === "attach") {
    auditId = uuid();
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
      auditId = null;
    }
  }

  const query = new URLSearchParams({
    machine: target.machineId,
    path: `/${kind}?pane=${encodeURIComponent(target.paneId)}`,
  });
  if (auditId) query.set("audit", auditId);
  let upgrade: Response | null = null;
  try {
    upgrade = await stub.fetch(`https://relay/client?${query}`, {
      headers: { Upgrade: "websocket" },
    });
  } catch {
    /* handled below as unreachable */
  }
  // Rewrap: a stub's Response has immutable headers that cors would trip over.
  if (upgrade?.status === 101 && upgrade.webSocket) {
    return new Response(null, { status: 101, webSocket: upgrade.webSocket });
  }

  // No stream was opened (machine offline, relay down): close the audit row.
  if (auditId) {
    await db
      .update(schema.paneAudit)
      .set({ detachedAt: Date.now() })
      .where(eq(schema.paneAudit.id, auditId))
      .catch((err: unknown) => console.error("pane_audit detach stamp failed:", err));
  }
  if (!upgrade) return c.json({ error: "execution plane unreachable" }, 502);
  return new Response(upgrade.body, {
    status: upgrade.status,
    headers: { "content-type": upgrade.headers.get("content-type") ?? "application/json" },
  });
}

// Workspace slug → membership check (slug is the binding key; membership is
// workspace-id scoped, so resolve through the workspaces table).
async function isMemberOfSlug(db: DbClient, slug: string, userId: string): Promise<boolean> {
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
  const relayPane = splitPaneId(pane);
  if (relayPane) return relayStream(c, "attach", pane, relayPane);

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

// Image pasted into a pane's prompt (web composer or app). Same per-pane authz
// as attach; the bridge saves it on the execution plane and returns the path,
// which the client inserts into the prompt for the agent to read.
const MAX_PASTE_BYTES = 20 * 1024 * 1024;
// base64 inflates by a third and the frame must stay under the 16 MiB a bridge
// accepts per WebSocket message.
const MAX_RELAY_PASTE_BYTES = 10 * 1024 * 1024;

paneRoutes.post("/paste", async (c) => {
  const pane = c.req.query("pane");
  if (!pane) throw new HTTPException(400, { message: "pane is required" });
  const user = c.get("user");
  const db = getDb(c.env.DB);
  const relayPane = splitPaneId(pane);
  if (relayPane) {
    // Machine ownership is the authz for a customer's own bridge (no workspace binding).
    if (!(await machines.findOwned(db, user.sub, relayPane.machineId))) {
      throw new HTTPException(403, { message: "not one of your machines" });
    }
  } else {
    const slug = await paneWorkspaceSlug(db, c.env, pane);
    if (!slug) throw new HTTPException(403, { message: "pane is not bound to an atur workspace" });
    if (!(await isMemberOfSlug(db, slug, user.sub))) {
      throw new HTTPException(403, { message: "not a member of the pane's workspace" });
    }
  }
  // The relay carries the image base64 inside one JSON frame, so it takes less.
  const maxBytes = relayPane ? MAX_RELAY_PASTE_BYTES : MAX_PASTE_BYTES;
  if (Number(c.req.header("content-length") ?? 0) > maxBytes) {
    return c.json({ error: "image too large" }, 413);
  }
  const image = new Uint8Array(await c.req.arrayBuffer());
  if (image.length === 0) return c.json({ error: "empty body" }, 400);
  if (image.length > maxBytes) return c.json({ error: "image too large" }, 413);

  if (relayPane) {
    const stub = relayStub(c.env, user.sub);
    if (!stub) return c.json({ error: "execution plane unreachable" }, 502);
    let relayed: RelayResponse;
    try {
      relayed = await stub.request(relayPane.machineId, {
        method: "POST",
        path: `/panes/paste?pane=${encodeURIComponent(relayPane.paneId)}`,
        headers: { "content-type": "application/octet-stream" },
        body: image,
      });
    } catch {
      return c.json({ error: "execution plane unreachable" }, 502);
    }
    console.log(
      `pane paste user=${user.sub} pane=${pane} bytes=${image.length} status=${relayed.status}`,
    );
    return new Response(relayed.body, {
      status: relayed.status,
      headers: { "content-type": relayed.headers["content-type"] ?? "application/json" },
    });
  }

  const base = bridgeBase(c.env);
  if (!base) return c.json({ error: "execution plane unreachable" }, 502);
  const headers = bridgeHeaders(c.env);
  headers.set("content-type", "application/octet-stream");
  let res: Response;
  try {
    res = await fetch(`${base}/panes/paste?pane=${encodeURIComponent(pane)}`, {
      method: "POST",
      headers,
      body: image,
    });
  } catch {
    return c.json({ error: "execution plane unreachable" }, 502);
  }
  console.log(
    `pane paste user=${user.sub} pane=${pane} bytes=${image.length} status=${res.status}`,
  );
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
});

paneRoutes.get("/observe", async (c) => {
  const pane = c.req.query("pane");
  if (!pane) throw new HTTPException(400, { message: "pane is required" });
  // The relay below answers with a WebSocket; without an upgrade request
  // (e.g. a stray curl) workerd would reject the 101 as a 500 — be explicit.
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    throw new HTTPException(426, { message: "websocket upgrade required" });
  }
  const user = c.get("user");
  const relayPane = splitPaneId(pane);
  if (relayPane) return relayStream(c, "observe", pane, relayPane);

  // Identical per-pane authz as /attach (DEV-32): the viewer must be a member
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
    upgrade = await fetch(`${base}/observe?pane=${encodeURIComponent(pane)}`, { headers });
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

  // No pane_audit row here: the table has no action column, so an observe
  // session would be indistinguishable from a keyboard attach (DEV-33).

  const origin = upgrade.webSocket; // bridge side
  origin.accept();

  const pair = new WebSocketPair();
  const server = pair[1]; // browser side of the relay
  server.accept();

  // Text frames only, verbatim both ways. The observe channel is read-only
  // for the pane (no input path): the daemon honours exactly two client frames,
  // the session-transcript opt-in and `older` paging, and closes (1008) on
  // anything else. Only the native app sends them; the web client never does.
  origin.addEventListener("message", (event) => {
    if (typeof event.data === "string") server.send(event.data);
  });
  server.addEventListener("message", (event) => {
    if (typeof event.data === "string") origin.send(event.data);
  });

  // Either side closing (or erroring) tears the relay down; there is no audit
  // row to stamp (see above).
  const detach = () => {
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
  };
  origin.addEventListener("close", detach);
  origin.addEventListener("error", detach);
  server.addEventListener("close", detach);
  server.addEventListener("error", detach);

  return new Response(null, { status: 101, webSocket: pair[0] });
});

// --- Pane management: workspaces, split, close --------------------------------
//
// The bridge owns the terminals; these routes authorise the caller and forward
// one JSON call to the right bridge (the env-configured one, or the caller's
// own machine through their BridgeRelay DO, exactly like attach / paste).
//
// Authz (see docs/native-panes-screen.md):
//  - split / close: whatever attach needs for that pane. Legacy bridge: member
//    of the Atur workspace the pane is bound to. Relay: the machine's owner.
//    No extra role: a member who can attach can already type `exit` or open a
//    shell, so a role gate here would only be theatre.
//  - new workspace, legacy bridge: the cwd must lie inside the local_path
//    bound to an Atur workspace the caller owns or administers (role >= 20).
//    Platform superuser alone is NOT enough: a workspace outside every binding
//    would be hidden from GET /api/panes for everyone, the owner included.
//  - new workspace, relay: the machine's owner, any absolute path.
// Every allowed call writes a pane_audit row (paneId = `<action>:<target>`,
// attached = detached = now) before it is forwarded, like attach does.

const MAX_LABEL_CHARS = 64;

function jsonBody(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

async function readJsonBody(c: Context<{ Bindings: Env }>): Promise<Record<string, unknown>> {
  const body = jsonBody(await c.req.json().catch(() => null));
  if (!body) throw new HTTPException(400, { message: "JSON body required" });
  return body;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value === "") {
    throw new HTTPException(400, { message: `${key} is required` });
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string")
    throw new HTTPException(400, { message: `${key} must be a string` });
  return value;
}

async function auditAction(db: DbClient, userId: string, action: string): Promise<void> {
  const now = Date.now();
  try {
    await db.insert(schema.paneAudit).values({
      id: uuid(),
      userId,
      paneId: action,
      attachedAt: now,
      detachedAt: now,
    });
  } catch (err) {
    console.error("pane_audit insert failed:", err);
  }
}

// The Atur workspace's name when the caller owns it or is an active admin of it.
async function adminWorkspaceName(
  db: DbClient,
  slug: string,
  userId: string,
): Promise<string | null> {
  const [ws] = await db
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      ownerId: schema.workspaces.ownerId,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug))
    .limit(1);
  if (!ws) return null;
  if (ws.ownerId === userId) return ws.name;
  const membership = await findMembership(db, ws.id, userId);
  return membership && membership.isActive === 1 && membership.role >= 20 ? ws.name : null;
}

interface BridgeReply {
  status: number;
  text: string;
}

// One JSON POST to a bridge: the caller's machine via the relay, else the
// env-configured bridge. Null = unreachable.
async function callBridge(
  c: Context<{ Bindings: Env }>,
  machineId: string | null,
  path: string,
  body: Record<string, unknown>,
): Promise<BridgeReply | null> {
  const payload = JSON.stringify(body);
  if (machineId) {
    const stub = relayStub(c.env, c.get("user").sub);
    if (!stub) return null;
    try {
      const res = await stub.request(machineId, {
        method: "POST",
        path,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(payload),
      });
      return { status: res.status, text: new TextDecoder().decode(res.body) };
    } catch {
      return null;
    }
  }
  const base = bridgeBase(c.env);
  if (!base) return null;
  const headers = bridgeHeaders(c.env);
  headers.set("content-type", "application/json");
  try {
    const res = await fetch(`${base}${path}`, { method: "POST", headers, body: payload });
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}

// A bridge that predates these routes answers its generic 404; a missing pane
// answers "pane not found". Tell the user to update instead of "not found".
const OLD_BRIDGE_ERROR = "this bridge is too old to manage panes; update atur-bridge";

// Forward a bridge reply. `rewrite` maps a successful JSON body (relay replies
// carry machine-local pane ids that must be namespaced for the client).
function bridgeReply(
  c: Context<{ Bindings: Env }>,
  reply: BridgeReply | null,
  rewrite?: (body: Record<string, unknown>) => unknown,
): Response {
  if (!reply) return c.json({ error: "execution plane unreachable" }, 502);
  const parsed = jsonBody(safeParse(reply.text));
  if (reply.status === 404 && parsed?.error === "not found") {
    return c.json({ error: OLD_BRIDGE_ERROR }, 501);
  }
  if (reply.status === 204) return c.body(null, 204);
  if (reply.status >= 200 && reply.status < 300 && rewrite && parsed) {
    return c.json(rewrite(parsed), reply.status as 200);
  }
  return new Response(reply.text, {
    status: reply.status,
    headers: { "content-type": "application/json" },
  });
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Namespace a machine-local pane row for clients (`<machine>~<pane>` + machine tag).
function relayPaneRow(machine: machines.BridgeMachine, pane: unknown): unknown {
  return prefixPanes({ id: machine.id, name: machine.name }, [pane])[0] ?? null;
}

// Authorise an existing pane for split / close and resolve where it lives.
async function authorizePane(
  c: Context<{ Bindings: Env }>,
  pane: string,
): Promise<{ machine: machines.BridgeMachine | null; localId: string }> {
  const user = c.get("user");
  const db = getDb(c.env.DB);
  const relayPane = splitPaneId(pane);
  if (relayPane) {
    const machine = await machines.findOwned(db, user.sub, relayPane.machineId);
    if (!machine) throw new HTTPException(403, { message: "not one of your machines" });
    return { machine, localId: relayPane.paneId };
  }
  const slug = await paneWorkspaceSlug(db, c.env, pane);
  if (!slug) throw new HTTPException(403, { message: "pane is not bound to an atur workspace" });
  if (!(await isMemberOfSlug(db, slug, user.sub))) {
    throw new HTTPException(403, { message: "not a member of the pane's workspace" });
  }
  return { machine: null, localId: pane };
}

paneRoutes.post("/split", async (c) => {
  const body = await readJsonBody(c);
  const pane = requiredString(body, "pane");
  const direction = body.direction;
  if (direction !== "right" && direction !== "down") {
    throw new HTTPException(400, { message: "direction must be right or down" });
  }
  const { machine, localId } = await authorizePane(c, pane);
  const user = c.get("user");
  await auditAction(getDb(c.env.DB), user.sub, `pane.split:${pane}`);
  const reply = await callBridge(c, machine?.id ?? null, "/panes/split", {
    pane: localId,
    direction,
  });
  console.log(`pane split user=${user.sub} pane=${pane} ${direction} status=${reply?.status ?? 0}`);
  return bridgeReply(c, reply, (res) => ({
    pane: machine ? relayPaneRow(machine, res.pane) : res.pane,
  }));
});

paneRoutes.post("/close", async (c) => {
  const pane = requiredString(await readJsonBody(c), "pane");
  const { machine, localId } = await authorizePane(c, pane);
  const user = c.get("user");
  await auditAction(getDb(c.env.DB), user.sub, `pane.close:${pane}`);
  const reply = await callBridge(c, machine?.id ?? null, "/panes/close", { pane: localId });
  console.log(`pane close user=${user.sub} pane=${pane} status=${reply?.status ?? 0}`);
  return bridgeReply(c, reply);
});

paneRoutes.post("/workspaces", async (c) => {
  const body = await readJsonBody(c);
  const cwd = normalizeAbsolutePath(requiredString(body, "cwd"));
  if (!cwd) throw new HTTPException(400, { message: "cwd must be an absolute path" });
  const label = optionalString(body, "label");
  if (label !== undefined && label.length > MAX_LABEL_CHARS) {
    throw new HTTPException(400, { message: `label is longer than ${MAX_LABEL_CHARS} characters` });
  }
  const machineId = optionalString(body, "machine_id") ?? null;
  const user = c.get("user");
  const db = getDb(c.env.DB);

  let machine: machines.BridgeMachine | null = null;
  if (machineId) {
    machine = await machines.findOwned(db, user.sub, machineId);
    if (!machine) throw new HTTPException(403, { message: "not one of your machines" });
  } else {
    const links = await db
      .select({
        workspaceSlug: schema.workspaceLinks.workspaceSlug,
        localPath: schema.workspaceLinks.localPath,
      })
      .from(schema.workspaceLinks);
    const slug = matchWorkspaceSlug(links, cwd);
    if (!slug) {
      throw new HTTPException(403, {
        message: "cwd is not inside a repo bound to an atur workspace",
      });
    }
    if (!(await adminWorkspaceName(db, slug, user.sub))) {
      throw new HTTPException(403, {
        message: "only the workspace owner or an admin can open workspaces there",
      });
    }
  }

  await auditAction(db, user.sub, `workspace.create:${machineId ?? "bridge"}:${cwd}`);
  const reply = await callBridge(c, machine?.id ?? null, "/workspaces", {
    cwd,
    ...(label === undefined ? {} : { label }),
  });
  console.log(
    `workspace create user=${user.sub} machine=${machineId ?? "-"} cwd=${cwd} status=${reply?.status ?? 0}`,
  );
  return bridgeReply(c, reply, (res) =>
    machine
      ? {
          workspace: {
            ...jsonBody(res.workspace),
            machine: { id: machine.id, name: machine.name },
          },
          pane: relayPaneRow(machine, res.pane),
        }
      : res,
  );
});

interface WorkspaceRow {
  id: string;
  label: string;
  cwd: string | null;
  pane_count: number;
  machine?: { id: string; name: string };
}

// Fold pane rows into one row per workspace (first-seen order, first pane's cwd).
// Built from /panes rather than the bridge's /workspaces so it also works for
// bridges that predate that route and honours the caller's pane visibility.
function groupWorkspaces(panes: readonly unknown[], machine?: RelayPaneMachine): WorkspaceRow[] {
  const rows = new Map<string, WorkspaceRow>();
  for (const raw of panes) {
    const pane = jsonBody(raw);
    if (!pane || typeof pane.workspace_id !== "string") continue;
    const known = rows.get(pane.workspace_id);
    if (known) {
      known.pane_count += 1;
      continue;
    }
    rows.set(pane.workspace_id, {
      id: pane.workspace_id,
      label: typeof pane.workspace_label === "string" ? pane.workspace_label : "",
      cwd: typeof pane.cwd === "string" ? pane.cwd : null,
      pane_count: 1,
      ...(machine ? { machine } : {}),
    });
  }
  return [...rows.values()];
}

// What the caller can target: the workspaces they can see, the machines they
// own, and the repo paths (`roots`) where they may open a new workspace on the
// env-configured bridge. The Panes tab uses it to build the "new workspace" form.
paneRoutes.get("/workspaces", async (c) => {
  const db = getDb(c.env.DB);
  const user = c.get("user");
  const owned = await machines.listActive(db, user.sub);
  const legacy = await visibleLegacyPanes(db, c.env, user.sub);
  if (!legacy && owned.length === 0) {
    return c.json({ error: "execution plane unreachable" }, 502);
  }

  const workspaces = groupWorkspaces(legacy ?? []);
  // Workspace ids are machine-local, so each machine's panes are grouped on their own.
  const relayPanes = await fetchRelayPanes(c.env, user.sub, owned);
  for (const machine of owned) {
    const tag = { id: machine.id, name: machine.name };
    workspaces.push(
      ...groupWorkspaces(
        relayPanes.filter((p) => p.machine.id === machine.id),
        tag,
      ),
    );
  }

  const roots: { path: string; label: string }[] = [];
  if (legacy) {
    const links = await db
      .select({
        workspaceSlug: schema.workspaceLinks.workspaceSlug,
        localPath: schema.workspaceLinks.localPath,
      })
      .from(schema.workspaceLinks);
    const rooted = await Promise.all(
      links.map(async (link) => {
        const path = link.localPath ? normalizeAbsolutePath(link.localPath) : null;
        const name = path ? await adminWorkspaceName(db, link.workspaceSlug, user.sub) : null;
        return path && name ? { path, label: name } : null;
      }),
    );
    for (const root of rooted) if (root) roots.push(root);
    roots.sort((a, b) => a.label.localeCompare(b.label));
  }

  return c.json({
    workspaces,
    machines: owned.map((m) => ({ id: m.id, name: m.name })),
    roots,
  });
});

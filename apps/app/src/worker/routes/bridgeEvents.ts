import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { parseOr400, publicJsonError } from "../lib/validate";
import { agentEventSchema, pushAgentEvent } from "../services/agentPush";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import { SCREEN_AUDIT_PANE } from "./screen";
import { workspaceSlugForPane } from "./panes";
import * as workspaceRepo from "../repositories/workspaces";
import * as memberRepo from "../repositories/members";

// POST /api/bridge/agent-events — the atur-bridge daemon reports that an agent
// pane finished a turn or needs the human; the Worker fans it out as a push to
// the members of the pane's workspace. Credential is the shared bridge token
// (same secret the Worker sends to the bridge), not a user session, so this is
// mounted before the global /api/* auth gate in app.ts.
export const bridgeEventRoutes = new Hono<{ Bindings: Env }>({ strict: false });
bridgeEventRoutes.onError(publicJsonError);

// Compare SHA-256 digests so neither content nor length of the secret leaks
// through timing.
async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

bridgeEventRoutes.post("/agent-events", async (c) => {
  const secret = c.env.HERDR_BRIDGE_TOKEN;
  if (!secret) return c.json({ error: "bridge events not configured" }, 503);
  if (!(await tokenMatches(c.req.header("x-bridge-token") ?? "", secret))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const event = parseOr400(agentEventSchema, await c.req.json().catch(() => undefined));
  const db = getDb(c.env.DB);

  const slug = await workspaceSlugForPane(db, c.env, {
    pane_id: event.pane_id,
    cwd: event.cwd ?? null,
  });
  if (!slug) return c.json({ sent: 0 });
  const workspace = await workspaceRepo.findBySlug(db, slug);
  if (!workspace) return c.json({ sent: 0 });

  const memberIds = await memberRepo.listActiveMemberIds(db, workspace.id);
  if (workspace.ownerId) memberIds.push(workspace.ownerId);
  const pushed = await pushAgentEvent(db, c.env, memberIds, event, slug);
  if (!pushed.ok) return c.json({ error: "push delivery failed" }, 502);
  return c.json({ sent: pushed.sent });
});

// POST /api/bridge/screen-events — a direct (tailnet) screen session ended on
// the bridge; stamps detached_at on the audit row the Worker wrote when it
// minted the ticket. Same shared-token credential as /agent-events.
bridgeEventRoutes.post("/screen-events", async (c) => {
  const secret = c.env.HERDR_BRIDGE_TOKEN;
  if (!secret) return c.json({ error: "bridge events not configured" }, 503);
  if (!(await tokenMatches(c.req.header("x-bridge-token") ?? "", secret))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const body = (await c.req.json().catch(() => null)) as {
    audit_id?: unknown;
    event?: unknown;
  } | null;
  if (typeof body?.audit_id !== "string" || body.event !== "stop") {
    return c.json({ error: "audit_id and event=stop required" }, 400);
  }
  await getDb(c.env.DB)
    .update(schema.paneAudit)
    .set({ detachedAt: Date.now() })
    .where(
      and(
        eq(schema.paneAudit.id, body.audit_id),
        eq(schema.paneAudit.paneId, SCREEN_AUDIT_PANE),
        isNull(schema.paneAudit.detachedAt),
      ),
    );
  return c.json({ ok: true });
});

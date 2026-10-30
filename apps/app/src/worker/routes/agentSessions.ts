import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { requireWorkspaceMember, requireWorkspaceAdmin } from "../middleware/workspace";
import { parseOr400 } from "../lib/validate";
import * as sessions from "../services/agentSessions";
import * as machines from "../services/bridgeMachines";
import * as workspaceRepo from "../repositories/workspaces";

// Agent terminal <-> issue links (the global /api/* gate authenticates). Pane ids are the ones GET /api/panes returns
// (`<machine>~<id>` for a relay machine, the bare id for the legacy bridge).
// Reads are scoped to the workspaces the caller belongs to; writes need
// membership of the issue's workspace (see services/agentSessions.ts).
const STATES = z.enum(sessions.SESSION_STATES);

const endSchema = z.object({
  pane_id: z.string().min(1).max(160),
  machine_id: z.string().max(64).optional(),
  session_id: z.string().max(128).optional(),
});

export const agentSessionRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const panes = c.req.queries("pane");
    // A prefixed pane id proves which machine a machine-less claim belongs to.
    for (const pane of panes ?? []) {
      const key = sessions.paneKey(pane);
      if (key.machineId && (await machines.findOwned(db, user.sub, key.machineId))) {
        await sessions.adoptMachine(db, key.machineId, key.paneId);
      }
    }
    const state = c.req.query("state");
    const rows = await sessions.list(db, {
      workspaceIds: await workspaceRepo.listIdsByUser(db, user.sub),
      panes,
      sessionId: c.req.query("session_id"),
      state: state ? STATES.parse(state) : undefined,
      activeOnly: c.req.query("active") === "1",
      limit: Number(c.req.query("limit")) || undefined,
    });
    return c.json({ sessions: rows });
  })
  .put("/link", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const body = parseOr400(sessions.linkSchema, await c.req.json().catch(() => undefined));
    const wire = await sessions.linkForUser(db, user.sub, body, "manual", async (machineId) =>
      Boolean(await machines.findOwned(db, user.sub, machineId)),
    );
    return c.json(wire);
  })
  .delete("/link", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const pane = c.req.query("pane");
    if (!pane) throw new HTTPException(400, { message: "pane is required" });
    const key = sessions.paneKey(pane, c.req.query("machine_id"));
    const [existing] = await sessions.list(db, {
      workspaceIds: await workspaceRepo.listIdsByUser(db, user.sub),
      panes: [pane],
    });
    if (!existing) return c.body(null, 204); // nothing visible to this caller
    await sessions.unlinkPane(db, key.machineId, key.paneId);
    return c.body(null, 204);
  })
  .post("/end", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const body = parseOr400(endSchema, await c.req.json().catch(() => undefined));
    const key = sessions.paneKey(body.pane_id, body.machine_id);
    const [existing] = await sessions.list(db, {
      workspaceIds: await workspaceRepo.listIdsByUser(db, user.sub),
      panes: [body.pane_id],
    });
    if (!existing) return c.json({ ended: false });
    await sessions.endSession(db, key.machineId, key.paneId, body.session_id ?? null);
    return c.json({ ended: true });
  });

export const workspaceAgentSessionRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const ws = c.get("workspace");
    const state = c.req.query("state");
    const rows = await sessions.list(db, {
      workspaceIds: [ws.id],
      state: state ? STATES.parse(state) : undefined,
      activeOnly: c.req.query("active") === "1",
      limit: Number(c.req.query("limit")) || undefined,
    });
    return c.json({ sessions: rows });
  })
  .get("/settings", requireWorkspaceMember, async (c) => {
    const s = await sessions.getSettings(getDb(c.env.DB), c.get("workspace").id);
    return c.json({ on_blocked: s.onBlocked, on_done: s.onDone });
  })
  .put("/settings", requireWorkspaceMember, requireWorkspaceAdmin, async (c) => {
    const body = parseOr400(sessions.settingsSchema, await c.req.json().catch(() => undefined));
    const s = await sessions.updateSettings(getDb(c.env.DB), c.get("workspace").id, body);
    return c.json({ on_blocked: s.onBlocked, on_done: s.onDone });
  });

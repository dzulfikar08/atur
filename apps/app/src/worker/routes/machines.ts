import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { relayStub } from "../lib/relay";
import { parseOr400 } from "../lib/validate";
import type { RelayOnlineMachine } from "../lib/relayProtocol";
import * as machines from "../services/bridgeMachines";
import * as billingService from "../services/billing";
import * as usersRepo from "../repositories/users";

// The caller's own bridge machines (Machines page). Mounted at
// /api/me/machines behind the global session gate and plan gate. Creating a
// machine needs a paid plan; listing and revoking never do, so a lapsed
// subscriber can still see and cut off what they connected.
export const machineRoutes = new Hono<{ Bindings: Env }>({ strict: false });

const createSchema = z.object({ name: z.string().trim().min(1).max(64) });

function machineJson(m: machines.BridgeMachine, live?: RelayOnlineMachine) {
  return {
    id: m.id,
    name: m.name,
    created_at: m.createdAt,
    last_seen_at: m.lastSeenAt,
    online: live !== undefined,
    hostname: live?.hostname ?? null,
    backend: live?.backend ?? null,
    version: live?.version ?? null,
  };
}

machineRoutes.get("/", async (c) => {
  const userId = c.get("user").sub;
  const rows = await machines.listActive(getDb(c.env.DB), userId);
  let online: Record<string, RelayOnlineMachine> = {};
  const stub = rows.length > 0 ? relayStub(c.env, userId) : null;
  if (stub) {
    // A relay hiccup must not hide the list: report everything offline.
    online = await stub.onlineMachines().catch((err: unknown) => {
      console.error("relay online lookup failed:", err);
      return {};
    });
  }
  return c.json({ machines: rows.map((m) => machineJson(m, online[m.id])) });
});

machineRoutes.post("/", async (c) => {
  const { name } = parseOr400(createSchema, await c.req.json().catch(() => undefined));
  const db = getDb(c.env.DB);
  const user = await usersRepo.findById(db, c.get("user").sub);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const billing = await billingService.billingFor(db, c.env, user);
  if (!billing.entitled) return c.json({ error: "plan_required" }, 402);

  const { machine, token } = await machines.createMachine(db, user.id, name);
  // The token is returned here and nowhere else; only its hash is stored.
  return c.json({ machine: machineJson(machine), token }, 201);
});

machineRoutes.delete("/:id", async (c) => {
  const userId = c.get("user").sub;
  const id = c.req.param("id");
  if (!(await machines.revoke(getDb(c.env.DB), userId, id))) {
    return c.json({ error: "machine not found" }, 404);
  }
  // Cut the live socket now; a failure here still leaves the token dead for
  // every future connect, so it is logged rather than surfaced.
  try {
    await relayStub(c.env, userId)?.closeMachine(id);
  } catch (err) {
    console.error(`relay closeMachine failed (${id}):`, err);
  }
  return c.json({ ok: true });
});

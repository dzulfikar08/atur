import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { publicJsonError } from "../lib/validate";
import { relayStub } from "../lib/relay";
import { RELAY_HEADER, machineTokenFromHeader } from "../lib/relayProtocol";
import * as machines from "../services/bridgeMachines";
import * as billingService from "../services/billing";
import * as usersRepo from "../repositories/users";

// GET /api/bridge/connect — a customer's atur-bridge dials OUT here with its
// machine token (`Authorization: Bearer atb_…`) and upgrades to a WebSocket.
// The BridgeRelay Durable Object of the machine's owner then muxes pane
// traffic over it. The credential is the machine token, not a session, so this
// mounts before the global /api/* auth gate in app.ts.
//
// Auth is answered as plain HTTP (401 / 402) before the upgrade is even looked
// at: Bun's WebSocket client cannot see the status of a rejected upgrade, so
// the bridge re-probes with a plain GET and maps the status itself.
export const bridgeConnectRoutes = new Hono<{ Bindings: Env }>({ strict: false });
bridgeConnectRoutes.onError(publicJsonError);

bridgeConnectRoutes.get("/connect", async (c) => {
  const token = machineTokenFromHeader(c.req.header("Authorization"));
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const db = getDb(c.env.DB);
  const machine = await machines.findActiveByToken(db, token);
  if (!machine) return c.json({ error: "Unauthorized" }, 401);

  const owner = await usersRepo.findById(db, machine.userId);
  if (!owner || !owner.isActive || owner.deletedAt) return c.json({ error: "Unauthorized" }, 401);

  const billing = await billingService.billingFor(db, c.env, owner);
  if (!billing.entitled) return c.json({ error: "plan_required" }, 402);

  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "websocket upgrade required" }, 426);
  }
  const stub = relayStub(c.env, owner.id);
  if (!stub) return c.json({ error: "relay not configured" }, 503);

  // The DO trusts these headers: strip anything client-supplied first.
  const headers = new Headers(c.req.raw.headers);
  headers.delete("Authorization");
  headers.set(RELAY_HEADER.machineId, machine.id);
  headers.set(RELAY_HEADER.machineName, machine.name);
  headers.set(RELAY_HEADER.userId, owner.id);
  const res = await stub.fetch("https://relay/bridge", { headers });
  // Rewrap: a Response fetched from a stub has immutable headers, which the
  // cors middleware above this route would otherwise trip over.
  if (res.status === 101 && res.webSocket) {
    return new Response(null, { status: 101, webSocket: res.webSocket });
  }
  return new Response(res.body, { status: res.status, headers: res.headers });
});

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { parseOr400, publicJsonError } from "../lib/validate";
import { ExpoPushError, sendExpoPush, type ExpoPushMessage } from "../lib/expoPush";
import { workspaceSlugForPane } from "./panes";
import * as workspaceRepo from "../repositories/workspaces";
import * as memberRepo from "../repositories/members";
import * as pushTokenRepo from "../repositories/pushTokens";

// POST /api/bridge/agent-events — the atur-bridge daemon reports that an agent
// pane finished a turn or needs the human; the Worker fans it out as a push to
// the members of the pane's workspace. Credential is the shared bridge token
// (same secret the Worker sends to the bridge), not a user session, so this is
// mounted before the global /api/* auth gate in app.ts.
export const bridgeEventRoutes = new Hono<{ Bindings: Env }>({ strict: false });
bridgeEventRoutes.onError(publicJsonError);

// Over-long titles/details are clipped, not rejected: a 400 would drop the alert.
const optionalText = (max: number) =>
  z
    .string()
    .max(4096)
    .transform((s) => s.slice(0, max))
    .nullish();

export const agentEventSchema = z.object({
  pane_id: z.string().min(1).max(64),
  status: z.enum(["done", "blocked"]),
  agent: optionalText(64),
  cwd: optionalText(1024),
  title: optionalText(200),
  detail: optionalText(500),
});
export type AgentEvent = z.infer<typeof agentEventSchema>;

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

/** Push payload for an agent event (contract C); `to` is filled per device. */
export function agentPushMessage(
  event: AgentEvent,
  workspaceSlug: string,
): Omit<ExpoPushMessage, "to"> {
  const folder = event.cwd?.split("/").filter(Boolean).pop();
  const title =
    event.title || (folder ? `${event.agent || "Agent"} in ${folder}` : event.agent) || "Agent";
  const lead =
    event.status === "blocked"
      ? event.detail
        ? `Needs you: ${event.detail}`
        : "Needs you"
      : event.detail
        ? `Done: ${event.detail}`
        : "Finished";
  return {
    title,
    body: `${lead} · ${workspaceSlug}`,
    sound: "default",
    priority: "high",
    channelId: "agents",
    data: { type: "agent", pane_id: event.pane_id, status: event.status },
  };
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
  const tokens = await pushTokenRepo.tokensForUsers(db, memberIds);
  if (tokens.length === 0) return c.json({ sent: 0 });

  const base = agentPushMessage(event, slug);
  let result;
  try {
    result = await sendExpoPush(
      c.env,
      tokens.map((to) => ({ ...base, to })),
    );
  } catch (err) {
    if (err instanceof ExpoPushError) {
      console.error(`agent-event push failed (${slug} ${event.pane_id}): ${err.message}`);
      return c.json({ error: "push delivery failed" }, 502);
    }
    throw err;
  }
  if (result.deadTokens.length > 0) await pushTokenRepo.removeTokens(db, result.deadTokens);

  const sent = result.tickets.filter((t) => t.status === "ok").length;
  console.log(
    `agent-event ${event.status} ${slug} ${event.pane_id}: sent ${sent}/${tokens.length}, pruned ${result.deadTokens.length}`,
  );
  return c.json({ sent });
});

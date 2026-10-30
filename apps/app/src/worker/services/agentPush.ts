// Push fan-out for agent events (an agent pane finished a turn or needs the
// human). Shared by the legacy HTTP path (routes/bridgeEvents.ts, env-configured
// bridge) and the relay path (BridgeRelay Durable Object, per-machine bridges).
import { z } from "zod";
import type { DbClient } from "../db/index";
import type { Env } from "../lib/env";
import { ExpoPushError, sendExpoPush, type ExpoPushMessage } from "../lib/expoPush";
import * as pushTokenRepo from "../repositories/pushTokens";

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
  /** Agent session id (omp: transcript file name after the timestamp), when known. */
  session_id: optionalText(128),
});
export type AgentEvent = z.infer<typeof agentEventSchema>;

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

export type AgentPushResult =
  | { ok: true; sent: number; devices: number; pruned: number }
  | { ok: false; error: string };

/**
 * Push `event` to every device of `userIds`. `label` is the trailing context in
 * the body (workspace slug on the legacy path, machine name on the relay path);
 * `event.pane_id` is whatever id the client opens (prefixed for relay panes).
 * Dead Expo tokens are pruned. Delivery failure is reported, never thrown.
 */
export async function pushAgentEvent(
  db: DbClient,
  env: Env,
  userIds: string[],
  event: AgentEvent,
  label: string,
): Promise<AgentPushResult> {
  const tokens = await pushTokenRepo.tokensForUsers(db, userIds);
  if (tokens.length === 0) return { ok: true, sent: 0, devices: 0, pruned: 0 };

  const base = agentPushMessage(event, label);
  let result;
  try {
    result = await sendExpoPush(
      env,
      tokens.map((to) => ({ ...base, to })),
    );
  } catch (err) {
    if (err instanceof ExpoPushError) {
      console.error(`agent-event push failed (${label} ${event.pane_id}): ${err.message}`);
      return { ok: false, error: err.message };
    }
    throw err;
  }
  if (result.deadTokens.length > 0) await pushTokenRepo.removeTokens(db, result.deadTokens);

  const sent = result.tickets.filter((t) => t.status === "ok").length;
  console.log(
    `agent-event ${event.status} ${label} ${event.pane_id}: sent ${sent}/${tokens.length}, pruned ${result.deadTokens.length}`,
  );
  return { ok: true, sent, devices: tokens.length, pruned: result.deadTokens.length };
}

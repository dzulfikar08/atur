import { eq, and, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { HTTPException } from "hono/http-exception";
import * as timeEntriesRepo from "../repositories/timeEntries";

async function isWorkspaceMember(
  db: DbClient,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [m] = await db
    .select({ id: schema.workspaceMembers.id })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.memberId, userId),
        eq(schema.workspaceMembers.isActive, 1),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  return !!m;
}

export async function getTimesheet(
  db: DbClient,
  slug: string,
  userId: string,
  opts: { from?: string; to?: string; userId?: string; projectId?: string },
) {
  const [ws] = await db
    .select({ id: schema.workspaces.id, ownerId: schema.workspaces.ownerId })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.slug, slug), isNull(schema.workspaces.deletedAt)))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  // Workspace owner or active member only — keeps timesheet scoped to members.
  if (ws.ownerId !== userId && !(await isWorkspaceMember(db, ws.id, userId))) {
    throw new HTTPException(403, { message: "Not a member of this workspace" });
  }

  const results = await timeEntriesRepo.aggregateForWorkspace(db, { workspaceId: ws.id, ...opts });

  let totalSeconds = 0;
  let totalEntries = 0;
  const byUser = new Map<string, { user_name: string | null; total_seconds: number }>();
  for (const r of results) {
    totalSeconds += r.total_seconds;
    totalEntries += r.entry_count;
    const prev = byUser.get(r.user_id);
    byUser.set(r.user_id, {
      user_name: r.user_name,
      total_seconds: (prev?.total_seconds ?? 0) + r.total_seconds,
    });
  }

  return {
    results,
    totals: {
      total_seconds: totalSeconds,
      total_entries: totalEntries,
      by_user: Array.from(byUser.entries()).map(([user_id, v]) => ({
        user_id,
        user_name: v.user_name,
        total_seconds: v.total_seconds,
      })),
    },
  };
}

// Agent KPI report: token + duration burn grouped by agent/model/issue.
// Same workspace gate as the human timesheet.
export async function getAgentUsage(
  db: DbClient,
  slug: string,
  userId: string,
  opts: { from?: string; to?: string; projectId?: string },
) {
  const [ws] = await db
    .select({ id: schema.workspaces.id, ownerId: schema.workspaces.ownerId })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.slug, slug), isNull(schema.workspaces.deletedAt)))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  if (ws.ownerId !== userId && !(await isWorkspaceMember(db, ws.id, userId))) {
    throw new HTTPException(403, { message: "Not a member of this workspace" });
  }

  const results = await timeEntriesRepo.aggregateAgentUsage(db, { workspaceId: ws.id, ...opts });

  const rollup = new Map<
    string,
    {
      agent_name: string;
      model: string;
      entry_count: number;
      issue_count: number;
      total_seconds: number;
      total_tokens: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number | null;
    }
  >();
  let totalTokens = 0;
  let totalSeconds = 0;
  // Null = no priced row contributed; unpriced rows are skipped, never
  // counted as $0.
  const addCost = (a: number | null, b: number | null): number | null => {
    if (a == null) return b;
    if (b == null) return a;
    return a + b;
  };
  let totalCost: number | null = null;
  for (const r of results) {
    totalTokens += r.total_tokens;
    totalSeconds += r.total_seconds;
    totalCost = addCost(totalCost, r.cost_usd);
    const key = `${r.agent_name}|${r.model}`;
    const prev = rollup.get(key);
    if (prev) {
      prev.entry_count += r.entry_count;
      prev.issue_count += 1;
      prev.total_seconds += r.total_seconds;
      prev.total_tokens += r.total_tokens;
      prev.input_tokens += r.input_tokens;
      prev.output_tokens += r.output_tokens;
      prev.cost_usd = addCost(prev.cost_usd, r.cost_usd);
    } else {
      rollup.set(key, {
        agent_name: r.agent_name ?? "unknown",
        model: r.model ?? "unknown",
        entry_count: r.entry_count,
        issue_count: 1,
        total_seconds: r.total_seconds,
        total_tokens: r.total_tokens,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        cost_usd: r.cost_usd ?? null,
      });
    }
  }

  return {
    results,
    totals: {
      total_tokens: totalTokens,
      total_seconds: totalSeconds,
      cost_usd: totalCost,
      by_agent: Array.from(rollup.values()).sort((a, b) => b.total_tokens - a.total_tokens),
    },
  };
}

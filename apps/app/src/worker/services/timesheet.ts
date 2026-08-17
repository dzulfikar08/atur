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

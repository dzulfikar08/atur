import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { nowISO } from "../lib/pagination";
import * as workspaceRepo from "../repositories/workspaces";

// Workspace ids the user hid from their own switcher. Presentation only: it
// never narrows membership, permissions or any other API listing.
// D1 caps a statement at 100 bound params; the insert binds 3 per row.
const MAX_IDS = 30;
const idList = z.array(z.string().min(1).max(64)).max(MAX_IDS);

export const updateHiddenWorkspacesSchema = z
  .object({ hide: idList.optional(), show: idList.optional() })
  .refine((d) => (d.hide?.length ?? 0) + (d.show?.length ?? 0) > 0, {
    message: "hide or show required",
  });

/** Hidden ids still reachable by the user (ids of left/deleted workspaces drop out). */
export async function list(db: DbClient, userId: string): Promise<string[]> {
  const [rows, accessible] = await Promise.all([
    db
      .select({ workspaceId: schema.userHiddenWorkspaces.workspaceId })
      .from(schema.userHiddenWorkspaces)
      .where(eq(schema.userHiddenWorkspaces.userId, userId)),
    workspaceRepo.listIdsByUser(db, userId),
  ]);
  const allowed = new Set(accessible);
  return rows.map((r) => r.workspaceId).filter((id) => allowed.has(id));
}

/**
 * Hide/show workspaces for the user. `hide` ids must all be workspaces the user
 * belongs to (400 otherwise); `show` is idempotent and accepts any id, so a
 * stale entry can always be cleared. Returns the resulting hidden list.
 */
export async function update(
  db: DbClient,
  userId: string,
  input: z.infer<typeof updateHiddenWorkspacesSchema>,
): Promise<string[]> {
  const hide = [...new Set(input.hide ?? [])];
  const show = [...new Set(input.show ?? [])];

  if (hide.length > 0) {
    const accessible = new Set(await workspaceRepo.listIdsByUser(db, userId));
    const unknown = hide.filter((id) => !accessible.has(id));
    if (unknown.length > 0) {
      throw new HTTPException(400, {
        message: `Not a member of workspace(s): ${unknown.join(", ")}`,
      });
    }
    // A concurrent hide of the same id is a no-op, not a conflict.
    await db
      .insert(schema.userHiddenWorkspaces)
      .values(hide.map((workspaceId) => ({ userId, workspaceId, createdAt: nowISO() })))
      .onConflictDoNothing();
  }
  if (show.length > 0) {
    await db
      .delete(schema.userHiddenWorkspaces)
      .where(
        and(
          eq(schema.userHiddenWorkspaces.userId, userId),
          inArray(schema.userHiddenWorkspaces.workspaceId, show),
        ),
      );
  }
  return list(db, userId);
}

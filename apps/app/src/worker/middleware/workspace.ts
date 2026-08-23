import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as schema from "../db/schema";
import * as workspaceRepo from "../repositories/workspaces";
import * as membersRepo from "../repositories/members";

declare module "hono" {
  interface ContextVariableMap {
    workspace: typeof schema.workspaces.$inferSelect;
  }
}

// Single shared workspace-membership gate for workspace-scoped routes
// (mounted under /api/workspaces/:slug/...). Replaces the per-route copies
// that deals, contacts, polar and portal-settings each carried.
//
// Resolves the workspace from the :slug path param and verifies the caller is
// the workspace owner or an active, non-deleted member:
//   - unknown slug            → 404 (never leak which slugs exist)
//   - known, not a member     → 403 "Not a member of this workspace"
//
// Usage: `authMiddleware, requireWorkspaceMember` in the handler chain, then
// read the resolved row via `c.get("workspace")`; or call
// `resolveWorkspaceForCaller(c)` directly inside a handler.
export async function resolveWorkspaceForCaller(
  c: Context<{ Bindings: Env }>,
  slugOverride?: string,
): Promise<typeof schema.workspaces.$inferSelect> {
  const db = getDb(c.env.DB);
  const ws = await workspaceRepo.findBySlug(db, slugOverride ?? c.req.param("slug")!);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  const userId = c.get("user").sub;
  if (ws.ownerId !== userId && !(await membersRepo.isWorkspaceMember(db, ws.id, userId))) {
    throw new HTTPException(403, { message: "Not a member of this workspace" });
  }
  return ws;
}

export async function requireWorkspaceMember(c: Context<{ Bindings: Env }>, next: Next) {
  const ws = await resolveWorkspaceForCaller(c);
  c.set("workspace", ws);
  await next();
}

// Admin gate for workspace-management mutations (member invite/add/remove,
// workspace rename/delete): the owner OR an ACTIVE admin member (role >= 20).
// Suspended members (is_active = 0) are denied even with an admin role — the
// same active-member rule as requireWorkspaceMember. Chain it after
// requireWorkspaceMember (reuses the resolved workspace) or use it alone
// (resolves + sets "workspace" itself).
export async function requireWorkspaceAdmin(c: Context<{ Bindings: Env }>, next: Next) {
  const ws =
    (c.get("workspace") as typeof schema.workspaces.$inferSelect | undefined) ??
    (await resolveWorkspaceForCaller(c));
  c.set("workspace", ws);
  const userId = c.get("user").sub;
  if (ws.ownerId !== userId) {
    const db = getDb(c.env.DB);
    const m = await membersRepo.findMembership(db, ws.id, userId);
    if (!m || m.isActive !== 1 || m.role < 20) {
      throw new HTTPException(403, {
        message: "Only the workspace owner or an admin can perform this action",
      });
    }
  }
  await next();
}

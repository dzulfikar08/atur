// Saved issue views: named IssueQuery snapshots, private to the caller.
//
// No dedicated table: they live in the caller's own workspace_members.view_props
// JSON (already per user + per workspace) under
//   { "saved_views": { "<projectId>": [{ id, name, query, created_at, updated_at }] } }
// so there is no schema change. `query` is the client's IssueQuery, stored
// verbatim: the client normalizes it on load, so a field added later never
// breaks an older stored view.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Env } from "../lib/env";
import { getDb, type DbClient } from "../db/index";
import { workspaceMembers } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember, requireWorkspaceProject } from "../middleware/workspace";
import { nowISO } from "../lib/pagination";

const MAX_VIEWS_PER_PROJECT = 50;
const MAX_NAME = 80;
const MAX_QUERY_BYTES = 8 * 1024;

interface StoredView {
  id: string;
  name: string;
  query: unknown;
  created_at: string;
  updated_at: string;
}

type ViewProps = Record<string, unknown> & {
  saved_views?: Record<string, StoredView[]>;
};

async function loadMembership(db: DbClient, workspaceId: string, userId: string) {
  const [row] = await db
    .select({ id: workspaceMembers.id, viewProps: workspaceMembers.viewProps })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.memberId, userId),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  if (!row)
    throw new HTTPException(409, {
      message: "No workspace membership to store views on",
    });
  let props: ViewProps = {};
  if (row.viewProps) {
    try {
      const parsed = JSON.parse(row.viewProps);
      if (parsed && typeof parsed === "object") props = parsed as ViewProps;
    } catch {
      // Corrupt JSON is treated as empty; the next write replaces it.
    }
  }
  return { id: row.id, props };
}

async function saveViews(
  db: DbClient,
  membershipId: string,
  props: ViewProps,
  projectId: string,
  views: StoredView[],
) {
  const next: ViewProps = {
    ...props,
    saved_views: { ...props.saved_views, [projectId]: views },
  };
  await db
    .update(workspaceMembers)
    .set({ viewProps: JSON.stringify(next), updatedAt: nowISO() })
    .where(eq(workspaceMembers.id, membershipId));
}

function parseBody(raw: unknown, partial: boolean): { name?: string; query?: unknown } {
  if (!raw || typeof raw !== "object") throw new HTTPException(400, { message: "Invalid body" });
  const body = raw as { name?: unknown; query?: unknown };
  const out: { name?: string; query?: unknown } = {};
  if (body.name !== undefined || !partial) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > MAX_NAME)
      throw new HTTPException(400, {
        message: `name must be 1-${MAX_NAME} characters`,
      });
    out.name = name;
  }
  if (body.query !== undefined || !partial) {
    if (!body.query || typeof body.query !== "object" || Array.isArray(body.query))
      throw new HTTPException(400, { message: "query must be an object" });
    if (JSON.stringify(body.query).length > MAX_QUERY_BYTES)
      throw new HTTPException(400, { message: "query is too large" });
    out.query = body.query;
  }
  return out;
}

const toApi = (v: StoredView) => ({
  id: v.id,
  name: v.name,
  query: v.query,
  is_locked: false,
  access: "PRIVATE",
  is_favorite: false,
  created_at: v.created_at,
  updated_at: v.updated_at,
});

export const viewRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, requireWorkspaceProject, async (c) => {
    const db = getDb(c.env.DB);
    const { props } = await loadMembership(db, c.get("workspace").id, c.get("user").sub);
    const views = props.saved_views?.[c.req.param("projectId")!] ?? [];
    return c.json({ results: views.map(toApi) });
  })
  .post("/", authMiddleware, requireWorkspaceMember, requireWorkspaceProject, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const body = parseBody(await c.req.json().catch(() => null), false);
    const { id, props } = await loadMembership(db, c.get("workspace").id, c.get("user").sub);
    const views = props.saved_views?.[projectId] ?? [];
    if (views.length >= MAX_VIEWS_PER_PROJECT)
      throw new HTTPException(400, {
        message: `At most ${MAX_VIEWS_PER_PROJECT} saved views`,
      });
    const now = nowISO();
    const view: StoredView = {
      id: uuid(),
      name: body.name!,
      query: body.query,
      created_at: now,
      updated_at: now,
    };
    await saveViews(db, id, props, projectId, [...views, view]);
    return c.json(toApi(view), 201);
  })
  .patch("/:viewId", authMiddleware, requireWorkspaceMember, requireWorkspaceProject, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const body = parseBody(await c.req.json().catch(() => null), true);
    const { id, props } = await loadMembership(db, c.get("workspace").id, c.get("user").sub);
    const views = props.saved_views?.[projectId] ?? [];
    const idx = views.findIndex((v) => v.id === c.req.param("viewId"));
    if (idx < 0) throw new HTTPException(404, { message: "View not found" });
    const updated: StoredView = {
      ...views[idx],
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.query !== undefined ? { query: body.query } : {}),
      updated_at: nowISO(),
    };
    const next = [...views];
    next[idx] = updated;
    await saveViews(db, id, props, projectId, next);
    return c.json(toApi(updated));
  })
  .delete(
    "/:viewId",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c) => {
      const db = getDb(c.env.DB);
      const projectId = c.req.param("projectId")!;
      const { id, props } = await loadMembership(db, c.get("workspace").id, c.get("user").sub);
      const views = props.saved_views?.[projectId] ?? [];
      const next = views.filter((v) => v.id !== c.req.param("viewId"));
      if (next.length === views.length) throw new HTTPException(404, { message: "View not found" });
      await saveViews(db, id, props, projectId, next);
      return c.body(null, 204);
    },
  );

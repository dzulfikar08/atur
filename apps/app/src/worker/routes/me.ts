// Cross-workspace ("All Workspaces") endpoints. Every handler scopes queries to
// the set of workspace IDs the current user owns or belongs to, then merges
// rows with their parent workspace (slug + name) so the client can build nav
// links and group by workspace. Mounted at /api/me (authed globally via
// app.use('/api/*', authMiddleware)).
import { Hono } from "hono";
import { and, eq, isNull, isNotNull, inArray, desc, like, or, count, sql } from "drizzle-orm";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { paginationParams, paginatedResponse } from "../lib/pagination";
import * as schema from "../db/schema";
import * as workspaceRepo from "../repositories/workspaces";
import * as issuesService from "../services/issues";

export const meRoutes = new Hono<{ Bindings: Env }>({ strict: false })

  // Recent + filterable issues across all the user's workspaces. Each row is
  // enriched (state/assignees/labels) and tagged with project + workspace fields
  // so the UI can link to /<workspace_slug>/projects/<project_id>/issues/<seq>.
  .get("/issues", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const ids = await workspaceRepo.listIdsByUser(db, user.sub);
    if (!ids.length) return c.json({ results: [], total: 0 });

    const state = c.req.query("state");
    const priority = c.req.query("priority");
    const search = c.req.query("search");
    const workspace = c.req.query("workspace"); // workspace id
    const project = c.req.query("project"); // project id
    const limit = Math.min(parseInt(c.req.query("limit") || "500", 10), 500);

    const conditions = [inArray(schema.issues.workspaceId, ids), isNull(schema.issues.deletedAt)];
    if (state) conditions.push(eq(schema.issues.stateId, state));
    if (priority) conditions.push(eq(schema.issues.priority, priority));
    if (search) conditions.push(like(schema.issues.name, `%${search}%`));
    if (workspace) conditions.push(eq(schema.issues.workspaceId, workspace));
    if (project) conditions.push(eq(schema.issues.projectId, project));

    const rows = await db
      .select({
        issue: schema.issues,
        projectName: schema.projects.name,
        projectIdentifier: schema.projects.identifier,
        workspaceSlug: schema.workspaces.slug,
        workspaceName: schema.workspaces.name,
      })
      .from(schema.issues)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.issues.projectId))
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.issues.workspaceId))
      .where(and(...conditions))
      .orderBy(desc(schema.issues.updatedAt))
      .limit(limit);

    const enriched = await issuesService.enrichIssues(
      db,
      rows.map((r) => r.issue) as Parameters<typeof issuesService.enrichIssues>[1],
    );
    const results = enriched.map((e, i) => ({
      ...e,
      projectName: rows[i].projectName,
      projectIdentifier: rows[i].projectIdentifier,
      workspaceSlug: rows[i].workspaceSlug,
      workspaceName: rows[i].workspaceName,
    }));

    return c.json({ results, total: results.length });
  })

  // All projects across the user's workspaces.
  .get("/projects", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const ids = await workspaceRepo.listIdsByUser(db, user.sub);
    if (!ids.length) return c.json({ results: [] });

    const rows = await db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        identifier: schema.projects.identifier,
        workspaceId: schema.projects.workspaceId,
        emoji: schema.projects.emoji,
        network: schema.projects.network,
        descriptionHtml: schema.projects.descriptionHtml,
        coverImage: schema.projects.coverImage,
        archivedAt: schema.projects.archivedAt,
        createdAt: schema.projects.createdAt,
        updatedAt: schema.projects.updatedAt,
        workspaceSlug: schema.workspaces.slug,
        workspaceName: schema.workspaces.name,
        isPipeline: schema.projects.isPipeline,
      })
      .from(schema.projects)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.projects.workspaceId))
      .where(
        and(
          inArray(schema.projects.workspaceId, ids),
          isNull(schema.projects.deletedAt),
          ...(c.req.query("is_pipeline") === "1" ? [eq(schema.projects.isPipeline, 1)] : []),
        ),
      )
      .orderBy(desc(schema.projects.updatedAt));

    return c.json({ results: rows });
  })

  // All pages across the user's workspaces.
  .get("/pages", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const ids = await workspaceRepo.listIdsByUser(db, user.sub);
    if (!ids.length) return c.json({ results: [] });

    const rows = await db
      .select({
        page: schema.pages,
        workspaceSlug: schema.workspaces.slug,
        workspaceName: schema.workspaces.name,
      })
      .from(schema.pages)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.pages.workspaceId))
      .where(and(inArray(schema.pages.workspaceId, ids), isNull(schema.pages.deletedAt)))
      .orderBy(desc(schema.pages.updatedAt));

    const results = rows.map((r) => ({
      ...r.page,
      workspaceSlug: r.workspaceSlug,
      workspaceName: r.workspaceName,
    }));

    return c.json({ results });
  })

  // All CRM contacts across the user's workspaces. Mirrors listContacts but
  // swaps the single-workspace eq() for inArray() and joins workspace fields.
  .get("/contacts", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const ids = await workspaceRepo.listIdsByUser(db, user.sub);
    if (!ids.length) return c.json(paginatedResponse([], 0, 0, 50));

    const { offset, limit } = paginationParams(c);
    const status = c.req.query("status");
    const search = c.req.query("search");

    const conditions = [inArray(schema.customers.workspaceId, ids)];
    if (status) conditions.push(eq(schema.customers.status, status));
    if (search) {
      const q = `%${search}%`;
      conditions.push(
        or(
          like(schema.customers.email, q),
          like(schema.customers.name, q),
          like(schema.customers.company, q),
        )!,
      );
    }
    const where = and(...conditions);

    const [countRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.customers)
      .where(where);
    const rows = await db
      .select({
        id: schema.customers.id,
        workspaceId: schema.customers.workspaceId,
        userId: schema.customers.userId,
        email: schema.customers.email,
        name: schema.customers.name,
        company: schema.customers.company,
        phone: schema.customers.phone,
        status: schema.customers.status,
        source: schema.customers.source,
        createdAt: schema.customers.createdAt,
        updatedAt: schema.customers.updatedAt,
        username: schema.users.username,
        workspaceSlug: schema.workspaces.slug,
        workspaceName: schema.workspaces.name,
      })
      .from(schema.customers)
      .leftJoin(schema.users, eq(schema.users.id, schema.customers.userId))
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.customers.workspaceId))
      .where(where)
      .orderBy(desc(schema.customers.createdAt))
      .offset(offset)
      .limit(limit);

    return c.json(paginatedResponse(rows, countRow.total, offset, limit));
  })

  // Aggregate issue counts across the user's workspaces. Template: routes/analytics.ts.
  .get("/analytics/overview", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const ids = await workspaceRepo.listIdsByUser(db, user.sub);
    if (!ids.length) {
      return c.json({
        total_issues: 0,
        open_issues: 0,
        closed_issues: 0,
        overdue_issues: 0,
        total_trend: 0,
        open_trend: 0,
        closed_trend: 0,
        overdue_trend: 0,
      });
    }

    const base = and(inArray(schema.issues.workspaceId, ids), isNull(schema.issues.deletedAt));
    const [totalRow] = await db.select({ n: count() }).from(schema.issues).where(base);
    const [openRow] = await db
      .select({ n: count() })
      .from(schema.issues)
      .where(and(base, isNull(schema.issues.completedAt)));
    const [closedRow] = await db
      .select({ n: count() })
      .from(schema.issues)
      .where(and(base, isNotNull(schema.issues.completedAt)));

    return c.json({
      total_issues: totalRow.n,
      open_issues: openRow.n,
      closed_issues: closedRow.n,
      overdue_issues: 0,
      total_trend: 0,
      open_trend: 0,
      closed_trend: 0,
      overdue_trend: 0,
    });
  })

  // Trend/sprint aggregations are deferred (per-workspace versions are stubs too).
  .get("/analytics/completion-trend", (c) => c.json({ trend: [] }))
  .get("/analytics/sprints", (c) => c.json({ active_sprints: [] }));

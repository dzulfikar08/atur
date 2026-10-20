// Cross-workspace ("All Workspaces") endpoints. Every handler scopes queries to
// the set of workspace IDs the current user owns or belongs to, then merges
// rows with their parent workspace (slug + name) so the client can build nav
// links and group by workspace. Mounted at /api/me (authed globally via
// app.use('/api/*', authMiddleware)).
import { Hono } from "hono";
import {
  type AnyColumn,
  type SQL,
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { paginationParams, paginatedResponse } from "../lib/pagination";
import * as schema from "../db/schema";
import * as workspaceRepo from "../repositories/workspaces";
import * as issuesService from "../services/issues";
import * as hiddenWorkspaces from "../services/hiddenWorkspaces";
import { parseOr400 } from "../lib/validate";

type Db = ReturnType<typeof getDb>;

/** YYYY-MM-DD prefix of a date/datetime text column. */
const dateOnly = (col: AnyColumn) => sql<string>`substr(${col}, 1, 10)`;

function todayDates(raw: string | undefined): {
  today: string;
  weekEnd: string;
} {
  const today =
    raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  return { today, weekEnd: end.toISOString().slice(0, 10) };
}

/** Accepts a workspace slug or id; only workspaces the user belongs to resolve. */
async function resolveWorkspaceId(db: Db, ids: string[], slugOrId: string) {
  const [row] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(
      and(
        inArray(schema.workspaces.id, ids),
        or(eq(schema.workspaces.id, slugOrId), eq(schema.workspaces.slug, slugOrId)),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

const liveAssignments = (db: Db) =>
  db
    .select({ id: schema.issueAssignees.issueId })
    .from(schema.issueAssignees)
    .where(isNull(schema.issueAssignees.deletedAt));

function assignedToMe(db: Db, userId: string) {
  return inArray(
    schema.issues.id,
    db
      .select({ id: schema.issueAssignees.issueId })
      .from(schema.issueAssignees)
      .where(
        and(eq(schema.issueAssignees.assigneeId, userId), isNull(schema.issueAssignees.deletedAt)),
      ),
  );
}

function unassignedInOwnedWorkspace(db: Db, userId: string) {
  return and(
    notInArray(schema.issues.id, liveAssignments(db)),
    inArray(
      schema.issues.workspaceId,
      db
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.ownerId, userId)),
    ),
  );
}

/** Not in a completed or cancelled state group (a stateless issue counts as open). */
function isOpen(db: Db): SQL {
  return sql`${or(
    isNull(schema.issues.stateId),
    notInArray(
      schema.issues.stateId,
      db
        .select({ id: schema.states.id })
        .from(schema.states)
        .where(inArray(schema.states.groupName, ["completed", "cancelled"])),
    ),
  )}`;
}

const SORT_COLUMNS = {
  updated_at: schema.issues.updatedAt,
  created_at: schema.issues.createdAt,
  sequence_id: schema.issues.sequenceId,
  target_date: schema.issues.targetDate,
  start_date: schema.issues.startDate,
  name: schema.issues.name,
} as const;

function orderFor(sort: string | undefined) {
  const [field, dir] = (sort ?? "updated_at:desc").split(":");
  const col = SORT_COLUMNS[field as keyof typeof SORT_COLUMNS] ?? schema.issues.updatedAt;
  const ordered = dir === "asc" ? asc(col) : desc(col);
  // Dated sorts keep undated issues last in both directions.
  return field === "target_date" || field === "start_date"
    ? [sql`${col} is null`, ordered]
    : [ordered];
}

// Lean projection: list rows never need the description bodies.
const {
  descriptionHtml: _html,
  descriptionJson: _json,
  descriptionStripped: _stripped,
  descriptionBinary: _binary,
  ...LEAN_ISSUE_COLUMNS
} = getTableColumns(schema.issues);

function selectIssueRows(
  db: Db,
  where: ReturnType<typeof and>,
  order: ReturnType<typeof orderFor>,
  offset: number,
  limit: number,
) {
  return db
    .select({
      issue: LEAN_ISSUE_COLUMNS,
      projectName: schema.projects.name,
      projectIdentifier: schema.projects.identifier,
      workspaceSlug: schema.workspaces.slug,
      workspaceName: schema.workspaces.name,
    })
    .from(schema.issues)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.issues.projectId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.issues.workspaceId))
    .where(where)
    .orderBy(...order)
    .offset(offset)
    .limit(limit);
}

async function enrichRows(db: Db, rows: Awaited<ReturnType<typeof selectIssueRows>>) {
  const enriched = await issuesService.enrichIssues(
    db,
    rows.map((r) => r.issue),
  );
  return enriched.map((e, i) => ({
    ...e,
    projectName: rows[i].projectName,
    projectIdentifier: rows[i].projectIdentifier,
    workspaceSlug: rows[i].workspaceSlug,
    workspaceName: rows[i].workspaceName,
  }));
}

export const meRoutes = new Hono<{ Bindings: Env }>({ strict: false })

  // Workspaces the user hid from their own switcher (syncs across devices).
  // Presentation only — /api/workspaces, MCP and API keys still list everything.
  .get("/hidden-workspaces", async (c) => {
    const db = getDb(c.env.DB);
    const ids = await hiddenWorkspaces.list(db, c.get("user").sub);
    return c.json({ workspace_ids: ids });
  })
  // Body { hide?: id[], show?: id[] } (ids, not slugs). Returns the new list.
  .patch("/hidden-workspaces", async (c) => {
    const db = getDb(c.env.DB);
    const body = parseOr400(
      hiddenWorkspaces.updateHiddenWorkspacesSchema,
      await c.req.json().catch(() => null),
    );
    const ids = await hiddenWorkspaces.update(db, c.get("user").sub, body);
    return c.json({ workspace_ids: ids });
  })

  // Recent + filterable issues across all the user's workspaces. Each row is
  // enriched (state/assignees/labels) and tagged with project + workspace fields
  // so the UI can link to /<workspace_slug>/projects/<project_id>/issues/<seq>.
  // Params: workspace (slug or id), assignee=me, due=overdue|today|week,
  // state_key (comma list), sort=<field>:<asc|desc>, q|search, today=YYYY-MM-DD.
  .get("/issues", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const ids = await workspaceRepo.listIdsByUser(db, user.sub);
    if (!ids.length) return c.json(paginatedResponse([], 0, 0, 50));

    const state = c.req.query("state");
    const priority = c.req.query("priority");
    const search = c.req.query("q") ?? c.req.query("search");
    const workspace = c.req.query("workspace"); // workspace slug or id
    const project = c.req.query("project"); // project id
    const stateKeys = (c.req.query("state_key") ?? "").split(",").filter(Boolean);
    const group = c.req.query("group"); // backlog|started|completed|cancelled
    const assignee = c.req.query("assignee");
    const due = c.req.query("due");
    const { offset, limit } = paginationParams(c);
    const dates = todayDates(c.req.query("today"));

    const conditions = [inArray(schema.issues.workspaceId, ids), isNull(schema.issues.deletedAt)];
    if (workspace) {
      const wsId = await resolveWorkspaceId(db, ids, workspace);
      // An unknown or foreign workspace matches nothing rather than everything.
      if (!wsId) return c.json(paginatedResponse([], 0, offset, limit));
      conditions.push(eq(schema.issues.workspaceId, wsId));
    }
    if (state) conditions.push(eq(schema.issues.stateId, state));
    // Canonical filters (ATUR-3): state UUIDs are per-project rows, so
    // cross-workspace filtering must resolve through the states table.
    if (stateKeys.length)
      conditions.push(
        inArray(
          schema.issues.stateId,
          db
            .select({ id: schema.states.id })
            .from(schema.states)
            .where(and(inArray(schema.states.key, stateKeys), isNull(schema.states.deletedAt))),
        ),
      );
    if (group)
      conditions.push(
        inArray(
          schema.issues.stateId,
          db
            .select({ id: schema.states.id })
            .from(schema.states)
            .where(and(eq(schema.states.groupName, group), isNull(schema.states.deletedAt))),
        ),
      );
    if (priority) conditions.push(eq(schema.issues.priority, priority));
    if (search) conditions.push(like(schema.issues.name, `%${search}%`));
    if (project) conditions.push(eq(schema.issues.projectId, project));
    if (assignee === "me") conditions.push(assignedToMe(db, user.sub));
    if (due === "overdue" || due === "today" || due === "week") {
      const target = dateOnly(schema.issues.targetDate);
      if (due === "overdue") {
        conditions.push(lt(target, dates.today), isOpen(db));
      } else if (due === "today") {
        conditions.push(eq(target, dates.today));
      } else {
        conditions.push(gte(target, dates.today), lte(target, dates.weekEnd));
      }
    }
    const where = and(...conditions);

    // Count without the display joins — every condition is issues-scoped, and
    // total must describe the full filtered set, not just this page.
    const [countRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.issues)
      .where(where);

    const rows = await selectIssueRows(db, where, orderFor(c.req.query("sort")), offset, limit);
    return c.json(paginatedResponse(await enrichRows(db, rows), countRow.total, offset, limit));
  })

  // The owner's "what do I do today" buckets. Scope: issues assigned to me, or
  // unassigned in workspaces I own. Each open issue lands in exactly one bucket,
  // by precedence: overdue > due_today > needs_you > need_review > in_progress
  // > due_this_week. `today` is the client's local date (YYYY-MM-DD).
  .get("/today", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const empty = {
      overdue: [],
      due_today: [],
      needs_you: [],
      need_review: [],
      in_progress: [],
      due_this_week: [],
      counts: {
        overdue: 0,
        due_today: 0,
        needs_you: 0,
        need_review: 0,
        in_progress: 0,
        due_this_week: 0,
        total: 0,
      },
    };
    const ids = await workspaceRepo.listIdsByUser(db, user.sub);
    if (!ids.length) return c.json(empty);

    const dates = todayDates(c.req.query("today"));
    const workspace = c.req.query("workspace");
    const scope = [inArray(schema.issues.workspaceId, ids), isNull(schema.issues.deletedAt)];
    if (workspace && workspace !== "all") {
      const wsId = await resolveWorkspaceId(db, ids, workspace);
      if (!wsId) return c.json(empty);
      scope.push(eq(schema.issues.workspaceId, wsId));
    }

    const target = dateOnly(schema.issues.targetDate);
    const start = dateOnly(schema.issues.startDate);
    const where = and(
      ...scope,
      isOpen(db),
      or(assignedToMe(db, user.sub), unassignedInOwnedWorkspace(db, user.sub)),
      or(
        lte(target, dates.weekEnd),
        lte(start, dates.today),
        inArray(
          schema.issues.stateId,
          db
            .select({ id: schema.states.id })
            .from(schema.states)
            .where(
              and(
                inArray(schema.states.key, ["needs_you", "need_review", "in_progress"]),
                isNull(schema.states.deletedAt),
              ),
            ),
        ),
      ),
    );

    const rows = await selectIssueRows(db, where, orderFor("target_date:asc"), 0, 500);
    const issues = await enrichRows(db, rows);

    const out = structuredClone(empty) as unknown as Record<string, unknown[]> & {
      counts: Record<string, number>;
    };
    for (const issue of issues) {
      const key = issue.state?.key ?? null;
      const t = typeof issue.targetDate === "string" ? issue.targetDate.slice(0, 10) : null;
      const s = typeof issue.startDate === "string" ? issue.startDate.slice(0, 10) : null;
      let bucket: string | null = null;
      if (t && t < dates.today) bucket = "overdue";
      else if (t === dates.today) bucket = "due_today";
      else if (key === "needs_you") bucket = "needs_you";
      else if (key === "need_review") bucket = "need_review";
      else if (key === "in_progress" || (s && s <= dates.today && (!t || t >= dates.today)))
        bucket = "in_progress";
      else if (t && t <= dates.weekEnd) bucket = "due_this_week";
      if (!bucket) continue;
      out[bucket].push(issue);
      out.counts[bucket]++;
      out.counts.total++;
    }
    return c.json(out);
  })

  // Per-workspace, per-canonical-state issue counts plus the oldest
  // updated_at in each bucket — the "is anything stagnating?" portfolio
  // rollup (ATUR-3). Feeds Status filter counts and the daily handling view.
  // CRM pipeline projects are excluded: sales stages are not the workflow.
  .get("/state-summary", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const ids = await workspaceRepo.listIdsByUser(db, user.sub);
    if (!ids.length) return c.json({ results: [] });

    const rows = await db
      .select({
        workspaceId: schema.workspaces.id,
        workspaceSlug: schema.workspaces.slug,
        workspaceName: schema.workspaces.name,
        stateKey: schema.states.key,
        group: schema.states.groupName,
        count: sql<number>`count(*)`,
        oldestUpdatedAt: sql<string | null>`min(${schema.issues.updatedAt})`,
      })
      .from(schema.issues)
      .innerJoin(schema.states, eq(schema.states.id, schema.issues.stateId))
      .innerJoin(schema.projects, eq(schema.projects.id, schema.issues.projectId))
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.issues.workspaceId))
      .where(
        and(
          inArray(schema.issues.workspaceId, ids),
          isNull(schema.issues.deletedAt),
          isNull(schema.states.deletedAt),
          eq(schema.projects.isPipeline, 0),
        ),
      )
      .groupBy(
        schema.workspaces.id,
        schema.workspaces.slug,
        schema.workspaces.name,
        schema.states.key,
        schema.states.groupName,
      );

    return c.json({ results: rows });
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
          like(schema.customers.threadsUsername, q),
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
        threadsUsername: schema.customers.threadsUsername,
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

  // ── Portfolio strategy (DEV-22) ──
  // All the user's workspaces with their Moat × AI-proof scores plus the two
  // most recent workspace_score_history rows per workspace. The client derives
  // trend arrows by comparing current values against the newest history row
  // that differs from them.
  .get("/strategy", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const ids = await workspaceRepo.listIdsByUser(db, user.sub);
    if (!ids.length) return c.json({ results: [] });

    const rows = await db
      .select({
        id: schema.workspaces.id,
        slug: schema.workspaces.slug,
        name: schema.workspaces.name,
        logo: schema.workspaces.logo,
        moatScore: schema.workspaces.moatScore,
        aiProofScore: schema.workspaces.aiProofScore,
        strategyVerdict: schema.workspaces.strategyVerdict,
        strategyNote: schema.workspaces.strategyNote,
        reviewedAt: schema.workspaces.reviewedAt,
      })
      .from(schema.workspaces)
      .where(and(inArray(schema.workspaces.id, ids), isNull(schema.workspaces.deletedAt)));

    const history = await db
      .select({
        workspaceId: schema.workspaceScoreHistory.workspaceId,
        moatScore: schema.workspaceScoreHistory.moatScore,
        aiProofScore: schema.workspaceScoreHistory.aiProofScore,
        strategyVerdict: schema.workspaceScoreHistory.strategyVerdict,
        strategyNote: schema.workspaceScoreHistory.strategyNote,
        createdAt: schema.workspaceScoreHistory.createdAt,
      })
      .from(schema.workspaceScoreHistory)
      .where(inArray(schema.workspaceScoreHistory.workspaceId, ids))
      .orderBy(desc(schema.workspaceScoreHistory.createdAt));

    // Keep only the two newest rows per workspace (desc scan, first two wins).
    const byWorkspace = new Map<string, typeof history>();
    for (const h of history) {
      const list = byWorkspace.get(h.workspaceId) ?? [];
      if (list.length < 2) {
        list.push(h);
        byWorkspace.set(h.workspaceId, list);
      }
    }

    const results = rows.map((w) => ({
      id: w.id,
      slug: w.slug,
      name: w.name,
      logo: w.logo,
      moatScore: w.moatScore,
      aiProofScore: w.aiProofScore,
      strategyVerdict: w.strategyVerdict,
      strategyNote: w.strategyNote,
      reviewedAt: w.reviewedAt,
      history: (byWorkspace.get(w.id) ?? []).map((h) => ({
        moatScore: h.moatScore,
        aiProofScore: h.aiProofScore,
        strategyVerdict: h.strategyVerdict,
        strategyNote: h.strategyNote,
        createdAt: h.createdAt,
      })),
    }));
    return c.json({ results });
  })

  // Open decision issues (is_decision=1) across the user's workspaces — the
  // portfolio "what needs deciding" inbox (DEV-22). Dated decisions first
  // ascending by due date; undated last by recency.
  .get("/decisions", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const ids = await workspaceRepo.listIdsByUser(db, user.sub);
    if (!ids.length) return c.json({ results: [] });

    const rows = await db
      .select({
        id: schema.issues.id,
        name: schema.issues.name,
        sequenceId: schema.issues.sequenceId,
        priority: schema.issues.priority,
        targetDate: schema.issues.targetDate,
        updatedAt: schema.issues.updatedAt,
        projectId: schema.projects.id,
        projectName: schema.projects.name,
        projectIdentifier: schema.projects.identifier,
        workspaceSlug: schema.workspaces.slug,
        workspaceName: schema.workspaces.name,
        stateName: schema.states.name,
        stateColor: schema.states.color,
      })
      .from(schema.issues)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.issues.projectId))
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.issues.workspaceId))
      .leftJoin(schema.states, eq(schema.states.id, schema.issues.stateId))
      .where(
        and(
          inArray(schema.issues.workspaceId, ids),
          eq(schema.issues.isDecision, 1),
          isNull(schema.issues.deletedAt),
          isNull(schema.issues.completedAt),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${schema.issues.targetDate} IS NULL THEN 1 ELSE 0 END`,
        sql`${schema.issues.targetDate} ASC`,
        desc(schema.issues.updatedAt),
      )
      .limit(200);

    return c.json({ results: rows });
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

    const [overdueRow] = await db
      .select({ n: count() })
      .from(schema.issues)
      .where(
        and(base, isOpen(db), lt(dateOnly(schema.issues.targetDate), todayDates(undefined).today)),
      );

    return c.json({
      total_issues: totalRow.n,
      open_issues: openRow.n,
      closed_issues: closedRow.n,
      overdue_issues: overdueRow.n,
      total_trend: 0,
      open_trend: 0,
      closed_trend: 0,
      overdue_trend: 0,
    });
  })

  // Trend/sprint aggregations are deferred (per-workspace versions are stubs too).
  .get("/analytics/completion-trend", (c) => c.json({ trend: [] }))
  .get("/analytics/sprints", (c) => c.json({ active_sprints: [] }));

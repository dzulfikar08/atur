// Cross-workspace "my work" queries behind GET /api/me/issues, GET /api/me/today
// and the MCP my_issues / my_today tools. Every query is scoped to the
// workspaces the user owns or belongs to.
import {
  type AnyColumn,
  type SQL,
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as workspaceRepo from "../repositories/workspaces";
import { issueTextCondition } from "../repositories/issues";
import * as issuesService from "./issues";

type Db = DbClient;

/** YYYY-MM-DD prefix of a date/datetime text column. */
export const dateOnly = (col: AnyColumn) => sql<string>`substr(${col}, 1, 10)`;

export function todayDates(raw: string | undefined): {
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
export function isOpen(db: Db): SQL {
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

export type MyIssueRow = Awaited<ReturnType<typeof enrichRows>>[number];

export interface ListMyIssuesParams {
  state?: string;
  priority?: string;
  search?: string;
  /** Workspace slug or id. */
  workspace?: string;
  /** Project id. */
  project?: string;
  stateKeys?: string[];
  /** backlog | started | completed | cancelled */
  group?: string;
  /** `me` restricts to issues assigned to the caller. */
  assignee?: string;
  due?: string;
  sort?: string;
  /** Client-local date, YYYY-MM-DD. */
  today?: string;
  offset: number;
  limit: number;
}

/**
 * Recent + filterable issues across the user's workspaces. `member` is false
 * when the user belongs to no workspace at all (callers shape that case
 * differently from "filters matched nothing").
 */
export async function listMyIssues(
  db: Db,
  userId: string,
  params: ListMyIssuesParams,
): Promise<{ member: boolean; results: MyIssueRow[]; total: number }> {
  const ids = await workspaceRepo.listIdsByUser(db, userId);
  if (!ids.length) return { member: false, results: [], total: 0 };

  const { state, priority, search, workspace, project, group, assignee, due, offset, limit } =
    params;
  const stateKeys = params.stateKeys ?? [];
  const dates = todayDates(params.today);

  const conditions = [inArray(schema.issues.workspaceId, ids), isNull(schema.issues.deletedAt)];
  if (workspace) {
    const wsId = await resolveWorkspaceId(db, ids, workspace);
    // An unknown or foreign workspace matches nothing rather than everything.
    if (!wsId) return { member: true, results: [], total: 0 };
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
  if (search?.trim()) conditions.push(issueTextCondition(search));
  if (project) conditions.push(eq(schema.issues.projectId, project));
  if (assignee === "me") conditions.push(assignedToMe(db, userId));
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

  const rows = await selectIssueRows(db, where, orderFor(params.sort), offset, limit);
  return { member: true, results: await enrichRows(db, rows), total: countRow.total };
}

export const TODAY_BUCKETS = [
  "overdue",
  "due_today",
  "needs_you",
  "need_review",
  "in_progress",
  "due_this_week",
] as const;

export type TodayBucket = (typeof TODAY_BUCKETS)[number];

export type TodayResult = Record<TodayBucket, MyIssueRow[]> & {
  counts: Record<TodayBucket | "total", number>;
};

function emptyToday(): TodayResult {
  return {
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
}

export interface TodayParams {
  /** Workspace slug or id; `all` or omitted = every workspace. */
  workspace?: string;
  /** Client-local date, YYYY-MM-DD. */
  today?: string;
}

/**
 * The owner's "what do I do today" buckets. Scope: issues assigned to me, or
 * unassigned in workspaces I own. Each open issue lands in exactly one bucket,
 * by precedence: overdue > due_today > needs_you > need_review > in_progress
 * > due_this_week.
 */
export async function todayBuckets(
  db: Db,
  userId: string,
  params: TodayParams,
): Promise<TodayResult> {
  const out = emptyToday();
  const ids = await workspaceRepo.listIdsByUser(db, userId);
  if (!ids.length) return out;

  const dates = todayDates(params.today);
  const { workspace } = params;
  const scope = [inArray(schema.issues.workspaceId, ids), isNull(schema.issues.deletedAt)];
  if (workspace && workspace !== "all") {
    const wsId = await resolveWorkspaceId(db, ids, workspace);
    if (!wsId) return out;
    scope.push(eq(schema.issues.workspaceId, wsId));
  }

  const target = dateOnly(schema.issues.targetDate);
  const start = dateOnly(schema.issues.startDate);
  const where = and(
    ...scope,
    isOpen(db),
    or(assignedToMe(db, userId), unassignedInOwnedWorkspace(db, userId)),
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

  for (const issue of issues) {
    const key = issue.state?.key ?? null;
    const t = typeof issue.targetDate === "string" ? issue.targetDate.slice(0, 10) : null;
    const s = typeof issue.startDate === "string" ? issue.startDate.slice(0, 10) : null;
    let bucket: TodayBucket | null = null;
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
  return out;
}

/** Slim, camelCase row the MCP my_issues / my_today tools return. */
export function toMcpIssueRow(issue: MyIssueRow) {
  return {
    id: issue.id,
    name: issue.name,
    sequenceId: issue.sequenceId,
    key: `${issue.projectIdentifier}-${issue.sequenceId}`,
    priority: issue.priority,
    stateId: issue.stateId,
    stateKey: issue.state?.key ?? null,
    stateName: issue.state?.name ?? null,
    stateGroup: issue.state?.group ?? null,
    projectId: issue.projectId,
    projectName: issue.projectName,
    projectIdentifier: issue.projectIdentifier,
    workspaceSlug: issue.workspaceSlug,
    workspaceName: issue.workspaceName,
    targetDate: issue.targetDate,
    updatedAt: issue.updatedAt,
    assignees: issue.assignees.map((a) => ({ id: a.id, displayName: a.displayName })),
  };
}

export type McpIssueRow = ReturnType<typeof toMcpIssueRow>;

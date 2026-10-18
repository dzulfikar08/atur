import {
  eq,
  and,
  or,
  like,
  desc,
  asc,
  sql,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  getTableColumns,
  type SQL,
} from "drizzle-orm";
import type { DbClient } from "../db/index";
import {
  issues,
  issueAssignees,
  issueLabels,
  labels,
  states,
  users,
  issueSequences,
  issueSequenceCounters,
} from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export async function findById(db: DbClient, id: string) {
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, id), isNull(issues.deletedAt)))
    .limit(1);
  return issue;
}

// Frontend addresses issues by sequence id in URLs (e.g. /issues/1) but also by
// UUID elsewhere. Resolve either form to the issue row within a project.
// BOTH branches are scoped to the bound project — the UUID branch used to fall
// through to a bare findById, letting a caller resolve a foreign workspace's
// issue by pasting its UUID under their own project path (cross-workspace
// IDOR). A UUID from another project now resolves to nothing (→ 404).
export async function resolveIssue(db: DbClient, projectId: string, identifier: string) {
  if (/^\d+$/.test(identifier)) {
    const [row] = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.projectId, projectId),
          eq(issues.sequenceId, Number(identifier)),
          isNull(issues.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }
  const [row] = await db
    .select()
    .from(issues)
    .where(
      and(eq(issues.projectId, projectId), eq(issues.id, identifier), isNull(issues.deletedAt)),
    )
    .limit(1);
  return row ?? null;
}

export type IssueListOpts = {
  offset: number;
  limit: number;
  /** Legacy single state uuid (MCP back-compat). */
  state?: string;
  /** State keys (todo, in_progress, …) resolved within the project. */
  stateKeys?: string[];
  /** Priorities (urgent|high|medium|low|none). */
  priorities?: string[];
  search?: string;
  /** Label uuids. */
  labels?: string[];
  /** User uuids, plus "none" for unassigned. "me" is resolved by the caller. */
  assignees?: string[];
  /** Product names derived from the name prefix ("[X] …" or "X: …"). */
  products?: string[];
  due?: "overdue" | "today" | "week" | "none" | "any";
  /** Caller-local YYYY-MM-DD, defaults to the UTC date. */
  today?: string;
  /** Hide completed + cancelled state groups. */
  hideDone?: boolean;
  sort?: string;
  /** Include description_* columns (default: lean rows). */
  full?: boolean;
};

// Lean projection: list rows never need the description bodies (HTML/JSON/
// stripped/binary) nor bookkeeping columns the client types don't read.
const {
  descriptionHtml: _html,
  descriptionJson: _json,
  descriptionStripped: _stripped,
  descriptionBinary: _binary,
  sortOrder: _sortOrder,
  archivedAt: _archivedAt,
  deletedAt: _deletedAt,
  typeId: _typeId,
  estimatePointId: _estimatePointId,
  externalId: _externalId,
  createdById: _createdById,
  ...leanColumns
} = getTableColumns(issues);
export const LEAN_ISSUE_COLUMNS = leanColumns;

const SORT_COLUMNS = {
  updated_at: issues.updatedAt,
  created_at: issues.createdAt,
  sequence_id: issues.sequenceId,
  target_date: issues.targetDate,
  start_date: issues.startDate,
  name: issues.name,
} as const;

const PRIORITY_RANK = sql`CASE ${issues.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;

// Workflow order: backlog, unstarted, started, completed, cancelled, then the
// state's own sequence, so equal `65535` sequences stay deterministic.
const STATE_GROUP_RANK = sql`CASE ${states.groupName} WHEN 'backlog' THEN 0 WHEN 'unstarted' THEN 1 WHEN 'started' THEN 2 WHEN 'completed' THEN 3 WHEN 'cancelled' THEN 4 ELSE 5 END`;

function orderFor(sort: string | undefined) {
  const [field, dirRaw] = (sort ?? "sequence_id:desc").split(":");
  const dir = dirRaw === "asc" ? asc : desc;
  if (field === "priority") return [dir(PRIORITY_RANK), desc(issues.sequenceId)];
  if (field === "state") {
    return [
      dir(sql`(SELECT ${STATE_GROUP_RANK} FROM ${states} WHERE ${states.id} = ${issues.stateId})`),
      dir(sql`(SELECT ${states.sequence} FROM ${states} WHERE ${states.id} = ${issues.stateId})`),
      desc(issues.sequenceId),
    ];
  }
  const col = SORT_COLUMNS[field as keyof typeof SORT_COLUMNS] ?? issues.sequenceId;
  // Dated sorts keep undated issues last in both directions.
  return field === "target_date" || field === "start_date"
    ? [sql`${col} IS NULL`, dir(col), desc(issues.sequenceId)]
    : [dir(col), desc(issues.sequenceId)];
}

/** `^\[([^\]]+)\]` or `^([^:\s]{1,24}):` prefix match on the issue name (LIKE is case-insensitive). */
function productCondition(products: string[]) {
  const escape = (s: string) => s.replace(/[\\%_]/g, "\\$&");
  return or(
    ...products.flatMap((p) => [
      sql`${issues.name} LIKE ${`[${escape(p)}]%`} ESCAPE '\\'`,
      sql`${issues.name} LIKE ${`${escape(p)}:%`} ESCAPE '\\'`,
    ]),
  )!;
}

function dueCondition(due: NonNullable<IssueListOpts["due"]>, todayRaw: string | undefined) {
  const today =
    todayRaw && /^\d{4}-\d{2}-\d{2}$/.test(todayRaw)
      ? todayRaw
      : new Date().toISOString().slice(0, 10);
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  const weekEnd = end.toISOString().slice(0, 10);
  const day = sql`substr(${issues.targetDate}, 1, 10)`;
  switch (due) {
    case "overdue":
      return and(isNotNull(issues.targetDate), sql`${day} < ${today}`, openStateCondition());
    case "today":
      return sql`${day} = ${today}`;
    case "week":
      return and(sql`${day} >= ${today}`, sql`${day} <= ${weekEnd}`);
    case "none":
      return isNull(issues.targetDate);
    default:
      return undefined;
  }
}

/** Not in a completed or cancelled state group (a stateless issue counts as open). */
function openStateCondition() {
  return or(
    isNull(issues.stateId),
    notInArray(
      issues.stateId,
      sql`(SELECT ${states.id} FROM ${states} WHERE ${states.groupName} IN ('completed', 'cancelled'))`,
    ),
  )!;
}

export async function listByProject(db: DbClient, projectId: string, opts: IssueListOpts) {
  const conditions: (SQL | undefined)[] = [
    eq(issues.projectId, projectId),
    isNull(issues.deletedAt),
  ];
  if (opts.state) conditions.push(eq(issues.stateId, opts.state));
  if (opts.stateKeys?.length) {
    conditions.push(
      inArray(
        issues.stateId,
        db
          .select({ id: states.id })
          .from(states)
          .where(
            and(
              eq(states.projectId, projectId),
              inArray(states.key, opts.stateKeys),
              isNull(states.deletedAt),
            ),
          ),
      ),
    );
  }
  if (opts.priorities?.length) conditions.push(inArray(issues.priority, opts.priorities));
  if (opts.search) conditions.push(like(issues.name, `%${opts.search}%`));
  if (opts.hideDone) conditions.push(openStateCondition());
  if (opts.products?.length) conditions.push(productCondition(opts.products));
  if (opts.due) conditions.push(dueCondition(opts.due, opts.today));

  if (opts.assignees?.length) {
    const wantsNone = opts.assignees.includes("none");
    const ids = opts.assignees.filter((a) => a !== "none");
    const live = db
      .select({ issueId: issueAssignees.issueId })
      .from(issueAssignees)
      .where(isNull(issueAssignees.deletedAt));
    const parts: (SQL | undefined)[] = [];
    if (ids.length) {
      parts.push(
        inArray(
          issues.id,
          db
            .select({ issueId: issueAssignees.issueId })
            .from(issueAssignees)
            .where(and(inArray(issueAssignees.assigneeId, ids), isNull(issueAssignees.deletedAt))),
        ),
      );
    }
    if (wantsNone) parts.push(notInArray(issues.id, live));
    conditions.push(or(...parts));
  }

  if (opts.labels && opts.labels.length > 0) {
    const labelIssueIds = db
      .select({ issueId: issueLabels.issueId })
      .from(issueLabels)
      .where(and(inArray(issueLabels.labelId, opts.labels), isNull(issueLabels.deletedAt)));
    conditions.push(inArray(issues.id, labelIssueIds));
  }

  const where = and(...conditions);

  // Count and page are independent: one round trip each, in parallel.
  const [[countRow], rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)` })
      .from(issues)
      .where(where),
    (opts.full ? db.select() : db.select(LEAN_ISSUE_COLUMNS))
      .from(issues)
      .where(where)
      .orderBy(...orderFor(opts.sort))
      .offset(opts.offset)
      .limit(opts.limit),
  ]);

  return { data: rows, total: countRow.total };
}

export async function listByParent(db: DbClient, parentId: string) {
  const rows = await db
    .select(LEAN_ISSUE_COLUMNS)
    .from(issues)
    .where(and(eq(issues.parentId, parentId), isNull(issues.deletedAt)))
    .orderBy(desc(issues.sequenceId));
  return rows;
}

export async function create(
  db: DbClient,
  data: {
    id: string;
    name: string;
    sequenceId?: number;
    projectId: string;
    workspaceId: string;
    priority?: string;
    descriptionHtml?: string;
    stateId?: string;
    createdById?: string;
    sortOrder?: number;
    startDate?: string;
    targetDate?: string;
    estimatePoints?: number | null;
    parentId?: string | null;
    isDecision?: number;
  },
) {
  const now = nowISO();
  // Atomic allocation: concurrent creators get distinct sequence ids via the
  // per-project counter (UPDATE ... RETURNING), no retry loop needed. An
  // explicit sequenceId is still honored for imports/backfills.
  const sequenceId = data.sequenceId ?? (await allocateNextSequence(db, data.projectId));
  const row: typeof issues.$inferInsert = {
    id: data.id,
    name: data.name,
    sequenceId,
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    priority: data.priority ?? "none",
    descriptionHtml: data.descriptionHtml ?? null,
    stateId: data.stateId ?? null,
    createdById: data.createdById ?? null,
    sortOrder: data.sortOrder ?? 65535.0,
    startDate: data.startDate ?? null,
    targetDate: data.targetDate ?? null,
    estimatePoints: data.estimatePoints ?? null,
    parentId: data.parentId ?? null,
    isDecision: data.isDecision ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(issues).values(row);

  await db.insert(issueSequences).values({
    id: uuid(),
    sequence: row.sequenceId,
    issueId: data.id,
    projectId: data.projectId,
    isDeleted: 0,
    createdAt: now,
    updatedAt: now,
  });

  return findById(db, data.id);
}

export async function update(
  db: DbClient,
  id: string,
  data: {
    name?: string;
    descriptionHtml?: string;
    priority?: string;
    stateId?: string;
    sortOrder?: number;
    startDate?: string;
    targetDate?: string;
    estimatePoints?: number | null;
    archivedAt?: string;
    isDecision?: number;
    isDraft?: number;
    descriptionJson?: string;
    descriptionStripped?: string;
  },
) {
  await db
    .update(issues)
    .set({ ...data, updatedAt: nowISO() })
    .where(and(eq(issues.id, id), isNull(issues.deletedAt)));
  return findById(db, id);
}

export async function remove(db: DbClient, id: string) {
  const now = nowISO();
  await db.update(issues).set({ deletedAt: now, updatedAt: now }).where(eq(issues.id, id));
}

export async function addLabel(db: DbClient, issueId: string, labelId: string) {
  const now = nowISO();
  await db.insert(issueLabels).values({
    id: uuid(),
    issueId,
    labelId,
    createdAt: now,
    updatedAt: now,
  });
}

export async function removeLabel(db: DbClient, issueId: string, labelId: string) {
  const now = nowISO();
  await db
    .update(issueLabels)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(issueLabels.issueId, issueId),
        eq(issueLabels.labelId, labelId),
        isNull(issueLabels.deletedAt),
      ),
    );
}

export async function addAssignee(db: DbClient, issueId: string, assigneeId: string) {
  const now = nowISO();
  await db.insert(issueAssignees).values({
    id: uuid(),
    issueId,
    assigneeId,
    createdAt: now,
    updatedAt: now,
  });
}

export async function removeAssignee(db: DbClient, issueId: string, assigneeId: string) {
  const now = nowISO();
  await db
    .update(issueAssignees)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(issueAssignees.issueId, issueId),
        eq(issueAssignees.assigneeId, assigneeId),
        isNull(issueAssignees.deletedAt),
      ),
    );
}

// workspaceId is optional belt-and-braces (DEV-21): when given, legacy
// cross-workspace link rows render empty instead of leaking a foreign
// label's name/color. All write paths already bind ids (DEV-19/20).
export async function listLabels(db: DbClient, issueId: string, workspaceId?: string) {
  return db
    .select({
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(issueLabels)
    .innerJoin(labels, eq(issueLabels.labelId, labels.id))
    .where(
      and(
        eq(issueLabels.issueId, issueId),
        isNull(issueLabels.deletedAt),
        ...(workspaceId ? [eq(labels.workspaceId, workspaceId)] : []),
      ),
    );
}

// Same optional workspaceId belt-and-braces: an assignee only renders when
// they are an active member of that workspace (the owner is seeded as a
// member row at workspace creation).
export async function listAssignees(db: DbClient, issueId: string, workspaceId?: string) {
  return db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      isBot: users.isBot,
    })
    .from(issueAssignees)
    .innerJoin(users, eq(issueAssignees.assigneeId, users.id))
    .where(
      and(
        eq(issueAssignees.issueId, issueId),
        isNull(issueAssignees.deletedAt),
        ...(workspaceId
          ? [
              sql`EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.member_id = ${users.id} AND wm.workspace_id = ${workspaceId} AND wm.is_active = 1 AND wm.deleted_at IS NULL)`,
            ]
          : []),
      ),
    );
}

export async function getNextSequence(db: DbClient, projectId: string): Promise<number> {
  // Backstop for seeding/imports that predate the counter table: read the
  // max sequence id assigned so far (never reused — soft-deleted rows keep
  // theirs), which keeps the lazy-seeded counter ahead of existing data.
  const [row] = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(${issues.sequenceId}), 0)` })
    .from(issues)
    .where(eq(issues.projectId, projectId));
  return (row?.maxSeq ?? 0) + 1;
}

/**
 * Atomically allocate the next sequence id for a project.
 *
 * MAX(sequence_id)+1 is not atomic across concurrent creators: every creator
 * reads the same MAX and proposes the same number, the unique index lets one
 * through and the rest collide. With the old retry loop the k-th of k
 * concurrent creators needs k-1 retries, so 12+ concurrent creators
 * deterministically exhaust the 10-retry cap and 500.
 *
 * Instead a single-row counter per project is bumped with one
 * UPDATE ... RETURNING statement, which D1/SQLite executes atomically — two
 * concurrent callers always get two distinct numbers, no retries needed.
 * The row is seeded lazily (INSERT OR IGNORE from MAX(sequence_id)+1) so it
 * stays correct for rows created before this table existed.
 */
export async function allocateNextSequence(db: DbClient, projectId: string): Promise<number> {
  const now = nowISO();
  // Seed the counter row if it doesn't exist yet. Concurrent first-callers
  // race here; INSERT OR IGNORE means exactly one wins and the rest no-op.
  const seed = await db
    .insert(issueSequenceCounters)
    .values({
      projectId,
      nextSequence: 0, // placeholder — reconciled from MAX below
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ projectId: issueSequenceCounters.projectId });

  if (seed.length === 0) {
    // Another request created the row concurrently. Nothing to do — the
    // UPDATE below reads whatever value it has.
  } else {
    // We created the row: initialize it from MAX(sequence_id)+1 so it stays
    // ahead of any issues that predate the counter table. Guard with MAX so
    // we never LOWER a counter a concurrent creator already bumped between
    // our INSERT OR IGNORE and this UPDATE.
    const [row] = await db
      .select({ maxSeq: sql<number>`COALESCE(MAX(${issues.sequenceId}), 0)` })
      .from(issues)
      .where(eq(issues.projectId, projectId));
    const maxSeq = row?.maxSeq ?? 0;
    await db
      .update(issueSequenceCounters)
      .set({
        nextSequence: sql`MAX(${issueSequenceCounters.nextSequence}, ${maxSeq + 1})`,
        updatedAt: now,
      })
      .where(eq(issueSequenceCounters.projectId, projectId));
  }

  // Atomic bump: this single statement assigns a unique number even under
  // heavy concurrency. If another request just seeded the row (we lost the
  // INSERT OR IGNORE race), the UPDATE still finds it and returns a value.
  const bumped = await db
    .update(issueSequenceCounters)
    .set({
      nextSequence: sql`${issueSequenceCounters.nextSequence} + 1`,
      updatedAt: now,
    })
    .where(eq(issueSequenceCounters.projectId, projectId))
    .returning({ nextSequence: issueSequenceCounters.nextSequence });

  const next = bumped[0]?.nextSequence;
  if (next === undefined) {
    // Extremely unlikely: the row was deleted between seed and bump. Fall
    // back to the read-based allocator rather than looping.
    return getNextSequence(db, projectId);
  }
  return next;
}

/**
 * True when `error` is a unique-constraint violation: SQLite/D1 reports these as
 * "UNIQUE constraint failed: ..." (the `uq_issue_sequence` index on issues) and
 * Postgres reports SQLSTATE 23505. The D1 runtime wraps the driver error, so the
 * constraint detail can be nested several `cause` levels deep — walk the whole
 * chain before deciding. We only retry on these — never on NOT NULL or
 * foreign-key failures.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error;
  const parts: string[] = [];
  for (let depth = 0; depth < 8 && current != null; depth++) {
    const record = current as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.code === "string") parts.push(record.code);
    current = record.cause;
  }
  return /(^|[^a-z])23505($|[^a-z])|unique|uq_issue_sequence/i.test(parts.join(" "));
}

const MAX_SEQUENCE_RETRIES = 10;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** @deprecated Superseded by allocateNextSequence (atomic). Kept for imports/backfills that need the read-only MAX+1 form. */
export async function insertIssueWithRetry(
  db: DbClient,
  row: typeof issues.$inferInsert,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_SEQUENCE_RETRIES; attempt++) {
    try {
      await db.insert(issues).values(row);
      return;
    } catch (error) {
      if (attempt + 1 < MAX_SEQUENCE_RETRIES && isUniqueConstraintError(error)) {
        // 1–8ms jitter so concurrent retries don't all re-collide on the same
        // freshly-incremented MAX.
        await sleep(1 + Math.floor(Math.random() * 7));
        row.sequenceId = await getNextSequence(db, row.projectId);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not assign a unique issue sequence id after retries");
}

import { eq, and, desc, sql, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export interface DealRow {
  id: string;
  issueId: string;
  customerId: string | null;
  workspaceId: string;
  amountCents: number;
  currency: string;
  expectedCloseAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// Board-shaped deal: the underlying issue fields joined in for rendering the
// pipeline kanban (stage, name, sequence, sort order).
export interface DealBoardRow extends DealRow {
  sequenceId: number;
  name: string;
  stateId: string | null;
  stateName: string | null;
  stateColor: string | null;
  stateGroup: string | null;
  priority: string | null;
  sortOrder: number;
}

const dealSelect = {
  id: schema.deals.id,
  issueId: schema.deals.issueId,
  customerId: schema.deals.customerId,
  workspaceId: schema.deals.workspaceId,
  amountCents: schema.deals.amountCents,
  currency: schema.deals.currency,
  expectedCloseAt: schema.deals.expectedCloseAt,
  createdAt: schema.deals.createdAt,
  updatedAt: schema.deals.updatedAt,
};

const boardSelect = {
  ...dealSelect,
  sequenceId: schema.issues.sequenceId,
  name: schema.issues.name,
  stateId: schema.issues.stateId,
  stateName: schema.states.name,
  stateColor: schema.states.color,
  stateGroup: schema.states.groupName,
  priority: schema.issues.priority,
  sortOrder: schema.issues.sortOrder,
};

export async function create(
  db: DbClient,
  data: {
    issueId: string;
    customerId?: string | null;
    workspaceId: string;
    amountCents: number;
    currency: string;
    expectedCloseAt?: string | null;
  },
): Promise<DealRow> {
  const id = uuid();
  const now = nowISO();
  await db.insert(schema.deals).values({
    id,
    issueId: data.issueId,
    customerId: data.customerId ?? null,
    workspaceId: data.workspaceId,
    amountCents: data.amountCents,
    currency: data.currency,
    expectedCloseAt: data.expectedCloseAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db
    .select(dealSelect)
    .from(schema.deals)
    .where(eq(schema.deals.id, id))
    .limit(1);
  return row!;
}

// Resolve a deal by its underlying issue. When projectId is given, the join
// also scopes by project — used to close IDOR on project-scoped routes.
export async function getByIssue(
  db: DbClient,
  issueId: string,
  projectId?: string,
): Promise<DealRow | null> {
  const conditions = [eq(schema.deals.issueId, issueId)];
  if (projectId) conditions.push(eq(schema.issues.projectId, projectId));
  const [row] = await db
    .select(dealSelect)
    .from(schema.deals)
    .innerJoin(schema.issues, eq(schema.issues.id, schema.deals.issueId))
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

export async function listByProject(
  db: DbClient,
  projectId: string,
  opts: { stateId?: string; offset: number; limit: number },
): Promise<{ rows: DealBoardRow[]; total: number }> {
  const conditions = [eq(schema.issues.projectId, projectId), isNull(schema.issues.deletedAt)];
  if (opts.stateId) conditions.push(eq(schema.issues.stateId, opts.stateId));
  const where = and(...conditions);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.deals)
    .innerJoin(schema.issues, eq(schema.issues.id, schema.deals.issueId))
    .where(where);

  const rows = await db
    .select(boardSelect)
    .from(schema.deals)
    .innerJoin(schema.issues, eq(schema.issues.id, schema.deals.issueId))
    .leftJoin(schema.states, eq(schema.states.id, schema.issues.stateId))
    .where(where)
    .orderBy(schema.issues.sortOrder)
    .offset(opts.offset)
    .limit(opts.limit);

  return { rows, total: countRow.total };
}

export async function listByCustomer(db: DbClient, customerId: string): Promise<DealBoardRow[]> {
  return db
    .select(boardSelect)
    .from(schema.deals)
    .innerJoin(schema.issues, eq(schema.issues.id, schema.deals.issueId))
    .leftJoin(schema.states, eq(schema.states.id, schema.issues.stateId))
    .where(and(eq(schema.deals.customerId, customerId), isNull(schema.issues.deletedAt)))
    .orderBy(desc(schema.issues.sequenceId));
}

export async function update(
  db: DbClient,
  issueId: string,
  patch: {
    amountCents?: number;
    currency?: string;
    expectedCloseAt?: string | null;
    customerId?: string | null;
  },
): Promise<DealRow | null> {
  const set: Record<string, unknown> = { updatedAt: nowISO() };
  if (patch.amountCents !== undefined) set.amountCents = patch.amountCents;
  if (patch.currency !== undefined) set.currency = patch.currency;
  if (patch.expectedCloseAt !== undefined) set.expectedCloseAt = patch.expectedCloseAt;
  if (patch.customerId !== undefined) set.customerId = patch.customerId;
  await db.update(schema.deals).set(set).where(eq(schema.deals.issueId, issueId));
  return getByIssue(db, issueId);
}

// Per-stage rollup: SUM(amount_cents) and COUNT, grouped by the issue's state.
// Powers pipeline column totals on the board.
export async function aggregateByState(
  db: DbClient,
  projectId: string,
): Promise<{ stateId: string | null; totalCents: number; count: number }[]> {
  const rows = await db
    .select({
      stateId: schema.issues.stateId,
      totalCents: sql<number>`COALESCE(SUM(${schema.deals.amountCents}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(schema.deals)
    .innerJoin(schema.issues, eq(schema.issues.id, schema.deals.issueId))
    .where(and(eq(schema.issues.projectId, projectId), isNull(schema.issues.deletedAt)))
    .groupBy(schema.issues.stateId);
  return rows;
}

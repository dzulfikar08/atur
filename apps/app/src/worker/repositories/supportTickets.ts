import { eq, and, desc, sql, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export interface TicketSummary {
  id: string;
  issueId: string;
  sequenceId: number;
  projectId: string;
  name: string;
  priority: string | null;
  stateId: string | null;
  stateName: string | null;
  stateColor: string | null;
  stateGroup: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

export async function create(
  db: DbClient,
  data: { issueId: string; customerId: string; workspaceId: string },
) {
  const id = uuid();
  await db.insert(schema.supportTickets).values({
    id,
    issueId: data.issueId,
    customerId: data.customerId,
    workspaceId: data.workspaceId,
    createdAt: nowISO(),
  });
  return id;
}

export async function listByCustomer(
  db: DbClient,
  customerId: string,
  opts: { offset: number; limit: number },
): Promise<{ rows: TicketSummary[]; total: number }> {
  const where = and(
    eq(schema.supportTickets.customerId, customerId),
    isNull(schema.issues.deletedAt),
  );

  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.supportTickets)
    .innerJoin(schema.issues, eq(schema.issues.id, schema.supportTickets.issueId))
    .where(where);

  const rows = await db
    .select({
      id: schema.supportTickets.id,
      issueId: schema.issues.id,
      sequenceId: schema.issues.sequenceId,
      projectId: schema.issues.projectId,
      name: schema.issues.name,
      priority: schema.issues.priority,
      stateId: schema.issues.stateId,
      stateName: schema.states.name,
      stateColor: schema.states.color,
      stateGroup: schema.states.groupName,
      createdAt: schema.issues.createdAt,
      updatedAt: schema.issues.updatedAt,
      completedAt: schema.issues.completedAt,
    })
    .from(schema.supportTickets)
    .innerJoin(schema.issues, eq(schema.issues.id, schema.supportTickets.issueId))
    .leftJoin(schema.states, eq(schema.states.id, schema.issues.stateId))
    .where(where)
    .orderBy(desc(schema.issues.sequenceId))
    .offset(opts.offset)
    .limit(opts.limit);

  return { rows, total: countRow.total };
}

// Resolve a ticket by its issue's sequence id, scoped to a customer so
// cross-customer access is impossible. Sequence ids are per project, so callers
// pass the project when the customer may hold tickets in several (widget
// reports land on the board's project, portal tickets on the support project);
// null matches any project.
export async function getByIssueSeqForCustomer(
  db: DbClient,
  projectId: string | null,
  sequenceId: number,
  customerId: string,
): Promise<TicketSummary | null> {
  const [row] = await db
    .select({
      id: schema.supportTickets.id,
      issueId: schema.issues.id,
      sequenceId: schema.issues.sequenceId,
      projectId: schema.issues.projectId,
      name: schema.issues.name,
      priority: schema.issues.priority,
      stateId: schema.issues.stateId,
      stateName: schema.states.name,
      stateColor: schema.states.color,
      stateGroup: schema.states.groupName,
      createdAt: schema.issues.createdAt,
      updatedAt: schema.issues.updatedAt,
      completedAt: schema.issues.completedAt,
    })
    .from(schema.supportTickets)
    .innerJoin(schema.issues, eq(schema.issues.id, schema.supportTickets.issueId))
    .leftJoin(schema.states, eq(schema.states.id, schema.issues.stateId))
    .where(
      and(
        eq(schema.supportTickets.customerId, customerId),
        projectId ? eq(schema.issues.projectId, projectId) : undefined,
        eq(schema.issues.sequenceId, sequenceId),
        isNull(schema.issues.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

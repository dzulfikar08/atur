import { eq, and, desc, sql, isNull, inArray } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export interface FactRow {
  id: string;
  workspaceId: string;
  customerId: string | null;
  companyId: string | null;
  field: string;
  value: string;
  score: number;
  band: string;
  evidence: string | null;
  method: string | null;
  sourceUrl: string | null;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  observedAt: string;
  supersededAt: string | null;
  createdAt: string | null;
}

export const factSelect = {
  id: schema.contactFacts.id,
  workspaceId: schema.contactFacts.workspaceId,
  customerId: schema.contactFacts.customerId,
  companyId: schema.contactFacts.companyId,
  field: schema.contactFacts.field,
  value: schema.contactFacts.value,
  score: schema.contactFacts.score,
  band: schema.contactFacts.band,
  evidence: schema.contactFacts.evidence,
  method: schema.contactFacts.method,
  sourceUrl: schema.contactFacts.sourceUrl,
  status: schema.contactFacts.status,
  decidedBy: schema.contactFacts.decidedBy,
  decidedAt: schema.contactFacts.decidedAt,
  observedAt: schema.contactFacts.observedAt,
  supersededAt: schema.contactFacts.supersededAt,
  createdAt: schema.contactFacts.createdAt,
};

export async function listFacts(
  db: DbClient,
  workspaceId: string,
  opts: {
    customerId?: string;
    companyId?: string;
    status?: string;
    offset: number;
    limit: number;
  },
): Promise<{ rows: FactRow[]; total: number }> {
  const conditions = [eq(schema.contactFacts.workspaceId, workspaceId)];
  if (opts.customerId) conditions.push(eq(schema.contactFacts.customerId, opts.customerId));
  if (opts.companyId) conditions.push(eq(schema.contactFacts.companyId, opts.companyId));
  if (opts.status) conditions.push(eq(schema.contactFacts.status, opts.status));
  const where = and(...conditions);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.contactFacts)
    .where(where);
  const rows = await db
    .select(factSelect)
    .from(schema.contactFacts)
    .where(where)
    .orderBy(desc(schema.contactFacts.observedAt))
    .offset(opts.offset)
    .limit(opts.limit);

  return { rows, total: countRow.total };
}

export async function getFact(
  db: DbClient,
  workspaceId: string,
  factId: string,
): Promise<FactRow | null> {
  const [row] = await db
    .select(factSelect)
    .from(schema.contactFacts)
    .where(
      and(eq(schema.contactFacts.id, factId), eq(schema.contactFacts.workspaceId, workspaceId)),
    )
    .limit(1);
  return row ?? null;
}

export async function createFact(
  db: DbClient,
  data: {
    workspaceId: string;
    customerId: string | null;
    companyId?: string | null;
    field: string;
    value: string;
    score: number;
    band: string;
    evidence?: string | null;
    method?: string | null;
    sourceUrl?: string | null;
    status: string;
    observedAt: string;
  },
): Promise<FactRow> {
  const id = uuid();
  await db.insert(schema.contactFacts).values({
    id,
    workspaceId: data.workspaceId,
    customerId: data.customerId,
    companyId: data.companyId ?? null,
    field: data.field,
    value: data.value,
    score: data.score,
    band: data.band,
    evidence: data.evidence ?? null,
    method: data.method ?? null,
    sourceUrl: data.sourceUrl ?? null,
    status: data.status,
    observedAt: data.observedAt,
    createdAt: nowISO(),
  });
  return (await getFact(db, data.workspaceId, id))!;
}

// Set the decision (status + decidedBy/decidedAt). Scoped by workspace.
export async function updateFactStatus(
  db: DbClient,
  workspaceId: string,
  factId: string,
  status: string,
  decidedBy: string,
): Promise<FactRow | null> {
  const now = nowISO();
  await db
    .update(schema.contactFacts)
    .set({ status, decidedBy, decidedAt: now })
    .where(
      and(eq(schema.contactFacts.id, factId), eq(schema.contactFacts.workspaceId, workspaceId)),
    );
  return getFact(db, workspaceId, factId);
}

// Mark every open (PROPOSED/APPLIED, not superseded) fact for a
// target+field as SUPERSEDED, optionally keeping one fact alive (the new one
// that replaced them). The target is a customer OR a company (whichever the
// fact is scoped to). This keeps provenance history without deleting.
export async function supersedeFacts(
  db: DbClient,
  workspaceId: string,
  target: { customerId?: string | null; companyId?: string | null },
  field: string,
  exceptId?: string,
): Promise<void> {
  const conditions = [
    eq(schema.contactFacts.workspaceId, workspaceId),
    eq(schema.contactFacts.field, field),
    isNull(schema.contactFacts.supersededAt),
    inArray(schema.contactFacts.status, ["PROPOSED", "APPLIED"]),
  ];
  if (target.customerId) {
    conditions.push(eq(schema.contactFacts.customerId, target.customerId));
  } else if (target.companyId) {
    conditions.push(eq(schema.contactFacts.companyId, target.companyId));
  }
  if (exceptId) conditions.push(sql`${schema.contactFacts.id} != ${exceptId}`);
  await db
    .update(schema.contactFacts)
    .set({ status: "SUPERSEDED", supersededAt: nowISO() })
    .where(and(...conditions));
}

import { eq, and, or, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { issueRelations } from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export async function listByIssue(db: DbClient, issueId: string) {
  return db
    .select()
    .from(issueRelations)
    .where(
      and(
        or(eq(issueRelations.issueId, issueId), eq(issueRelations.relatedIssueId, issueId)),
        isNull(issueRelations.deletedAt),
      ),
    );
}

export async function findById(db: DbClient, id: string) {
  const [relation] = await db
    .select()
    .from(issueRelations)
    .where(and(eq(issueRelations.id, id), isNull(issueRelations.deletedAt)))
    .limit(1);
  return relation;
}

export async function createRelation(
  db: DbClient,
  data: {
    issueId: string;
    relatedIssueId: string;
    relationType: "blocks" | "blocked_by" | "relates_to" | "duplicates";
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(issueRelations).values({
    id,
    issueId: data.issueId,
    relatedIssueId: data.relatedIssueId,
    relationType: data.relationType,
    createdAt: now,
    updatedAt: now,
  });
  return findById(db, id);
}

export async function removeRelation(db: DbClient, id: string) {
  await db
    .update(issueRelations)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(and(eq(issueRelations.id, id), isNull(issueRelations.deletedAt)));
}

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as relationsRepo from "../repositories/relations";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

export const createRelationSchema = z.object({
  issue_id: z.string().uuid(),
  related_issue_id: z.string().uuid(),
  relation_type: z.enum(["blocks", "blocked_by", "relates_to", "duplicates"]),
});

// Both endpoints must be issues in the caller's workspace (route guard) —
// ported from the MCP add_issue_relation tool's both-sided asserts. Without
// this, a member of ws A could link a foreign issue by UUID (and the foreign
// issue's relation list would leak the reference back).
export async function create(
  db: DbClient,
  workspaceId: string,
  data: z.infer<typeof createRelationSchema>,
) {
  const rows = await db
    .select({ id: schema.issues.id })
    .from(schema.issues)
    .where(
      and(
        inArray(schema.issues.id, [data.issue_id, data.related_issue_id]),
        eq(schema.issues.workspaceId, workspaceId),
        isNull(schema.issues.deletedAt),
      ),
    );
  if (rows.length !== 2) throw new HTTPException(404, { message: "Issue not found" });
  return relationsRepo.createRelation(db, {
    issueId: data.issue_id,
    relatedIssueId: data.related_issue_id,
    relationType: data.relation_type,
  });
}

// List an issue's relations under the caller's workspace (route guard):
// resolve the issue first — a foreign issue UUID must 404, not leak its
// relation graph.
export async function list(db: DbClient, issueId: string, workspaceId: string) {
  const [issue] = await db
    .select({ id: schema.issues.id })
    .from(schema.issues)
    .where(
      and(
        eq(schema.issues.id, issueId),
        eq(schema.issues.workspaceId, workspaceId),
        isNull(schema.issues.deletedAt),
      ),
    )
    .limit(1);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });
  return relationsRepo.listByIssue(db, issueId);
}

// issue_relations has no workspace column, so scope via BOTH sides: the
// relation is only removable when its issue AND its related issue belong to
// the caller's workspace (route guard) — mirror of create's both-sided check.
// Otherwise 404 — same as a missing relation.
export async function remove(db: DbClient, id: string, workspaceId: string) {
  const relation = await relationsRepo.findById(db, id);
  if (!relation) throw new HTTPException(404, { message: "Relation not found" });
  const rows = await db
    .select({ id: schema.issues.id })
    .from(schema.issues)
    .where(
      and(
        inArray(schema.issues.id, [relation.issueId, relation.relatedIssueId]),
        eq(schema.issues.workspaceId, workspaceId),
        isNull(schema.issues.deletedAt),
      ),
    );
  if (rows.length !== 2) throw new HTTPException(404, { message: "Relation not found" });
  await relationsRepo.removeRelation(db, id);
}

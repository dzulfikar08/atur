import { z } from "zod";
import type { DbClient } from "../db/index";
import * as relationsRepo from "../repositories/relations";
import { HTTPException } from "hono/http-exception";

export const createRelationSchema = z.object({
  issue_id: z.string().uuid(),
  related_issue_id: z.string().uuid(),
  relation_type: z.enum(["blocks", "blocked_by", "relates_to", "duplicates"]),
});

export async function create(db: DbClient, data: z.infer<typeof createRelationSchema>) {
  return relationsRepo.createRelation(db, {
    issueId: data.issue_id,
    relatedIssueId: data.related_issue_id,
    relationType: data.relation_type,
  });
}

export async function list(db: DbClient, issueId: string) {
  return relationsRepo.listByIssue(db, issueId);
}

export async function remove(db: DbClient, id: string) {
  const relation = await relationsRepo.findById(db, id);
  if (!relation) throw new HTTPException(404, { message: "Relation not found" });
  await relationsRepo.removeRelation(db, id);
}

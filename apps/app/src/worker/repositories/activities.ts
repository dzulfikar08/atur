import { eq, and, desc, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { issueActivities, users } from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export interface ActivityInput {
  verb: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  issueId: string;
  issueCommentId?: string | null;
  actorId?: string | null;
}

export interface ActivityRow {
  id: string;
  verb: string | null;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  issueId: string | null;
  issueCommentId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  isCustomer: number | null;
  createdAt: string | null;
}

export async function create(db: DbClient, data: ActivityInput) {
  const id = uuid();
  const now = nowISO();
  await db.insert(issueActivities).values({
    id,
    verb: data.verb,
    field: data.field ?? null,
    oldValue: data.oldValue ?? null,
    newValue: data.newValue ?? null,
    issueId: data.issueId,
    issueCommentId: data.issueCommentId ?? null,
    actorId: data.actorId ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

// Joined with users so a trail can attribute each event to a person and tell
// customer vs staff apart. Newest first to match the comments thread ordering.
export async function listByIssue(
  db: DbClient,
  issueId: string,
  limit = 100,
): Promise<ActivityRow[]> {
  return db
    .select({
      id: issueActivities.id,
      verb: issueActivities.verb,
      field: issueActivities.field,
      oldValue: issueActivities.oldValue,
      newValue: issueActivities.newValue,
      issueId: issueActivities.issueId,
      issueCommentId: issueActivities.issueCommentId,
      actorId: issueActivities.actorId,
      actorName: users.displayName,
      actorEmail: users.email,
      isCustomer: users.isCustomer,
      createdAt: issueActivities.createdAt,
    })
    .from(issueActivities)
    .leftJoin(users, eq(users.id, issueActivities.actorId))
    .where(and(eq(issueActivities.issueId, issueId), isNull(issueActivities.deletedAt)))
    .orderBy(desc(issueActivities.createdAt))
    .limit(limit);
}

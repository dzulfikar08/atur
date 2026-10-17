import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as issuesRepo from "../repositories/issues";
import * as commentsService from "./comments";
import * as subscribersService from "./subscribers";
import * as customFieldValuesService from "./customFieldValues";
import { enrichIssue, enrichIssues } from "./issues";
import * as timeEntriesRepo from "../repositories/timeEntries";
import { paginatedResponse } from "../lib/pagination";

/** Sub-resources `GET .../issues/:id/?include=` can bundle into the issue payload. */
export const ISSUE_INCLUDES = [
  "comments",
  "activities",
  "relations",
  "sub_issues",
  "subscribers",
  "modules",
  "custom_values",
] as const;
export type IssueInclude = (typeof ISSUE_INCLUDES)[number];

export function parseIncludes(raw: string | undefined): Set<IssueInclude> {
  const wanted = (raw ?? "").split(",").map((s) => s.trim());
  return new Set(ISSUE_INCLUDES.filter((k) => wanted.includes(k)));
}

// Activities, joined to users so each event is attributable to an actor.
export async function listActivities(db: DbClient, issueId: string) {
  return db
    .select({
      id: schema.issueActivities.id,
      verb: schema.issueActivities.verb,
      field: schema.issueActivities.field,
      oldValue: schema.issueActivities.oldValue,
      newValue: schema.issueActivities.newValue,
      issueId: schema.issueActivities.issueId,
      issueCommentId: schema.issueActivities.issueCommentId,
      actorId: schema.issueActivities.actorId,
      actorName: schema.users.displayName,
      actorEmail: schema.users.email,
      isCustomer: schema.users.isCustomer,
      createdAt: schema.issueActivities.createdAt,
    })
    .from(schema.issueActivities)
    .leftJoin(schema.users, eq(schema.users.id, schema.issueActivities.actorId))
    .where(
      and(eq(schema.issueActivities.issueId, issueId), isNull(schema.issueActivities.deletedAt)),
    )
    .orderBy(desc(schema.issueActivities.createdAt));
}

export async function listRelations(db: DbClient, issueId: string) {
  return db
    .select()
    .from(schema.issueRelations)
    .where(and(eq(schema.issueRelations.issueId, issueId), isNull(schema.issueRelations.deletedAt)))
    .orderBy(desc(schema.issueRelations.createdAt));
}

export async function listIssueModules(db: DbClient, issueId: string) {
  return db
    .select({
      id: schema.modules.id,
      name: schema.modules.name,
      description: schema.modules.description,
      status: schema.modules.status,
      start_date: schema.modules.startDate,
      target_date: schema.modules.targetDate,
      project_id: schema.modules.projectId,
      workspace_id: schema.modules.workspaceId,
    })
    .from(schema.moduleIssues)
    .innerJoin(schema.modules, eq(schema.moduleIssues.moduleId, schema.modules.id))
    .where(and(eq(schema.moduleIssues.issueId, issueId), isNull(schema.moduleIssues.deletedAt)));
}

// Children via issues.parent_id: lean rows, enriched like GET .../sub-issues/.
export async function listChildren(db: DbClient, issueId: string) {
  return enrichIssues(db, await issuesRepo.listByParent(db, issueId));
}

async function countAttachments(db: DbClient, issueId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.issueAttachments)
    .where(
      and(eq(schema.issueAttachments.issueId, issueId), isNull(schema.issueAttachments.deletedAt)),
    );
  return row?.n ?? 0;
}

type IssueRow = NonNullable<Awaited<ReturnType<typeof issuesRepo.findById>>>;

/**
 * The issue plus its project (breadcrumb) and, on request, the sub-resources the
 * detail page otherwise fetches as ~10 separate requests. Each included value has
 * exactly the shape of its standalone endpoint so the client can seed its cache.
 * Related/parent issue names ride along so the page needs no 500-row lookups.
 */
export async function getDetail(
  db: DbClient,
  issue: IssueRow,
  project: { id: string; name: string; identifier: string },
  include: Set<IssueInclude>,
) {
  const withCounts = include.size > 0;
  const [
    enriched,
    comments,
    activities,
    relations,
    subIssues,
    subscribers,
    modules,
    customValues,
    attachmentCount,
    timeSeconds,
  ] = await Promise.all([
      enrichIssue(db, issue),
      include.has("comments") ? commentsService.list(db, issue.id, 0, 100) : null,
      include.has("activities") ? listActivities(db, issue.id) : null,
      include.has("relations") ? listRelations(db, issue.id) : null,
      include.has("sub_issues") ? listChildren(db, issue.id) : null,
      include.has("subscribers") ? subscribersService.listByIssue(db, issue.id) : null,
      include.has("modules") ? listIssueModules(db, issue.id) : null,
      include.has("custom_values") ? customFieldValuesService.list(db, issue) : null,
      // Tab badges: the attachment/time tabs load lazily but show their totals.
      withCounts ? countAttachments(db, issue.id) : null,
      withCounts ? timeEntriesRepo.totalForIssue(db, issue.id) : null,
    ]);

  // Names for the parent and related issues, in one lookup.
  const refIds = [
    ...(issue.parentId ? [issue.parentId] : []),
    ...(relations ?? []).map((r) => r.relatedIssueId),
  ];
  const refs =
    refIds.length > 0
      ? await db
          .select({
            id: schema.issues.id,
            name: schema.issues.name,
            sequenceId: schema.issues.sequenceId,
          })
          .from(schema.issues)
          .where(
            and(
              inArray(schema.issues.id, [...new Set(refIds)].slice(0, 90)),
              eq(schema.issues.workspaceId, issue.workspaceId),
              isNull(schema.issues.deletedAt),
            ),
          )
      : [];

  const included: Record<string, unknown> = {};
  if (comments) included.comments = paginatedResponse(comments, comments.length, 0, 100);
  if (activities) included.activities = { results: activities };
  if (relations) included.relations = { results: relations };
  if (subIssues) included.sub_issues = { results: subIssues };
  if (subscribers) included.subscribers = subscribers;
  if (modules) included.modules = { results: modules };
  if (customValues) included.custom_values = customValues;
  if (withCounts) {
    included.related_issues = refs;
    included.counts = { attachments: attachmentCount, time_seconds: timeSeconds };
  }

  return {
    ...enriched,
    project_detail: { id: project.id, name: project.name, identifier: project.identifier },
    ...(include.size > 0 ? { included } : {}),
  };
}

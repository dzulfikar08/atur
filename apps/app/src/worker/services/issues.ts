import { z } from "zod";
import { v4 as uuid } from "uuid";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as issuesRepo from "../repositories/issues";
import * as statesRepo from "../repositories/states";
import * as activitiesRepo from "../repositories/activities";
import * as feedbackRepo from "../repositories/feedback";
import * as subscribersRepo from "../repositories/subscribers";
import { notifyMentioned, resolveMentionsInHtml } from "./issue_notifications";
import type { Env } from "../lib/env";
import { paginatedResponse } from "../lib/pagination";

export const createIssueSchema = z.object({
  name: z.string().min(1),
  description_html: z.string().optional(),
  priority: z.enum(["high", "medium", "low", "urgent", "none"]).optional().default("none"),
  state_id: z.string().uuid().optional(),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  estimate_points: z.number().nullable().optional(),
  label_ids: z.array(z.string().uuid()).optional(),
  assignee_ids: z.array(z.string().uuid()).optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

export const updateIssueSchema = z.object({
  name: z.string().min(1).optional(),
  description_html: z.string().optional(),
  priority: z.enum(["high", "medium", "low", "urgent", "none"]).optional(),
  state_id: z.string().uuid().optional(),
  start_date: z.string().nullable().optional(),
  target_date: z.string().nullable().optional(),
  estimate_points: z.number().nullable().optional(),
  label_ids: z.array(z.string().uuid()).optional(),
  assignee_ids: z.array(z.string().uuid()).optional(),
});

// Bind caller-supplied state/label/assignee ids to the issue's workspace —
// same rules as the MCP asserts (DEV-19): an id from another workspace (or a
// soft-deleted one) is indistinguishable from a missing one → 404 before any
// write. update() validates its state_id inline instead, so the fetched row
// can be reused for the activity trail.
async function assertIdsInWorkspace(
  db: DbClient,
  workspaceId: string,
  ids: { stateId?: string; labelIds?: string[]; assigneeIds?: string[]; parentId?: string },
) {
  if (ids.stateId) {
    const state = await statesRepo.findById(db, ids.stateId);
    if (!state || state.workspaceId !== workspaceId) {
      throw new HTTPException(404, { message: "State not found" });
    }
  }
  if (ids.labelIds && ids.labelIds.length > 0) {
    const rows = await db
      .select({ id: schema.labels.id })
      .from(schema.labels)
      .where(
        and(
          inArray(schema.labels.id, ids.labelIds),
          eq(schema.labels.workspaceId, workspaceId),
          isNull(schema.labels.deletedAt),
        ),
      );
    if (rows.length !== new Set(ids.labelIds).size) {
      throw new HTTPException(404, { message: "Label not found" });
    }
  }
  if (ids.assigneeIds && ids.assigneeIds.length > 0) {
    const unique = [...new Set(ids.assigneeIds)];
    const rows = await db
      .select({ memberId: schema.workspaceMembers.memberId })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, workspaceId),
          inArray(schema.workspaceMembers.memberId, unique),
          eq(schema.workspaceMembers.isActive, 1),
          isNull(schema.workspaceMembers.deletedAt),
        ),
      );
    if (rows.length !== unique.length) {
      throw new HTTPException(404, { message: "Assignee not found in this workspace" });
    }
  }
  if (ids.parentId) {
    // The parent issue must live in the same workspace — else a member could
    // nest their issue under a foreign workspace's issue tree (and leak its
    // name via the post-create activity lookup).
    const [parent] = await db
      .select({ id: schema.issues.id })
      .from(schema.issues)
      .where(
        and(
          eq(schema.issues.id, ids.parentId),
          eq(schema.issues.workspaceId, workspaceId),
          isNull(schema.issues.deletedAt),
        ),
      )
      .limit(1);
    if (!parent) throw new HTTPException(404, { message: "Parent issue not found" });
  }
}

export async function create(
  db: DbClient,
  projectId: string,
  data: z.infer<typeof createIssueSchema>,
  createdById?: string,
) {
  const project = await db.query.projects.findFirst({
    where: and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)),
  });
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  // Caller-supplied ids must belong to the project's workspace before any
  // insert — mirrors the MCP create_issue binding (DEV-19).
  await assertIdsInWorkspace(db, project.workspaceId, {
    stateId: data.state_id,
    labelIds: data.label_ids,
    assigneeIds: data.assignee_ids,
    parentId: data.parent_id ?? undefined,
  });

  // Default state: caller choice → project default → project's isDefault state.
  let stateId = data.state_id ?? project.defaultStateId ?? undefined;
  if (!stateId) {
    stateId = (await feedbackRepo.pickDefaultStateId(db, projectId)) ?? undefined;
  }

  // sequenceId allocated atomically inside issuesRepo.create (per-project
  // counter) — concurrent creators get distinct ids, no retry loop needed.
  const issue = await issuesRepo.create(db, {
    id: uuid(),
    name: data.name,
    projectId,
    workspaceId: project.workspaceId,
    priority: data.priority,
    descriptionHtml: data.description_html,
    stateId,
    startDate: data.start_date,
    targetDate: data.target_date,
    estimatePoints: data.estimate_points ?? null,
    parentId: data.parent_id ?? null,
    createdById,
  });

  if (data.label_ids && data.label_ids.length > 0) {
    for (const labelId of data.label_ids) {
      await issuesRepo.addLabel(db, issue.id, labelId);
    }
  }

  if (data.assignee_ids && data.assignee_ids.length > 0) {
    for (const assigneeId of data.assignee_ids) {
      await issuesRepo.addAssignee(db, issue.id, assigneeId);
      // Assignees auto-follow so they see later comments/activity.
      await subscribersRepo.autoFollow(db, issue.id, assigneeId);
    }
  }
  // The creator auto-follows their own issue.
  if (createdById) await subscribersRepo.autoFollow(db, issue.id, createdById);
  // First trail entry: who created this issue.
  await activitiesRepo.create(db, {
    verb: "created",
    issueId: issue.id,
    actorId: createdById,
  });
  if (data.parent_id) {
    const [parent] = await db
      .select({ name: schema.issues.name })
      .from(schema.issues)
      // Workspace-scoped belt-and-braces: the pre-insert validation already
      // rejected foreign parents; this filter keeps the trail lookup from
      // ever reading (and recording) a foreign issue's name.
      .where(
        and(
          eq(schema.issues.id, data.parent_id),
          eq(schema.issues.workspaceId, project.workspaceId),
          isNull(schema.issues.deletedAt),
        ),
      )
      .limit(1);
    await activitiesRepo.create(db, {
      verb: "updated",
      field: "parent",
      oldValue: null,
      newValue: parent?.name ?? data.parent_id,
      issueId: issue.id,
      actorId: createdById ?? null,
    });
  }

  return enrichIssue(db, issue);
}

export async function getById(db: DbClient, issueId: string) {
  const issue = await issuesRepo.findById(db, issueId);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });
  return enrichIssue(db, issue);
}

export async function list(
  db: DbClient,
  projectId: string,
  opts: {
    offset: number;
    limit: number;
    state?: string;
    priority?: string;
    search?: string;
    labels?: string[];
    assignee?: string;
  },
) {
  const project = await db.query.projects.findFirst({
    where: and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)),
  });
  if (!project) throw new HTTPException(404, { message: "Project not found" });

  // The REST contract filters by label NAME (e.g. ?labels=agent-ready); the
  // repo filters by label UUID, so resolve names → IDs first.
  if (opts.labels && opts.labels.length > 0) {
    const labelRows = await db
      .select({ id: schema.labels.id })
      .from(schema.labels)
      .where(
        and(
          inArray(schema.labels.name, opts.labels),
          eq(schema.labels.workspaceId, project.workspaceId),
          isNull(schema.labels.deletedAt),
        ),
      );
    const labelIds = labelRows.map((l) => l.id);
    if (labelIds.length === 0) {
      // No matching label → no issues can match.
      return paginatedResponse([], 0, opts.offset, opts.limit);
    }
    opts = { ...opts, labels: labelIds };
  }

  const { data, total } = await issuesRepo.listByProject(db, projectId, opts);

  const enriched = await enrichIssues(db, data);

  return paginatedResponse(enriched, total, opts.offset, opts.limit);
}

export async function listSubIssues(db: DbClient, parentId: string) {
  const data = await issuesRepo.listByParent(db, parentId);
  const enriched = await enrichIssues(db, data);
  return { results: enriched };
}

export async function update(
  db: DbClient,
  issueId: string,
  data: z.infer<typeof updateIssueSchema>,
  actorId?: string,
  env?: Env,
  actorName?: string | null,
) {
  const issue = await issuesRepo.findById(db, issueId);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });
  // Replacement label/assignee lists must belong to the issue's workspace
  // before any write (state_id is validated inline below so the fetch feeds
  // the activity trail) — DEV-19.
  await assertIdsInWorkspace(db, issue.workspaceId, {
    labelIds: data.label_ids,
    assigneeIds: data.assignee_ids,
  });

  // Track only fields whose value actually changed so the activity trail
  // records real edits, not no-op PATCHes.
  const updateData: Record<string, unknown> = {};
  const events: { field: string; oldValue: string | null; newValue: string | null }[] = [];
  const descriptionChanged =
    data.description_html !== undefined && data.description_html !== issue.descriptionHtml;

  if (data.name !== undefined && data.name !== issue.name) {
    updateData.name = data.name;
    events.push({ field: "name", oldValue: issue.name ?? null, newValue: data.name });
  }
  if (data.description_html !== undefined && data.description_html !== issue.descriptionHtml) {
    updateData.descriptionHtml = data.description_html;
    // Skip the HTML blobs — only flag that the description changed.
    events.push({ field: "description_html", oldValue: null, newValue: null });
  }
  if (data.priority !== undefined && data.priority !== issue.priority) {
    updateData.priority = data.priority;
    events.push({ field: "priority", oldValue: issue.priority ?? null, newValue: data.priority });
  }
  // Set when the state changes below and reused for the activity trail, so
  // the workspace-validation fetch is not repeated after the write.
  let newState: Awaited<ReturnType<typeof statesRepo.findById>> | undefined;
  if (data.state_id !== undefined && data.state_id !== issue.stateId) {
    // The new state must live in the issue's workspace — otherwise a member
    // could point their issue at a foreign workspace's state (cross-workspace
    // linkage plus name leak via the activity trail).
    const state = await statesRepo.findById(db, data.state_id);
    if (!state || state.workspaceId !== issue.workspaceId) {
      throw new HTTPException(404, { message: "State not found" });
    }
    newState = state;
    updateData.stateId = data.state_id;
    events.push({ field: "state", oldValue: null, newValue: null }); // names resolved below
  }
  if (data.start_date !== undefined && data.start_date !== issue.startDate) {
    updateData.startDate = data.start_date;
    events.push({
      field: "start_date",
      oldValue: issue.startDate ?? null,
      newValue: data.start_date,
    });
  }
  if (data.target_date !== undefined && data.target_date !== issue.targetDate) {
    updateData.targetDate = data.target_date;
    events.push({
      field: "target_date",
      oldValue: issue.targetDate ?? null,
      newValue: data.target_date,
    });
  }
  if (data.estimate_points !== undefined && data.estimate_points !== issue.estimatePoints) {
    updateData.estimatePoints = data.estimate_points;
    events.push({
      field: "estimate_points",
      oldValue: issue.estimatePoints != null ? String(issue.estimatePoints) : null,
      newValue: data.estimate_points != null ? String(data.estimate_points) : null,
    });
  }

  const updated = await issuesRepo.update(db, issueId, updateData);

  // State changes are stored by id; resolve human-readable names for the trail.
  if (events.some((e) => e.field === "state")) {
    // newState was already fetched (and workspace-validated) above — only the
    // previous state still needs resolving.
    const oldState = issue.stateId ? await statesRepo.findById(db, issue.stateId) : undefined;
    for (const e of events) {
      if (e.field === "state") {
        e.oldValue = oldState?.name ?? null;
        e.newValue = newState?.name ?? null;
      }
    }
  }

  for (const e of events) {
    await activitiesRepo.create(db, {
      verb: "updated",
      field: e.field,
      oldValue: e.oldValue,
      newValue: e.newValue,
      issueId,
      actorId: actorId ?? null,
    });
  }

  if (data.label_ids !== undefined) {
    const currentLabels = await issuesRepo.listLabels(db, issueId);
    const currentLabelIds = currentLabels.map((l) => l.id);
    for (const labelId of currentLabelIds) {
      await issuesRepo.removeLabel(db, issueId, labelId);
    }
    for (const labelId of data.label_ids) {
      await issuesRepo.addLabel(db, issueId, labelId);
    }
  }

  if (data.assignee_ids !== undefined) {
    const currentAssignees = await issuesRepo.listAssignees(db, issueId);
    const currentAssigneeIds = currentAssignees.map((a) => a.id);
    for (const assigneeId of currentAssigneeIds) {
      await issuesRepo.removeAssignee(db, issueId, assigneeId);
    }
    for (const assigneeId of data.assignee_ids) {
      await issuesRepo.addAssignee(db, issueId, assigneeId);
      // Assignees auto-follow so they see later comments/activity.
      await subscribersRepo.autoFollow(db, issueId, assigneeId);
    }
  }

  // Mentions in the description: notify newly-mentioned users (and followers).
  if (descriptionChanged && env && actorId) {
    const { mentionedIds } = await resolveMentionsInHtml(
      db,
      issue.workspaceId,
      data.description_html,
    );
    if (mentionedIds.length > 0) {
      await notifyMentioned(db, env, issue, {
        actorId,
        actorName,
        mentionedIds,
        source: "description",
        contentSnippet: data.description_html,
      });
    }
  }

  return enrichIssue(db, updated!);
}

export async function remove(db: DbClient, issueId: string) {
  const issue = await issuesRepo.findById(db, issueId);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });
  await issuesRepo.remove(db, issueId);
}

export async function addLabel(db: DbClient, issueId: string, labelId: string) {
  const issue = await issuesRepo.findById(db, issueId);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });
  await issuesRepo.addLabel(db, issueId, labelId);
}

export async function removeLabel(db: DbClient, issueId: string, labelId: string) {
  const issue = await issuesRepo.findById(db, issueId);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });
  await issuesRepo.removeLabel(db, issueId, labelId);
}

export async function addAssignee(db: DbClient, issueId: string, assigneeId: string) {
  const issue = await issuesRepo.findById(db, issueId);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });
  await issuesRepo.addAssignee(db, issueId, assigneeId);
  await subscribersRepo.autoFollow(db, issueId, assigneeId);
}

export async function removeAssignee(db: DbClient, issueId: string, assigneeId: string) {
  const issue = await issuesRepo.findById(db, issueId);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });
  await issuesRepo.removeAssignee(db, issueId, assigneeId);
}

export async function setAssignees(db: DbClient, issueId: string, assigneeIds: string[]) {
  const issue = await issuesRepo.findById(db, issueId);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });

  const currentAssignees = await issuesRepo.listAssignees(db, issueId);
  const currentAssigneeIds = currentAssignees.map((a) => a.id);

  for (const assigneeId of currentAssigneeIds) {
    await issuesRepo.removeAssignee(db, issueId, assigneeId);
  }
  for (const assigneeId of assigneeIds) {
    await issuesRepo.addAssignee(db, issueId, assigneeId);
    await subscribersRepo.autoFollow(db, issueId, assigneeId);
  }
}

async function enrichIssue(
  db: DbClient,
  issue: NonNullable<Awaited<ReturnType<typeof issuesRepo.findById>>>,
) {
  const labels = issue ? await issuesRepo.listLabels(db, issue.id) : [];
  const assignees = issue ? await issuesRepo.listAssignees(db, issue.id) : [];

  let state = null;
  if (issue?.stateId) {
    const [s] = await db
      .select({
        id: schema.states.id,
        name: schema.states.name,
        color: schema.states.color,
        group: schema.states.groupName,
      })
      .from(schema.states)
      .where(eq(schema.states.id, issue.stateId))
      .limit(1);
    state = s ?? null;
  }

  return {
    ...issue,
    labels,
    assignees,
    state,
  };
}

export async function enrichIssues(
  db: DbClient,
  issueList: NonNullable<Awaited<ReturnType<typeof issuesRepo.findById>>>[],
) {
  if (issueList.length === 0) return [];

  const issueIds = issueList.map((i) => i.id);
  const stateIds = [...new Set(issueList.map((i) => i.stateId).filter(Boolean) as string[])];

  const stateRows =
    stateIds.length > 0
      ? await db
          .select({
            id: schema.states.id,
            name: schema.states.name,
            color: schema.states.color,
            group: schema.states.groupName,
          })
          .from(schema.states)
          .where(inArray(schema.states.id, stateIds))
      : [];
  const stateMap = new Map(stateRows.map((s) => [s.id, s]));

  const assigneeRows = await db
    .select({
      issueId: schema.issueAssignees.issueId,
      id: schema.users.id,
      email: schema.users.email,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
    })
    .from(schema.issueAssignees)
    .innerJoin(schema.users, eq(schema.issueAssignees.assigneeId, schema.users.id))
    .where(
      and(
        inArray(schema.issueAssignees.issueId, issueIds),
        isNull(schema.issueAssignees.deletedAt),
      ),
    );

  const assigneeMap = new Map<string, typeof assigneeRows>();
  for (const row of assigneeRows) {
    if (!assigneeMap.has(row.issueId)) assigneeMap.set(row.issueId, []);
    assigneeMap.get(row.issueId)!.push(row);
  }

  const labelRows = await db
    .select({
      issueId: schema.issueLabels.issueId,
      id: schema.labels.id,
      name: schema.labels.name,
      color: schema.labels.color,
    })
    .from(schema.issueLabels)
    .innerJoin(schema.labels, eq(schema.issueLabels.labelId, schema.labels.id))
    .where(
      and(inArray(schema.issueLabels.issueId, issueIds), isNull(schema.issueLabels.deletedAt)),
    );

  const labelMap = new Map<string, typeof labelRows>();
  for (const row of labelRows) {
    if (!labelMap.has(row.issueId)) labelMap.set(row.issueId, []);
    labelMap.get(row.issueId)!.push(row);
  }

  return issueList.map((issue) => {
    const assignees =
      assigneeMap.get(issue.id)?.map((a) => ({
        id: a.id,
        email: a.email,
        username: a.username,
        displayName: a.displayName,
        avatar: a.avatar,
      })) ?? [];
    const labels =
      labelMap.get(issue.id)?.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })) ?? [];
    const state = issue.stateId ? (stateMap.get(issue.stateId) ?? null) : null;
    return { ...issue, labels, assignees, state };
  });
}

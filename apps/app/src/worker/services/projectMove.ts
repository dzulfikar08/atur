import { v4 as uuid } from "uuid";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as workspaceRepo from "../repositories/workspaces";
import * as membersRepo from "../repositories/members";
import { nowISO } from "../lib/pagination";

// D1 caps bound parameters per statement (~100); keep multi-row inserts and
// IN-lists below it.
const INSERT_CHUNK = 10;
const IN_CHUNK = 90;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const moveProjectSchema = z.object({
  target_workspace: z.string().min(1).describe("Slug of the destination workspace"),
  page_ids: z
    .array(z.string().uuid())
    .max(50)
    .optional()
    .describe("Pages of the source workspace that travel with the project"),
});

export type MoveProjectOpts = {
  sourceWorkspaceId: string;
  projectId: string;
  targetWorkspaceSlug: string;
  actorId: string;
  pageIds?: string[];
};

export type MoveProjectResult = {
  projectId: string;
  identifier: string;
  fromWorkspace: { id: string; slug: string };
  toWorkspace: { id: string; slug: string };
  /** Rows re-parented to the target workspace, by table. */
  moved: Record<string, number>;
  /** Rows that could not follow into the new workspace, by kind. */
  detached: Record<string, number>;
  /** Source-workspace labels copied into the target (old id → new id). */
  copiedLabels: { name: string; fromId: string; toId: string }[];
  /** Source workspace members added to the target workspace. */
  addedMemberIds: string[];
};

// Owner or ACTIVE admin (role >= 20) — same rule as requireWorkspaceAdmin.
async function assertAdmin(
  db: DbClient,
  workspace: { id: string; ownerId: string; slug: string },
  userId: string,
) {
  if (workspace.ownerId === userId) return;
  const m = await membersRepo.findMembership(db, workspace.id, userId);
  if (!m || m.isActive !== 1 || m.role < 20) {
    throw new HTTPException(403, {
      message: `Only the owner or an admin of workspace "${workspace.slug}" can move projects`,
    });
  }
}

/**
 * Re-parent a project (and everything that hangs off it) from one workspace to
 * another, in a single D1 batch (atomic: all or nothing).
 *
 * The project, its issues and every row beneath them keep their ids, so issue
 * keys (JRG-123), comments, activity, time entries, relations, attachments,
 * states, modules, sprints/cycles and custom fields come along unchanged — only
 * the `workspace_id` they carry changes. What cannot follow:
 *
 *  - links that would span two workspaces: sub-issue parent pointers, issue
 *    relations, and sprint/cycle/module memberships between this project and
 *    another one (parents are cleared with an activity entry, relations are
 *    soft-deleted, memberships are deleted; all counted in `detached`);
 *  - workspace-wide labels (or another project's labels) used by the project's
 *    issues: they are copied into the target workspace and remapped;
 *  - the project's folder (folders are per workspace) — it lands under "No folder";
 *  - the portal support-project pointer of the source workspace (copied to the
 *    target, then cleared and the source portal disabled).
 *
 * Refused (409): pipeline projects / deals, support tickets, a Polar pipeline
 * pointing at the project, or an identifier already used in the target.
 */
export async function moveProjectToWorkspace(
  db: DbClient,
  opts: MoveProjectOpts,
): Promise<MoveProjectResult> {
  const { projectId, actorId } = opts;

  const source = await workspaceRepo.findById(db, opts.sourceWorkspaceId);
  if (!source) throw new HTTPException(404, { message: "Workspace not found" });
  const target = await workspaceRepo.findBySlug(db, opts.targetWorkspaceSlug);
  if (!target) throw new HTTPException(404, { message: "Target workspace not found" });
  if (target.id === source.id) {
    throw new HTTPException(400, { message: "Project is already in the target workspace" });
  }
  await assertAdmin(db, source, actorId);
  await assertAdmin(db, target, actorId);

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.workspaceId, source.id),
        isNull(schema.projects.deletedAt),
      ),
    )
    .limit(1);
  if (!project) throw new HTTPException(404, { message: "Project not found" });

  const [clash] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.workspaceId, target.id),
        eq(schema.projects.identifier, project.identifier),
      ),
    )
    .limit(1);
  if (clash) {
    throw new HTTPException(409, {
      message: `Workspace "${target.slug}" already has a project with identifier ${project.identifier}`,
    });
  }

  // ── Guards ───────────────────────────────────────────────────────────────
  const projectIssueIds = db
    .select({ id: schema.issues.id })
    .from(schema.issues)
    .where(eq(schema.issues.projectId, projectId));
  const issuesOf = (col: Parameters<typeof inArray>[0]) => inArray(col, projectIssueIds);
  const otherIssueIds = db
    .select({ id: schema.issues.id })
    .from(schema.issues)
    .where(ne(schema.issues.projectId, projectId));

  const [deal] = await db
    .select({ id: schema.deals.id })
    .from(schema.deals)
    .where(issuesOf(schema.deals.issueId))
    .limit(1);
  if (deal || project.isPipeline === 1) {
    throw new HTTPException(409, { message: "Deals and pipeline projects cannot be moved" });
  }
  const [ticket] = await db
    .select({ id: schema.supportTickets.id })
    .from(schema.supportTickets)
    .where(issuesOf(schema.supportTickets.issueId))
    .limit(1);
  if (ticket) {
    throw new HTTPException(409, {
      message: "Project has support tickets (portal customers belong to the source workspace)",
    });
  }
  const [polar] = await db
    .select({ workspaceId: schema.polarSettings.workspaceId })
    .from(schema.polarSettings)
    .where(eq(schema.polarSettings.pipelineProjectId, projectId))
    .limit(1);
  if (polar) {
    throw new HTTPException(409, { message: "A Polar pipeline imports deals into this project" });
  }

  const pageIds = [...new Set(opts.pageIds ?? [])];
  if (pageIds.length > 0) {
    const found = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(and(inArray(schema.pages.id, pageIds), eq(schema.pages.workspaceId, source.id)));
    if (found.length !== pageIds.length) {
      throw new HTTPException(404, { message: "A page was not found in the source workspace" });
    }
  }

  // ── Counts (reported back; also the dry-run view of what the batch touches) ─
  const count = async (table: SQLiteTable, where: SQL | undefined): Promise<number> => {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(table)
      .where(where);
    return Number(row?.n ?? 0);
  };
  const inProject = (col: Parameters<typeof eq>[0]) => eq(col, projectId);

  // Attachments of the project's issues, plus not-yet-claimed uploads of its
  // board (an attachment on another project's issue stays with that issue).
  const ownFeedbackAttachment = or(
    issuesOf(schema.feedbackAttachments.issueId),
    and(
      isNull(schema.feedbackAttachments.issueId),
      inArray(
        schema.feedbackAttachments.boardId,
        db
          .select({ id: schema.feedbackBoards.id })
          .from(schema.feedbackBoards)
          .where(eq(schema.feedbackBoards.projectId, projectId)),
      ),
    ),
  );

  const moved: Record<string, number> = {
    projects: 1,
    issues: await count(schema.issues, inProject(schema.issues.projectId)),
    states: await count(schema.states, inProject(schema.states.projectId)),
    estimates: await count(schema.estimates, inProject(schema.estimates.projectId)),
    cycles: await count(schema.cycles, inProject(schema.cycles.projectId)),
    sprints: await count(schema.sprints, inProject(schema.sprints.projectId)),
    modules: await count(schema.modules, inProject(schema.modules.projectId)),
    customFields: await count(schema.customFields, inProject(schema.customFields.projectId)),
    projectMembers: await count(schema.projectMembers, inProject(schema.projectMembers.projectId)),
    labels: await count(schema.labels, inProject(schema.labels.projectId)),
    notifications: await count(schema.notifications, inProject(schema.notifications.projectId)),
    imports: await count(schema.imports, inProject(schema.imports.projectId)),
    exports: await count(schema.exports_, inProject(schema.exports_.projectId)),
    feedbackBoards: await count(schema.feedbackBoards, inProject(schema.feedbackBoards.projectId)),
    timeEntries: await count(schema.timeEntries, issuesOf(schema.timeEntries.issueId)),
    customFieldValues: await count(
      schema.customFieldValues,
      issuesOf(schema.customFieldValues.issueId),
    ),
    feedbackAttachments: await count(schema.feedbackAttachments, ownFeedbackAttachment),
    pages: pageIds.length,
  };

  // ── Cross-workspace links that must be cut ───────────────────────────────
  // Sub-issues whose parent sits in another project (either direction).
  const parent = schema.issues;
  const strandedChildren = await db
    .select({
      id: schema.issues.id,
      parentId: schema.issues.parentId,
    })
    .from(schema.issues)
    .where(
      and(
        isNotNull(schema.issues.parentId),
        or(
          and(
            eq(schema.issues.projectId, projectId),
            inArray(
              schema.issues.parentId,
              db.select({ id: parent.id }).from(parent).where(ne(parent.projectId, projectId)),
            ),
          ),
          and(
            ne(schema.issues.projectId, projectId),
            inArray(schema.issues.parentId, projectIssueIds),
          ),
        ),
      ),
    );
  const parentKeys = new Map<string, string>();
  for (const ids of chunk([...new Set(strandedChildren.map((c) => c.parentId!))], IN_CHUNK)) {
    const rows = await db
      .select({
        id: schema.issues.id,
        seq: schema.issues.sequenceId,
        identifier: schema.projects.identifier,
      })
      .from(schema.issues)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.issues.projectId))
      .where(inArray(schema.issues.id, ids));
    for (const r of rows) parentKeys.set(r.id, `${r.identifier}-${r.seq}`);
  }

  const crossRelation = or(
    and(
      issuesOf(schema.issueRelations.issueId),
      inArray(schema.issueRelations.relatedIssueId, otherIssueIds),
    ),
    and(
      inArray(schema.issueRelations.issueId, otherIssueIds),
      issuesOf(schema.issueRelations.relatedIssueId),
    ),
  );
  const crossRelationLive = and(crossRelation, isNull(schema.issueRelations.deletedAt));

  const projectCycles = db
    .select({ id: schema.cycles.id })
    .from(schema.cycles)
    .where(eq(schema.cycles.projectId, projectId));
  const projectSprints = db
    .select({ id: schema.sprints.id })
    .from(schema.sprints)
    .where(eq(schema.sprints.projectId, projectId));
  const projectModules = db
    .select({ id: schema.modules.id })
    .from(schema.modules)
    .where(eq(schema.modules.projectId, projectId));
  const crossCycle = or(
    and(
      issuesOf(schema.cycleIssues.issueId),
      notInArray(schema.cycleIssues.cycleId, projectCycles),
    ),
    and(
      inArray(schema.cycleIssues.issueId, otherIssueIds),
      inArray(schema.cycleIssues.cycleId, projectCycles),
    ),
  );
  const crossSprint = or(
    and(
      issuesOf(schema.sprintIssues.issueId),
      notInArray(schema.sprintIssues.sprintId, projectSprints),
    ),
    and(
      inArray(schema.sprintIssues.issueId, otherIssueIds),
      inArray(schema.sprintIssues.sprintId, projectSprints),
    ),
  );
  const crossModule = or(
    and(
      issuesOf(schema.moduleIssues.issueId),
      notInArray(schema.moduleIssues.moduleId, projectModules),
    ),
    and(
      inArray(schema.moduleIssues.issueId, otherIssueIds),
      inArray(schema.moduleIssues.moduleId, projectModules),
    ),
  );
  // Custom-field values of a field that belongs to another project.
  const foreignFieldValue = and(
    issuesOf(schema.customFieldValues.issueId),
    isNull(schema.customFieldValues.deletedAt),
    notInArray(
      schema.customFieldValues.customFieldId,
      db
        .select({ id: schema.customFields.id })
        .from(schema.customFields)
        .where(eq(schema.customFields.projectId, projectId)),
    ),
  );

  const detached: Record<string, number> = {
    parentLinks: strandedChildren.length,
    relations: await count(schema.issueRelations, crossRelationLive),
    cycleLinks: await count(schema.cycleIssues, crossCycle),
    sprintLinks: await count(schema.sprintIssues, crossSprint),
    moduleLinks: await count(schema.moduleIssues, crossModule),
    customFieldValues: await count(schema.customFieldValues, foreignFieldValue),
  };

  // ── Labels used by the project's issues but owned elsewhere ──────────────
  const foreignLabelRows = await db
    .select({
      id: schema.labels.id,
      name: schema.labels.name,
      description: schema.labels.description,
      color: schema.labels.color,
      sortOrder: schema.labels.sortOrder,
      projectId: schema.labels.projectId,
    })
    .from(schema.issueLabels)
    .innerJoin(schema.labels, eq(schema.labels.id, schema.issueLabels.labelId))
    .where(
      and(
        issuesOf(schema.issueLabels.issueId),
        ne(schema.labels.workspaceId, target.id),
        or(isNull(schema.labels.projectId), ne(schema.labels.projectId, projectId)),
      ),
    )
    .groupBy(schema.labels.id);

  const now = nowISO();
  const targetLabels = foreignLabelRows.length
    ? await db
        .select({
          id: schema.labels.id,
          name: schema.labels.name,
          projectId: schema.labels.projectId,
        })
        .from(schema.labels)
        .where(and(eq(schema.labels.workspaceId, target.id), isNull(schema.labels.deletedAt)))
    : [];
  const copiedLabels: MoveProjectResult["copiedLabels"] = [];
  const labelInserts: (typeof schema.labels.$inferInsert)[] = [];
  const labelMap = new Map<string, string>();
  const created = new Map<string, string>(); // scope+name → new label id
  for (const l of foreignLabelRows) {
    // Workspace-wide labels stay workspace-wide; another project's label
    // becomes this project's label.
    const scope = l.projectId === null ? null : projectId;
    const key = `${scope ?? ""}\u0000${l.name.trim().toLowerCase()}`;
    const existing = targetLabels.find(
      (t) =>
        t.name.trim().toLowerCase() === l.name.trim().toLowerCase() &&
        (t.projectId === scope || (scope === projectId && t.projectId === null)),
    );
    let toId = existing?.id ?? created.get(key);
    if (!toId) {
      toId = uuid();
      created.set(key, toId);
      labelInserts.push({
        id: toId,
        name: l.name,
        description: l.description,
        color: l.color,
        sortOrder: l.sortOrder,
        workspaceId: target.id,
        projectId: scope,
        createdAt: now,
        updatedAt: now,
      });
    }
    labelMap.set(l.id, toId);
    copiedLabels.push({ name: l.name, fromId: l.id, toId });
  }

  // ── Members the project's content refers to ──────────────────────────────
  const referenced = new Set<string>();
  const addIds = (rows: { id: string | null }[]) => {
    for (const r of rows) if (r.id) referenced.add(r.id);
  };
  addIds(
    await db
      .selectDistinct({ id: schema.issueAssignees.assigneeId })
      .from(schema.issueAssignees)
      .where(issuesOf(schema.issueAssignees.issueId)),
  );
  addIds(
    await db
      .selectDistinct({ id: schema.timeEntries.userId })
      .from(schema.timeEntries)
      .where(issuesOf(schema.timeEntries.issueId)),
  );
  addIds(
    await db
      .selectDistinct({ id: schema.projectMembers.memberId })
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.projectId, projectId)),
  );
  addIds(
    await db
      .selectDistinct({ id: schema.issues.createdById })
      .from(schema.issues)
      .where(eq(schema.issues.projectId, projectId)),
  );
  addIds(
    await db
      .selectDistinct({ id: schema.issueComments.actorId })
      .from(schema.issueComments)
      .where(issuesOf(schema.issueComments.issueId)),
  );
  const sourceMembers = await db
    .select({ memberId: schema.workspaceMembers.memberId, role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, source.id),
        eq(schema.workspaceMembers.isActive, 1),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    );
  const targetMemberRows = await db
    .select({ memberId: schema.workspaceMembers.memberId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, target.id));
  const inTarget = new Set(targetMemberRows.map((m) => m.memberId));
  inTarget.add(target.ownerId);
  const membersToAdd = sourceMembers.filter(
    (m) => referenced.has(m.memberId) && !inTarget.has(m.memberId),
  );

  const [sourcePortal] = await db
    .select()
    .from(schema.portalSettings)
    .where(
      and(
        eq(schema.portalSettings.workspaceId, source.id),
        eq(schema.portalSettings.supportProjectId, projectId),
      ),
    )
    .limit(1);
  const [targetPortal] = sourcePortal
    ? await db
        .select()
        .from(schema.portalSettings)
        .where(eq(schema.portalSettings.workspaceId, target.id))
        .limit(1)
    : [];

  // ── Write ────────────────────────────────────────────────────────────────
  const touch = { updatedAt: now };
  const W = { workspaceId: target.id };
  const writes: unknown[] = [];

  // Cut the links that would span two workspaces first, while the rows still
  // agree on where they live.
  for (const rows of chunk(strandedChildren, INSERT_CHUNK)) {
    writes.push(
      db.insert(schema.issueActivities).values(
        rows.map((c) => ({
          id: uuid(),
          verb: "updated",
          field: "parent",
          oldValue: parentKeys.get(c.parentId!) ?? c.parentId,
          newValue: null,
          issueId: c.id,
          actorId,
          createdAt: now,
          updatedAt: now,
        })),
      ),
    );
  }
  for (const rows of chunk(strandedChildren, IN_CHUNK)) {
    writes.push(
      db
        .update(schema.issues)
        .set({ parentId: null, updatedAt: now })
        .where(
          inArray(
            schema.issues.id,
            rows.map((c) => c.id),
          ),
        ),
    );
  }
  writes.push(
    db
      .update(schema.issueRelations)
      .set({ deletedAt: now, updatedAt: now })
      .where(crossRelationLive),
    db.delete(schema.cycleIssues).where(crossCycle),
    db.delete(schema.sprintIssues).where(crossSprint),
    db.delete(schema.moduleIssues).where(crossModule),
    db
      .update(schema.customFieldValues)
      .set({ deletedAt: now, updatedAt: now })
      .where(foreignFieldValue),
  );

  // Copy foreign labels into the target workspace and remap the issues.
  for (const rows of chunk(labelInserts, INSERT_CHUNK)) {
    writes.push(db.insert(schema.labels).values(rows));
  }
  for (const [fromId, toId] of labelMap) {
    writes.push(
      // Skip issues that already carry the target label (two source labels can
      // collapse into one); the leftovers are removed just below.
      db
        .update(schema.issueLabels)
        .set({ labelId: toId, updatedAt: now })
        .where(
          and(
            eq(schema.issueLabels.labelId, fromId),
            issuesOf(schema.issueLabels.issueId),
            notInArray(
              schema.issueLabels.issueId,
              db
                .select({ id: schema.issueLabels.issueId })
                .from(schema.issueLabels)
                .where(eq(schema.issueLabels.labelId, toId)),
            ),
          ),
        ),
      db
        .delete(schema.issueLabels)
        .where(and(eq(schema.issueLabels.labelId, fromId), issuesOf(schema.issueLabels.issueId))),
      db
        .update(schema.feedbackBoards)
        .set({ submitLabelId: toId })
        .where(
          and(
            eq(schema.feedbackBoards.projectId, projectId),
            eq(schema.feedbackBoards.submitLabelId, fromId),
          ),
        ),
    );
  }

  // Members first: the target workspace must know the people in the project.
  for (const rows of chunk(membersToAdd, INSERT_CHUNK)) {
    writes.push(
      db.insert(schema.workspaceMembers).values(
        rows.map((m) => ({
          id: uuid(),
          workspaceId: target.id,
          memberId: m.memberId,
          role: m.role,
          isActive: 1,
          createdAt: now,
          updatedAt: now,
        })),
      ),
    );
  }

  // Re-parent. Children before the project row is irrelevant (no FK on
  // workspace_id), but keep the project row last so a half-applied read-side
  // never sees it in the target without its issues.
  const issuesUpdate = db
    .update(schema.issues)
    .set(W)
    .where(eq(schema.issues.projectId, projectId));
  writes.push(
    issuesUpdate,
    db.update(schema.states).set(W).where(eq(schema.states.projectId, projectId)),
    db.update(schema.estimates).set(W).where(eq(schema.estimates.projectId, projectId)),
    db.update(schema.cycles).set(W).where(eq(schema.cycles.projectId, projectId)),
    db.update(schema.sprints).set(W).where(eq(schema.sprints.projectId, projectId)),
    db.update(schema.modules).set(W).where(eq(schema.modules.projectId, projectId)),
    db.update(schema.customFields).set(W).where(eq(schema.customFields.projectId, projectId)),
    db.update(schema.projectMembers).set(W).where(eq(schema.projectMembers.projectId, projectId)),
    db.update(schema.labels).set(W).where(eq(schema.labels.projectId, projectId)),
    db.update(schema.notifications).set(W).where(eq(schema.notifications.projectId, projectId)),
    db.update(schema.imports).set(W).where(eq(schema.imports.projectId, projectId)),
    db.update(schema.exports_).set(W).where(eq(schema.exports_.projectId, projectId)),
    db.update(schema.feedbackBoards).set(W).where(eq(schema.feedbackBoards.projectId, projectId)),
    db.update(schema.timeEntries).set(W).where(issuesOf(schema.timeEntries.issueId)),
    db.update(schema.customFieldValues).set(W).where(issuesOf(schema.customFieldValues.issueId)),
    db.update(schema.feedbackAttachments).set(W).where(ownFeedbackAttachment),
  );
  for (const ids of chunk(pageIds, IN_CHUNK)) {
    writes.push(
      db
        .update(schema.pages)
        .set({ ...W, ...touch, parentId: null })
        .where(inArray(schema.pages.id, ids)),
    );
  }

  if (sourcePortal) {
    if (targetPortal) {
      writes.push(
        db
          .update(schema.portalSettings)
          .set({ supportProjectId: projectId, isEnabled: sourcePortal.isEnabled, ...touch })
          .where(eq(schema.portalSettings.workspaceId, target.id)),
      );
    } else {
      writes.push(
        db.insert(schema.portalSettings).values({
          workspaceId: target.id,
          supportProjectId: projectId,
          isEnabled: sourcePortal.isEnabled,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    writes.push(
      db
        .update(schema.portalSettings)
        .set({ supportProjectId: null, isEnabled: 0, ...touch })
        .where(eq(schema.portalSettings.workspaceId, source.id)),
    );
  }

  writes.push(
    db
      .update(schema.projects)
      .set({ ...W, folderId: null, ...touch })
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, source.id))),
  );

  await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);

  const [after] = await db
    .select({ workspaceId: schema.projects.workspaceId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (after?.workspaceId !== target.id) {
    throw new HTTPException(409, { message: "Project changed during the move; retry" });
  }

  return {
    projectId,
    identifier: project.identifier,
    fromWorkspace: { id: source.id, slug: source.slug },
    toWorkspace: { id: target.id, slug: target.slug },
    moved,
    detached,
    copiedLabels,
    addedMemberIds: membersToAdd.map((m) => m.memberId),
  };
}

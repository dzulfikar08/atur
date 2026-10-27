import { v4 as uuid } from "uuid";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as issuesRepo from "../repositories/issues";
import * as statesService from "./states";
import { canonicalStateKey } from "./states";
import { nowISO } from "../lib/pagination";

// D1 caps bound parameters per statement (~100); IN-lists stay below it.
const IN_CHUNK = 90;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type StateRow = {
  id: string;
  name: string;
  key: string | null;
  groupName: string;
  isDefault: number;
  isTriage: number;
};

/**
 * Landing state in the target project for an issue leaving `source`. States
 * are per project, so the id cannot carry over; match by identity instead:
 *   1. same name + same group   (a "Need Review" stays "Need Review")
 *   2. same canonical key + same group
 *   3. same group               (lowest-sequence state of that group; `states`
 *                                arrives in workflow order, defaults preferred)
 *   4. the target's default     (project.defaultStateId → isDefault → first)
 * Triage states are never a landing spot unless nothing else exists.
 */
function mapState(
  source: { name: string; key: string | null; groupName: string },
  targetStates: StateRow[],
  defaultStateId: string | null,
): StateRow | undefined {
  const pool = targetStates.filter((s) => !s.isTriage);
  const candidates = pool.length > 0 ? pool : targetStates;
  const name = source.name.trim().toLowerCase();
  const key = source.key ?? canonicalStateKey(source.name, source.groupName);
  const sameGroup = candidates.filter((s) => s.groupName === source.groupName);
  return (
    sameGroup.find((s) => s.name.trim().toLowerCase() === name) ??
    sameGroup.find((s) => (s.key ?? canonicalStateKey(s.name, s.groupName)) === key) ??
    sameGroup.find((s) => s.isDefault === 1) ??
    sameGroup[0] ??
    candidates.find((s) => s.id === defaultStateId) ??
    candidates.find((s) => s.isDefault === 1) ??
    candidates[0]
  );
}

export const moveIssueSchema = z.object({
  target_project_id: z.string().uuid(),
  state_id: z.string().uuid().optional(),
});

export type MoveIssueOpts = {
  /** Explicit landing state; must belong to the target project. */
  stateId?: string;
  actorId?: string | null;
};

export type MoveIssueResult = {
  issue: typeof schema.issues.$inferSelect;
  /** `JRG-439` — the key before the move. */
  previousKey: string;
  /** `FIT-3` — the key after the move. */
  key: string;
  /** Names of project-scoped labels with no same-named label in the target. */
  droppedLabels: string[];
};

/**
 * Move an issue to another project of the same workspace, keeping its
 * identity: comments, activity, time entries, relations, attachments, links,
 * reactions, subscribers, assignees, feedback/support rows all hang off
 * `issues.id`, so they follow untouched.
 *
 * What is project-scoped, and what happens to it:
 *   - issues.project_id / sequence_id   → re-keyed: next number of the target
 *                                          project (per-project atomic counter,
 *                                          same as create_issue); the old number
 *                                          is retired (counters never go back)
 *   - issues.state_id                   → mapped (see mapState) or `opts.stateId`
 *   - issues.estimate_point_id/type_id  → cleared (per-project lookups)
 *   - labels with project_id ≠ target   → remapped by name (case-insensitive) to
 *                                          a target-project or workspace label,
 *                                          else dropped; never created
 *   - cycle / sprint / module links     → removed when the container belongs to
 *                                          another project
 *   - custom field values               → soft-deleted when the field belongs to
 *                                          another project
 *   - parent_id                         → kept (the parent may live elsewhere)
 *   - sub-issues                        → NOT moved implicitly: the move is
 *                                          refused (409) while live sub-issues
 *                                          remain in the source project. Move them
 *                                          first (leaves up) — a silent cascade
 *                                          would renumber many issues at once.
 *   - ingest_groups                     → untouched; the group still dedupes
 *                                          log hits into this issue by id
 *   - deals / pipeline projects         → refused (a deal's stage is its state)
 *
 * The sequence number is allocated first (its own atomic statement; a failed
 * move only burns a number). Every write after that goes in ONE D1 batch, so
 * the issue is never half-moved.
 */
export async function moveIssue(
  db: DbClient,
  workspaceId: string,
  issueId: string,
  targetProjectId: string,
  opts: MoveIssueOpts = {},
): Promise<MoveIssueResult> {
  const [issue] = await db
    .select()
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

  const [target] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, targetProjectId),
        eq(schema.projects.workspaceId, workspaceId),
        isNull(schema.projects.deletedAt),
      ),
    )
    .limit(1);
  if (!target) throw new HTTPException(404, { message: "Target project not found" });
  if (target.id === issue.projectId) {
    throw new HTTPException(400, { message: "Issue is already in the target project" });
  }

  const [source] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, issue.projectId))
    .limit(1);
  if (!source) throw new HTTPException(404, { message: "Source project not found" });

  const [deal] = await db
    .select({ id: schema.deals.id })
    .from(schema.deals)
    .where(eq(schema.deals.issueId, issue.id))
    .limit(1);
  if (deal || source.isPipeline === 1 || target.isPipeline === 1) {
    throw new HTTPException(409, {
      message: "Deals and pipeline projects cannot be moved with move_issue",
    });
  }

  const [liveChild] = await db
    .select({ id: schema.issues.id })
    .from(schema.issues)
    .where(
      and(
        eq(schema.issues.parentId, issue.id),
        eq(schema.issues.projectId, issue.projectId),
        isNull(schema.issues.deletedAt),
      ),
    )
    .limit(1);
  if (liveChild) {
    throw new HTTPException(409, {
      message:
        "Issue has sub-issues in the source project; move the sub-issues first, then the parent",
    });
  }

  // ── State ────────────────────────────────────────────────────────────────
  const loadTargetStates = () =>
    db
      .select({
        id: schema.states.id,
        name: schema.states.name,
        key: schema.states.key,
        groupName: schema.states.groupName,
        isDefault: schema.states.isDefault,
        isTriage: schema.states.isTriage,
      })
      .from(schema.states)
      .where(and(eq(schema.states.projectId, target.id), isNull(schema.states.deletedAt)))
      .orderBy(schema.states.sequence, schema.states.name);
  let targetStates = await loadTargetStates();
  if (targetStates.length === 0 && opts.stateId === undefined) {
    // UI-created projects start stateless; seed the default workflow.
    await statesService.list(db, target.id);
    targetStates = await loadTargetStates();
  }

  const [sourceState] = issue.stateId
    ? await db
        .select({
          name: schema.states.name,
          key: schema.states.key,
          groupName: schema.states.groupName,
        })
        .from(schema.states)
        .where(eq(schema.states.id, issue.stateId))
        .limit(1)
    : [];

  let nextState: StateRow | undefined;
  if (opts.stateId !== undefined) {
    // An explicit state must belong to the TARGET project (not merely the
    // workspace): a state of the old project would orphan the issue.
    nextState = targetStates.find((s) => s.id === opts.stateId);
    if (!nextState) throw new HTTPException(404, { message: "State not found in target project" });
  } else if (sourceState) {
    nextState = mapState(sourceState, targetStates, target.defaultStateId);
  }

  // ── Labels ───────────────────────────────────────────────────────────────
  const issueLabelRows = await db
    .select({
      linkId: schema.issueLabels.id,
      labelId: schema.labels.id,
      name: schema.labels.name,
      projectId: schema.labels.projectId,
    })
    .from(schema.issueLabels)
    .innerJoin(schema.labels, eq(schema.labels.id, schema.issueLabels.labelId))
    .where(and(eq(schema.issueLabels.issueId, issue.id), isNull(schema.issueLabels.deletedAt)));
  const foreignLabels = issueLabelRows.filter(
    (l) => l.projectId !== null && l.projectId !== target.id,
  );
  const labelsToDrop: string[] = [];
  const labelsToAdd: string[] = [];
  const droppedLabels: string[] = [];
  if (foreignLabels.length > 0) {
    const targetLabels = await db
      .select({
        id: schema.labels.id,
        name: schema.labels.name,
        projectId: schema.labels.projectId,
      })
      .from(schema.labels)
      .where(
        and(
          eq(schema.labels.workspaceId, workspaceId),
          isNull(schema.labels.deletedAt),
          or(eq(schema.labels.projectId, target.id), isNull(schema.labels.projectId)),
        ),
      );
    const held = new Set(issueLabelRows.map((l) => l.labelId));
    for (const l of foreignLabels) {
      labelsToDrop.push(l.linkId);
      const name = l.name.trim().toLowerCase();
      const matches = targetLabels.filter((t) => t.name.trim().toLowerCase() === name);
      // Prefer the target project's own label over a workspace-wide one.
      const match = matches.find((t) => t.projectId === target.id) ?? matches[0];
      if (!match) {
        droppedLabels.push(l.name);
      } else if (!held.has(match.id)) {
        held.add(match.id);
        labelsToAdd.push(match.id);
      }
    }
  }

  // ── Write ────────────────────────────────────────────────────────────────
  const now = nowISO();
  const sequenceId = await issuesRepo.allocateNextSequence(db, target.id);
  const previousKey = `${source.identifier}-${issue.sequenceId}`;
  const key = `${target.identifier}-${sequenceId}`;

  const completedAt = nextState
    ? nextState.groupName === "completed" || nextState.groupName === "cancelled"
      ? (issue.completedAt ?? now)
      : null
    : issue.completedAt;

  const writes: unknown[] = [
    db
      .update(schema.issues)
      .set({
        projectId: target.id,
        sequenceId,
        stateId: nextState?.id ?? issue.stateId,
        completedAt,
        estimatePointId: null,
        typeId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.issues.id, issue.id),
          eq(schema.issues.projectId, issue.projectId),
          isNull(schema.issues.deletedAt),
        ),
      ),
    // The old issue_sequences row stays: it keeps the retired old key
    // traceable to this issue.
    db.insert(schema.issueSequences).values({
      id: uuid(),
      sequence: sequenceId,
      issueId: issue.id,
      projectId: target.id,
      isDeleted: 0,
      createdAt: now,
      updatedAt: now,
    }),
    db
      .delete(schema.cycleIssues)
      .where(
        and(
          eq(schema.cycleIssues.issueId, issue.id),
          inArray(
            schema.cycleIssues.cycleId,
            db
              .select({ id: schema.cycles.id })
              .from(schema.cycles)
              .where(ne(schema.cycles.projectId, target.id)),
          ),
        ),
      ),
    db
      .delete(schema.sprintIssues)
      .where(
        and(
          eq(schema.sprintIssues.issueId, issue.id),
          inArray(
            schema.sprintIssues.sprintId,
            db
              .select({ id: schema.sprints.id })
              .from(schema.sprints)
              .where(ne(schema.sprints.projectId, target.id)),
          ),
        ),
      ),
    db
      .delete(schema.moduleIssues)
      .where(
        and(
          eq(schema.moduleIssues.issueId, issue.id),
          inArray(
            schema.moduleIssues.moduleId,
            db
              .select({ id: schema.modules.id })
              .from(schema.modules)
              .where(ne(schema.modules.projectId, target.id)),
          ),
        ),
      ),
    db
      .update(schema.customFieldValues)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.customFieldValues.issueId, issue.id),
          isNull(schema.customFieldValues.deletedAt),
          inArray(
            schema.customFieldValues.customFieldId,
            db
              .select({ id: schema.customFields.id })
              .from(schema.customFields)
              .where(ne(schema.customFields.projectId, target.id)),
          ),
        ),
      ),
  ];
  for (const ids of chunk(labelsToDrop, IN_CHUNK)) {
    writes.push(
      db
        .update(schema.issueLabels)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(schema.issueLabels.id, ids)),
    );
  }
  for (const rows of chunk(labelsToAdd, 10)) {
    writes.push(
      db.insert(schema.issueLabels).values(
        rows.map((labelId) => ({
          id: uuid(),
          issueId: issue.id,
          labelId,
          createdAt: now,
          updatedAt: now,
        })),
      ),
    );
  }
  writes.push(
    db.insert(schema.issueActivities).values({
      id: uuid(),
      verb: "updated",
      field: "project",
      oldValue: previousKey,
      newValue: key,
      issueId: issue.id,
      actorId: opts.actorId ?? null,
      createdAt: now,
      updatedAt: now,
    }),
  );
  if (nextState && nextState.id !== issue.stateId) {
    writes.push(
      db.insert(schema.issueActivities).values({
        id: uuid(),
        verb: "updated",
        field: "state",
        oldValue: sourceState?.name ?? null,
        newValue: nextState.name,
        issueId: issue.id,
        actorId: opts.actorId ?? null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);

  const [moved] = await db
    .select()
    .from(schema.issues)
    .where(eq(schema.issues.id, issue.id))
    .limit(1);
  if (!moved || moved.projectId !== target.id) {
    // The guarded UPDATE matched nothing: the issue moved or was deleted
    // between our read and the batch (the sequence number is simply burned).
    throw new HTTPException(409, { message: "Issue changed during the move; retry" });
  }
  return { issue: moved, previousKey, key, droppedLabels };
}

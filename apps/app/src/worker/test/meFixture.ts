// Test-only: two users and three workspaces with issues in every shape the
// "my work" queries must tell apart (assigned to me / someone else / nobody,
// foreign workspace, deleted, completed). `me` owns alpha, belongs to beta and
// is not in gamma. Dates are relative to TODAY.
import * as schema from "../db/schema";
import type { DbClient } from "../db/index";

export const TODAY = "2026-10-30";
const NOW = "2026-10-20T00:00:00.000Z";

type IssueInsert = typeof schema.issues.$inferInsert;

export async function seedMyWork(db: DbClient) {
  await db.insert(schema.users).values([
    {
      id: "me",
      email: "me@example.com",
      username: "me",
      displayName: "Me Myself",
      avatar: "a.png",
    },
    { id: "other", email: "other@example.com", username: "other" },
  ]);
  await db.insert(schema.workspaces).values([
    { id: "w-alpha", name: "Alpha", slug: "alpha", ownerId: "me", createdAt: NOW },
    { id: "w-beta", name: "Beta", slug: "beta", ownerId: "other", createdAt: NOW },
    { id: "w-gamma", name: "Gamma", slug: "gamma", ownerId: "other", createdAt: NOW },
  ]);
  await db.insert(schema.workspaceMembers).values([
    { id: "m1", workspaceId: "w-alpha", memberId: "me", role: 20, isActive: 1 },
    { id: "m2", workspaceId: "w-beta", memberId: "me", role: 15, isActive: 1 },
    { id: "m3", workspaceId: "w-beta", memberId: "other", role: 20, isActive: 1 },
    { id: "m4", workspaceId: "w-alpha", memberId: "other", role: 15, isActive: 1 },
  ]);
  await db.insert(schema.projects).values([
    { id: "p-alpha", name: "Alpha App", identifier: "ALP", workspaceId: "w-alpha", createdAt: NOW },
    { id: "p-beta", name: "Beta App", identifier: "BET", workspaceId: "w-beta", createdAt: NOW },
    { id: "p-gamma", name: "Gamma App", identifier: "GAM", workspaceId: "w-gamma", createdAt: NOW },
  ] as (typeof schema.projects.$inferInsert)[]);
  const state = (
    id: string,
    projectId: string,
    workspaceId: string,
    key: string,
    group: string,
  ) => ({
    id,
    name: key,
    key,
    groupName: group,
    projectId,
    workspaceId,
  });
  await db
    .insert(schema.states)
    .values([
      state("s-alpha-prog", "p-alpha", "w-alpha", "in_progress", "started"),
      state("s-alpha-you", "p-alpha", "w-alpha", "needs_you", "started"),
      state("s-alpha-done", "p-alpha", "w-alpha", "done", "completed"),
      state("s-beta-prog", "p-beta", "w-beta", "in_progress", "started"),
      state("s-gamma-prog", "p-gamma", "w-gamma", "in_progress", "started"),
    ] as (typeof schema.states.$inferInsert)[]);

  const issue = (
    id: string,
    projectId: string,
    workspaceId: string,
    sequenceId: number,
    name: string,
    extra: Partial<IssueInsert> = {},
  ): IssueInsert => ({
    id,
    name,
    sequenceId,
    projectId,
    workspaceId,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  });
  await db.insert(schema.issues).values([
    // Assigned to me.
    issue("i-overdue", "p-alpha", "w-alpha", 1, "Overdue thing", {
      stateId: "s-alpha-prog",
      targetDate: "2026-10-01",
      priority: "high",
    }),
    issue("i-today", "p-alpha", "w-alpha", 2, "Due today", {
      stateId: "s-alpha-you",
      targetDate: TODAY,
    }),
    issue("i-week", "p-beta", "w-beta", 1, "Due this week", { targetDate: "2026-11-02" }),
    issue("i-done", "p-alpha", "w-alpha", 3, "Already done", {
      stateId: "s-alpha-done",
      targetDate: "2026-10-01",
    }),
    issue("i-gone", "p-alpha", "w-alpha", 6, "Deleted one", {
      stateId: "s-alpha-prog",
      deletedAt: NOW,
    }),
    // Assigned to someone else.
    issue("i-theirs", "p-alpha", "w-alpha", 4, "Their thing", {
      stateId: "s-alpha-prog",
      targetDate: "2026-10-01",
    }),
    // Unassigned: mine to triage in alpha (owner), not in beta.
    issue("i-free-alpha", "p-alpha", "w-alpha", 5, "Nobody has this", { targetDate: TODAY }),
    issue("i-free-beta", "p-beta", "w-beta", 2, "Nobody has this either", { targetDate: TODAY }),
    // Assigned to me but in a workspace I do not belong to.
    issue("i-foreign", "p-gamma", "w-gamma", 1, "Foreign", {
      stateId: "s-gamma-prog",
      targetDate: "2026-10-01",
    }),
  ]);
  const assign = (id: string, issueId: string, assigneeId: string, deletedAt?: string) => ({
    id,
    issueId,
    assigneeId,
    deletedAt,
  });
  await db.insert(schema.issueAssignees).values([
    assign("a1", "i-overdue", "me"),
    assign("a2", "i-today", "me"),
    assign("a3", "i-week", "me"),
    assign("a4", "i-done", "me"),
    assign("a5", "i-gone", "me"),
    assign("a6", "i-theirs", "other"),
    assign("a7", "i-foreign", "me"),
    // A removed assignment must not count as mine.
    assign("a8", "i-theirs", "me", NOW),
  ] as (typeof schema.issueAssignees.$inferInsert)[]);
}

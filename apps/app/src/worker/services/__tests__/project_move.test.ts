import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as schema from "../../db/schema";
import type { DbClient } from "../../db/index";
import type { Env } from "../../lib/env";
import { createTestDb, sqliteSupported } from "../../test/sqliteD1";
import { handleTool } from "../../routes/mcp/index";
import {
  moveProjectToWorkspace,
  type MoveProjectOpts,
  type MoveProjectResult,
} from "../projectMove";

const NOW = "2026-10-29T00:00:00.000Z";
const SRC = "ws-src";
const DST = "ws-dst";

async function expectStatus(fn: () => Promise<unknown>, status: number) {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HTTPException);
    expect((err as HTTPException).status).toBe(status);
    return;
  }
  throw new Error(`expected HTTPException(${status})`);
}

// Real SQLite behind the D1 surface (test/sqliteD1.ts), foreign keys on.
describe.skipIf(!sqliteSupported)("move project to workspace", () => {
  let db: DbClient;
  let env: Env;

  const move = (overrides: Partial<MoveProjectOpts> = {}): Promise<MoveProjectResult> =>
    moveProjectToWorkspace(db, {
      sourceWorkspaceId: SRC,
      projectId: "fit",
      targetWorkspaceSlug: "joyofit",
      actorId: "owner",
      ...overrides,
    });

  const insertIssue = (
    id: string,
    projectId: string,
    sequenceId: number,
    extra: Partial<typeof schema.issues.$inferInsert> = {},
  ) =>
    db.insert(schema.issues).values({
      id,
      name: `Issue ${id}`,
      sequenceId,
      projectId,
      workspaceId: SRC,
      stateId: `${projectId}-todo`,
      createdAt: NOW,
      updatedAt: NOW,
      ...extra,
    });

  const issue = async (id: string) =>
    (await db.select().from(schema.issues).where(eq(schema.issues.id, id)))[0]!;

  const liveLabelNames = async (issueId: string) =>
    (
      await db
        .select({ name: schema.labels.name, ws: schema.labels.workspaceId })
        .from(schema.issueLabels)
        .innerJoin(schema.labels, eq(schema.labels.id, schema.issueLabels.labelId))
        .where(and(eq(schema.issueLabels.issueId, issueId), isNull(schema.issueLabels.deletedAt)))
    ).toSorted((a, b) => a.name.localeCompare(b.name));

  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
    env = { DB: t.d1 } as unknown as Env;

    await db.insert(schema.users).values([
      { id: "owner", email: "o@x.test", username: "owner", token: "t1" },
      { id: "dev", email: "d@x.test", username: "dev", token: "t2" },
      { id: "plain", email: "p@x.test", username: "plain", token: "t3" },
      { id: "outsider", email: "x@x.test", username: "outsider", token: "t4" },
    ]);
    await db.insert(schema.workspaces).values([
      { id: SRC, name: "Joyo", slug: "joyo", ownerId: "owner", createdAt: NOW },
      { id: DST, name: "JoyoFit", slug: "joyofit", ownerId: "owner", createdAt: NOW },
      { id: "ws-x", name: "Elsewhere", slug: "elsewhere", ownerId: "outsider", createdAt: NOW },
    ]);
    await db.insert(schema.workspaceMembers).values([
      { id: "m-owner-src", workspaceId: SRC, memberId: "owner", role: 20 },
      { id: "m-owner-dst", workspaceId: DST, memberId: "owner", role: 20 },
      { id: "m-dev-src", workspaceId: SRC, memberId: "dev", role: 15 },
      { id: "m-plain-src", workspaceId: SRC, memberId: "plain", role: 20 },
    ]);
    await db.insert(schema.projectFolders).values({
      id: "folder",
      name: "Apps",
      workspaceId: SRC,
      createdAt: NOW,
    });
    await db.insert(schema.projects).values([
      {
        id: "fit",
        name: "JoyoFit",
        identifier: "FIT",
        workspaceId: SRC,
        folderId: "folder",
        createdAt: NOW,
      },
      { id: "jrg", name: "Joyorogo", identifier: "JRG", workspaceId: SRC, createdAt: NOW },
    ] as (typeof schema.projects.$inferInsert)[]);
    await db.insert(schema.states).values([
      { id: "fit-todo", name: "Todo", groupName: "started", projectId: "fit", workspaceId: SRC },
      { id: "fit-done", name: "Done", groupName: "completed", projectId: "fit", workspaceId: SRC },
      { id: "jrg-todo", name: "Todo", groupName: "started", projectId: "jrg", workspaceId: SRC },
    ]);
    await db
      .update(schema.projects)
      .set({ defaultStateId: "fit-todo" })
      .where(eq(schema.projects.id, "fit"));
  });

  it("re-parents the project and everything under it, keeping ids and keys", async () => {
    await insertIssue("i1", "fit", 1);
    await insertIssue("i2", "fit", 7, { stateId: "fit-done", deletedAt: NOW });
    await insertIssue("j1", "jrg", 1);
    await db.insert(schema.issueComments).values({
      id: "c1",
      issueId: "i1",
      actorId: "dev",
      commentHtml: "<p>hi</p>",
      createdAt: NOW,
    });
    await db.insert(schema.issueActivities).values({
      id: "a1",
      issueId: "i1",
      verb: "created",
      createdAt: NOW,
    });
    await db.insert(schema.timeEntries).values({
      id: "t1",
      issueId: "i1",
      workspaceId: SRC,
      userId: "dev",
      durationSeconds: 60,
      startedAt: NOW,
    });
    await db.insert(schema.modules).values({
      id: "mod",
      name: "M1",
      projectId: "fit",
      workspaceId: SRC,
    } as typeof schema.modules.$inferInsert);
    await db
      .insert(schema.moduleIssues)
      .values({ id: "mi1", moduleId: "mod", issueId: "i1", createdAt: NOW });
    await db.insert(schema.issueSequenceCounters).values({
      projectId: "fit",
      nextSequence: 8,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db.insert(schema.labels).values({
      id: "l-fit",
      name: "feedback",
      workspaceId: SRC,
      projectId: "fit",
    });
    await db
      .insert(schema.issueLabels)
      .values({ id: "il1", issueId: "i1", labelId: "l-fit", createdAt: NOW });
    await db.insert(schema.feedbackBoards).values({
      id: "board",
      projectId: "fit",
      workspaceId: SRC,
      publicToken: "pk_fb_1",
      title: "Reports",
    } as typeof schema.feedbackBoards.$inferInsert);

    const result = await move();

    expect(result.toWorkspace).toEqual({ id: DST, slug: "joyofit" });
    expect(result.moved).toMatchObject({
      projects: 1,
      issues: 2,
      states: 2,
      modules: 1,
      labels: 1,
      timeEntries: 1,
      feedbackBoards: 1,
    });
    expect(result.detached).toEqual({
      parentLinks: 0,
      relations: 0,
      cycleLinks: 0,
      sprintLinks: 0,
      moduleLinks: 0,
      customFieldValues: 0,
    });

    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, "fit"));
    expect(project).toMatchObject({ workspaceId: DST, identifier: "FIT", folderId: null });
    // Soft-deleted rows travel too; sequence numbers (keys) are untouched.
    expect((await issue("i1")).workspaceId).toBe(DST);
    expect(await issue("i2")).toMatchObject({ workspaceId: DST, sequenceId: 7, projectId: "fit" });
    // Other projects stay put.
    expect((await issue("j1")).workspaceId).toBe(SRC);
    for (const t of [
      schema.states,
      schema.modules,
      schema.labels,
      schema.feedbackBoards,
    ] as const) {
      const rows = await db.select().from(t).where(eq(t.projectId, "fit"));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.workspaceId === DST)).toBe(true);
    }
    const jrgStates = await db
      .select()
      .from(schema.states)
      .where(eq(schema.states.projectId, "jrg"));
    expect(jrgStates[0]!.workspaceId).toBe(SRC);
    expect((await db.select().from(schema.timeEntries))[0]!.workspaceId).toBe(DST);
    // Rows without a workspace column are simply still attached to the same issue.
    expect(await db.select().from(schema.issueComments)).toHaveLength(1);
    expect(await db.select().from(schema.issueActivities)).toHaveLength(1);
    expect(await db.select().from(schema.moduleIssues)).toHaveLength(1);
    expect(await liveLabelNames("i1")).toEqual([{ name: "feedback", ws: DST }]);
    expect(result.copiedLabels).toEqual([]);
  });

  it("copies the members the project refers to into the target workspace", async () => {
    await insertIssue("i1", "fit", 1, { createdById: "dev" });
    await db.insert(schema.timeEntries).values({
      id: "t1",
      issueId: "i1",
      workspaceId: SRC,
      userId: "plain",
      durationSeconds: 60,
      startedAt: NOW,
    });

    const result = await move();

    expect(result.addedMemberIds.toSorted()).toEqual(["dev", "plain"]);
    const members = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, DST));
    expect(members.map((m) => [m.memberId, m.role]).toSorted()).toEqual([
      ["dev", 15],
      ["owner", 20],
      ["plain", 20],
    ]);
  });

  it("cuts links that would span the two workspaces and says so", async () => {
    await insertIssue("epic", "jrg", 1);
    await insertIssue("child", "fit", 1, { parentId: "epic" });
    await insertIssue("child2", "fit", 2, { parentId: "child" }); // same project: kept
    await insertIssue("j-kid", "jrg", 2, { parentId: "child" }); // other project under ours
    await insertIssue("peer", "jrg", 3);
    await insertIssue("fit-peer", "fit", 3);
    await db.insert(schema.issueRelations).values([
      { id: "r-cross", issueId: "child", relatedIssueId: "peer", relationType: "blocks" },
      { id: "r-cross-rev", issueId: "peer", relatedIssueId: "child", relationType: "relates_to" },
      { id: "r-inner", issueId: "child", relatedIssueId: "fit-peer", relationType: "relates_to" },
    ]);
    await db.insert(schema.modules).values([
      { id: "mod-fit", name: "F", projectId: "fit", workspaceId: SRC },
      { id: "mod-jrg", name: "J", projectId: "jrg", workspaceId: SRC },
    ] as (typeof schema.modules.$inferInsert)[]);
    await db.insert(schema.moduleIssues).values([
      { id: "mi-ok", moduleId: "mod-fit", issueId: "child" },
      { id: "mi-out", moduleId: "mod-jrg", issueId: "child" },
      { id: "mi-in", moduleId: "mod-fit", issueId: "peer" },
      { id: "mi-jrg", moduleId: "mod-jrg", issueId: "peer" },
    ]);

    const result = await move({ actorId: "owner" });

    expect(result.detached).toMatchObject({
      parentLinks: 2,
      relations: 2,
      moduleLinks: 2,
    });
    expect((await issue("child")).parentId).toBeNull();
    expect((await issue("j-kid")).parentId).toBeNull();
    expect((await issue("child2")).parentId).toBe("child");

    const acts = await db
      .select()
      .from(schema.issueActivities)
      .where(eq(schema.issueActivities.field, "parent"));
    expect(acts.map((a) => [a.issueId, a.oldValue, a.newValue, a.actorId]).toSorted()).toEqual([
      ["child", "JRG-1", null, "owner"],
      ["j-kid", "FIT-1", null, "owner"],
    ]);

    const rel = await db.select().from(schema.issueRelations);
    const live = rel.filter((r) => r.deletedAt === null).map((r) => r.id);
    expect(live).toEqual(["r-inner"]);
    expect(rel).toHaveLength(3); // soft-deleted, not removed

    const links = await db.select().from(schema.moduleIssues);
    expect(links.map((l) => l.id).toSorted()).toEqual(["mi-jrg", "mi-ok"]);
  });

  it("copies workspace-wide and foreign-project labels into the target and remaps", async () => {
    await insertIssue("i1", "fit", 1);
    await insertIssue("i2", "fit", 2);
    await insertIssue("j1", "jrg", 1);
    await db.insert(schema.labels).values([
      { id: "ws-ui", name: "UI", workspaceId: SRC, projectId: null, color: "#111111" },
      { id: "ws-bug", name: "Bug", workspaceId: SRC, projectId: null },
      { id: "jrg-fb", name: "feedback", workspaceId: SRC, projectId: "jrg", color: "#6366f1" },
      { id: "dst-bug", name: "bug", workspaceId: DST, projectId: null },
    ]);
    await db.insert(schema.issueLabels).values([
      { id: "1", issueId: "i1", labelId: "ws-ui" },
      { id: "2", issueId: "i1", labelId: "ws-bug" },
      { id: "3", issueId: "i1", labelId: "dst-bug" }, // already has the target twin
      { id: "4", issueId: "i2", labelId: "jrg-fb" },
      { id: "5", issueId: "j1", labelId: "ws-ui" }, // other project keeps its label
    ]);

    const result = await move();

    expect(result.copiedLabels.map((l) => l.name).toSorted()).toEqual(["Bug", "UI", "feedback"]);
    expect(await liveLabelNames("i1")).toEqual([
      { name: "bug", ws: DST },
      { name: "UI", ws: DST },
    ]);
    expect(await liveLabelNames("i2")).toEqual([{ name: "feedback", ws: DST }]);
    expect(await liveLabelNames("j1")).toEqual([{ name: "UI", ws: SRC }]);

    const dstLabels = await db
      .select()
      .from(schema.labels)
      .where(eq(schema.labels.workspaceId, DST));
    const byName = Object.fromEntries(dstLabels.map((l) => [l.name, l]));
    expect(byName.UI).toMatchObject({ projectId: null, color: "#111111" });
    expect(byName.feedback).toMatchObject({ projectId: "fit", color: "#6366f1" });
    // The source workspace's labels are untouched.
    expect(
      (await db.select().from(schema.labels).where(eq(schema.labels.workspaceId, SRC)))
        .map((l) => l.id)
        .toSorted(),
    ).toEqual(["jrg-fb", "ws-bug", "ws-ui"]);
  });

  it("moves feedback attachments of its issues and unclaimed uploads, not other projects'", async () => {
    await insertIssue("i1", "fit", 1);
    await insertIssue("j1", "jrg", 1);
    await db.insert(schema.feedbackBoards).values({
      id: "board",
      projectId: "fit",
      workspaceId: SRC,
      publicToken: "pk_fb_1",
      title: "Reports",
    } as typeof schema.feedbackBoards.$inferInsert);
    await db.insert(schema.fileAssets).values(
      ["a1", "a2", "a3"].map((id) => ({
        id,
        asset: `k/${id}`,
        createdById: "owner",
        createdAt: NOW,
      })) as (typeof schema.fileAssets.$inferInsert)[],
    );
    const att = (asset: string, issueId: string | null) => ({
      assetId: asset,
      boardId: "board",
      workspaceId: SRC,
      issueId,
      filename: `${asset}.png`,
      createdAt: NOW,
    });
    await db
      .insert(schema.feedbackAttachments)
      .values([att("a1", "i1"), att("a2", null), att("a3", "j1")]);

    const result = await move();

    expect(result.moved.feedbackAttachments).toBe(2);
    const rows = await db.select().from(schema.feedbackAttachments);
    expect(Object.fromEntries(rows.map((r) => [r.assetId, r.workspaceId]))).toEqual({
      a1: DST,
      a2: DST,
      a3: SRC,
    });
  });

  it("hands the portal support project and chosen pages to the target", async () => {
    await db.insert(schema.portalSettings).values({
      workspaceId: SRC,
      supportProjectId: "fit",
      isEnabled: 1,
    });
    await db.insert(schema.pages).values([
      { id: "p1", name: "PRD", workspaceId: SRC, ownedById: "owner" },
      { id: "p2", name: "Shared", workspaceId: SRC, ownedById: "owner" },
    ] as (typeof schema.pages.$inferInsert)[]);

    const result = await move({ pageIds: ["p1"] });

    expect(result.moved.pages).toBe(1);
    const pages = await db.select().from(schema.pages);
    expect(Object.fromEntries(pages.map((p) => [p.id, p.workspaceId]))).toEqual({
      p1: DST,
      p2: SRC,
    });
    const portals = await db.select().from(schema.portalSettings);
    expect(
      Object.fromEntries(portals.map((p) => [p.workspaceId, [p.supportProjectId, p.isEnabled]])),
    ).toEqual({ [SRC]: [null, 0], [DST]: ["fit", 1] });
  });

  describe("refusals leave everything in place", () => {
    const stays = async () =>
      expect(
        (await db.select().from(schema.projects).where(eq(schema.projects.id, "fit")))[0]!
          .workspaceId,
      ).toBe(SRC);

    it("requires admin on both workspaces", async () => {
      await expectStatus(() => move({ actorId: "dev" }), 403); // plain member of src
      await expectStatus(() => move({ actorId: "plain" }), 403); // admin of src, not in dst
      await expectStatus(() => move({ actorId: "outsider" }), 403);
      await stays();
    });

    it("404s unknown targets/projects and 400s the same workspace", async () => {
      await expectStatus(() => move({ targetWorkspaceSlug: "nope" }), 404);
      await expectStatus(() => move({ projectId: "ghost" }), 404);
      await expectStatus(() => move({ targetWorkspaceSlug: "joyo" }), 400);
      await stays();
    });

    it("409s on an identifier clash, pipelines, deals, tickets and polar pipelines", async () => {
      await db.insert(schema.projects).values({
        id: "dst-fit",
        name: "Other FIT",
        identifier: "FIT",
        workspaceId: DST,
      } as typeof schema.projects.$inferInsert);
      await expectStatus(() => move(), 409);
      await db.delete(schema.projects).where(eq(schema.projects.id, "dst-fit"));

      await db.update(schema.projects).set({ isPipeline: 1 }).where(eq(schema.projects.id, "fit"));
      await expectStatus(() => move(), 409);
      await db.update(schema.projects).set({ isPipeline: 0 }).where(eq(schema.projects.id, "fit"));

      await db.insert(schema.polarSettings).values({
        workspaceId: SRC,
        pipelineProjectId: "fit",
      } as typeof schema.polarSettings.$inferInsert);
      await expectStatus(() => move(), 409);
      await db.delete(schema.polarSettings);
      await stays();
    });

    it("rejects a page that is not in the source workspace", async () => {
      await db.insert(schema.pages).values({
        id: "p-x",
        name: "Elsewhere",
        workspaceId: "ws-x",
        ownedById: "outsider",
      } as typeof schema.pages.$inferInsert);
      await expectStatus(() => move({ pageIds: ["p-x"] }), 404);
      await stays();
    });
  });

  it("is exposed as the move_project_to_workspace MCP tool", async () => {
    await insertIssue("i1", "fit", 1);
    const call = (args: Record<string, unknown>, user = "owner") =>
      handleTool(db as never, env, "move_project_to_workspace", args, user);

    await expectStatus(() => call({ workspace: "joyo", project_id: "fit" }), 400);
    await expectStatus(
      () => call({ workspace: "joyo", project_id: "fit", target_workspace: "joyofit" }, "outsider"),
      403,
    );
    const result = (await call({
      workspace: "joyo",
      project_id: "fit",
      target_workspace: "joyofit",
    })) as { toWorkspace: { slug: string }; moved: Record<string, number> };
    expect(result.toWorkspace.slug).toBe("joyofit");
    expect(result.moved.issues).toBe(1);
    expect((await issue("i1")).workspaceId).toBe(DST);
  });
});

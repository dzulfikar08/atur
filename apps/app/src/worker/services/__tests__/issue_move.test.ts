import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as schema from "../../db/schema";
import type { DbClient } from "../../db/index";
import type { Env } from "../../lib/env";
import { createTestDb, sqliteSupported } from "../../test/sqliteD1";
import { handleTool, TOOLS } from "../../routes/mcp/index";
import { moveIssue } from "../issueMove";

const NOW = "2026-10-27T00:00:00.000Z";
const WS = "ws-a";

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

// Real SQLite behind the D1 surface (test/sqliteD1.ts): the move runs actual
// queries and the batch, so the assertions look at stored rows.
describe.skipIf(!sqliteSupported)("move_issue", () => {
  let db: DbClient;
  let env: Env;

  const insertState = (
    id: string,
    projectId: string,
    name: string,
    groupName: string,
    extra: Partial<typeof schema.states.$inferInsert> = {},
  ) =>
    db.insert(schema.states).values({
      id,
      name,
      groupName,
      projectId,
      workspaceId: WS,
      sequence: 0,
      ...extra,
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
      workspaceId: WS,
      createdAt: NOW,
      updatedAt: NOW,
      ...extra,
    });

  const load = async (id: string) =>
    (await db.select().from(schema.issues).where(eq(schema.issues.id, id)))[0]!;

  const liveLabelIds = async (issueId: string) =>
    (
      await db
        .select({ id: schema.issueLabels.labelId })
        .from(schema.issueLabels)
        .where(and(eq(schema.issueLabels.issueId, issueId), isNull(schema.issueLabels.deletedAt)))
    )
      .map((r) => r.id)
      .toSorted();

  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
    env = { DB: t.d1 } as unknown as Env;

    await db.insert(schema.users).values([
      { id: "owner", email: "o@x.test", username: "owner", token: "t1" },
      { id: "member", email: "m@x.test", username: "member", token: "t2" },
      { id: "outsider", email: "x@x.test", username: "outsider", token: "t3" },
    ]);
    await db.insert(schema.workspaces).values([
      { id: WS, name: "Joyo", slug: "joyo", ownerId: "owner", createdAt: NOW },
      { id: "ws-b", name: "Other", slug: "other", ownerId: "outsider", createdAt: NOW },
    ]);
    await db
      .insert(schema.workspaceMembers)
      .values({ id: "m1", workspaceId: WS, memberId: "member" });
    await db.insert(schema.projects).values([
      { id: "jrg", name: "Joyorogo", identifier: "JRG", workspaceId: WS, createdAt: NOW },
      { id: "fit", name: "JoyoFit", identifier: "FIT", workspaceId: WS, createdAt: NOW },
      { id: "foreign", name: "Foreign", identifier: "FOR", workspaceId: "ws-b", createdAt: NOW },
    ] as (typeof schema.projects.$inferInsert)[]);

    // Source workflow (JRG) and target workflow (FIT) with different ids.
    await insertState("jrg-todo", "jrg", "Todo", "started", { key: "todo", isDefault: 1 });
    await insertState("jrg-review", "jrg", "In Review", "started");
    await insertState("jrg-needyou", "jrg", "Needs You", "started", { key: "needs_you" });
    await insertState("jrg-done", "jrg", "Done", "completed", { key: "done" });
    await insertState("jrg-cancel", "jrg", "Cancelled", "cancelled", { key: "cancelled" });
    await insertState("fit-backlog", "fit", "Backlog", "backlog", { key: "backlog" });
    await insertState("fit-todo", "fit", "Todo", "started", { key: "todo", isDefault: 1 });
    await insertState("fit-prog", "fit", "In Progress", "started", { key: "in_progress" });
    await insertState("fit-done", "fit", "Done", "completed", { key: "done" });
    await insertState("foreign-todo", "foreign", "Todo", "started");
    await db
      .update(schema.projects)
      .set({ defaultStateId: "fit-todo" })
      .where(eq(schema.projects.id, "fit"));
  });

  describe("state mapping", () => {
    it("matches by name+group first, then canonical key within the group", async () => {
      await insertIssue("i-todo", "jrg", 1, { stateId: "jrg-todo" });
      await insertIssue("i-review", "jrg", 2, { stateId: "jrg-review" });
      await moveIssue(db, WS, "i-todo", "fit");
      await moveIssue(db, WS, "i-review", "fit");

      // same name + group
      expect((await load("i-todo")).stateId).toBe("fit-todo");
      // "In Review" has no namesake; its canonical key (in_progress, derived
      // from the started group) lands on the target's In Progress.
      expect((await load("i-review")).stateId).toBe("fit-prog");
    });

    it("keeps a closed issue closed and preserves completed_at", async () => {
      await insertIssue("i-done", "jrg", 1, {
        stateId: "jrg-done",
        completedAt: "2026-01-02T00:00:00.000Z",
      });
      await moveIssue(db, WS, "i-done", "fit");
      const moved = await load("i-done");
      expect(moved.stateId).toBe("fit-done");
      expect(moved.completedAt).toBe("2026-01-02T00:00:00.000Z");
    });

    it("falls back to the target default when the group does not exist there", async () => {
      await insertIssue("i-cancel", "jrg", 1, {
        stateId: "jrg-cancel",
        completedAt: "2026-01-02T00:00:00.000Z",
      });
      await moveIssue(db, WS, "i-cancel", "fit");
      const moved = await load("i-cancel");
      expect(moved.stateId).toBe("fit-todo");
      // Landed in an open state: no longer counts as closed.
      expect(moved.completedAt).toBeNull();
    });

    it("honors an explicit target state and rejects a state of another project", async () => {
      await insertIssue("i-1", "jrg", 1, { stateId: "jrg-todo" });
      await expectStatus(() => moveIssue(db, WS, "i-1", "fit", { stateId: "jrg-todo" }), 404);
      await expectStatus(() => moveIssue(db, WS, "i-1", "fit", { stateId: "foreign-todo" }), 404);
      expect((await load("i-1")).projectId).toBe("jrg");

      await moveIssue(db, WS, "i-1", "fit", { stateId: "fit-backlog" });
      expect((await load("i-1")).stateId).toBe("fit-backlog");
    });

    it("seeds the default workflow when the target project has no states", async () => {
      await db.insert(schema.projects).values({
        id: "bare",
        name: "Bare",
        identifier: "BAR",
        workspaceId: WS,
        createdAt: NOW,
      } as typeof schema.projects.$inferInsert);
      await insertIssue("i-1", "jrg", 1, { stateId: "jrg-todo" });
      await moveIssue(db, WS, "i-1", "bare");
      const [state] = await db
        .select()
        .from(schema.states)
        .where(eq(schema.states.id, (await load("i-1")).stateId!));
      expect(state).toMatchObject({ projectId: "bare", name: "Todo" });
    });

    it("records the state change in the activity trail", async () => {
      await insertIssue("i-1", "jrg", 1, { stateId: "jrg-review" });
      await moveIssue(db, WS, "i-1", "fit", { actorId: "member" });
      const acts = await db
        .select()
        .from(schema.issueActivities)
        .where(eq(schema.issueActivities.field, "state"));
      expect(acts).toHaveLength(1);
      expect(acts[0]).toMatchObject({ oldValue: "In Review", newValue: "In Progress" });
    });
  });

  describe("sequence allocation", () => {
    it("takes the next number of the target project and records the old key", async () => {
      // The target already holds FIT-1..5 (no counter row yet → lazily seeded).
      for (let n = 1; n <= 5; n++) await insertIssue(`fit-${n}`, "fit", n);
      await insertIssue("jrg-439", "jrg", 439, { stateId: "jrg-todo" });
      await insertIssue("jrg-440", "jrg", 440, { stateId: "jrg-todo" });

      const first = await moveIssue(db, WS, "jrg-439", "fit", { actorId: "member" });
      const second = await moveIssue(db, WS, "jrg-440", "fit");

      // Same allocator as create_issue (the counter seeds past MAX and may
      // skip a number); what matters is: beyond FIT-5, consecutive afterwards.
      const seq = first.issue.sequenceId;
      expect(seq).toBeGreaterThan(5);
      expect(first.previousKey).toBe("JRG-439");
      expect(first.key).toBe(`FIT-${seq}`);
      expect(second.issue.sequenceId).toBe(seq + 1);
      expect(second.key).toBe(`FIT-${seq + 1}`);

      const [activity] = await db
        .select()
        .from(schema.issueActivities)
        .where(
          and(
            eq(schema.issueActivities.issueId, "jrg-439"),
            eq(schema.issueActivities.field, "project"),
          ),
        );
      expect(activity).toMatchObject({
        verb: "updated",
        oldValue: "JRG-439",
        newValue: `FIT-${seq}`,
        actorId: "member",
      });

      // The retired JRG number is never handed out again.
      const rows = await db
        .select({
          projectId: schema.issueSequences.projectId,
          sequence: schema.issueSequences.sequence,
        })
        .from(schema.issueSequences)
        .where(eq(schema.issueSequences.issueId, "jrg-439"));
      expect(rows).toEqual([{ projectId: "fit", sequence: seq }]);
    });

    it("does not collide with the unique (project, sequence) index", async () => {
      await insertIssue("a", "jrg", 1, { stateId: "jrg-todo" });
      await insertIssue("b", "jrg", 2, { stateId: "jrg-todo" });
      await insertIssue("c", "jrg", 3, { stateId: "jrg-todo" });
      await moveIssue(db, WS, "a", "fit");
      await moveIssue(db, WS, "b", "fit");
      await moveIssue(db, WS, "c", "fit");
      const seqs = (await db.select().from(schema.issues).where(eq(schema.issues.projectId, "fit")))
        .map((i) => i.sequenceId)
        .toSorted();
      expect(new Set(seqs).size).toBe(3);
      expect(seqs[2]! - seqs[0]!).toBe(2);
    });
  });

  describe("project-scoped data", () => {
    it("remaps project labels by name, keeps workspace labels, drops the rest", async () => {
      await db.insert(schema.labels).values([
        { id: "l-bug-jrg", name: "bug", workspaceId: WS, projectId: "jrg" },
        { id: "l-legacy-jrg", name: "legacy", workspaceId: WS, projectId: "jrg" },
        { id: "l-ops", name: "ops", workspaceId: WS, projectId: null },
        { id: "l-bug-fit", name: "Bug", workspaceId: WS, projectId: "fit" },
        { id: "l-dup-jrg", name: "ui", workspaceId: WS, projectId: "jrg" },
        { id: "l-ui-ws", name: "UI", workspaceId: WS, projectId: null },
        { id: "l-bug-gone", name: "gone", workspaceId: WS, projectId: "fit" },
      ]);
      await insertIssue("i-1", "jrg", 1, { stateId: "jrg-todo" });
      await db.insert(schema.issueLabels).values(
        ["l-bug-jrg", "l-legacy-jrg", "l-ops", "l-dup-jrg"].map((labelId) => ({
          id: `il-${labelId}`,
          issueId: "i-1",
          labelId,
          createdAt: NOW,
          updatedAt: NOW,
        })),
      );

      const moved = await moveIssue(db, WS, "i-1", "fit");

      expect(moved.droppedLabels).toEqual(["legacy"]);
      // bug → FIT's own "Bug", ui → the workspace-wide "UI", ops untouched.
      expect(await liveLabelIds("i-1")).toEqual(["l-bug-fit", "l-ops", "l-ui-ws"]);
      // No label was created.
      expect(await db.select().from(schema.labels)).toHaveLength(7);
    });

    it("does not duplicate a label the issue already holds in the target", async () => {
      await db.insert(schema.labels).values([
        { id: "l-jrg", name: "bug", workspaceId: WS, projectId: "jrg" },
        { id: "l-fit", name: "bug", workspaceId: WS, projectId: "fit" },
      ]);
      await insertIssue("i-1", "jrg", 1, { stateId: "jrg-todo" });
      await db.insert(schema.issueLabels).values(
        ["l-jrg", "l-fit"].map((labelId) => ({
          id: `il-${labelId}`,
          issueId: "i-1",
          labelId,
          createdAt: NOW,
          updatedAt: NOW,
        })),
      );
      await moveIssue(db, WS, "i-1", "fit");
      expect(await liveLabelIds("i-1")).toEqual(["l-fit"]);
    });

    it("removes sprint/cycle/module links of the old project and keeps the target's", async () => {
      await db.insert(schema.sprints).values([
        { id: "sp-jrg", name: "S1", projectId: "jrg", workspaceId: WS },
        { id: "sp-fit", name: "S2", projectId: "fit", workspaceId: WS },
      ]);
      await db.insert(schema.cycles).values({
        id: "cy-jrg",
        name: "C1",
        projectId: "jrg",
        workspaceId: WS,
        ownedById: "owner",
      });
      await db.insert(schema.modules).values([
        { id: "mo-jrg", name: "M1", projectId: "jrg", workspaceId: WS },
        { id: "mo-fit", name: "M2", projectId: "fit", workspaceId: WS },
      ]);
      await insertIssue("i-1", "jrg", 1, { stateId: "jrg-todo" });
      await insertIssue("i-other", "jrg", 2, { stateId: "jrg-todo" });
      await db.insert(schema.sprintIssues).values([
        { id: "si-1", sprintId: "sp-jrg", issueId: "i-1" },
        { id: "si-2", sprintId: "sp-fit", issueId: "i-1" },
        { id: "si-3", sprintId: "sp-jrg", issueId: "i-other" },
      ]);
      await db.insert(schema.cycleIssues).values({ id: "ci-1", cycleId: "cy-jrg", issueId: "i-1" });
      await db.insert(schema.moduleIssues).values([
        { id: "mi-1", moduleId: "mo-jrg", issueId: "i-1" },
        { id: "mi-2", moduleId: "mo-fit", issueId: "i-1" },
      ]);

      await moveIssue(db, WS, "i-1", "fit");

      const sprintLinks = await db.select().from(schema.sprintIssues);
      expect(sprintLinks.map((r) => r.id).toSorted()).toEqual(["si-2", "si-3"]);
      expect(await db.select().from(schema.cycleIssues)).toEqual([]);
      const moduleLinks = await db.select().from(schema.moduleIssues);
      expect(moduleLinks.map((r) => r.id)).toEqual(["mi-2"]);
    });

    it("soft-deletes custom field values of the old project only", async () => {
      await db.insert(schema.customFields).values([
        { id: "cf-jrg", name: "Owner", fieldType: "text", projectId: "jrg", workspaceId: WS },
        { id: "cf-fit", name: "Plan", fieldType: "text", projectId: "fit", workspaceId: WS },
      ]);
      await insertIssue("i-1", "jrg", 1, { stateId: "jrg-todo" });
      await db.insert(schema.customFieldValues).values([
        { id: "v-jrg", issueId: "i-1", customFieldId: "cf-jrg", valueJson: '"x"', workspaceId: WS },
        { id: "v-fit", issueId: "i-1", customFieldId: "cf-fit", valueJson: '"y"', workspaceId: WS },
      ]);

      await moveIssue(db, WS, "i-1", "fit");

      const rows = await db.select().from(schema.customFieldValues);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.deletedAt]));
      expect(byId["v-jrg"]).not.toBeNull();
      expect(byId["v-fit"]).toBeNull();
    });

    it("clears per-project lookups but keeps assignees, parent and plain fields", async () => {
      await insertIssue("parent", "jrg", 1, { stateId: "jrg-todo" });
      await insertIssue("i-1", "jrg", 2, {
        stateId: "jrg-todo",
        parentId: "parent",
        estimatePointId: "ep-1",
        typeId: "ty-1",
        estimatePoints: 3,
        priority: "high",
      });
      await db
        .insert(schema.issueAssignees)
        .values({ id: "a1", issueId: "i-1", assigneeId: "member", createdAt: NOW, updatedAt: NOW });

      await moveIssue(db, WS, "i-1", "fit");

      const moved = await load("i-1");
      expect(moved).toMatchObject({
        parentId: "parent",
        estimatePointId: null,
        typeId: null,
        estimatePoints: 3,
        priority: "high",
        projectId: "fit",
      });
      expect(await db.select().from(schema.issueAssignees)).toHaveLength(1);
    });

    it("keeps comments, activity, time entries, relations, links and attachments on the issue", async () => {
      await insertIssue("i-1", "jrg", 1, { stateId: "jrg-todo" });
      await insertIssue("i-2", "jrg", 2, { stateId: "jrg-todo" });
      await db.insert(schema.issueComments).values({
        id: "c1",
        commentHtml: "<p>hi</p>",
        issueId: "i-1",
        actorId: "member",
      });
      await db.insert(schema.issueActivities).values({
        id: "act-old",
        verb: "created",
        issueId: "i-1",
        actorId: "member",
      });
      await db.insert(schema.timeEntries).values({
        id: "te1",
        issueId: "i-1",
        workspaceId: WS,
        userId: "member",
        durationSeconds: 600,
        startedAt: NOW,
      });
      await db
        .insert(schema.issueRelations)
        .values({ id: "r1", issueId: "i-1", relatedIssueId: "i-2", relationType: "blocks" });
      await db
        .insert(schema.issueLinks)
        .values({ id: "ln1", issueId: "i-1", url: "https://x.test" });
      await db.insert(schema.issueAttachments).values({ id: "at1", issueId: "i-1", asset: "a" });

      await moveIssue(db, WS, "i-1", "fit");

      expect(await db.select().from(schema.issueComments)).toHaveLength(1);
      expect(await db.select().from(schema.timeEntries)).toHaveLength(1);
      expect(await db.select().from(schema.issueRelations)).toHaveLength(1);
      expect(await db.select().from(schema.issueLinks)).toHaveLength(1);
      expect(await db.select().from(schema.issueAttachments)).toHaveLength(1);
      // Original activity survives; the move added its own entry.
      const acts = await db
        .select()
        .from(schema.issueActivities)
        .where(eq(schema.issueActivities.issueId, "i-1"));
      expect(acts.map((a) => a.id)).toContain("act-old");
      expect(acts.some((a) => a.field === "project")).toBe(true);
    });
  });

  describe("guards", () => {
    it("rejects a target project from another workspace and changes nothing", async () => {
      await insertIssue("i-1", "jrg", 1, { stateId: "jrg-todo" });
      await expectStatus(() => moveIssue(db, WS, "i-1", "foreign"), 404);
      expect(await load("i-1")).toMatchObject({ projectId: "jrg", sequenceId: 1 });
    });

    it("rejects an issue from another workspace", async () => {
      await db.insert(schema.issues).values({
        id: "alien",
        name: "Alien",
        sequenceId: 1,
        projectId: "foreign",
        workspaceId: "ws-b",
      });
      await expectStatus(() => moveIssue(db, WS, "alien", "fit"), 404);
      expect((await load("alien")).projectId).toBe("foreign");
    });

    it("rejects deleted issues, unknown targets, same-project moves and pipelines", async () => {
      await insertIssue("gone", "jrg", 1, { deletedAt: NOW });
      await insertIssue("i-1", "jrg", 2, { stateId: "jrg-todo" });
      await expectStatus(() => moveIssue(db, WS, "gone", "fit"), 404);
      await expectStatus(() => moveIssue(db, WS, "i-1", "nope"), 404);
      await expectStatus(() => moveIssue(db, WS, "i-1", "jrg"), 400);

      await db.insert(schema.projects).values({
        id: "pipe",
        name: "Sales",
        identifier: "SAL",
        workspaceId: WS,
        isPipeline: 1,
        createdAt: NOW,
      } as typeof schema.projects.$inferInsert);
      await expectStatus(() => moveIssue(db, WS, "i-1", "pipe"), 409);
    });
  });

  describe("sub-issues", () => {
    it("refuses to move a parent while live sub-issues remain in the source project", async () => {
      await insertIssue("parent", "jrg", 1, { stateId: "jrg-todo" });
      await insertIssue("child", "jrg", 2, { stateId: "jrg-todo", parentId: "parent" });
      await expectStatus(() => moveIssue(db, WS, "parent", "fit"), 409);
      expect(await load("parent")).toMatchObject({ projectId: "jrg", sequenceId: 1 });
      expect((await load("child")).projectId).toBe("jrg");
    });

    it("allows the parent once its sub-issues are moved (leaves up); the link survives", async () => {
      await insertIssue("parent", "jrg", 1, { stateId: "jrg-todo" });
      await insertIssue("child", "jrg", 2, { stateId: "jrg-todo", parentId: "parent" });
      await moveIssue(db, WS, "child", "fit");
      expect(await load("child")).toMatchObject({ projectId: "fit", parentId: "parent" });
      await moveIssue(db, WS, "parent", "fit");
      expect(await load("parent")).toMatchObject({ projectId: "fit" });
      expect((await load("child")).parentId).toBe("parent");
    });

    it("ignores soft-deleted sub-issues", async () => {
      await insertIssue("parent", "jrg", 1, { stateId: "jrg-todo" });
      await insertIssue("child", "jrg", 2, { parentId: "parent", deletedAt: NOW });
      await moveIssue(db, WS, "parent", "fit");
      expect((await load("parent")).projectId).toBe("fit");
    });
  });

  describe("MCP move_issue", () => {
    it("is advertised in tools/list with the slim fields", () => {
      const tool = TOOLS.find((t) => t.name === "move_issue");
      expect(tool?.inputSchema.required).toEqual(["workspace", "issue_id", "target_project_id"]);
      expect(Object.keys(tool!.inputSchema.properties as object)).toEqual(
        expect.arrayContaining(["state_id", "slim", "include"]),
      );
    });

    it("returns the slim moved issue with old and new keys", async () => {
      await insertIssue("i-1", "jrg", 439, {
        stateId: "jrg-todo",
        descriptionHtml: "<p>heavy</p>",
      });
      const result = (await handleTool(
        db as never,
        env,
        "move_issue",
        { workspace: "joyo", issue_id: "i-1", target_project_id: "fit" },
        "member",
      )) as Record<string, unknown>;
      expect(result).toEqual({
        id: "i-1",
        name: "Issue i-1",
        sequenceId: result.sequenceId,
        stateId: "fit-todo",
        priority: "none",
        projectId: "fit",
        previousKey: "JRG-439",
        key: `FIT-${result.sequenceId}`,
        droppedLabels: [],
      });
    });

    it("rejects non-members, foreign targets and missing arguments", async () => {
      await insertIssue("i-1", "jrg", 1, { stateId: "jrg-todo" });
      const call = (args: Record<string, unknown>, user = "member") =>
        handleTool(db as never, env, "move_issue", args, user);
      await expectStatus(
        () => call({ workspace: "joyo", issue_id: "i-1", target_project_id: "fit" }, "outsider"),
        403,
      );
      await expectStatus(
        () => call({ workspace: "joyo", issue_id: "i-1", target_project_id: "foreign" }),
        404,
      );
      await expectStatus(() => call({ workspace: "joyo", issue_id: "i-1" }), 400);
      expect((await load("i-1")).projectId).toBe("jrg");
    });
  });
});

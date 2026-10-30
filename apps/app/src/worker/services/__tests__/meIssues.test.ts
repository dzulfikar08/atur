import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { TODAY, seedMyWork } from "../../test/meFixture";
import { listMyIssues, todayBuckets, toMcpIssueRow } from "../meIssues";

const page = { offset: 0, limit: 50 };
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe.skipIf(!sqliteSupported)("meIssues service (real SQLite)", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    await seedMyWork(t.db);
  });

  const mine = (params: Partial<Parameters<typeof listMyIssues>[2]> = {}) =>
    listMyIssues(t.db, "me", { assignee: "me", today: TODAY, ...page, ...params });

  describe("listMyIssues", () => {
    it("assignee=me returns only live, non-deleted issues assigned to the caller in their workspaces", async () => {
      const { results, total } = await mine();
      expect(ids(results)).toEqual(["i-done", "i-overdue", "i-today", "i-week"]);
      expect(total).toBe(4);
    });

    it("without assignee=me it lists every issue in the caller's workspaces", async () => {
      const { results } = await listMyIssues(t.db, "me", { today: TODAY, ...page });
      expect(ids(results)).toContain("i-theirs");
      expect(ids(results)).not.toContain("i-foreign");
    });

    it("scopes to a workspace by slug or id; unknown or foreign workspaces match nothing", async () => {
      expect(ids((await mine({ workspace: "alpha" })).results)).toEqual([
        "i-done",
        "i-overdue",
        "i-today",
      ]);
      expect(ids((await mine({ workspace: "w-beta" })).results)).toEqual(["i-week"]);
      for (const workspace of ["gamma", "nope"]) {
        expect(await mine({ workspace })).toEqual({ member: true, results: [], total: 0 });
      }
    });

    it("due filters: overdue skips completed issues, today is exact, week is today..+7d", async () => {
      expect(ids((await mine({ due: "overdue" })).results)).toEqual(["i-overdue"]);
      expect(ids((await mine({ due: "today" })).results)).toEqual(["i-today"]);
      expect(ids((await mine({ due: "week" })).results)).toEqual(["i-today", "i-week"]);
    });

    it("state_key resolves canonical keys across projects", async () => {
      expect(ids((await mine({ stateKeys: ["in_progress"] })).results)).toEqual(["i-overdue"]);
      expect(ids((await mine({ stateKeys: ["needs_you", "done"] })).results)).toEqual([
        "i-done",
        "i-today",
      ]);
    });

    it("q matches names and total counts the full filtered set past the page", async () => {
      expect(ids((await mine({ search: "this week" })).results)).toEqual(["i-week"]);
      expect(ids((await mine({ search: "alp-2" })).results)).toEqual(["i-today"]);
      const first = await mine({ limit: 1 });
      expect(first.results).toHaveLength(1);
      expect(first.total).toBe(4);
    });

    it("reports member=false for a user in no workspace", async () => {
      expect(await listMyIssues(t.db, "nobody", { ...page })).toEqual({
        member: false,
        results: [],
        total: 0,
      });
    });

    it("toMcpIssueRow carries the slim camelCase contract", async () => {
      const { results } = await mine({ search: "overdue" });
      expect(toMcpIssueRow(results[0])).toEqual({
        id: "i-overdue",
        name: "Overdue thing",
        sequenceId: 1,
        key: "ALP-1",
        priority: "high",
        stateId: "s-alpha-prog",
        stateKey: "in_progress",
        stateName: "in_progress",
        stateGroup: "started",
        projectId: "p-alpha",
        projectName: "Alpha App",
        projectIdentifier: "ALP",
        workspaceSlug: "alpha",
        workspaceName: "Alpha",
        targetDate: "2026-10-01",
        updatedAt: "2026-10-20T00:00:00.000Z",
        assignees: [{ id: "me", displayName: "Me Myself" }],
      });
    });
  });

  describe("todayBuckets", () => {
    it("puts each open issue in exactly one bucket; unassigned counts only in owned workspaces", async () => {
      const out = await todayBuckets(t.db, "me", { today: TODAY });
      expect(ids(out.overdue)).toEqual(["i-overdue"]);
      expect(ids(out.due_today)).toEqual(["i-free-alpha", "i-today"]);
      expect(ids(out.due_this_week)).toEqual(["i-week"]);
      expect(out.needs_you).toEqual([]);
      expect(out.need_review).toEqual([]);
      expect(out.in_progress).toEqual([]);
      expect(out.counts).toEqual({
        overdue: 1,
        due_today: 2,
        needs_you: 0,
        need_review: 0,
        in_progress: 0,
        due_this_week: 1,
        total: 4,
      });
    });

    it("scopes to a workspace; 'all' and unknown workspaces behave like the route", async () => {
      expect(
        ids((await todayBuckets(t.db, "me", { today: TODAY, workspace: "beta" })).due_this_week),
      ).toEqual(["i-week"]);
      expect(
        (await todayBuckets(t.db, "me", { today: TODAY, workspace: "all" })).counts.total,
      ).toBe(4);
      expect(
        (await todayBuckets(t.db, "me", { today: TODAY, workspace: "gamma" })).counts.total,
      ).toBe(0);
    });

    it("a user with no workspace gets the empty shape", async () => {
      const out = await todayBuckets(t.db, "nobody", {});
      expect(out.counts.total).toBe(0);
      expect(Object.keys(out)).toEqual([
        "overdue",
        "due_today",
        "needs_you",
        "need_review",
        "in_progress",
        "due_this_week",
        "counts",
      ]);
    });
  });
});

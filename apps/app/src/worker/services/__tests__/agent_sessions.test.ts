import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as schema from "../../db/schema";
import type { DbClient } from "../../db/index";
import type { Env } from "../../lib/env";
import { createTestDb, sqliteSupported } from "../../test/sqliteD1";
import { handleTool, TOOLS } from "../../routes/mcp/index";
import * as sessions from "../agentSessions";
import * as commentsService from "../comments";

describe("parseClaim / sessionIdFromPath / paneKey", () => {
  it("reads the agent and pane id from a claim comment", () => {
    expect(
      sessions.parseClaim(
        "<p>Picked up by omp/firstmate (pane abc-123).<br>Observe: https://app.diatur.com/panes/abc-123</p>",
      ),
    ).toEqual({ agent: "omp/firstmate", paneId: "abc-123" });
    expect(sessions.parseClaim("Picked up by codex (pane m1~p_7)")?.paneId).toBe("m1~p_7");
  });

  it("ignores prose and unfilled templates", () => {
    expect(sessions.parseClaim("I picked this up yesterday")).toBeNull();
    expect(sessions.parseClaim("Picked up by <agent-name> (pane <pane-id>)")).toBeNull();
  });

  it("derives the session id from a transcript path and splits pane ids", () => {
    expect(sessions.sessionIdFromPath("/x/2026-09-01T14-13_01a05d51-3006.jsonl")).toBe(
      "01a05d51-3006",
    );
    expect(sessions.sessionIdFromPath(null)).toBeNull();
    expect(sessions.paneKey("m1~p2")).toEqual({ machineId: "m1", paneId: "p2" });
    expect(sessions.paneKey("p2", "m9")).toEqual({ machineId: "m9", paneId: "p2" });
    expect(sessions.paneKey("p2")).toEqual({ machineId: "", paneId: "p2" });
  });
});

describe.skipIf(!sqliteSupported)("agent sessions", () => {
  let db: DbClient;
  const env = {} as Env;
  const NOW = "2026-10-30T00:00:00.000Z";

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

  const state = (id: string, name: string, groupName: string, key: string) =>
    db.insert(schema.states).values({
      id,
      name,
      groupName,
      key,
      projectId: "pr-a",
      workspaceId: "ws-a",
      sequence: 0,
    });

  const comments = async (issueId: string) =>
    (await db.select().from(schema.issueComments)).filter((c) => c.issueId === issueId);

  beforeEach(async () => {
    db = (await createTestDb()).db;
    await db.insert(schema.users).values([
      { id: "u1", email: "u1@example.com", username: "u1" },
      { id: "u2", email: "u2@example.com", username: "u2" },
    ]);
    await db.insert(schema.workspaces).values([
      { id: "ws-a", name: "Acme", slug: "acme", ownerId: "u1" },
      { id: "ws-b", name: "Other", slug: "other", ownerId: "u2" },
    ]);
    await db.insert(schema.projects).values([
      { id: "pr-a", name: "App", identifier: "APP", workspaceId: "ws-a" },
      { id: "pr-b", name: "Secret", identifier: "SEC", workspaceId: "ws-b" },
    ]);
    await state("st-prog", "In Progress", "started", "in_progress");
    await state("st-review", "Need Review", "started", "need_review");
    await state("st-needs", "Needs You", "started", "needs_you");
    await state("st-done", "Done", "completed", "done");
    await db.insert(schema.issues).values([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Fix login",
        sequenceId: 7,
        projectId: "pr-a",
        workspaceId: "ws-a",
        stateId: "st-prog",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Second",
        sequenceId: 8,
        projectId: "pr-a",
        workspaceId: "ws-a",
        stateId: "st-prog",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Not yours",
        sequenceId: 1,
        projectId: "pr-b",
        workspaceId: "ws-b",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  });

  const I1 = "11111111-1111-4111-8111-111111111111";
  const I2 = "22222222-2222-4222-8222-222222222222";

  it("links a pane by issue key, resolves the wire shape, and filters by client pane id", async () => {
    const wire = await sessions.linkForUser(db, "u1", {
      pane_id: "m1~p9",
      workspace: "acme",
      issue_id: "app-7",
      agent: "omp/x",
    });
    expect(wire).toMatchObject({
      paneId: "m1~p9",
      machineId: "m1",
      localPaneId: "p9",
      source: "manual",
      state: "unknown",
      agent: "omp/x",
      issue: {
        id: I1,
        key: "APP-7",
        name: "Fix login",
        workspaceSlug: "acme",
        stateKey: "in_progress",
        url: `https://app.diatur.com/acme/projects/pr-a/issues/7`,
      },
    });
    const hit = await sessions.list(db, { workspaceIds: ["ws-a"], panes: ["m1~p9"] });
    expect(hit).toHaveLength(1);
    expect(await sessions.list(db, { workspaceIds: ["ws-a"], panes: ["m1~other"] })).toEqual([]);
  });

  it("re-linking replaces the pane's link; unlink removes it", async () => {
    const base = { pane_id: "p1", workspace: "acme" };
    await sessions.linkForUser(db, "u1", { ...base, issue_id: I1 });
    await sessions.linkForUser(db, "u1", { ...base, issue_id: "APP-8" });
    const rows = await sessions.list(db, { workspaceIds: ["ws-a"] });
    expect(rows.map((r) => r.issue.key)).toEqual(["APP-8"]);
    await sessions.unlinkPane(db, "", "p1");
    expect(await sessions.list(db, { workspaceIds: ["ws-a"] })).toEqual([]);
  });

  it("refuses issues in workspaces the caller is not a member of, and unknown issues", async () => {
    await expectStatus(
      () =>
        sessions.linkForUser(db, "u1", { pane_id: "p1", workspace: "other", issue_id: "SEC-1" }),
      403,
    );
    await expectStatus(
      () =>
        sessions.linkForUser(db, "u1", { pane_id: "p1", workspace: "acme", issue_id: "APP-99" }),
      404,
    );
    await expectStatus(
      () => sessions.linkForUser(db, "u1", { pane_id: "p1", workspace: "acme", issue_id: "SEC-1" }),
      404,
    );
  });

  it("reads are scoped to the caller's workspaces", async () => {
    await sessions.linkForUser(db, "u1", { pane_id: "p1", workspace: "acme", issue_id: I1 });
    await sessions.linkForUser(db, "u2", { pane_id: "p2", workspace: "other", issue_id: "SEC-1" });
    expect((await sessions.list(db, { workspaceIds: ["ws-a"] })).map((r) => r.paneId)).toEqual([
      "p1",
    ]);
    expect(await sessions.list(db, { workspaceIds: [] })).toEqual([]);
  });

  it("a claim comment links the pane; a later hook report fills the session without moving the issue", async () => {
    await commentsService.create(
      db,
      env,
      "u1",
      I1,
      { comment_html: "<p>Picked up by omp/firstmate (pane m1~p3).</p>" },
      { sub: "u1" },
    );
    let [row] = await sessions.list(db, { workspaceIds: ["ws-a"] });
    expect(row).toMatchObject({ paneId: "m1~p3", source: "claim_comment", state: "working" });

    // The hook saw MCP calls on another issue in the same session: the explicit claim stays.
    await sessions.linkPane(db, {
      machineId: "",
      paneId: "p3",
      workspaceId: "ws-a",
      projectId: "pr-a",
      issueId: I2,
      sessionId: "sess-1",
      source: "usage_hook",
    });
    [row] = await sessions.list(db, { workspaceIds: ["ws-a"] });
    expect(row).toMatchObject({ source: "claim_comment", sessionId: "sess-1", machineId: "m1" });
    expect(row!.issue.id).toBe(I1);

    // A new explicit claim wins.
    await commentsService.create(
      db,
      env,
      "u1",
      I2,
      { comment_html: "Picked up by omp/firstmate (pane m1~p3)" },
      { sub: "u1" },
    );
    [row] = await sessions.list(db, { workspaceIds: ["ws-a"] });
    expect(row!.issue.id).toBe(I2);
  });

  it("a hook link alone creates a working, hook-sourced link and a bare id adopts its machine", async () => {
    await sessions.linkPane(db, {
      machineId: "",
      paneId: "p4",
      workspaceId: "ws-a",
      projectId: "pr-a",
      issueId: I1,
      sessionId: "s",
      source: "usage_hook",
      state: "working",
    });
    await sessions.adoptMachine(db, "m2", "p4");
    const [row] = await sessions.list(db, { workspaceIds: ["ws-a"], panes: ["m2~p4"] });
    expect(row).toMatchObject({ paneId: "m2~p4", source: "usage_hook", state: "working" });
  });

  it("ended sessions drop out of the active list and ignore agent events", async () => {
    await sessions.linkForUser(db, "u1", { pane_id: "p5", workspace: "acme", issue_id: I1 });
    await sessions.endSession(db, "", "p5", null);
    expect(await sessions.list(db, { workspaceIds: ["ws-a"], activeOnly: true })).toEqual([]);
    expect(await sessions.list(db, { workspaceIds: ["ws-a"] })).toHaveLength(1);
    const res = await sessions.recordEvent(db, { status: "blocked", paneId: "p5", machineId: "" });
    expect(res.linked).toBe(false);
  });

  describe("agent events", () => {
    const link = () =>
      sessions.linkForUser(db, "u1", {
        pane_id: "m1~p6",
        workspace: "acme",
        issue_id: I1,
        agent: "omp",
      });
    const setSettings = (v: { on_blocked?: sessions.Reaction; on_done?: sessions.Reaction }) =>
      sessions.updateSettings(db, "ws-a", v);
    const issueState = async () =>
      (await db.select().from(schema.issues).where(eq(schema.issues.id, I1)))[0]!.stateId;

    it("ignores events for unlinked panes", async () => {
      const res = await sessions.recordEvent(db, { status: "done", paneId: "zz", machineId: "m1" });
      expect(res).toEqual({ linked: false, action: "none" });
    });

    it("defaults: blocked comments once per cooldown, done only updates state, no state change", async () => {
      await link();
      const done = await sessions.recordEvent(db, {
        status: "done",
        paneId: "p6",
        machineId: "m1",
        detail: "Shipped",
      });
      expect(done).toEqual({ linked: true, action: "none" });
      let [row] = await sessions.list(db, { workspaceIds: ["ws-a"] });
      expect(row!.state).toBe("done");
      expect(await comments(I1)).toHaveLength(0);

      const blocked = {
        status: "blocked" as const,
        paneId: "p6",
        machineId: "m1",
        detail: "Which db?",
      };
      expect((await sessions.recordEvent(db, blocked)).action).toBe("comment");
      expect((await sessions.recordEvent(db, blocked)).action).toBe("none"); // cooldown
      const posted = await comments(I1);
      expect(posted).toHaveLength(1);
      expect(posted[0]!.commentHtml).toContain("needs you: Which db?");
      expect(posted[0]!.actorId).toBe("u1");
      [row] = await sessions.list(db, { workspaceIds: ["ws-a"] });
      expect(row!.state).toBe("blocked");
      expect(await issueState()).toBe("st-prog");
    });

    it("suggest stores a state and says so; auto moves the issue; both leave finished issues alone", async () => {
      await link();
      await setSettings({ on_done: "suggest", on_blocked: "auto" });
      expect(
        (await sessions.recordEvent(db, { status: "done", paneId: "p6", machineId: "m1" })).action,
      ).toBe("suggest");
      let [row] = await sessions.list(db, { workspaceIds: ["ws-a"] });
      expect(row!.suggestedStateId).toBe("st-review");
      expect((await comments(I1))[0]!.commentHtml).toContain(
        "Suggested state: <strong>Need Review",
      );
      expect(await issueState()).toBe("st-prog");

      expect(
        (await sessions.recordEvent(db, { status: "blocked", paneId: "p6", machineId: "m1" }))
          .action,
      ).toBe("auto");
      expect(await issueState()).toBe("st-needs");
      const acts = await db.select().from(schema.issueActivities);
      expect(acts.some((a) => a.field === "state" && a.newValue === "Needs You")).toBe(true);

      await db.update(schema.issues).set({ stateId: "st-done" }).where(eq(schema.issues.id, I1));
      [row] = await sessions.list(db, { workspaceIds: ["ws-a"] });
      await db.update(schema.agentSessions).set({ lastNotifiedAt: null, lastNotifiedState: null });
      expect(
        (await sessions.recordEvent(db, { status: "blocked", paneId: "p6", machineId: "m1" }))
          .action,
      ).toBe("comment");
      expect(await issueState()).toBe("st-done");
    });

    it("settings default off for state changes and validate values", async () => {
      expect(await sessions.getSettings(db, "ws-a")).toEqual({
        onBlocked: "comment",
        onDone: "off",
      });
      expect(await sessions.updateSettings(db, "ws-a", { on_done: "comment" })).toEqual({
        onBlocked: "comment",
        onDone: "comment",
      });
      expect(sessions.settingsSchema.safeParse({ on_done: "yolo" }).success).toBe(false);
    });
  });

  describe("MCP tools", () => {
    it("are advertised", () => {
      const names = TOOLS.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining(["get_session_issue", "list_agent_sessions", "link_session_issue"]),
      );
    });

    it("link, look up by pane and session, list per workspace", async () => {
      const call = (name: string, params: Record<string, unknown>) =>
        handleTool(db, env, name, params, "u1") as Promise<any>;
      const linked = await call("link_session_issue", {
        workspace: "acme",
        issue_id: "APP-7",
        pane_id: "p8",
        session_id: "sess-8",
      });
      expect(linked.session).toMatchObject({ source: "mcp", paneId: "p8" });
      const byPane = await call("get_session_issue", { pane_id: "p8" });
      expect(byPane.session.issue.key).toBe("APP-7");
      const bySession = await call("get_session_issue", { session_id: "sess-8" });
      expect(bySession.session.paneId).toBe("p8");
      expect((await call("get_session_issue", { pane_id: "nope" })).session).toBeNull();
      expect((await call("list_agent_sessions", { workspace: "acme" })).sessions).toHaveLength(1);
      await expectStatus(() => call("list_agent_sessions", { workspace: "other" }), 403);
      await expectStatus(() => call("get_session_issue", {}), 400);
    });

    it("an MCP add_comment claim links the pane", async () => {
      await handleTool(
        db,
        env,
        "add_comment",
        {
          workspace: "acme",
          project_id: "pr-a",
          issue_id: I2,
          comment_html: "Picked up by omp (pane p10).",
        },
        "u1",
      );
      const [row] = await sessions.list(db, { workspaceIds: ["ws-a"], panes: ["p10"] });
      expect(row!.issue.id).toBe(I2);
    });
  });
});

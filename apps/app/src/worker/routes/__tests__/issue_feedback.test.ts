import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import * as schema from "../../db/schema";
import type { DbClient } from "../../db/index";
import type { Env } from "../../lib/env";
import { errorMiddleware } from "../../middleware/error";
import { createTestDb, sqliteSupported } from "../../test/sqliteD1";
import { feedbackRoutes } from "../feedback";
import { issueExtrasRoutes } from "../issue_extras";
import { handleTool } from "../mcp/index";
import * as feedback from "../../services/feedback";
import * as attachments from "../../services/feedback_attachments";
import type { IssueFeedback } from "../../services/feedback";

// Node's own File (arrayBuffer() is guaranteed). Static import cannot work: the worker
// tsconfig has no node types, so the specifier stays runtime-resolved (as in feedback_portal.test.ts).
const nodeBuffer = "node:buffer";
const { File: NodeFile } = (await import(/* @vite-ignore */ nodeBuffer)) as { File: typeof File };

async function readFeedback(res: Response): Promise<IssueFeedback> {
  return (await res.json()) as IssueFeedback;
}

const NOW = "2026-10-18T00:00:00.000Z";
const TOKEN = "pk_fb_issuefeedback";
const LOG = "12:00:01 boot\n12:00:02 crash: undefined is not a function\n";

// Issue feedback is read through the authenticated API: files a submission
// carries live in feedback_attachments, which the generic issue attachments
// endpoint never reads.
describe.skipIf(!sqliteSupported)("issue feedback (authenticated read)", () => {
  let db: DbClient;
  let env: Env;
  let issueId: string;
  let sequenceId: number;
  let assetId: string;

  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
    const objects = new Map<string, Uint8Array>();
    env = {
      DB: t.d1,
      R2: {
        put: async (key: string, bytes: Uint8Array) => void objects.set(key, bytes),
        get: async () => null,
        delete: async () => undefined,
      },
    } as unknown as Env;

    await db.insert(schema.users).values([
      { id: feedback.FEEDBACK_BOT_USER_ID, email: "bot@feedback.local", username: "bot", isBot: 1 },
      { id: "member", email: "member@x.test", username: "member", token: "tok-member" },
      { id: "owner", email: "owner@x.test", username: "owner", token: "tok-owner" },
      { id: "outsider", email: "out@x.test", username: "outsider", token: "tok-outsider" },
    ]);
    await db.insert(schema.workspaces).values([
      { id: "ws-a", name: "A", slug: "a", ownerId: "owner", createdAt: NOW },
      { id: "ws-b", name: "B", slug: "b", ownerId: "outsider", createdAt: NOW },
    ]);
    await db
      .insert(schema.workspaceMembers)
      .values({ id: "m1", workspaceId: "ws-a", memberId: "member" });
    await db.insert(schema.projects).values([
      { id: "proj-a", name: "Dev", identifier: "DEV", workspaceId: "ws-a", createdAt: NOW },
      { id: "proj-b", name: "Other", identifier: "OTH", workspaceId: "ws-b", createdAt: NOW },
    ] as (typeof schema.projects.$inferInsert)[]);
    await db.insert(schema.states).values({
      id: "st-open",
      name: "Backlog",
      groupName: "backlog",
      isDefault: 1,
      projectId: "proj-a",
      workspaceId: "ws-a",
    } as typeof schema.states.$inferInsert);
    await db.insert(schema.feedbackBoards).values({
      id: "board-a",
      projectId: "proj-a",
      workspaceId: "ws-a",
      publicToken: TOKEN,
      title: "A feedback",
      defaultStateId: "st-open",
    });

    // A real submission: .txt log claimed by a bug report with context.
    const file = new NodeFile([LOG], "app.log.txt", { type: "text/plain" }) as unknown as File;
    const uploaded = await attachments.uploadAttachment(
      db,
      env,
      { id: "board-a", workspaceId: "ws-a" },
      file,
      "https://app.test",
      feedback.FEEDBACK_BOT_USER_ID,
    );
    assetId = uploaded.id;
    const submit = new Hono<{ Bindings: Env }>();
    submit.use("*", errorMiddleware);
    submit.route("/api/feedback/:token", feedbackRoutes);
    const res = await submit.fetch(
      new Request(`http://localhost/api/feedback/${TOKEN}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "App crashes on boot",
          kind: "bug",
          source: "native",
          name: "Ana",
          email: "ana@example.com",
          context: {
            url: "https://app.test/home?token=secret&tab=1",
            app_version: "2.4.1",
            console_errors: [{ message: "TypeError: x", at: NOW }],
          },
          attachment_ids: [assetId],
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const out = (await res.json()) as { id: string; sequence_id: number };
    issueId = out.id;
    sequenceId = out.sequence_id;
  });

  function app() {
    const a = new Hono<{ Bindings: Env }>();
    a.use("*", errorMiddleware);
    a.route("/api/workspaces/:slug/projects/:projectId/issues/:issueId", issueExtrasRoutes);
    return a;
  }

  function get(path: string, token?: string) {
    return app().fetch(
      new Request(`https://app.test${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
      env,
    );
  }

  const feedbackPath = (slug: string, projectId: string, issue: string | number) =>
    `/api/workspaces/${slug}/projects/${projectId}/issues/${issue}/feedback`;

  it("returns reporter, redacted context and the claimed files to a workspace member", async () => {
    const res = await get(feedbackPath("a", "proj-a", issueId), "tok-member");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issue_id: issueId,
      source: "native",
      kind: "bug",
      reporter: {
        name: "Ana",
        email: "ana@example.com",
        external_user_id: null,
        identity_verified: false,
      },
      context: {
        url: "https://app.test/home?token=REDACTED&tab=1",
        app_version: "2.4.1",
        console_errors: [{ message: "TypeError: x", at: NOW }],
      },
      created_at: expect.any(String),
      attachments: [
        {
          id: assetId,
          filename: "app.log.txt",
          content_type: "text/plain",
          size: LOG.length,
          url: `https://app.test/api/assets/${assetId}`,
          created_at: expect.any(String),
        },
      ],
    });
  });

  it("resolves the issue by sequence id and lets the workspace owner read it", async () => {
    const res = await get(feedbackPath("a", "proj-a", sequenceId), "tok-owner");
    expect(res.status).toBe(200);
    expect((await readFeedback(res)).issue_id).toBe(issueId);
  });

  it("does not list files that were uploaded but never claimed", async () => {
    const file = new NodeFile([LOG], "orphan.txt", { type: "text/plain" }) as unknown as File;
    await attachments.uploadAttachment(
      db,
      env,
      { id: "board-a", workspaceId: "ws-a" },
      file,
      "https://app.test",
      feedback.FEEDBACK_BOT_USER_ID,
    );
    const res = await get(feedbackPath("a", "proj-a", issueId), "tok-member");
    const body = await readFeedback(res);
    expect(body.attachments.map((a) => a.filename)).toEqual(["app.log.txt"]);
  });

  it("rejects anonymous callers and non-members, and cannot cross workspaces", async () => {
    expect((await get(feedbackPath("a", "proj-a", issueId))).status).toBe(401);
    expect((await get(feedbackPath("a", "proj-a", issueId), "tok-outsider")).status).toBe(403);
    // Member of A pointing at B's slug is not a member there.
    expect((await get(feedbackPath("b", "proj-b", issueId), "tok-member")).status).toBe(403);
    // Foreign project id under a workspace the caller belongs to.
    expect((await get(feedbackPath("a", "proj-b", issueId), "tok-member")).status).toBe(404);
  });

  it("404s for an issue that did not come from a feedback submission", async () => {
    await db.insert(schema.issues).values({
      id: "plain",
      name: "Plain issue",
      sequenceId: 99,
      projectId: "proj-a",
      workspaceId: "ws-a",
      createdAt: NOW,
    } as typeof schema.issues.$inferInsert);
    expect((await get(feedbackPath("a", "proj-a", "plain"), "tok-member")).status).toBe(404);
    expect((await get(feedbackPath("a", "proj-a", "nope"), "tok-member")).status).toBe(404);
  });

  describe("MCP get_issue_feedback", () => {
    const params = () => ({ workspace: "a", project_id: "proj-a", issue_id: issueId });

    it("returns the same payload with absolute file urls", async () => {
      const out = (await handleTool(
        db,
        env,
        "get_issue_feedback",
        params(),
        "member",
        "https://app.test",
      )) as IssueFeedback;
      expect(out.reporter.email).toBe("ana@example.com");
      expect(out.attachments).toHaveLength(1);
      expect(out.attachments[0].url).toBe(`https://app.test/api/assets/${assetId}`);
    });

    it("is closed to non-members", async () => {
      await expect(
        handleTool(db, env, "get_issue_feedback", params(), "outsider"),
      ).rejects.toMatchObject({ status: 403 });
    });
  });
});

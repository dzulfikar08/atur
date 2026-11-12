import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import * as schema from "../../db/schema";
import type { DbClient } from "../../db/index";
import type { Env } from "../../lib/env";
import { errorMiddleware } from "../../middleware/error";
import { hmacSha256Hex } from "../../lib/identify";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { feedbackRoutes } from "../../routes/feedback";
import * as feedback from "../feedback";
import { htmlToText, meMessage, ME_MAX_AGE_SEC } from "../feedback_me";

const NOW = "2026-10-18T00:00:00.000Z";
const SECRET = "ids_test_secret";
const TOKEN = "pk_fb_metoken";

describe("htmlToText", () => {
  it("keeps paragraphs and breaks, drops tags, decodes entities", () => {
    expect(htmlToText("<p>Hi &amp; <b>thanks</b></p><p>Line<br>two &lt;3</p>")).toBe(
      "Hi & thanks\n\nLine\ntwo <3",
    );
    expect(htmlToText(null)).toBe("");
  });
});

describe.skipIf(!sqliteSupported)("signed-in feedback API (/me)", () => {
  let t: TestDb;
  let db: DbClient;
  let env: Env;

  beforeEach(async () => {
    t = await createTestDb();
    db = t.db;
    env = { DB: t.d1 } as unknown as Env;
    await db.insert(schema.users).values({
      id: feedback.FEEDBACK_BOT_USER_ID,
      email: "bot@feedback.local",
      username: "feedback-bot",
      isBot: 1,
    });
    await db.insert(schema.users).values({
      id: "staff-1",
      email: "staff@team.test",
      username: "staff",
      displayName: "Dzul",
    });
    await db.insert(schema.workspaces).values({
      id: "ws",
      name: "JoyoFit",
      slug: "joyofit",
      ownerId: "staff-1",
      createdAt: NOW,
    });
    await db.insert(schema.projects).values({
      id: "proj",
      name: "JoyoFit",
      identifier: "FIT",
      workspaceId: "ws",
      createdAt: NOW,
    } as typeof schema.projects.$inferInsert);
    await db.insert(schema.states).values([
      {
        id: "st-open",
        name: "Backlog",
        groupName: "backlog",
        isDefault: 1,
        projectId: "proj",
        workspaceId: "ws",
      },
      { id: "st-done", name: "Done", groupName: "completed", projectId: "proj", workspaceId: "ws" },
    ] as (typeof schema.states.$inferInsert)[]);
    await db.insert(schema.feedbackBoards).values({
      id: "board",
      projectId: "proj",
      workspaceId: "ws",
      publicToken: TOKEN,
      title: "JoyoFit feedback",
      defaultStateId: "st-open",
      identifySecret: SECRET,
    });
  });

  function app() {
    const a = new Hono<{ Bindings: Env }>();
    a.use("*", errorMiddleware);
    a.route("/api/feedback/:token", feedbackRoutes);
    return a;
  }

  async function headers(
    id = "user-1",
    email = "Ana@Example.com",
    opts: { expires?: number; secret?: string; name?: string } = {},
  ) {
    const expires = opts.expires ?? Math.floor(Date.now() / 1000) + 120;
    return {
      "x-atur-user-id": id,
      "x-atur-user-email": email,
      "x-atur-user-name": encodeURIComponent(opts.name ?? "Ana"),
      "x-atur-expires": String(expires),
      "x-atur-signature": await hmacSha256Hex(opts.secret ?? SECRET, meMessage(id, email, expires)),
    };
  }

  async function call(
    path: string,
    init: { method?: string; body?: unknown; h?: Record<string, string> } = {},
  ) {
    const h = init.h ?? (await headers());
    return app().fetch(
      new Request(`http://localhost/api/feedback/${TOKEN}${path}`, {
        method: init.method ?? "GET",
        headers: {
          ...h,
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      }),
      env,
    );
  }

  async function report(kind: "bug" | "idea", title: string, email = "ana@example.com") {
    const res = await app().fetch(
      new Request(`http://localhost/api/feedback/${TOKEN}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description: "Steps here",
          kind,
          source: "widget",
          external_user: {
            id: "user-1",
            email,
            name: "Ana",
            signature: await hmacSha256Hex(SECRET, `user-1:${email.toLowerCase()}`),
          },
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; sequence_id: number };
  }

  it("refuses a missing, wrong, widget-style or expired signature", async () => {
    expect((await call("/me/board", { h: {} })).status).toBe(401);
    expect(
      (
        await call("/me/board", {
          h: await headers("user-1", "ana@example.com", { secret: "nope" }),
        })
      ).status,
    ).toBe(401);
    const now = Math.floor(Date.now() / 1000);
    expect(
      (
        await call("/me/board", {
          h: await headers("user-1", "ana@example.com", { expires: now - 1 }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call("/me/board", {
          h: await headers("user-1", "ana@example.com", { expires: now + ME_MAX_AGE_SEC + 60 }),
        })
      ).status,
    ).toBe(401);
    // The widget's signature (id:email) does not open this API.
    const widget = {
      ...(await headers()),
      "x-atur-signature": await hmacSha256Hex(SECRET, "user-1:ana@example.com"),
    };
    expect((await call("/me/board", { h: widget })).status).toBe(401);
  });

  it("refuses a board without an identify secret", async () => {
    await db
      .update(schema.feedbackBoards)
      .set({ identifySecret: null })
      .where(eq(schema.feedbackBoards.id, "board"));
    expect((await call("/me/board")).status).toBe(403);
  });

  it("lists ideas, votes as the verified email and comments", async () => {
    const idea = await report("idea", "Export GPX to Komoot");
    let board = (await (await call("/me/board")).json()) as {
      items: { id: string; votes: number; voted: boolean }[];
    };
    expect(board.items.map((i) => i.id)).toEqual([idea.id]);
    expect(board.items[0]!.voted).toBe(false);

    const vote = await call(`/me/items/${idea.id}/votes`, { method: "POST", body: {} });
    expect(await vote.json()).toEqual({ voted: true, count: 1 });
    board = (await (await call("/me/board")).json()) as typeof board;
    expect(board.items[0]).toMatchObject({ votes: 1, voted: true });
    // Same email from the public board (portal) sees the same vote.
    const pub = await app().fetch(
      new Request(`http://localhost/api/feedback/${TOKEN}?email=ana@example.com`),
      env,
    );
    expect(((await pub.json()) as typeof board).items[0]!.voted).toBe(true);

    expect(
      (await call(`/me/items/${idea.id}/comments`, { method: "POST", body: { body: " " } })).status,
    ).toBe(400);
    expect(
      (
        await call(`/me/items/${idea.id}/comments`, {
          method: "POST",
          body: { body: "Yes please" },
        })
      ).status,
    ).toBe(201);
    const item = (await (await call(`/me/items/${idea.id}`)).json()) as {
      comments: { body: string }[];
    };
    expect(item.comments.map((c) => c.body)).toEqual(["Yes please"]);
  });

  it("shows the person's tickets and ideas, and the thread of a ticket with replies both ways", async () => {
    const bug = await report("bug", "Splits missing after sync");
    await report("idea", "Dark mode");
    await report("bug", "Someone else's bug", "bob@example.com");

    const mine = (await (await call("/me/reports")).json()) as {
      tickets: { sequence_id: number; name: string; state: { name: string } | null }[];
      ideas: { name: string }[];
    };
    expect(mine.tickets.map((t) => t.name)).toEqual(["Splits missing after sync"]);
    expect(mine.tickets[0]!.state?.name).toBe("Backlog");
    expect(mine.ideas.map((i) => i.name)).toEqual(["Dark mode"]);

    // A staff reply (public) and an internal note.
    await db.insert(schema.issueComments).values([
      {
        id: "c-staff",
        issueId: bug.id,
        actorId: "staff-1",
        access: "public",
        commentHtml: "<p>Thanks, looking</p>",
        createdAt: "2026-10-18T01:00:00.000Z",
      },
      {
        id: "c-note",
        issueId: bug.id,
        actorId: "staff-1",
        access: "internal",
        commentHtml: "<p>secret</p>",
        createdAt: "2026-10-18T01:30:00.000Z",
      },
    ] as (typeof schema.issueComments.$inferInsert)[]);
    expect(
      (
        await call(`/me/tickets/${bug.sequence_id}/comments`, {
          method: "POST",
          body: { body: "Here is the FIT file" },
        })
      ).status,
    ).toBe(201);

    const res = await call(`/me/tickets/${bug.sequence_id}`);
    expect(res.status).toBe(200);
    const thread = (await res.json()) as {
      name: string;
      description: string;
      comments: { text: string; from: string; author_name: string | null }[];
    };
    expect(thread.name).toBe("Splits missing after sync");
    expect(thread.description).toBe("Steps here");
    expect(thread.comments).toEqual([
      expect.objectContaining({ text: "Thanks, looking", from: "team", author_name: "Dzul" }),
      expect.objectContaining({ text: "Here is the FIT file", from: "you", author_name: null }),
    ]);
    expect(JSON.stringify(thread)).not.toContain("staff@team.test");
    expect(JSON.stringify(thread)).not.toContain("secret");
  });

  it("files a bug as the person's verified ticket and an idea on the board, from the host's own form", async () => {
    const bug = await call("/me/items", {
      method: "POST",
      body: {
        title: "Sync stuck at 0%",
        description: "Since this morning",
        kind: "bug",
        context: { url: "https://app.fit.test/issues", app_version: "web", platform: "web" },
      },
    });
    expect(bug.status).toBe(201);
    const created = (await bug.json()) as { id: string; sequence_id: number };
    const idea = await call("/me/items", {
      method: "POST",
      body: { title: "Komoot export", kind: "idea" },
    });
    expect(idea.status).toBe(201);
    expect(
      (await call("/me/items", { method: "POST", body: { title: "x", kind: "bug" } })).status,
    ).toBe(400);
    expect(
      (await call("/me/items", { method: "POST", body: { title: "Valid title", kind: "nope" } }))
        .status,
    ).toBe(400);

    const mine = (await (await call("/me/reports")).json()) as {
      tickets: { sequence_id: number; name: string }[];
      ideas: { name: string }[];
      unverified: unknown[];
    };
    expect(mine.tickets.map((t) => t.name)).toEqual(["Sync stuck at 0%"]);
    expect(mine.ideas.map((i) => i.name)).toEqual(["Komoot export"]);
    expect(mine.unverified).toEqual([]);
    const meta = await db
      .select()
      .from(schema.feedbackMeta)
      .where(eq(schema.feedbackMeta.issueId, created.id));
    expect(meta[0]).toMatchObject({
      identityVerified: 1,
      source: "api",
      kind: "bug",
      authorEmail: "ana@example.com",
    });
  });

  it("does not open another person's ticket", async () => {
    const bobs = await report("bug", "Bob's bug", "bob@example.com");
    expect((await call(`/me/tickets/${bobs.sequence_id}`)).status).toBe(404);
    expect(
      (
        await call(`/me/tickets/${bobs.sequence_id}/comments`, {
          method: "POST",
          body: { body: "hi" },
        })
      ).status,
    ).toBe(404);
    expect((await call(`/me/tickets/abc`)).status).toBe(400);
  });

  it("lists completed ideas as the changelog", async () => {
    const idea = await report("idea", "Strava auto sync");
    await db
      .update(schema.issues)
      .set({ stateId: "st-done", completedAt: "2026-10-19T00:00:00.000Z" })
      .where(eq(schema.issues.id, idea.id));
    const log = (await (await call("/me/changelog")).json()) as { results: { name: string }[] };
    expect(log.results.map((r) => r.name)).toEqual(["Strava auto sync"]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import * as schema from "../../db/schema";
import type { DbClient } from "../../db/index";
import type { Env } from "../../lib/env";
import { errorMiddleware } from "../../middleware/error";
import { hmacSha256Hex } from "../../lib/identify";
import { redactUrl } from "../../lib/feedbackContext";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { feedbackRoutes } from "../../routes/feedback";
import { ingestRoutes } from "../../routes/ingest";
import * as feedback from "../feedback";
import * as attachments from "../feedback_attachments";
import * as portal from "../portal";
import { normalizeMessage, topStackFrame, fingerprintFor } from "../ingest";

// Node's own File (arrayBuffer() is guaranteed). The worker tsconfig has no node
// types and the specifier is runtime-resolved, same as test/sqliteD1.ts.
const nodeBuffer = "node:buffer";
const { File: NodeFile } = (await import(/* @vite-ignore */ nodeBuffer)) as { File: typeof File };

const NOW = "2026-10-18T00:00:00.000Z";
const SECRET = "ids_test_secret";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function fakeR2() {
  const store = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const r2 = {
    put: async (key: string, bytes: Uint8Array) => void store.set(key, bytes),
    get: async (key: string) => (store.has(key) ? { body: null, size: 1 } : null),
    delete: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        store.delete(k);
        deleted.push(k);
      }
    },
  };
  return { r2: r2 as unknown as R2Bucket, store, deleted };
}

describe("identify signatures", () => {
  it("matches the RFC 4231-style HMAC-SHA256 reference vector", async () => {
    expect(await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });
});

describe("context redaction", () => {
  it("redacts secret-looking query params on the page URL and drops failed-request queries", () => {
    expect(redactUrl("https://x.test/a?token=abc&tab=2#frag", { keepQuery: true })).toBe(
      "https://x.test/a?token=REDACTED&tab=2",
    );
    expect(redactUrl("https://u:p@x.test/api?api_key=1&x=2", { keepQuery: false })).toBe(
      "https://x.test/api",
    );
  });
});

describe("fingerprinting", () => {
  it("masks volatile tokens and line numbers", async () => {
    expect(normalizeMessage("User 42 not found (req 0xDEADBEEF)")).toBe(
      "user <n> not found (req <hex>)",
    );
    expect(topStackFrame("Error: x\n    at handler (/app/src/a.ts:10:5)\n    at next")).toBe(
      "at handler (/app/src/a.ts)",
    );
    const a = await fingerprintFor({
      service: "api",
      message: "User 1 not found",
      stack: "Error\n at f (a.ts:1:1)",
    });
    const b = await fingerprintFor({
      service: "api",
      message: "User 99 not found",
      stack: "Error\n at f (a.ts:77:3)",
    });
    const c = await fingerprintFor({
      service: "worker",
      message: "User 1 not found",
      stack: "Error\n at f (a.ts:1:1)",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe.skipIf(!sqliteSupported)("feedback portal, attachments and ingest", () => {
  let t: TestDb;
  let db: DbClient;
  let env: Env;
  let r2: ReturnType<typeof fakeR2>;
  let boardId: string;
  const TOKEN = "pk_fb_testtoken";
  const KEY = "ik_testkey";

  async function seedWorkspace(slug: string, withSecret: boolean, ingestKey: string | null) {
    const ws = `ws-${slug}`;
    const project = `proj-${slug}`;
    await db.insert(schema.workspaces).values({
      id: ws,
      name: slug,
      slug,
      ownerId: feedback.FEEDBACK_BOT_USER_ID,
      createdAt: NOW,
    });
    await db.insert(schema.projects).values({
      id: project,
      name: "Dev",
      identifier: "DEV",
      workspaceId: ws,
      createdAt: NOW,
    } as typeof schema.projects.$inferInsert);
    await db.insert(schema.states).values([
      {
        id: `st-open-${slug}`,
        name: "Backlog",
        groupName: "backlog",
        isDefault: 1,
        projectId: project,
        workspaceId: ws,
      },
      {
        id: `st-done-${slug}`,
        name: "Done",
        groupName: "completed",
        projectId: project,
        workspaceId: ws,
      },
    ] as (typeof schema.states.$inferInsert)[]);
    const id = `board-${slug}`;
    await db.insert(schema.feedbackBoards).values({
      id,
      projectId: project,
      workspaceId: ws,
      publicToken: slug === "acme" ? TOKEN : `pk_fb_${slug}`,
      title: `${slug} feedback`,
      defaultStateId: `st-open-${slug}`,
      identifySecret: withSecret ? SECRET : null,
      ingestKey,
    });
    return { ws, project, id };
  }

  beforeEach(async () => {
    t = await createTestDb();
    db = t.db;
    r2 = fakeR2();
    env = { DB: t.d1, R2: r2.r2 } as unknown as Env;
    await db.insert(schema.users).values({
      id: feedback.FEEDBACK_BOT_USER_ID,
      email: "bot@feedback.local",
      username: "feedback-bot",
      isBot: 1,
    });
    const seeded = await seedWorkspace("acme", true, KEY);
    boardId = seeded.id;
  });

  function app() {
    const a = new Hono<{ Bindings: Env }>();
    a.use("*", errorMiddleware);
    a.route("/api/feedback/:token", feedbackRoutes);
    a.route("/api/ingest/:ingestKey", ingestRoutes);
    return a;
  }

  async function post(path: string, body: unknown) {
    return app().fetch(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );
  }

  async function upload(name = "shot.png", bytes: Uint8Array = PNG, type = "image/png") {
    const file = new NodeFile([bytes], name, { type }) as unknown as File;
    const board = { id: boardId, workspaceId: "ws-acme" };
    return attachments.uploadAttachment(
      db,
      env,
      board,
      file,
      "https://app.test",
      feedback.FEEDBACK_BOT_USER_ID,
    );
  }

  const meta = async (issueId: string) =>
    (
      await db.select().from(schema.feedbackMeta).where(eq(schema.feedbackMeta.issueId, issueId))
    )[0];

  describe("items + identify", () => {
    it("trusts the email with a valid signature and files the bug as the person's ticket", async () => {
      const res = await post(`/api/feedback/${TOKEN}/items`, {
        title: "Checkout is broken",
        kind: "bug",
        source: "widget",
        external_user: {
          id: "user-7",
          email: "Ana@Example.com",
          name: "Ana",
          signature: await hmacSha256Hex(SECRET, "user-7"),
        },
        context: {
          url: "https://shop.test/cart?session=zzz&step=2",
          viewport: "1280x720",
          console_errors: [{ message: "TypeError: x", at: NOW }],
          failed_requests: [
            { method: "POST", url: "https://shop.test/api/pay?key=1", status: 500, at: NOW },
          ],
        },
      });
      expect(res.status).toBe(201);
      const out = (await res.json()) as { id: string; sequence_id: number; url: string };
      expect(out.url).toContain("/portal/acme/tickets/");

      const m = await meta(out.id);
      expect(m).toMatchObject({
        kind: "bug",
        source: "widget",
        authorEmail: "ana@example.com",
        identityVerified: 1,
        emailTrusted: 1,
        externalUserId: "user-7",
      });
      const ctx = JSON.parse(m.contextJson!);
      expect(ctx.url).toBe("https://shop.test/cart?session=REDACTED&step=2");
      expect(ctx.failed_requests[0].url).toBe("https://shop.test/api/pay");

      const [issue] = await db.select().from(schema.issues).where(eq(schema.issues.id, out.id));
      expect(issue.externalSource).toBe("portal");
      expect(issue.descriptionHtml).toContain("<details><summary>Context</summary>");
      expect(issue.descriptionHtml).toContain("verified identity");
      const [ticket] = await db
        .select()
        .from(schema.supportTickets)
        .where(eq(schema.supportTickets.issueId, out.id));
      expect(ticket).toBeTruthy();
    });

    it("keeps an unsigned email on boards with an identify secret, but flags it and skips the portal link", async () => {
      for (const external_user of [
        { id: "user-7", email: "mallory@example.com" },
        { id: "user-7", email: "mallory@example.com", signature: "00".repeat(32) },
      ]) {
        const res = await post(`/api/feedback/${TOKEN}/items`, {
          title: "Spoofed report",
          kind: "question",
          external_user,
        });
        const out = (await res.json()) as { id: string };
        expect(await meta(out.id)).toMatchObject({
          authorEmail: "mallory@example.com",
          identityVerified: 0,
          emailTrusted: 0,
        });
        const tickets = await db
          .select()
          .from(schema.supportTickets)
          .where(eq(schema.supportTickets.issueId, out.id));
        expect(tickets).toHaveLength(0);
        const [issue] = await db.select().from(schema.issues).where(eq(schema.issues.id, out.id));
        expect(issue.descriptionHtml).toContain("unverified identity");
      }
    });

    it("accepts the typed email on boards without an identify secret", async () => {
      await seedWorkspace("open", false, null);
      const res = await post(`/api/feedback/pk_fb_open/items`, {
        title: "Open board bug",
        kind: "bug",
        email: "bo@example.com",
      });
      const out = (await res.json()) as { id: string };
      expect(await meta(out.id)).toMatchObject({ emailTrusted: 1, identityVerified: 0 });
      const rows = await db
        .select()
        .from(schema.supportTickets)
        .where(eq(schema.supportTickets.issueId, out.id));
      expect(rows).toHaveLength(1);
    });

    it("ideas stay on the public board and never become tickets", async () => {
      const res = await post(`/api/feedback/${TOKEN}/items`, { title: "Dark mode please" });
      const out = (await res.json()) as { id: string; url: string };
      expect(out.url).toContain("/portal/acme/ideas?board=");
      const board = await feedback.getBoard(db, TOKEN, "voter");
      expect(board.items.map((i) => i.id)).toContain(out.id);
      expect(board.board.workspace_slug).toBe("acme");
    });

    it("returns 400 JSON for an invalid body", async () => {
      const res = await post(`/api/feedback/${TOKEN}/items`, { title: "x", kind: "nope" });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("Invalid request");
    });
  });

  describe("attachments", () => {
    it("stores allowed files and rejects bad type, mismatched bytes and oversize", async () => {
      const ok = await upload();
      expect(ok).toMatchObject({ filename: "shot.png", mime: "image/png", size: PNG.length });
      expect(ok.url).toBe(`https://app.test/api/assets/${ok.id}`);

      await expect(upload("a.svg", PNG, "image/svg+xml")).rejects.toMatchObject({ status: 415 });
      await expect(
        upload("fake.png", new Uint8Array([1, 2, 3]), "image/png"),
      ).rejects.toMatchObject({ status: 415 });
      await expect(
        upload("big.png", new Uint8Array(10 * 1024 * 1024 + 1), "image/png"),
      ).rejects.toMatchObject({ status: 413 });
    });

    it("attaches to the issue (image in description) and cannot be claimed twice or across boards", async () => {
      const a = await upload();
      const res = await post(`/api/feedback/${TOKEN}/items`, {
        title: "With screenshot",
        kind: "bug",
        attachment_ids: [a.id],
      });
      const out = (await res.json()) as { id: string };
      const [issue] = await db.select().from(schema.issues).where(eq(schema.issues.id, out.id));
      expect(issue.descriptionHtml).toContain(`<img src="/api/assets/${a.id}"`);
      const [att] = await db
        .select()
        .from(schema.feedbackAttachments)
        .where(eq(schema.feedbackAttachments.assetId, a.id));
      expect(att.issueId).toBe(out.id);

      const again = await post(`/api/feedback/${TOKEN}/items`, {
        title: "Reuse attachment",
        attachment_ids: [a.id],
      });
      expect(again.status).toBe(400);

      await seedWorkspace("other", false, null);
      const foreign = await post(`/api/feedback/pk_fb_other/items`, {
        title: "Foreign attachment",
        attachment_ids: [(await upload()).id],
      });
      expect(foreign.status).toBe(400);
    });

    it("garbage-collects unclaimed uploads older than 24h and keeps claimed/fresh ones", async () => {
      const stale = await upload("old.png");
      const fresh = await upload("new.png");
      const claimed = await upload("kept.png");
      await post(`/api/feedback/${TOKEN}/items`, {
        title: "Claims one",
        attachment_ids: [claimed.id],
      });
      const old = new Date(Date.now() - 25 * 3600_000).toISOString();
      for (const id of [stale.id, claimed.id]) {
        await db
          .update(schema.feedbackAttachments)
          .set({ createdAt: old })
          .where(eq(schema.feedbackAttachments.assetId, id));
      }
      expect(await attachments.gcUnclaimedAttachments(db, env)).toBe(1);
      const left = (await db.select().from(schema.feedbackAttachments)).map((r) => r.assetId);
      expect(left.sort()).toEqual([fresh.id, claimed.id].sort());
      expect(r2.deleted).toHaveLength(1);
      const assets = await db.select().from(schema.fileAssets);
      expect(assets.map((a) => a.id)).not.toContain(stale.id);
    });

    it("authorizes reads: members of the workspace, and only the customer who filed the issue", async () => {
      const mine = await upload();
      const other = await upload();
      const unclaimed = await upload();
      // The id signs itself so each reporter is a distinct verified identity.
      const file = async (attId: string, email: string) => {
        const r = await post(`/api/feedback/${TOKEN}/items`, {
          title: `Report ${email}`,
          kind: "bug",
          attachment_ids: [attId],
          external_user: { id: email, email, signature: await hmacSha256Hex(SECRET, email) },
        });
        return (await r.json()) as { id: string };
      };
      await file(mine.id, "ana@example.com");
      await file(other.id, "ben@example.com");

      const customer = (email: string) =>
        db
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.email, email))
          .then((r) => r[0]);
      const ana = await customer("ana@example.com");
      const ben = await customer("ben@example.com");
      const asCustomer = (c: { id: string; workspaceId: string; email: string | null }) =>
        ({
          kind: "customer",
          customerId: c.id,
          workspaceId: c.workspaceId,
          email: c.email,
        }) as const;

      expect(await attachments.authorizeFeedbackAsset(db, mine.id, asCustomer(ana))).toBe(true);
      expect(await attachments.authorizeFeedbackAsset(db, other.id, asCustomer(ana))).toBe(false);
      expect(await attachments.authorizeFeedbackAsset(db, other.id, asCustomer(ben))).toBe(true);
      expect(await attachments.authorizeFeedbackAsset(db, unclaimed.id, asCustomer(ana))).toBe(
        false,
      );

      const member = (ws: string) =>
        ({ kind: "member", isMember: async (w: string) => w === ws }) as const;
      expect(await attachments.authorizeFeedbackAsset(db, mine.id, member("ws-acme"))).toBe(true);
      expect(await attachments.authorizeFeedbackAsset(db, mine.id, member("ws-else"))).toBe(false);
      expect(
        await attachments.authorizeFeedbackAsset(db, "not-a-feedback-asset", member("ws-acme")),
      ).toBe(null);
    });
  });

  describe("ingest", () => {
    const ingest = (body: Record<string, unknown>, key = KEY) => post(`/api/ingest/${key}`, body);
    const json = async (r: Response) =>
      (await r.json()) as {
        issue_id: string;
        sequence_id: number;
        occurrences: number;
        created: boolean;
      };

    it("groups the same fingerprint into one issue with an occurrence counter", async () => {
      const body = {
        message: "Payment 123 failed",
        service: "api",
        stack: "Error: Payment failed\n  at pay (/srv/pay.js:10:3)",
        logs: ["start", "boom"],
        context: { user: "u1" },
      };
      const first = await json(await ingest(body));
      const second = await json(
        await ingest({ ...body, message: "Payment 456 failed", logs: ["again"] }),
      );
      expect(first).toMatchObject({ occurrences: 1, created: true });
      expect(second).toMatchObject({ occurrences: 2, created: false, issue_id: first.issue_id });

      const issues = await db
        .select()
        .from(schema.issues)
        .where(eq(schema.issues.externalSource, "ingest"));
      expect(issues).toHaveLength(1);
      expect(issues[0].priority).toBe("high");
      expect(issues[0].descriptionHtml).toContain("<strong>Occurrences:</strong> 2");
      expect(issues[0].descriptionHtml).toContain("Recent logs (1)");
      expect(issues[0].descriptionHtml).not.toContain("Recent logs (2)");
      const [group] = await db.select().from(schema.ingestGroups);
      expect(group.occurrences).toBe(2);
      expect(group.firstSeenAt <= group.lastSeenAt).toBe(true);
    });

    it("splits distinct fingerprints, honours an explicit fingerprint, and re-adds markers after human edits", async () => {
      const a = await json(await ingest({ message: "Disk full" }));
      const b = await json(await ingest({ message: "Cache miss storm" }));
      expect(a.issue_id).not.toBe(b.issue_id);

      const c1 = await json(await ingest({ message: "x1", fingerprint: "custom-fp" }));
      const c2 = await json(
        await ingest({ message: "totally different", fingerprint: "custom-fp" }),
      );
      expect(c2.issue_id).toBe(c1.issue_id);
      expect(c2.occurrences).toBe(2);

      await db
        .update(schema.issues)
        .set({ descriptionHtml: "<p>human rewrote this</p>" })
        .where(eq(schema.issues.id, a.issue_id));
      await ingest({ message: "Disk full" });
      const [edited] = await db
        .select()
        .from(schema.issues)
        .where(eq(schema.issues.id, a.issue_id));
      expect(edited.descriptionHtml).toContain("human rewrote this");
      expect(edited.descriptionHtml).toContain("<strong>Occurrences:</strong> 2");
    });

    it("starts a fresh issue after the team deleted the grouped one", async () => {
      const first = await json(await ingest({ message: "Flaky" }));
      await db
        .update(schema.issues)
        .set({ deletedAt: NOW })
        .where(eq(schema.issues.id, first.issue_id));
      const again = await json(await ingest({ message: "Flaky" }));
      expect(again).toMatchObject({ created: true, occurrences: 1 });
      expect(again.issue_id).not.toBe(first.issue_id);
    });

    it("404s on unknown or revoked keys and 400s on a bad body", async () => {
      expect((await ingest({ message: "x" }, "ik_nope")).status).toBe(404);
      await db
        .update(schema.feedbackBoards)
        .set({ ingestKey: null })
        .where(eq(schema.feedbackBoards.id, boardId));
      expect((await ingest({ message: "x" })).status).toBe(404);
      expect((await ingest({ nope: 1 }, "ik_whatever")).status).toBe(400);
    });
  });

  describe("unified portal", () => {
    async function seedCustomerSession(email: string) {
      const c = await feedback.findOrCreateCustomer(db, "ws-acme", email, null);
      return {
        id: c.id,
        workspaceId: c.workspaceId,
        userId: c.userId!,
        email: c.email ?? "",
        displayName: c.name,
      };
    }

    it("shows a person their own ideas and tickets by verified email, and nobody else's", async () => {
      const sig = async (id: string) => hmacSha256Hex(SECRET, id);
      const file = async (title: string, kind: string, email: string, signed: boolean) => {
        const res = await post(`/api/feedback/${TOKEN}/items`, {
          title,
          kind,
          external_user: {
            id: email,
            email,
            ...(signed ? { signature: await sig(email) } : {}),
          },
        });
        return (await res.json()) as { id: string };
      };
      const idea = await file("Anas idea", "idea", "ana@example.com", true);
      const ticket = await file("Anas bug", "bug", "ana@example.com", true);
      await file("Bens idea", "idea", "ben@example.com", true);
      await file("Spoofed as Ana", "idea", "ana@example.com", false);
      await file("Spoofed bug as Ana", "bug", "ana@example.com", false);

      const ana = await seedCustomerSession("ANA@example.com");
      const mine = await portal.getMine(db, ana);
      expect(mine.ideas.map((i) => i.id)).toEqual([idea.id]);
      expect(mine.tickets.map((tk) => tk.issueId)).toEqual([ticket.id]);
      expect(mine.ideas[0].board_token).toBe(TOKEN);

      const ben = await seedCustomerSession("ben@example.com");
      const benMine = await portal.getMine(db, ben);
      expect(benMine.ideas.map((i) => i.name)).toEqual(["Bens idea"]);
      expect(benMine.tickets).toHaveLength(0);
    });

    it("resolves a widget ticket by sequence id in its own project without portal support settings", async () => {
      const res = await post(`/api/feedback/${TOKEN}/items`, {
        title: "Ticket in board project",
        kind: "question",
        external_user: {
          id: "u9",
          email: "ana@example.com",
          signature: await hmacSha256Hex(SECRET, "u9"),
        },
      });
      const out = (await res.json()) as { sequence_id: number };
      const ana = await seedCustomerSession("ana@example.com");
      const detail = await portal.getTicket(db, ana, out.sequence_id);
      expect(detail.ticket.projectId).toBe("proj-acme");
      const ben = await seedCustomerSession("ben@example.com");
      await expect(portal.getTicket(db, ben, out.sequence_id)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("lists boards in the overview and completed ideas in the changelog", async () => {
      const done = (await (
        await post(`/api/feedback/${TOKEN}/items`, { title: "Shipped idea" })
      ).json()) as { id: string };
      await post(`/api/feedback/${TOKEN}/items`, { title: "Still open idea" });
      await db
        .update(schema.issues)
        .set({ stateId: "st-done-acme", completedAt: NOW })
        .where(eq(schema.issues.id, done.id));

      const overview = await portal.getOverview(db, { id: "ws-acme", name: "acme", slug: "acme" });
      expect(overview.boards.map((b) => b.token)).toEqual([TOKEN]);

      const log = await portal.getChangelog(db, "ws-acme");
      expect(log.results.map((r) => r.name)).toEqual(["Shipped idea"]);
      expect(log.results[0].board_token).toBe(TOKEN);
    });
  });
});

import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { rateLimit } from "../lib/rateLimit";
import * as feedback from "../services/feedback";
import * as attachments from "../services/feedback_attachments";
import * as feedbackMe from "../services/feedback_me";
import * as portal from "../services/portal";
import { parseOr400, publicJsonError } from "../lib/validate";

export const feedbackRoutes = new Hono<{ Bindings: Env }>({ strict: false });
feedbackRoutes.onError(publicJsonError);

// Public, token-keyed, no session. Board identity comes from the path token.
// Voter identity for dedup + "voted" state is derived from email (if provided)
// else from ip+user-agent, hashed with a server salt.

function clientIp(c: Context): string {
  return (
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For")?.split(",")[0].trim() ||
    "0.0.0.0"
  );
}

function readEmail(c: Context): string | undefined {
  return c.req.query("email") || c.req.header("x-feedback-email") || undefined;
}

async function voter(c: Context<{ Bindings: Env }>) {
  const email = readEmail(c);
  const hash = await feedback.voterHashFor(email, clientIp(c), c.req.header("user-agent") || "");
  return { email, hash };
}

feedbackRoutes
  // Board settings only (no items): what the widget needs to boot.
  .get("/config", async (c) => {
    return c.json(await feedback.getBoardConfig(getDb(c.env.DB), c.req.param("token")!));
  })
  .get("/", async (c) => {
    const db = getDb(c.env.DB);
    const token = c.req.param("token")!;
    const { hash } = await voter(c);
    return c.json(await feedback.getBoard(db, token, hash));
  })

  .post("/items", async (c) => {
    const db = getDb(c.env.DB);
    const token = c.req.param("token")!;
    const ok = await rateLimit(c.env, `fb:${token}:${clientIp(c)}:submit`, 10, 60);
    if (!ok) return c.json({ message: "Too many submissions. Try again shortly." }, 429);
    const body = parseOr400(feedback.createItemSchema, await c.req.json().catch(() => undefined));
    const result = await feedback.createItem(db, token, body, new URL(c.req.url).origin);
    return c.json(result, 201);
  })

  .post("/attachments", async (c) => {
    const db = getDb(c.env.DB);
    const token = c.req.param("token")!;
    const ok =
      (await rateLimit(c.env, `fb:${token}:${clientIp(c)}:upload`, 15, 60)) &&
      (await rateLimit(c.env, `fb:${token}:upload`, 60, 60));
    if (!ok) return c.json({ message: "Too many uploads. Try again shortly." }, 429);
    const board = await feedback.findBoardForUpload(db, token);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") {
      return c.json({ message: "Multipart field 'file' is required" }, 400);
    }
    const result = await attachments.uploadAttachment(
      db,
      c.env,
      board,
      file,
      new URL(c.req.url).origin,
      feedback.FEEDBACK_BOT_USER_ID,
    );
    return c.json(result, 201);
  })

  .get("/items/:issueId", async (c) => {
    const db = getDb(c.env.DB);
    const token = c.req.param("token")!;
    const { hash } = await voter(c);
    return c.json(await feedback.getItem(db, token, c.req.param("issueId")!, hash));
  })

  .post("/items/:issueId/votes", async (c) => {
    const db = getDb(c.env.DB);
    const token = c.req.param("token")!;
    const ok = await rateLimit(c.env, `fb:${token}:${clientIp(c)}:vote`, 30, 60);
    if (!ok) return c.json({ message: "Too many votes. Slow down." }, 429);
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const { email } = feedback.voteSchema.parse(body);
    const { hash } = await voter(c);
    const result = await feedback.voteWithHash(db, token, c.req.param("issueId")!, hash, email);
    return c.json(result);
  })

  .get("/items/:issueId/comments", async (c) => {
    const db = getDb(c.env.DB);
    const token = c.req.param("token")!;
    return c.json({ results: await feedback.listComments(db, token, c.req.param("issueId")!) });
  })

  .post("/items/:issueId/comments", async (c) => {
    const db = getDb(c.env.DB);
    const token = c.req.param("token")!;
    const ok = await rateLimit(c.env, `fb:${token}:${clientIp(c)}:comment`, 20, 60);
    if (!ok) return c.json({ message: "Too many comments. Slow down." }, 429);
    const { body, email } = feedback.commentSchema.parse(await c.req.json());
    const result = await feedback.addComment(db, token, c.req.param("issueId")!, body, email);
    return c.json(result, 201);
  })

  // ── Signed-in API (server to server): a host app's own feedback page acts for a person it
  // signed in. services/feedback_me.ts has the header format; docs/feedback-portal.md too.
  .get("/me/board", async (c) => {
    const db = getDb(c.env.DB);
    const me = await signedIn(c);
    return c.json(await feedback.getBoard(db, c.req.param("token")!, me.voterHash));
  })
  .get("/me/items/:issueId", async (c) => {
    const db = getDb(c.env.DB);
    const me = await signedIn(c);
    return c.json(
      await feedback.getItem(db, c.req.param("token")!, c.req.param("issueId")!, me.voterHash),
    );
  })
  .post("/me/items/:issueId/votes", async (c) => {
    const db = getDb(c.env.DB);
    const token = c.req.param("token")!;
    const me = await signedIn(c);
    if (!(await rateLimit(c.env, `fbme:${token}:${me.email}:vote`, 30, 60))) {
      return c.json({ message: "Too many votes. Slow down." }, 429);
    }
    return c.json(
      await feedback.voteWithHash(db, token, c.req.param("issueId")!, me.voterHash, me.email),
    );
  })
  .post("/me/items/:issueId/comments", async (c) => {
    const db = getDb(c.env.DB);
    const token = c.req.param("token")!;
    const me = await signedIn(c);
    if (!(await rateLimit(c.env, `fbme:${token}:${me.email}:comment`, 20, 60))) {
      return c.json({ message: "Too many comments. Slow down." }, 429);
    }
    const { body } = parseOr400(
      feedbackMe.meCommentSchema,
      await c.req.json().catch(() => undefined),
    );
    return c.json(
      await feedback.addComment(db, token, c.req.param("issueId")!, body, me.email),
      201,
    );
  })
  .get("/me/reports", async (c) => {
    const db = getDb(c.env.DB);
    const me = await signedIn(c);
    return c.json(await feedbackMe.reports(db, me));
  })
  .get("/me/tickets/:seq", async (c) => {
    const db = getDb(c.env.DB);
    const me = await signedIn(c);
    return c.json(await feedbackMe.ticket(db, me, ticketSeq(c), c.req.query("project") || null));
  })
  .post("/me/tickets/:seq/comments", async (c) => {
    const db = getDb(c.env.DB);
    const token = c.req.param("token")!;
    const me = await signedIn(c);
    if (!(await rateLimit(c.env, `fbme:${token}:${me.email}:reply`, 20, 60))) {
      return c.json({ message: "Too many replies. Slow down." }, 429);
    }
    const { body } = parseOr400(
      feedbackMe.meCommentSchema,
      await c.req.json().catch(() => undefined),
    );
    const result = await feedbackMe.replyToTicket(
      db,
      me,
      ticketSeq(c),
      body,
      c.req.query("project") || null,
    );
    return c.json(result, 201);
  })
  .get("/me/changelog", async (c) => {
    const db = getDb(c.env.DB);
    const me = await signedIn(c);
    return c.json(await portal.getChangelog(db, me.board.workspaceId));
  });

function signedIn(c: Context<{ Bindings: Env }>) {
  return feedbackMe.resolveMe(getDb(c.env.DB), c.req.param("token")!, {
    id: c.req.header("x-atur-user-id"),
    email: c.req.header("x-atur-user-email"),
    name: c.req.header("x-atur-user-name"),
    expires: c.req.header("x-atur-expires"),
    signature: c.req.header("x-atur-signature"),
  });
}

function ticketSeq(c: Context<{ Bindings: Env }>): number {
  const seq = Number(c.req.param("seq"));
  if (!Number.isInteger(seq) || seq < 1) {
    throw new HTTPException(400, { message: "Invalid ticket number" });
  }
  return seq;
}

import { Hono, type Context } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { rateLimit } from "../lib/rateLimit";
import * as feedback from "../services/feedback";

export const feedbackRoutes = new Hono<{ Bindings: Env }>({ strict: false });

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
    const body = feedback.createItemSchema.parse(await c.req.json());
    const result = await feedback.createItem(db, token, body);
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
  });

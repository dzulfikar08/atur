import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import * as subscribersService from "../services/subscribers";
import * as issuesRepo from "../repositories/issues";
import { HTTPException } from "hono/http-exception";

export const subscriberRoutes = new Hono<{ Bindings: Env }>({ strict: false });

subscriberRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const projectId = c.req.param("projectId")!;
  const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param("issueId")!);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });

  const result = await subscribersService.listByIssue(db, issue.id);
  return c.json(result);
});

subscriberRoutes.post("/", authMiddleware, async (c) => {
  const db = getDb(c.env.DB);
  const user = c.get("user");
  const projectId = c.req.param("projectId")!;
  const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param("issueId")!);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });

  await subscribersService.follow(db, issue.id, user.sub);
  return c.json({ ok: true });
});

subscriberRoutes.delete("/", authMiddleware, async (c) => {
  const db = getDb(c.env.DB);
  const user = c.get("user");
  const projectId = c.req.param("projectId")!;
  const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param("issueId")!);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });

  await subscribersService.unfollow(db, issue.id, user.sub);
  return c.json({ ok: true });
});

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember, requireWorkspaceProject } from "../middleware/workspace";
import * as issuesService from "../services/issues";
import * as issuesRepo from "../repositories/issues";
import type { IssueListOpts } from "../repositories/issues";
import * as issueDetailService from "../services/issueDetail";

const DUE_VALUES = new Set(["overdue", "today", "week", "none", "any"]);

function csv(raw: string | undefined): string[] | undefined {
  const items = raw
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

export const issueRoutes = new Hono<{ Bindings: Env }>({ strict: false })

  // List params (shared names with the client IssueQuery):
  //   state=<uuid> | state_key=a,b | priority=a,b | q|search | labels=<names> |
  //   label=<uuids> | assignee=<uuid|me|none>,… | product=A,B |
  //   due=overdue|today|week|none|any (+today=YYYY-MM-DD) | done=hide |
  //   sort=<field>:<asc|desc> | fields=full | limit<=500
  // Rows omit description_* unless fields=full.
  .get("/", authMiddleware, requireWorkspaceMember, requireWorkspaceProject, async (c) => {
    const db = getDb(c.env.DB);
    const project = c.get("project");
    const userId = c.get("user").sub;
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 500);
    const due = c.req.query("due");

    const result = await issuesService.list(db, project, {
      offset,
      limit,
      state: c.req.query("state") || undefined,
      stateKeys: csv(c.req.query("state_key")),
      priorities: csv(c.req.query("priority")),
      search: c.req.query("q") || c.req.query("search") || undefined,
      labelNames: csv(c.req.query("labels")),
      labels: csv(c.req.query("label")),
      assignees: csv(c.req.query("assignee"))?.map((a) => (a === "me" ? userId : a)),
      products: csv(c.req.query("product")),
      due: due && DUE_VALUES.has(due) ? (due as IssueListOpts["due"]) : undefined,
      today: c.req.query("today") || undefined,
      hideDone: c.req.query("done") === "hide",
      sort: c.req.query("sort") || undefined,
      full: c.req.query("fields") === "full",
    });
    return c.json(result);
  })

  .post("/", authMiddleware, requireWorkspaceMember, requireWorkspaceProject, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const body = issuesService.createIssueSchema.parse(await c.req.json());
    const user = c.get("user");
    const result = await issuesService.create(db, projectId, body, user.sub);
    return c.json(result, 201);
  })

  .get("/:issueId", authMiddleware, requireWorkspaceMember, requireWorkspaceProject, async (c) => {
    const db = getDb(c.env.DB);
    const project = c.get("project");
    const issue = await issuesRepo.resolveIssue(db, project.id, c.req.param("issueId")!);
    if (!issue) throw new HTTPException(404, { message: "Issue not found" });
    const result = await issueDetailService.getDetail(
      db,
      issue,
      project,
      issueDetailService.parseIncludes(c.req.query("include")),
    );
    return c.json(result);
  })

  .get(
    "/:issueId/sub-issues",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c) => {
      const db = getDb(c.env.DB);
      const projectId = c.req.param("projectId")!;
      const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param("issueId")!);
      if (!issue) throw new HTTPException(404, { message: "Issue not found" });
      const result = await issuesService.listSubIssues(db, issue.id);
      return c.json(result);
    },
  )

  .patch(
    "/:issueId",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c) => {
      const db = getDb(c.env.DB);
      const projectId = c.req.param("projectId")!;
      const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param("issueId")!);
      if (!issue) throw new HTTPException(404, { message: "Issue not found" });
      const body = issuesService.updateIssueSchema.parse(await c.req.json());
      const user = c.get("user");
      const result = await issuesService.update(
        db,
        issue.id,
        body,
        user.sub,
        c.env,
        user.displayName,
      );
      return c.json(result);
    },
  )

  .delete(
    "/:issueId",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c) => {
      const db = getDb(c.env.DB);
      const projectId = c.req.param("projectId")!;
      const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param("issueId")!);
      if (!issue) throw new HTTPException(404, { message: "Issue not found" });
      await issuesService.remove(db, issue.id);
      return c.json({ ok: true });
    },
  )

  .post(
    "/:issueId/labels",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c) => {
      const db = getDb(c.env.DB);
      const projectId = c.req.param("projectId")!;
      const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param("issueId")!);
      if (!issue) throw new HTTPException(404, { message: "Issue not found" });
      const { label_id } = (await c.req.json()) as { label_id: string };
      await issuesService.addLabel(db, issue.id, label_id);
      return c.json({ ok: true });
    },
  )

  .delete(
    "/:issueId/labels/:labelId",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c) => {
      const db = getDb(c.env.DB);
      const projectId = c.req.param("projectId")!;
      const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param("issueId")!);
      if (!issue) throw new HTTPException(404, { message: "Issue not found" });
      const labelId = c.req.param("labelId")!;
      await issuesService.removeLabel(db, issue.id, labelId);
      return c.json({ ok: true });
    },
  )

  .post(
    "/:issueId/assignees",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c) => {
      const db = getDb(c.env.DB);
      const projectId = c.req.param("projectId")!;
      const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param("issueId")!);
      if (!issue) throw new HTTPException(404, { message: "Issue not found" });
      const { assignee_id } = (await c.req.json()) as { assignee_id: string };
      await issuesService.addAssignee(db, issue.id, assignee_id);
      return c.json({ ok: true });
    },
  )

  .delete(
    "/:issueId/assignees/:assigneeId",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c) => {
      const db = getDb(c.env.DB);
      const projectId = c.req.param("projectId")!;
      const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param("issueId")!);
      if (!issue) throw new HTTPException(404, { message: "Issue not found" });
      const assigneeId = c.req.param("assigneeId")!;
      await issuesService.removeAssignee(db, issue.id, assigneeId);
      return c.json({ ok: true });
    },
  );

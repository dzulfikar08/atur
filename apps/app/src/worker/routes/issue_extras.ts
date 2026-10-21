// Sub-resources under /api/workspaces/:slug/projects/:projectId/issues/:issueId
// The :issueId param may be a sequence id (e.g. "1") or a UUID — resolve to the
// issue row, then key all sub-resource queries on its UUID.
// Backed by real tables: attachments, sub-issues (issues.parentId), relations,
// modules (module_issues), activities (issue_activities).
// Stubbed (no table in schema): custom-values.
import { Hono, type Context } from "hono";
import { and, eq, isNull, desc } from "drizzle-orm";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember, requireWorkspaceProject } from "../middleware/workspace";
import { HTTPException } from "hono/http-exception";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";
import * as schema from "../db/schema";
import * as issuesRepo from "../repositories/issues";
import * as timeEntriesService from "../services/timeEntries";
import * as customFieldValuesService from "../services/customFieldValues";
import { listActivities, listIssueModules, listRelations } from "../services/issueDetail";
import { getIssueFeedback } from "../services/feedback";

type C = Context<{ Bindings: Env }>;

async function resolveIssue(c: C) {
  const db = getDb(c.env.DB);
  const projectId = c.req.param("projectId")!;
  const issue = await issuesRepo.resolveIssue(db, projectId, c.req.param("issueId")!);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });
  return { db, issue };
}

// `asset` holds a file_assets id (what the web/native upload flow stores) or,
// from callers that posted a link, a URL/path. Clients load `url`.
function attachmentUrl(asset: string | null): string | null {
  if (!asset) return null;
  return /^(https?:\/\/|\/)/.test(asset) ? asset : `/api/assets/${asset}`;
}

export const issueExtrasRoutes = new Hono<{ Bindings: Env }>({ strict: false })

  // ---- Feedback submission (reporter, auto-context, claimed files) ----
  // Feedback-board files live in feedback_attachments, not issue_attachments,
  // so they are exposed here instead of through /attachments.
  .get(
    "/feedback",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      return c.json(await getIssueFeedback(db, issue.id, new URL(c.req.url).origin));
    },
  )

  // ---- Attachments ----
  .get(
    "/attachments",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      const rows = await db
        .select()
        .from(schema.issueAttachments)
        .where(
          and(
            eq(schema.issueAttachments.issueId, issue.id),
            isNull(schema.issueAttachments.deletedAt),
          ),
        )
        .orderBy(desc(schema.issueAttachments.createdAt));
      return c.json({
        results: rows.map((r) => ({
          id: r.id,
          issue_id: r.issueId,
          asset: r.asset,
          url: attachmentUrl(r.asset),
          attributes: r.attributes ? JSON.parse(r.attributes) : null,
          created_at: r.createdAt,
        })),
      });
    },
  )
  .post(
    "/attachments",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      const body = (await c.req.json().catch(() => ({}))) as {
        asset?: string | null;
        attributes?: unknown;
      };
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.issueAttachments).values({
        id,
        issueId: issue.id,
        asset: body.asset ?? null,
        attributes: body.attributes !== undefined ? JSON.stringify(body.attributes) : null,
        createdAt: now,
        updatedAt: now,
      });
      return c.json(
        {
          id,
          issue_id: issue.id,
          asset: body.asset ?? null,
          url: attachmentUrl(body.asset ?? null),
          attributes: body.attributes ?? null,
          created_at: now,
        },
        201,
      );
    },
  )
  .delete(
    "/attachments/:attachmentId",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      // Scope to the path issue so a caller can't delete another issue's
      // attachment by guessing its id (IDOR).
      const { db, issue } = await resolveIssue(c);
      await db
        .update(schema.issueAttachments)
        .set({ deletedAt: nowISO(), updatedAt: nowISO() })
        .where(
          and(
            eq(schema.issueAttachments.id, c.req.param("attachmentId")!),
            eq(schema.issueAttachments.issueId, issue.id),
          ),
        );
      return c.body(null, 204);
    },
  )

  // ---- Sub-issues (children via issues.parent_id) ----
  .get(
    "/sub-issues",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      const rows = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.parentId, issue.id), isNull(schema.issues.deletedAt)))
        .orderBy(desc(schema.issues.createdAt));
      return c.json({ results: rows });
    },
  )
  .post(
    "/sub-issues",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue: parent } = await resolveIssue(c);
      const user = c.get("user");
      const body = (await c.req.json().catch(() => ({}))) as { name?: string };
      if (!body.name) throw new HTTPException(400, { message: "name is required" });
      const id = uuid();
      const now = nowISO();
      const row: typeof schema.issues.$inferInsert = {
        id,
        name: body.name,
        sequenceId: await issuesRepo.allocateNextSequence(db, parent.projectId),
        parentId: parent.id,
        projectId: parent.projectId,
        workspaceId: parent.workspaceId,
        createdById: user.sub,
        createdAt: now,
        updatedAt: now,
      };
      // sequenceId comes from the atomic per-project counter (UPDATE ...
      // RETURNING), so concurrent creators get distinct ids — no collisions,
      // no retry loop.
      await db.insert(schema.issues).values(row);
      return c.json(
        (
          await db
            .select()
            .from(schema.issues)
            .where(
              and(
                eq(schema.issues.id, id),
                eq(schema.issues.projectId, parent.projectId),
                eq(schema.issues.workspaceId, parent.workspaceId),
                isNull(schema.issues.deletedAt),
              ),
            )
            .limit(1)
        )[0],
        201,
      );
    },
  )

  // ---- Relations ----
  .get(
    "/relations",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      const rows = await listRelations(db, issue.id);
      return c.json({ results: rows });
    },
  )
  .post(
    "/relations",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      const body = (await c.req.json().catch(() => ({}))) as {
        related_issue_id?: string;
        relation_type?: string;
      };
      if (!body.related_issue_id || !body.relation_type)
        throw new HTTPException(400, {
          message: "related_issue_id and relation_type are required",
        });
      // related_issue_id must be an issue in the caller's workspace — a raw
      // insert here bypasses relationsService.create's both-sided check and
      // would let a member attach a foreign-workspace issue as the related side
      // (leaking the reference back via that issue's relation list).
      const [related] = await db
        .select({ id: schema.issues.id })
        .from(schema.issues)
        .where(
          and(
            eq(schema.issues.id, body.related_issue_id),
            eq(schema.issues.workspaceId, c.get("workspace").id),
            isNull(schema.issues.deletedAt),
          ),
        )
        .limit(1);
      if (!related) throw new HTTPException(404, { message: "Issue not found" });
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.issueRelations).values({
        id,
        issueId: issue.id,
        relatedIssueId: body.related_issue_id,
        relationType: body.relation_type,
        createdAt: now,
        updatedAt: now,
      });
      return c.json(
        (
          await db
            .select()
            .from(schema.issueRelations)
            .where(eq(schema.issueRelations.id, id))
            .limit(1)
        )[0],
        201,
      );
    },
  )
  .delete(
    "/relations/:relationId",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      await db
        .update(schema.issueRelations)
        .set({ deletedAt: nowISO(), updatedAt: nowISO() })
        .where(
          and(
            eq(schema.issueRelations.id, c.req.param("relationId")!),
            eq(schema.issueRelations.issueId, issue.id),
          ),
        );
      return c.body(null, 204);
    },
  )

  // ---- Modules (module_issues join) ----
  .get(
    "/modules",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      const rows = await listIssueModules(db, issue.id);
      return c.json({ results: rows });
    },
  )
  .post(
    "/modules",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      const body = (await c.req.json().catch(() => ({}))) as { module_id?: string };
      if (!body.module_id) throw new HTTPException(400, { message: "module_id is required" });
      // module_id must belong to the caller's workspace — otherwise a foreign
      // module could be attached to a local issue via this raw insert (it
      // bypasses modulesService.addIssue's workspace compare).
      const [mod] = await db
        .select({ id: schema.modules.id })
        .from(schema.modules)
        .where(
          and(
            eq(schema.modules.id, body.module_id),
            eq(schema.modules.workspaceId, c.get("workspace").id),
            isNull(schema.modules.deletedAt),
          ),
        )
        .limit(1);
      if (!mod) throw new HTTPException(404, { message: "Module not found" });
      const [existing] = await db
        .select()
        .from(schema.moduleIssues)
        .where(
          and(
            eq(schema.moduleIssues.moduleId, body.module_id),
            eq(schema.moduleIssues.issueId, issue.id),
          ),
        )
        .limit(1);
      if (!existing) {
        const now = nowISO();
        await db.insert(schema.moduleIssues).values({
          id: uuid(),
          moduleId: body.module_id,
          issueId: issue.id,
          createdAt: now,
          updatedAt: now,
        });
      }
      return c.json({ ok: true });
    },
  )
  .delete(
    "/modules/:moduleId",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      await db
        .delete(schema.moduleIssues)
        .where(
          and(
            eq(schema.moduleIssues.moduleId, c.req.param("moduleId")!),
            eq(schema.moduleIssues.issueId, issue.id),
          ),
        );
      return c.body(null, 204);
    },
  )

  // ---- Activities ----
  .get(
    "/activities",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      const rows = await listActivities(db, issue.id);
      return c.json({ results: rows });
    },
  )

  // ---- Custom values ----
  .get(
    "/custom-values",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      // Bare array on the wire — the client types GET as CustomFieldValue[]
      // (the old stub also returned a bare array).
      const results = await customFieldValuesService.list(db, issue);
      return c.json(results);
    },
  )
  .post(
    "/custom-values",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      const result = await customFieldValuesService.set(
        db,
        issue,
        await c.req.json().catch(() => ({})),
      );
      return c.json(result, 201);
    },
  )

  // ---- Time entries ----
  .get(
    "/time-entries",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      const result = await timeEntriesService.list(db, issue, c);
      return c.json(result);
    },
  )
  .post(
    "/time-entries",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      const { db, issue } = await resolveIssue(c);
      const user = c.get("user");
      const body = timeEntriesService.createTimeEntrySchema.parse(
        await c.req.json().catch(() => ({})),
      );
      const entry = await timeEntriesService.create(db, issue, user.sub, body);
      // snake_case payload matching the frontend TimeEntry type.
      return c.json(
        {
          id: entry!.id,
          issue_id: entry!.issueId,
          user_id: entry!.userId,
          duration_seconds: entry!.durationSeconds,
          description: entry!.description,
          started_at: entry!.startedAt,
          ended_at: entry!.endedAt,
          source: entry!.source,
          agent_name: entry!.agentName,
          model: entry!.model,
          input_tokens: entry!.inputTokens,
          output_tokens: entry!.outputTokens,
          cache_read_tokens: entry!.cacheReadTokens,
          cache_write_tokens: entry!.cacheWriteTokens,
          reasoning_tokens: entry!.reasoningTokens,
          created_at: entry!.createdAt,
        },
        201,
      );
    },
  )
  .delete(
    "/time-entries/:entryId",
    authMiddleware,
    requireWorkspaceMember,
    requireWorkspaceProject,
    async (c: C) => {
      // Scope delete to the path issue so a caller can't delete another issue's
      // entry by guessing its id (IDOR).
      const { db, issue } = await resolveIssue(c);
      await timeEntriesService.remove(db, issue, c.req.param("entryId")!);
      return c.body(null, 204);
    },
  );

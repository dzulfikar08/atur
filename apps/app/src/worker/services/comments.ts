import { z } from "zod";
import type { DbClient } from "../db/index";
import * as commentsRepo from "../repositories/comments";
import * as subscribersRepo from "../repositories/subscribers";
import * as issuesRepo from "../repositories/issues";
import { linkFromComment } from "./agentSessions";
import { notifyCommentAdded, notifyMentioned, resolveMentionsInHtml } from "./issue_notifications";
import type { Env } from "../lib/env";
import { HTTPException } from "hono/http-exception";

export const createCommentSchema = z.object({
  comment_html: z.string().min(1),
  access: z.string().optional(),
});

export const updateCommentSchema = z.object({
  comment_html: z.string().min(1).optional(),
  access: z.string().optional(),
});

export async function create(
  db: DbClient,
  env: Env,
  actorId: string,
  issueId: string,
  data: z.infer<typeof createCommentSchema>,
  user?: { sub: string; email?: string; displayName?: string | null },
) {
  const issue = await issuesRepo.findById(db, issueId);
  if (!issue) throw new HTTPException(404, { message: "Issue not found" });

  const comment = await commentsRepo.create(db, {
    commentHtml: data.comment_html,
    access: data.access,
    issueId,
    actorId,
  });

  // Commenters auto-follow the issue so they stay in the loop on later
  // activity. Idempotent — safe to call on every comment.
  await subscribersRepo.autoFollow(db, issueId, actorId);

  if (comment) {
    // "Picked up by <agent> (pane <id>)" links that pane to this issue.
    await linkFromComment(db, issue, actorId, data.comment_html);
    const actorName = user?.displayName || undefined;
    // Notify followers (excludes the comment author).
    await notifyCommentAdded(db, env, issue, comment, actorName);

    // Mentions: picker spans + @username fallback, resolved against workspace
    // members. Mentioned users are notified even if they don't follow.
    const { mentionedIds } = await resolveMentionsInHtml(
      db,
      issue.workspaceId,
      comment.commentHtml ?? data.comment_html,
    );
    if (mentionedIds.length > 0) {
      await notifyMentioned(db, env, issue, {
        actorId,
        actorName,
        mentionedIds,
        source: "comment",
        contentSnippet: comment.commentStripped ?? data.comment_html,
      });
    }
  }

  return comment;
}

export async function getById(db: DbClient, id: string) {
  const comment = await commentsRepo.findById(db, id);
  if (!comment) throw new HTTPException(404, { message: "Comment not found" });
  return comment;
}

export async function list(db: DbClient, issueId: string, offset: number, limit: number) {
  return commentsRepo.listByIssue(db, issueId, offset, limit);
}

export async function update(
  db: DbClient,
  actorId: string,
  id: string,
  data: z.infer<typeof updateCommentSchema>,
) {
  const comment = await commentsRepo.findById(db, id);
  if (!comment) throw new HTTPException(404, { message: "Comment not found" });
  if (comment.actorId !== actorId) {
    throw new HTTPException(403, { message: "You can only edit your own comments" });
  }
  return commentsRepo.update(db, id, {
    commentHtml: data.comment_html,
    access: data.access,
  });
}

export async function remove(db: DbClient, actorId: string, id: string) {
  const comment = await commentsRepo.findById(db, id);
  if (!comment) throw new HTTPException(404, { message: "Comment not found" });
  if (comment.actorId !== actorId) {
    throw new HTTPException(403, { message: "You can only delete your own comments" });
  }
  await commentsRepo.remove(db, id);
}

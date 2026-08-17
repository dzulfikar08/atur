import { and, eq, isNull, inArray } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import * as schema from '../db/schema'
import * as subscribersRepo from '../repositories/subscribers'
import { notify, extractMentionedUserIds, extractMentionedUsernames, actorLine, type NotifyReceiver } from '../lib/notify'
import type { Env } from '../lib/env'

export interface IssueLike {
  id: string
  name: string
  sequenceId: number
  projectId: string
  workspaceId: string
}

export interface CommentLike {
  id: string
  commentHtml: string | null
  commentStripped: string | null
  actorId: string | null
}

// Resolve a set of user ids to NotifyReceiver rows (email + verification flags).
export async function resolveReceivers(db: DbClient, userIds: string[]): Promise<NotifyReceiver[]> {
  const unique = [...new Set(userIds.filter(Boolean))]
  if (unique.length === 0) return []
  const rows = await db.select({
    id: schema.users.id,
    email: schema.users.email,
    isEmailVerified: schema.users.isEmailVerified,
    isActive: schema.users.isActive,
  }).from(schema.users).where(and(inArray(schema.users.id, unique), isNull(schema.users.deletedAt)))
  return rows.map((r) => ({ id: r.id, email: r.email, isEmailVerified: r.isEmailVerified, isActive: r.isActive }))
}

function issueUrl(issue: IssueLike): string {
  return `https://diatur.com/${issue.workspaceId}/projects/${issue.projectId}/issues/${issue.sequenceId}`
}

function issueLabel(issue: IssueLike): string {
  return `${issue.sequenceId}`
}

// New comment on an issue → notify all followers (author excluded).
export async function notifyCommentAdded(db: DbClient, env: Env, issue: IssueLike, comment: CommentLike, actorName?: string | null) {
  const subscribers = await subscribersRepo.listByIssue(db, issue.id)
  const receivers = subscribers
    .map((s): NotifyReceiver | null => s.user ? {
      id: s.user.id,
      email: s.user.email,
      username: s.user.username,
      display_name: s.user.display_name,
      avatar: s.user.avatar,
      isEmailVerified: s.user.is_email_verified,
      isActive: s.user.is_active,
    } : null)
    .filter((r): r is NotifyReceiver => r !== null)

  const who = actorLine(actorName)
  const snippet = (comment.commentStripped || comment.commentHtml || '').replace(/<[^>]*>/g, '').slice(0, 180)

  await notify(db, env, {
    receivers,
    actorId: comment.actorId,
    actorName,
    workspaceId: issue.workspaceId,
    projectId: issue.projectId,
    title: `${who} commented on ${issueLabel(issue)} — ${issue.name}`,
    message: snippet || 'New comment on this issue.',
    data: { issue_id: issue.id, comment_id: comment.id },
    entityIdentifier: issue.id,
    entityName: 'issue',
    notificationType: 'comment',
    email: {
      subject: `[${issueLabel(issue)}] ${who} commented — ${issue.name}`,
      text: `${who} commented on ${issue.name}:\n\n${snippet}\n\n${issueUrl(issue)}`,
      bodyHtml: `<p><strong>${who}</strong> commented on <strong>${issue.name}</strong>:</p><blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #e5e7eb;color:#4b5563;">${snippet.replace(/</g, '&lt;')}</blockquote>`,
      ctaText: 'View issue',
      ctaUrl: issueUrl(issue),
    },
  })
}

// Mention in a comment or description → notify mentioned users + followers
// (mentioner excluded). Mentioned users get their own notification even if they
// don't follow the issue.
export async function notifyMentioned(
  db: DbClient,
  env: Env,
  issue: IssueLike,
  opts: {
    actorId: string
    actorName?: string | null
    mentionedIds: string[]
    mentionedUsernames?: string[]
    source: 'comment' | 'description'
    contentSnippet?: string
  }
) {
  // Resolve mention targets: explicit ids from data-mention-id, plus any
  // @username fallback matches typed without the picker.
  const mentioned = await resolveReceivers(db, opts.mentionedIds)
  const idSet = new Set(mentioned.map((u) => u.id))

  const subscribers = await subscribersRepo.listByIssue(db, issue.id)
  const receivers = subscribers
    .map((s): NotifyReceiver | null => s.user ? {
      id: s.user.id,
      email: s.user.email,
      username: s.user.username,
      display_name: s.user.display_name,
      avatar: s.user.avatar,
      isEmailVerified: s.user.is_email_verified,
      isActive: s.user.is_active,
    } : null)
    .filter((r): r is NotifyReceiver => r !== null)

  const combined: NotifyReceiver[] = [...mentioned]
  for (const r of receivers) {
    if (!idSet.has(r.id)) combined.push(r)
    idSet.add(r.id)
  }

  const who = actorLine(opts.actorName)
  const where = opts.source === 'comment' ? 'mentioned you in a comment' : 'mentioned you in the description'
  const snippet = (opts.contentSnippet || '').replace(/<[^>]*>/g, '').slice(0, 180)

  await notify(db, env, {
    receivers: combined,
    actorId: opts.actorId,
    actorName: opts.actorName,
    workspaceId: issue.workspaceId,
    projectId: issue.projectId,
    title: `${who} ${where} on ${issueLabel(issue)} — ${issue.name}`,
    message: snippet || `${who} mentioned you on ${issue.name}.`,
    data: { issue_id: issue.id, source: opts.source },
    entityIdentifier: issue.id,
    entityName: 'issue',
    notificationType: 'mention',
    email: {
      subject: `${who} mentioned you — ${issue.name}`,
      text: `${who} ${where}:\n\n${snippet}\n\n${issueUrl(issue)}`,
      bodyHtml: `<p><strong>${who}</strong> ${where} on <strong>${issue.name}</strong>:</p><blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #e5e7eb;color:#4b5563;">${snippet.replace(/</g, '&lt;')}</blockquote>`,
      ctaText: 'View issue',
      ctaUrl: issueUrl(issue),
    },
  })
}

// Workspace members for the mention picker suggestion list.
export async function getWorkspaceMembersForMention(db: DbClient, workspaceId: string) {
  const rows = await db.select({
    id: schema.workspaceMembers.memberId,
    email: schema.users.email,
    username: schema.users.username,
    display_name: schema.users.displayName,
    avatar: schema.users.avatar,
  })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.workspaceMembers.memberId, schema.users.id))
    .where(and(
      eq(schema.workspaceMembers.workspaceId, workspaceId),
      isNull(schema.workspaceMembers.deletedAt),
      isNull(schema.users.deletedAt),
    ))
  return rows.map((r) => ({ id: r.id, email: r.email, username: r.username, display_name: r.display_name, avatar: r.avatar }))
}

// All mentioned ids in an HTML body: picker spans + @username fallback resolved
// against workspace members.
export async function resolveMentionsInHtml(db: DbClient, workspaceId: string, html: string | null | undefined): Promise<{ mentionedIds: string[]; mentionedUsernames: string[] }> {
  const mentionedIds = extractMentionedUserIds(html)
  const usernames = extractMentionedUsernames((html || '').replace(/<[^>]*>/g, ' '))

  let resolvedFromUsernames: string[] = []
  if (usernames.length > 0) {
    const members = await getWorkspaceMembersForMention(db, workspaceId)
    const byUsername = new Map(members.map((m) => [m.username.toLowerCase(), m.id]))
    resolvedFromUsernames = usernames
      .map((u) => byUsername.get(u))
      .filter((id): id is string => !!id)
  }

  return {
    mentionedIds: [...new Set([...mentionedIds, ...resolvedFromUsernames])],
    mentionedUsernames: usernames,
  }
}

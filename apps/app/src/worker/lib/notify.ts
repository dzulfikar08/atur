import { eq, and, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as notificationsRepo from "../repositories/notifications";
import { sendNotificationEmail, notificationEmailHtml } from "../services/email";
import type { Env } from "./env";

export interface NotifyReceiver {
  id: string;
  email: string;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
  isEmailVerified: number;
  isActive: number;
}

export interface NotifyOptions {
  receivers: NotifyReceiver[];
  // Actor whose action triggered this — never notified of their own action.
  actorId?: string | null;
  actorName?: string | null;
  workspaceId: string;
  projectId?: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  entityIdentifier?: string;
  entityName?: string;
  // Notification type key in notification_preferences (e.g. 'comment').
  notificationType: string;
  // Email (skipped entirely when omitted — in-app only).
  email?: {
    subject: string;
    text: string;
    bodyHtml: string;
    ctaText?: string;
    ctaUrl?: string;
  };
}

// Does this user want email for the given notification type? Defaults to ON
// when no preference row exists (a row is only created when the user opts out).
export async function emailEnabledFor(
  db: DbClient,
  userId: string,
  type: string,
): Promise<boolean> {
  const [pref] = await db
    .select({ emailEnabled: schema.notificationPreferences.emailEnabled })
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.userId, userId),
        eq(schema.notificationPreferences.notificationType, type),
        isNull(schema.notificationPreferences.deletedAt),
      ),
    )
    .limit(1);
  return pref ? pref.emailEnabled === 1 : true;
}

// Core dispatcher: writes an in-app notification row per receiver and (when an
// email payload is given) sends email. Email failures are non-fatal — the in-app
// row is the source of truth; sending is best-effort within the request.
export async function notify(db: DbClient, env: Env, opts: NotifyOptions): Promise<void> {
  const seen = new Set<string>();
  for (const receiver of opts.receivers) {
    if (!receiver || !receiver.id) continue;
    if (receiver.id === opts.actorId) continue;
    if (seen.has(receiver.id)) continue;
    seen.add(receiver.id);

    await notificationsRepo.create(db, {
      title: opts.title,
      message: opts.message,
      workspaceId: opts.workspaceId,
      projectId: opts.projectId,
      triggeredById: opts.actorId ?? undefined,
      receiverId: receiver.id,
      data: opts.data ? JSON.stringify(opts.data) : undefined,
      entityIdentifier: opts.entityIdentifier,
      entityName: opts.entityName,
    });

    if (!opts.email) continue;
    // In-app always; email only for verified active users who haven't opted out.
    if (receiver.isEmailVerified !== 1 || receiver.isActive !== 1) continue;
    if (!(await emailEnabledFor(db, receiver.id, opts.notificationType))) continue;

    try {
      await sendNotificationEmail(env, receiver.email, {
        subject: opts.email.subject,
        text: opts.email.text,
        html: notificationEmailHtml({
          title: opts.email.subject,
          bodyHtml: opts.email.bodyHtml,
          ctaText: opts.email.ctaText,
          ctaUrl: opts.email.ctaUrl,
        }),
      });
    } catch (err) {
      // Never let an email failure break the request that created the content.
      console.error(`[notify] email error → ${receiver.email}:`, err);
    }
  }
}

// Extract mentioned user ids from stored HTML: <span data-mention-id="...">.
// Falls back to a @username scan of the visible text for mentions typed without
// the picker (usernames are [a-z0-9_-], matching the invite code path).
export function extractMentionedUserIds(html: string | null | undefined): string[] {
  if (!html) return [];
  const ids: string[] = [];
  const idRe = /data-mention-id="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(html)) !== null) {
    if (m[1] && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

// Extract @username mentions from plain text (for fallback detection and for
// building the email body's human-readable mention list).
export function extractMentionedUsernames(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const re = /@([a-z0-9][a-z0-9_-]{0,31})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const u = m[1].toLowerCase();
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

// Render a "who did what" email body line for the actor.
export function actorLine(actorName: string | null | undefined, fallback = "Someone"): string {
  return actorName && actorName.trim() ? actorName.trim() : fallback;
}

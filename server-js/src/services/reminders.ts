import { and, eq, gte, lte, isNull } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import { getDb } from '../db/index'
import * as schema from '../db/schema'
import * as subscribersRepo from '../repositories/subscribers'
import { sendNotificationEmail, notificationEmailHtml } from './email'
import { emailEnabledFor } from '../lib/notify'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'
import type { Env } from '../lib/env'

// Date math helpers (UTC; the target_date is a date-only yyyy-MM-dd).
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

// The "local date" for a user given their timezone: we approximate by applying
// the timezone's current offset to the target instant, which is close enough
// for a daily reminder (edge cases at the day boundary are acceptable).
function localDateForUser(userTimezone: string | null | undefined, utcDate: string): string {
  if (!userTimezone || userTimezone === 'UTC') return utcDate
  try {
    const parts = utcDate.split('-').map(Number)
    const now = new Date()
    const tzNow = new Date(now.toLocaleString('en-US', { timeZone: userTimezone }))
    const offsetMs = tzNow.getTime() - now.getTime()
    const local = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]) + offsetMs)
    return local.toISOString().slice(0, 10)
  } catch {
    return utcDate
  }
}

// Issues with a target_date in [startDate, endDate] (inclusive), not completed,
// not archived/deleted.
async function findDueIssues(db: DbClient, startDate: string, endDate: string) {
  return db.select({
    id: schema.issues.id,
    name: schema.issues.name,
    sequenceId: schema.issues.sequenceId,
    targetDate: schema.issues.targetDate,
    projectId: schema.issues.projectId,
    workspaceId: schema.issues.workspaceId,
    projectIdentifier: schema.projects.identifier,
    workspaceSlug: schema.workspaces.slug,
  })
    .from(schema.issues)
    .innerJoin(schema.projects, eq(schema.issues.projectId, schema.projects.id))
    .innerJoin(schema.workspaces, eq(schema.issues.workspaceId, schema.workspaces.id))
    .where(and(
      gte(schema.issues.targetDate, startDate),
      lte(schema.issues.targetDate, endDate),
      isNull(schema.issues.deletedAt),
      isNull(schema.issues.completedAt),
      isNull(schema.projects.deletedAt),
      isNull(schema.projects.archivedAt),
    ))
    .limit(500)
}

// Has this reminder already been sent for the issue on this date?
async function reminderSent(db: DbClient, issueId: string, date: string, type: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.issueReminders.id })
    .from(schema.issueReminders)
    .where(and(
      eq(schema.issueReminders.issueId, issueId),
      eq(schema.issueReminders.reminderDate, date),
      eq(schema.issueReminders.reminderType, type),
    ))
    .limit(1)
  return !!row
}

async function markReminderSent(db: DbClient, issueId: string, date: string, type: string) {
  const now = nowISO()
  await db.insert(schema.issueReminders).values({
    id: uuid(),
    issueId,
    reminderDate: date,
    reminderType: type,
    createdAt: now,
    updatedAt: now,
  })
}

// Due-date reminder email for a single issue+recipient. Returns true when sent.
async function sendDueReminder(env: Env, opts: {
  to: string
  issueName: string
  sequenceId: number
  projectIdentifier: string
  targetDate: string
  daysFromNow: number // negative = overdue
  url: string
  workspaceSlug: string
}): Promise<boolean> {
  const label = `${opts.projectIdentifier}-${String(opts.sequenceId).padStart(4, '0')}`
  const due = opts.daysFromNow < 0
    ? `overdue by ${Math.abs(opts.daysFromNow)} day${Math.abs(opts.daysFromNow) === 1 ? '' : 's'}`
    : opts.daysFromNow === 0
      ? 'due today'
      : opts.daysFromNow === 1
        ? 'due tomorrow'
        : `due in ${opts.daysFromNow} days`

  const subject = `[${label}] ${opts.issueName} — ${due}`
  const text = `${opts.issueName} is ${due} (${opts.targetDate}).\n\n${opts.url}`
  const html = notificationEmailHtml({
    title: subject,
    bodyHtml: `<p><strong>${opts.issueName}</strong> is ${due} (${opts.targetDate}).</p>`,
    ctaText: 'View issue',
    ctaUrl: opts.url,
  })

  const result = await sendNotificationEmail(env, opts.to, { subject, text, html })
  return result.sent
}

// Cron entry point. Finds issues whose target_date lands in the next 24h (or is
// overdue), then emails each follower once per issue per local day.
export async function runDueDateReminders(env: Env): Promise<{ processed: number; sent: number }> {
  const db = getDb(env.DB)

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const overdueStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Overdue window: [7 days ago, today]; upcoming: [today, tomorrow].
  const issues = await findDueIssues(db, overdueStart, tomorrow)

  let processed = 0
  let sent = 0

  for (const issue of issues) {
    const target = issue.targetDate!
    // How many days from "today" the target is (approx, UTC).
    const daysFromNow = Math.round((Date.parse(target + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000)
    // Only remind for overdue or within next 24h targets.
    if (daysFromNow > 1) continue

    const url = `https://diatur.com/${issue.workspaceSlug}/projects/${issue.projectId}/issues/${issue.sequenceId}`

    const subscribers = await subscribersRepo.listByIssue(db, issue.id)
    for (const sub of subscribers) {
      if (!sub.user) continue
      const u = sub.user
      if (u.is_email_verified !== 1 || u.is_active !== 1) continue
      if (!(await emailEnabledFor(db, u.id, 'reminder'))) continue

      const localDate = localDateForUser(u.user_timezone, today)
      // Dedup per issue per (local) day. KV is the fast-path guard; the
      // issue_reminders table is the durable record.
      const kvKey = `reminder:${issue.id}:${localDate}`
      if (env.RATE_LIMIT) {
        const existing = await env.RATE_LIMIT.get(kvKey).catch(() => null)
        if (existing) continue
      }
      if (await reminderSent(db, issue.id, localDate, 'target_date')) continue

      const ok = await sendDueReminder(env, {
        to: u.email,
        issueName: issue.name,
        sequenceId: issue.sequenceId,
        projectIdentifier: issue.projectIdentifier,
        targetDate: target,
        daysFromNow,
        url,
        workspaceSlug: issue.workspaceSlug,
      })
      if (ok) {
        sent += 1
        await markReminderSent(db, issue.id, localDate, 'target_date')
        if (env.RATE_LIMIT) {
          await env.RATE_LIMIT.put(kvKey, '1', { expirationTtl: 86400 }).catch(() => {})
        }
      }
      processed += 1
    }
  }

  console.log(`[reminders] processed=${processed} sent=${sent}`)
  return { processed, sent }
}

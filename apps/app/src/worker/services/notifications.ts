import { eq, and, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as notificationsRepo from "../repositories/notifications";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";
import { HTTPException } from "hono/http-exception";

export async function list(db: DbClient, userId: string, offset: number, limit: number) {
  return notificationsRepo.listByUser(db, userId, offset, limit);
}

export async function markRead(db: DbClient, id: string, _userId: string) {
  const notification = await notificationsRepo.findById(db, id);
  if (!notification) throw new HTTPException(404, { message: "Notification not found" });
  await notificationsRepo.markRead(db, id);
}

export async function markAllRead(db: DbClient, userId: string) {
  await notificationsRepo.markAllRead(db, userId);
}

export async function unreadCount(db: DbClient, userId: string) {
  return notificationsRepo.unreadCount(db, userId);
}

export async function update(
  db: DbClient,
  id: string,
  _userId: string,
  data: { read?: boolean; archived?: boolean },
) {
  const notification = await notificationsRepo.findById(db, id);
  if (!notification) throw new HTTPException(404, { message: "Notification not found" });
  await notificationsRepo.update(db, id, data);
}

// --- Email notification preferences ---

export const NOTIFICATION_TYPES = ["comment", "mention", "reminder"] as const;

async function upsertPreference(
  db: DbClient,
  userId: string,
  notificationType: string,
  emailEnabled: boolean,
) {
  const [existing] = await db
    .select({ id: schema.notificationPreferences.id })
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.userId, userId),
        eq(schema.notificationPreferences.notificationType, notificationType),
        isNull(schema.notificationPreferences.deletedAt),
      ),
    )
    .limit(1);
  const now = nowISO();
  if (existing) {
    await db
      .update(schema.notificationPreferences)
      .set({ emailEnabled: emailEnabled ? 1 : 0, updatedAt: now })
      .where(eq(schema.notificationPreferences.id, existing.id));
  } else {
    await db.insert(schema.notificationPreferences).values({
      id: uuid(),
      userId,
      notificationType,
      emailEnabled: emailEnabled ? 1 : 0,
      pushEnabled: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

// Per-type email preference for the current user. Missing rows default to ON —
// they only exist after the user opts out (or changes a value), so default-on
// here matches the dispatcher in lib/notify.ts.
export async function getPreferences(db: DbClient, userId: string) {
  const rows = await db
    .select({
      notificationType: schema.notificationPreferences.notificationType,
      emailEnabled: schema.notificationPreferences.emailEnabled,
    })
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.userId, userId),
        isNull(schema.notificationPreferences.deletedAt),
      ),
    );
  const map = new Map(rows.map((r) => [r.notificationType, r.emailEnabled === 1]));
  return {
    preferences: NOTIFICATION_TYPES.map((t) => ({
      notification_type: t,
      email_enabled: map.get(t) ?? true,
    })),
  };
}

export async function updatePreferences(
  db: DbClient,
  userId: string,
  data: { notification_type?: string; email_enabled?: boolean },
) {
  if (!data.notification_type || !NOTIFICATION_TYPES.includes(data.notification_type as any)) {
    throw new HTTPException(400, {
      message: `notification_type must be one of: ${NOTIFICATION_TYPES.join(", ")}`,
    });
  }
  if (data.email_enabled === undefined) {
    throw new HTTPException(400, { message: "email_enabled is required" });
  }
  await upsertPreference(db, userId, data.notification_type, data.email_enabled);
  return { ok: true };
}

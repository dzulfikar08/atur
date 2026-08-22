import { desc, eq } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export interface EmailLogRow {
  id: string;
  workspaceId: string;
  customerId: string;
  purpose: string;
  variantId: string | null;
  variantName: string | null;
  subject: string;
  sentAt: string;
  sent: number;
}

// Record one templated-email send attempt. sent=0 marks attempts that didn't
// actually go out (SEND_EMAIL binding absent in local dev).
export async function logSend(
  db: DbClient,
  data: {
    workspaceId: string;
    customerId: string;
    purpose: string;
    variantId?: string | null;
    variantName?: string | null;
    subject: string;
    sent: boolean;
  },
): Promise<void> {
  await db.insert(schema.crmEmailLog).values({
    id: uuid(),
    workspaceId: data.workspaceId,
    customerId: data.customerId,
    purpose: data.purpose,
    variantId: data.variantId ?? null,
    variantName: data.variantName ?? null,
    subject: data.subject,
    sentAt: nowISO(),
    sent: data.sent ? 1 : 0,
  });
}

// Latest sends for a contact (newest first).
export async function listByCustomer(
  db: DbClient,
  customerId: string,
  limit = 20,
): Promise<EmailLogRow[]> {
  return db
    .select()
    .from(schema.crmEmailLog)
    .where(eq(schema.crmEmailLog.customerId, customerId))
    .orderBy(desc(schema.crmEmailLog.sentAt))
    .limit(limit);
}

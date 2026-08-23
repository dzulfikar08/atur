import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import * as activitiesRepo from "../repositories/crm_activities";
import { paginatedResponse } from "../lib/pagination";

// Unified CRM timeline types (mirrors trycompai/crm's Activity taxonomy,
// adapted for Atur's surface).
export const ACTIVITY_TYPES = [
  "NOTE",
  "CALL",
  "EMAIL",
  "MEETING",
  "TASK",
  "STAGE_CHANGE",
  "ENRICHMENT",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityInput {
  customerId?: string | null;
  dealId?: string | null;
  type: ActivityType;
  subject?: string | null;
  body?: string | null;
  occurredAt?: string;
  createdBy?: string | null;
}

// Record an activity on the CRM timeline + touch the contact's rollup.
export async function recordActivity(db: DbClient, workspaceId: string, input: ActivityInput) {
  if (!input.customerId && !input.dealId) {
    throw new HTTPException(400, { message: "Activity needs a customer or deal" });
  }
  const activity = await activitiesRepo.createActivity(db, { workspaceId, ...input });
  if (input.customerId) {
    await activitiesRepo.touchContact(db, input.customerId);
  }
  return activity;
}

export async function listActivities(
  db: DbClient,
  workspaceId: string,
  opts: {
    customerId?: string;
    dealId?: string;
    offset: number;
    limit: number;
  },
) {
  if (opts.customerId) {
    const { rows, total } = await activitiesRepo.listByCustomer(db, opts.customerId, opts);
    return paginatedResponse(rows, total, opts.offset, opts.limit);
  }
  if (opts.dealId) {
    const { rows, total } = await activitiesRepo.listByDeal(db, opts.dealId, opts);
    return paginatedResponse(rows, total, opts.offset, opts.limit);
  }
  throw new HTTPException(400, { message: "customerId or dealId is required" });
}

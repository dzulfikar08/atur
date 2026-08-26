import { z } from "zod";
import { v4 as uuid } from "uuid";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as valuesRepo from "../repositories/customFieldValues";
import { nowISO } from "../lib/pagination";

// Wire contract matches the client's CustomFieldValue editor
// ({custom_field_id, value_json} pairs; null/omitted value_json clears).
export const setValuesSchema = z.object({
  values: z
    .array(
      z.object({
        custom_field_id: z.string().min(1),
        value_json: z.unknown().optional(),
      }),
    )
    .min(1),
});

export type IssueLike = { id: string; projectId: string; workspaceId: string };

export async function list(db: DbClient, issue: IssueLike) {
  const rows = await valuesRepo.listByIssue(db, issue.id);
  // snake_case payload matching the frontend CustomFieldValue type.
  return rows.map((r) => ({
    id: r.id,
    issue_id: r.issueId,
    custom_field_id: r.customFieldId,
    value_json: r.valueJson === null ? null : safeParse(r.valueJson),
    field_name: r.fieldName,
    field_type: r.fieldType,
    field_settings: r.fieldSettings === null ? null : safeParse(r.fieldSettings),
  }));
}

export async function set(db: DbClient, issue: IssueLike, body: unknown) {
  const parsed = setValuesSchema.parse(body);
  const now = nowISO();
  for (const entry of parsed.values) {
    // The field must belong to the SAME project as the issue — otherwise a
    // member could park another project's field id (and its values) on this
    // issue (cross-project linkage; the IDOR class this file guards against).
    const [field] = await db
      .select({ id: schema.customFields.id })
      .from(schema.customFields)
      .where(
        and(
          eq(schema.customFields.id, entry.custom_field_id),
          eq(schema.customFields.projectId, issue.projectId),
          isNull(schema.customFields.deletedAt),
        ),
      )
      .limit(1);
    if (!field) throw new HTTPException(404, { message: "Custom field not found" });

    const valueJson =
      entry.value_json === undefined || entry.value_json === null
        ? null
        : JSON.stringify(entry.value_json);
    await valuesRepo.upsert(db, {
      id: uuid(),
      issueId: issue.id,
      customFieldId: entry.custom_field_id,
      valueJson,
      workspaceId: issue.workspaceId,
      now,
    });
  }
  return { ok: true };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";

export interface CustomFieldValueRow {
  id: string;
  issueId: string;
  customFieldId: string;
  valueJson: string | null;
  workspaceId: string;
}

export interface CustomFieldValueWithField extends CustomFieldValueRow {
  fieldName: string | null;
  fieldType: string | null;
  fieldSettings: string | null;
}

export async function listByIssue(db: DbClient, issueId: string) {
  const rows = await db
    .select({
      id: schema.customFieldValues.id,
      issueId: schema.customFieldValues.issueId,
      customFieldId: schema.customFieldValues.customFieldId,
      valueJson: schema.customFieldValues.valueJson,
      workspaceId: schema.customFieldValues.workspaceId,
      fieldName: schema.customFields.name,
      fieldType: schema.customFields.fieldType,
      fieldSettings: schema.customFields.options,
    })
    .from(schema.customFieldValues)
    .innerJoin(
      schema.customFields,
      eq(schema.customFieldValues.customFieldId, schema.customFields.id),
    )
    .where(
      and(
        eq(schema.customFieldValues.issueId, issueId),
        isNull(schema.customFieldValues.deletedAt),
        isNull(schema.customFields.deletedAt),
      ),
    );
  return rows;
}

export async function upsert(
  db: DbClient,
  data: {
    id: string;
    issueId: string;
    customFieldId: string;
    valueJson: string | null;
    workspaceId: string;
    now: string;
  },
) {
  await db
    .insert(schema.customFieldValues)
    .values({
      id: data.id,
      issueId: data.issueId,
      customFieldId: data.customFieldId,
      valueJson: data.valueJson,
      workspaceId: data.workspaceId,
      createdAt: data.now,
      updatedAt: data.now,
    })
    .onConflictDoUpdate({
      target: [schema.customFieldValues.issueId, schema.customFieldValues.customFieldId],
      // deletedAt: null resurrects a soft-deleted row instead of silently
      // updating an invisible one.
      set: { valueJson: data.valueJson, updatedAt: data.now, deletedAt: null },
    });
}

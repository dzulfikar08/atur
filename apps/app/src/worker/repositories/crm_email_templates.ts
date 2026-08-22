import { and, desc, eq } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export interface EmailTemplateRow {
  id: string;
  workspaceId: string;
  templateName: string;
  subject: string;
  body: string;
  isHtml: number;
  createdAt: string | null;
  updatedAt: string | null;
}

// Get the stored template for a (workspace, template_name), or null.
export async function getTemplate(
  db: DbClient,
  workspaceId: string,
  templateName: string,
): Promise<EmailTemplateRow | null> {
  const [row] = await db
    .select()
    .from(schema.crmEmailTemplates)
    .where(
      and(
        eq(schema.crmEmailTemplates.workspaceId, workspaceId),
        eq(schema.crmEmailTemplates.templateName, templateName),
      ),
    )
    .limit(1);
  return row ?? null;
}

// List all custom templates for a workspace.
export async function listTemplates(
  db: DbClient,
  workspaceId: string,
): Promise<EmailTemplateRow[]> {
  return db
    .select()
    .from(schema.crmEmailTemplates)
    .where(eq(schema.crmEmailTemplates.workspaceId, workspaceId))
    .orderBy(desc(schema.crmEmailTemplates.updatedAt));
}

// Insert or update a template (upsert on the unique workspace+name index).
export async function upsertTemplate(
  db: DbClient,
  workspaceId: string,
  templateName: string,
  data: { subject: string; body: string; isHtml?: boolean },
): Promise<EmailTemplateRow> {
  const now = nowISO();
  // Single atomic statement on the (workspace_id, template_name) unique index
  // — a read-then-write upsert would 500 on the constraint under concurrent
  // saves and cost three round trips instead of two.
  await db
    .insert(schema.crmEmailTemplates)
    .values({
      id: uuid(),
      workspaceId,
      templateName,
      subject: data.subject,
      body: data.body,
      isHtml: data.isHtml ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.crmEmailTemplates.workspaceId,
        schema.crmEmailTemplates.templateName,
      ],
      set: {
        subject: data.subject,
        body: data.body,
        isHtml: data.isHtml ? 1 : 0,
        updatedAt: now,
      },
    });

  const updated = await getTemplate(db, workspaceId, templateName);
  return updated!;
}

// Delete a custom template (reverts to the code default on next render).
export async function deleteTemplate(
  db: DbClient,
  workspaceId: string,
  templateName: string,
): Promise<void> {
  await db
    .delete(schema.crmEmailTemplates)
    .where(
      and(
        eq(schema.crmEmailTemplates.workspaceId, workspaceId),
        eq(schema.crmEmailTemplates.templateName, templateName),
      ),
    );
}

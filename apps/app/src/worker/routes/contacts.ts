import { Hono, type Context } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { paginationParams } from "../lib/pagination";
import * as schema from "../db/schema";
import * as workspaceRepo from "../repositories/workspaces";
import * as crmService from "../services/crm";

// Admin CRM contacts API. Mounted under /api/workspaces/:slug/contacts, so the
// global authMiddleware already applies; each handler re-checks membership.
export const contactsRoutes = new Hono<{ Bindings: Env }>({ strict: false });

async function resolveWorkspace(c: Context<{ Bindings: Env }>) {
  const db = getDb(c.env.DB);
  const slug = c.req.param("slug")!;
  const ws = await workspaceRepo.findBySlug(db, slug);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  return ws;
}

async function assertMember(
  db: ReturnType<typeof getDb>,
  ws: { id: string; ownerId: string },
  userId: string,
) {
  if (ws.ownerId === userId) return;
  const [m] = await db
    .select({ id: schema.workspaceMembers.id })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, ws.id),
        eq(schema.workspaceMembers.memberId, userId),
        eq(schema.workspaceMembers.isActive, 1),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  if (!m) throw new HTTPException(403, { message: "Not a member of this workspace" });
}

contactsRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const { offset, limit } = paginationParams(c);
  const result = await crmService.listContacts(db, ws.id, {
    status: c.req.query("status"),
    search: c.req.query("search"),
    offset,
    limit,
  });
  return c.json(result);
});

contactsRoutes.post("/", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const body = crmService.createContactSchema.parse(await c.req.json());
  const contact = await crmService.createContact(db, ws.id, body);
  return c.json(contact, 201);
});

// ── Email template management ────────────────────────────────────────────────
// IMPORTANT: register static /email-templates routes BEFORE /:id so Hono's
// radix tree doesn't match "email-templates" as the :id parametric segment.
contactsRoutes.get("/email-templates", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const result = await crmService.listEmailTemplates(db, ws.id);
  return c.json({ ...result, footer: ws.emailFooter ?? "" });
});

// Workspace-level {{footer}} signature. Registered before parametric siblings
// so "footer" / "variants" aren't matched as the :name segment (radix-tree
// rule: static segments must be registered first).
contactsRoutes.put("/email-templates/footer", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const body = crmService.saveFooterSchema.parse(await c.req.json());
  await workspaceRepo.update(db, ws.id, {
    emailFooter: body.footer === "" ? null : body.footer,
  });
  return c.json({ footer: body.footer });
});

// Create a variant under a purpose.
contactsRoutes.post("/email-templates/variants", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const body = crmService.saveVariantSchema.parse(await c.req.json());
  const result = await crmService.createEmailVariant(db, ws.id, body);
  return c.json(result, 201);
});

// Update a variant.
contactsRoutes.put("/email-templates/variants/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const body = crmService.updateVariantSchema.parse(await c.req.json());
  await crmService.updateEmailVariant(db, ws.id, c.req.param("id")!, body);
  return c.body(null, 204);
});

// Delete a variant.
contactsRoutes.delete("/email-templates/variants/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  await crmService.deleteEmailVariant(db, ws.id, c.req.param("id")!);
  return c.body(null, 204);
});

// Flag a variant as its purpose's default.
contactsRoutes.put("/email-templates/variants/:id/default", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  await crmService.setDefaultEmailVariant(db, ws.id, c.req.param("id")!);
  return c.body(null, 204);
});

contactsRoutes.get("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const result = await crmService.getContact(db, ws.id, c.req.param("id")!);
  return c.json(result);
});

contactsRoutes.patch("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const body = crmService.updateContactSchema.parse(await c.req.json());
  const contact = await crmService.updateContact(db, ws.id, c.req.param("id")!, body);
  return c.json(contact);
});

contactsRoutes.delete("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  await crmService.deleteContact(db, ws.id, c.req.param("id")!);
  return c.body(null, 204);
});

// Preview a CRM customer email template for a contact (no email is sent).
contactsRoutes.get("/:id/email-preview", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const { purpose, variant_id } = crmService.sendEmailSchema.parse({
    purpose: c.req.query("purpose") || "feedback_request",
    variant_id: c.req.query("variant_id") || undefined,
  });
  const result = await crmService.renderTemplateEmail(db, ws, c.req.param("id")!, purpose, variant_id);
  return c.json(result);
});

// Send a templated customer email (e.g. feedback request) to a contact.
contactsRoutes.post("/:id/send-email", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const body = crmService.sendEmailSchema.parse(await c.req.json());
  const result = await crmService.sendTemplateEmail(
    db,
    c.env,
    ws,
    c.req.param("id")!,
    body,
  );
  return c.json(result);
});

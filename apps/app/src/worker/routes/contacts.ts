import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { paginationParams } from "../lib/pagination";
import { resolveWorkspaceForCaller } from "../middleware/workspace";
import * as workspaceRepo from "../repositories/workspaces";
import * as crmService from "../services/crm";
import * as factsService from "../services/contact_facts";

// Admin CRM contacts API. Mounted under /api/workspaces/:slug/contacts, so the
// global authMiddleware already applies; each handler re-checks membership.
export const contactsRoutes = new Hono<{ Bindings: Env }>({ strict: false });

contactsRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
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
  const ws = await resolveWorkspaceForCaller(c);
  const body = crmService.createContactSchema.parse(await c.req.json());
  const contact = await crmService.createContact(db, ws.id, body);
  return c.json(contact, 201);
});

// ── Email template management ────────────────────────────────────────────────
// IMPORTANT: register static /email-templates routes BEFORE /:id so Hono's
// radix tree doesn't match "email-templates" as the :id parametric segment.
contactsRoutes.get("/email-templates", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const result = await crmService.listEmailTemplates(db, ws.id);
  return c.json({ ...result, footer: ws.emailFooter ?? "" });
});

// Workspace-level {{footer}} signature. Registered before parametric siblings
// so "footer" / "variants" aren't matched as the :name segment (radix-tree
// rule: static segments must be registered first).
contactsRoutes.put("/email-templates/footer", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const body = crmService.saveFooterSchema.parse(await c.req.json());
  await workspaceRepo.update(db, ws.id, {
    emailFooter: body.footer === "" ? null : body.footer,
  });
  return c.json({ footer: body.footer });
});

// Create a variant under a purpose.
contactsRoutes.post("/email-templates/variants", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const body = crmService.saveVariantSchema.parse(await c.req.json());
  const result = await crmService.createEmailVariant(db, ws.id, body);
  return c.json(result, 201);
});

// Update a variant.
contactsRoutes.put("/email-templates/variants/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const body = crmService.updateVariantSchema.parse(await c.req.json());
  await crmService.updateEmailVariant(db, ws.id, c.req.param("id")!, body);
  return c.body(null, 204);
});

// Delete a variant.
contactsRoutes.delete("/email-templates/variants/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  await crmService.deleteEmailVariant(db, ws.id, c.req.param("id")!);
  return c.body(null, 204);
});

// Flag a variant as its purpose's default.
contactsRoutes.put("/email-templates/variants/:id/default", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  await crmService.setDefaultEmailVariant(db, ws.id, c.req.param("id")!);
  return c.body(null, 204);
});

contactsRoutes.get("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const result = await crmService.getContact(db, ws.id, c.req.param("id")!);
  return c.json(result);
});

// ── Evidence ledger (DEV-11): facts for a contact ────────────────────────────
// Registered before the /:id/email-preview + /:id/send-email static routes'
// parametric sibling /:id so the radix tree resolves these first.

// Facts for this contact (paginated; includes PROPOSED/APPLIED/DISMISSED).
contactsRoutes.get("/:id/facts", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const { offset, limit } = paginationParams(c);
  const result = await factsService.listFacts(db, ws.id, {
    customerId: c.req.param("id")!,
    status: c.req.query("status") || undefined,
    offset,
    limit,
  });
  return c.json(result);
});

// Suggestions = PROPOSED facts waiting for a rep decision, with enrichment
// coverage for the contact.
contactsRoutes.get("/:id/facts/suggestions", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const result = await factsService.listFacts(db, ws.id, {
    customerId: c.req.param("id")!,
    status: "PROPOSED",
    offset: 0,
    limit: 10,
  });
  const contact = await crmService.getContact(db, ws.id, c.req.param("id")!);
  return c.json({
    suggestions: result.results,
    coverage: { enriched_at: contact.contact.enrichedAt },
  });
});

// Record a fact through the ledger (agent + rep path share this).
contactsRoutes.post("/:id/facts", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const body = factsService.recordFactSchema.parse(await c.req.json());
  const fact = await factsService.recordFact(db, ws.id, c.get("user").sub, {
    ...body,
    customer_id: c.req.param("id")!,
  });
  return c.json(fact, 201);
});

// Rep decisions on a PROPOSED fact.
contactsRoutes.post("/:id/facts/:factId/apply", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const fact = await factsService.applyFact(db, ws.id, c.get("user").sub, c.req.param("factId")!);
  return c.json(fact);
});

contactsRoutes.post("/:id/facts/:factId/dismiss", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const fact = await factsService.dismissFact(db, ws.id, c.get("user").sub, c.req.param("factId")!);
  return c.json(fact);
});

contactsRoutes.patch("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const body = crmService.updateContactSchema.parse(await c.req.json());
  const contact = await crmService.updateContact(db, ws.id, c.req.param("id")!, body);
  return c.json(contact);
});

contactsRoutes.delete("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  await crmService.deleteContact(db, ws.id, c.req.param("id")!);
  return c.body(null, 204);
});

// Preview a CRM customer email template for a contact (no email is sent).
contactsRoutes.get("/:id/email-preview", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const { purpose, variant_id } = crmService.sendEmailSchema.parse({
    purpose: c.req.query("purpose") || "feedback_request",
    variant_id: c.req.query("variant_id") || undefined,
  });
  const result = await crmService.renderTemplateEmail(
    db,
    ws,
    c.req.param("id")!,
    purpose,
    variant_id,
  );
  return c.json(result);
});

// Send a templated customer email (e.g. feedback request) to a contact.
contactsRoutes.post("/:id/send-email", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const body = crmService.sendEmailSchema.parse(await c.req.json());
  const result = await crmService.sendTemplateEmail(
    db,
    c.env,
    ws,
    c.req.param("id")!,
    body,
    c.get("user").sub,
  );
  return c.json(result);
});

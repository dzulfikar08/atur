// ── Template registry ────────────────────────────────────────────────────────
// Each template maps to a renderer. New templates (e.g. "follow_up") extend
// this registry — the send-email endpoint dispatches by name.

import { emailLayout, escapeHtml } from "./email_layout";

export const TEMPLATE_NAMES = ["feedback_request"] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

// Templates that need the customer's most-recent paid order to render.
export const TEMPLATES_REQUIRING_PURCHASE = new Set<TemplateName>(["feedback_request"]);

// Fallback footer when a workspace has no custom footer configured
// (workspaces.email_footer). Falls back further to "<workspace name> team"
// at the service layer when the workspace name is known.
export const DEFAULT_EMAIL_FOOTER = "Regards";

// ── Placeholder variables ─────────────────────────────────────────────────────
// These can be used as {{key}} in template subject/body and are filled with
// customer + purchase data at render time.

export const TEMPLATE_VARIABLES = [
  { key: "name", label: "Customer name" },
  { key: "email", label: "Customer email" },
  { key: "product", label: "Product name (most recent paid purchase)" },
  { key: "date", label: "Purchase date" },
  { key: "amount", label: "Purchase amount" },
  { key: "footer", label: "Email footer signature" },
] as const;

export interface CustomerContext {
  name: string | null;
  email: string | null;
  company: string | null;
}

export interface PurchaseInfo {
  date: string; // ISO date string from Polar order.created_at
  amountCents: number;
  currency: string;
  productName: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// ── Default templates (used when no custom template is stored in the DB) ────

const DEFAULT_TEMPLATES: Record<TemplateName, { subject: string; body: string }> = {
  feedback_request: {
    subject: "How was your experience, {{name}}?",
    body: `Hi {{name}},

We noticed you purchased {{product}} on {{date}}. How was your experience?

We'd love to hear your feedback — what went well, what could be better, or any questions you might have.

Just reply to this email with your thoughts.

{{footer}}`,
  },
};

export function getDefaultTemplate(template: TemplateName): { subject: string; body: string } | null {
  return DEFAULT_TEMPLATES[template] ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayName(ctx: CustomerContext): string {
  return ctx.name ?? ctx.email?.split("@")[0] ?? "there";
}

function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${cents}`;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// Convert plain-text body to HTML: escape + convert newlines to <br/>.
export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br/>\n");
}

// Replace {{key}} placeholders with values from the map. Unknown placeholders
// are left untouched so the sender can see what's missing.
export function fillPlaceholders(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] !== undefined ? vars[key] : `{{${key}}}`;
  });
}

// Build the variable map for a specific customer + optional purchase.
// footer comes from the workspace's email_footer setting (falls back to
// DEFAULT_EMAIL_FOOTER at the service layer).
export function buildTemplateVars(
  ctx: CustomerContext,
  purchase?: PurchaseInfo | null,
  footer: string = DEFAULT_EMAIL_FOOTER,
): Record<string, string> {
  return {
    name: displayName(ctx),
    email: ctx.email ?? "",
    product: purchase?.productName ?? "",
    date: purchase ? formatDate(purchase.date) : "",
    amount: purchase ? formatCurrency(purchase.amountCents, purchase.currency) : "",
    footer,
  };
}

// ── Customer-facing HTML email wrapper ────────────────────────────────────────
// Differs from notificationEmailHtml: the footer says the email was sent
// because the customer is a contact in this workspace. bodyHtml is inserted
// verbatim — callers wrap/escape for their body format.
export function customerEmailHtml(opts: { title: string; bodyHtml: string }): string {
  return emailLayout({
    title: opts.title,
    bodyHtml: opts.bodyHtml,
    footerText: "This email was sent to you because you're a contact in an Atur workspace.",
  });
}

// ── Template rendering ────────────────────────────────────────────────────────
// Pure function: takes a template source (subject + body, e.g. from DB or default)
// and customer context + optional purchase, fills placeholders, returns the
// rendered email. Plain-text sources are escaped and newline-converted; an
// is_html source is the workspace owner's own markup and passes through
// verbatim (they control their own customer emails, like any ESP).

export function renderFromTemplateSource(
  source: { subject: string; body: string; isHtml?: boolean },
  ctx: CustomerContext,
  purchase?: PurchaseInfo | null,
  footer: string = DEFAULT_EMAIL_FOOTER,
): RenderedEmail {
  const vars = buildTemplateVars(ctx, purchase, footer);
  const subject = fillPlaceholders(source.subject, vars);
  const text = fillPlaceholders(source.body, vars);
  const bodyHtml = source.isHtml
    ? text
    : `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${textToHtml(text)}</p>`;
  const html = customerEmailHtml({
    title: subject,
    bodyHtml,
  });

  return { subject, text, html };
}

// ── Template registry ────────────────────────────────────────────────────────
// Each template maps to a renderer. New templates (e.g. "follow_up") extend
// this registry — the send-email endpoint dispatches by name.

export const TEMPLATE_NAMES = ["feedback_request"] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

// Templates that need the customer's most-recent paid order to render.
export const TEMPLATES_REQUIRING_PURCHASE = new Set<TemplateName>(["feedback_request"]);

// Default email footer signature appended to all customer emails.
export const DEFAULT_EMAIL_FOOTER = "Regards,\nDzulfikar\nVoltrus";

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

// Escape HTML special characters for safe body text rendering.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
export function buildTemplateVars(
  ctx: CustomerContext,
  purchase?: PurchaseInfo | null,
): Record<string, string> {
  return {
    name: displayName(ctx),
    email: ctx.email ?? "",
    product: purchase?.productName ?? "",
    date: purchase ? formatDate(purchase.date) : "",
    amount: purchase ? formatCurrency(purchase.amountCents, purchase.currency) : "",
    footer: DEFAULT_EMAIL_FOOTER,
  };
}

// ── Customer-facing HTML email wrapper ────────────────────────────────────────
// Differs from notificationEmailHtml: the footer says the email was sent
// because the customer is a contact in this workspace. The bodyHtml is the
// inner content.
export function customerEmailHtml(opts: {
  title: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
}): string {
  const cta =
    opts.ctaText && opts.ctaUrl
      ? `<p style="margin:24px 0 0;"><a href="${opts.ctaUrl}" style="display:inline-block;padding:10px 20px;background:#3b82f6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${opts.ctaText}</a></p>`
      : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${opts.title}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #ececec;">
<tr><td style="background:#3b82f6;padding:24px 32px;color:#ffffff;">
<h1 style="margin:0;font-size:20px;font-weight:700;letter-spacing:-0.3px;">Atur</h1>
</td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${opts.bodyHtml}</p>
${cta}
</td></tr>
<tr><td style="padding:16px 32px;background:#f9fafb;color:#6b7280;font-size:12px;text-align:center;line-height:1.5;">
This email was sent to you because you're a contact in an Atur workspace.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Template rendering ────────────────────────────────────────────────────────
// Pure function: takes a template source (subject + body, e.g. from DB or default)
// and customer context + optional purchase, fills placeholders, returns the
// rendered email.

export function renderFromTemplateSource(
  source: { subject: string; body: string },
  ctx: CustomerContext,
  purchase?: PurchaseInfo | null,
): RenderedEmail {
  const vars = buildTemplateVars(ctx, purchase);
  const subject = fillPlaceholders(source.subject, vars);
  const text = fillPlaceholders(source.body, vars);
  const html = customerEmailHtml({
    title: subject,
    bodyHtml: textToHtml(text),
  });

  return { subject, text, html };
}

// ── Purpose registry ─────────────────────────────────────────────────────────
// A "purpose" is a stage of the CRM customer lifecycle (cold outreach,
// welcome, feedback, follow-up, thank-you, win-back). Purposes live in code:
// each carries a curated default template plus metadata. Workspaces can save
// arbitrary VARIANTS per purpose (crm_email_variants table); one variant per
// (workspace, purpose) can be flagged default. At send time the resolution
// order is: requested variant → default-flagged variant → curated default.

import { emailLayout, escapeHtml } from "./email_layout";

export interface TemplatePurposeDef {
  name: string;
  label: string;
  description: string;
  // Purpose emails that only make sense with the customer's most-recent paid
  // order loaded ({{product}}, {{date}}, {{amount}} filled from Polar data).
  requiresPurchase: boolean;
  default: { subject: string; body: string };
}

export const TEMPLATE_PURPOSES = [
  {
    name: "cold_outreach",
    label: "Cold Outreach",
    description: "First contact to a new lead",
    requiresPurchase: false,
    default: {
      subject: "Quick question, {{name}}",
      body: `Hi {{name}},

I came across {{company}} and thought we might be able to help with what you're building.

Worth a quick chat? Just reply to this email and we'll take it from there.

{{footer}}`,
    },
  },
  {
    name: "welcome",
    label: "Welcome",
    description: "Greet a new customer after signup or first purchase",
    requiresPurchase: false,
    default: {
      subject: "Welcome, {{name}}!",
      body: `Hi {{name}},

Welcome aboard! Great to have you.

If anything comes up — questions, ideas, or things that don't work the way you expect — just reply to this email. We read everything.

{{footer}}`,
    },
  },
  {
    name: "feedback_request",
    label: "Feedback Request",
    description: "Ask how their purchase went",
    requiresPurchase: true,
    default: {
      subject: "How was your experience, {{name}}?",
      body: `Hi {{name}},

We noticed you purchased {{product}} on {{date}}. How was your experience?

We'd love to hear your feedback — what went well, what could be better, or any questions you might have.

Just reply to this email with your thoughts.

{{footer}}`,
    },
  },
  {
    name: "follow_up",
    label: "Follow-up",
    description: "Nudge after no reply, or check in later",
    requiresPurchase: false,
    default: {
      subject: "Following up, {{name}}",
      body: `Hi {{name}},

Just circling back on my last note in case it got buried.

If you have any questions — or if the timing isn't right — a one-line reply is all it takes.

{{footer}}`,
    },
  },
  {
    name: "thank_you",
    label: "Thank You",
    description: "Acknowledge a closed deal or purchase",
    requiresPurchase: true,
    default: {
      subject: "Thank you, {{name}}!",
      body: `Hi {{name}},

Thank you for purchasing {{product}} — it genuinely means a lot.

If you hit any bumps or have questions along the way, just reply here. We're happy to help.

{{footer}}`,
    },
  },
  {
    name: "win_back",
    label: "Win-back",
    description: "Re-engage a churned or quiet customer",
    requiresPurchase: false,
    default: {
      subject: "We miss you, {{name}}",
      body: `Hi {{name}},

It's been a while — we noticed you haven't been around lately.

If something went wrong, we'd love the chance to fix it. If your needs changed, tell us — no hard feelings either way.

Just reply to this email.

{{footer}}`,
    },
  },
] as const satisfies readonly TemplatePurposeDef[];

export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number]["name"];

export function getPurpose(name: string): TemplatePurposeDef | null {
  return TEMPLATE_PURPOSES.find((p) => p.name === name) ?? null;
}

export function isKnownPurpose(name: string): name is TemplatePurpose {
  return getPurpose(name) !== null;
}

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
  { key: "company", label: "Customer company" },
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
    company: ctx.company ?? "",
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
// Pure function: takes a template source (subject + body, e.g. from a variant
// row or curated default) and customer context + optional purchase, fills
// placeholders, returns the rendered email. Plain-text sources are escaped and
// newline-converted; an is_html source is the workspace owner's own markup and
// passes through verbatim (they control their own customer emails, like any
// ESP).

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

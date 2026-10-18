import { z } from "zod";

// Automatic context attached to widget / native reports. Everything here is
// client-supplied and untrusted: bounded by the schema, secrets stripped from
// URLs, and HTML-escaped before it reaches an issue description.

const MAX_EXTRA_KEYS = 30;

export const contextSchema = z.object({
  url: z.string().max(1000).optional(),
  user_agent: z.string().max(500).optional(),
  viewport: z.string().max(30).optional(),
  app_version: z.string().max(64).optional(),
  platform: z.string().max(32).optional(),
  os: z.string().max(64).optional(),
  console_errors: z
    .array(
      z.object({
        message: z.string().max(1000),
        stack: z.string().max(4000).optional(),
        at: z.string().max(40),
      }),
    )
    .max(20)
    .optional(),
  failed_requests: z
    .array(
      z.object({
        method: z.string().max(10),
        url: z.string().max(500),
        status: z.number().int().min(0).max(999),
        at: z.string().max(40),
      }),
    )
    .max(20)
    .optional(),
  extra: z
    .record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean()]))
    .refine((o) => Object.keys(o).length <= MAX_EXTRA_KEYS, "Too many extra keys")
    .optional(),
});

export type FeedbackContext = z.infer<typeof contextSchema>;

const SECRET_PARAM = /token|key|secret|pass|auth|sig|session|code|jwt|credential|bearer|otp/i;

// Drops credentials, fragment and (optionally) the whole query. Query values of
// secret-looking parameters are redacted; the rest are kept so a report still
// shows which page / filter the user was on.
export function redactUrl(raw: string, { keepQuery }: { keepQuery: boolean }): string {
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    u.hash = "";
    if (!keepQuery) {
      u.search = "";
    } else {
      for (const k of new Set(u.searchParams.keys())) {
        if (SECRET_PARAM.test(k)) u.searchParams.set(k, "REDACTED");
      }
    }
    return u.toString();
  } catch {
    // Relative / non-URL string: cut at the first "?" or "#" so no query leaks.
    return raw.split(/[?#]/)[0].slice(0, 500);
  }
}

export function sanitizeContext(ctx: FeedbackContext): FeedbackContext {
  return {
    ...ctx,
    url: ctx.url ? redactUrl(ctx.url, { keepQuery: true }) : undefined,
    failed_requests: ctx.failed_requests?.map((r) => ({
      ...r,
      url: redactUrl(r.url, { keepQuery: false }),
    })),
  };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(label: string, value: string | undefined): string {
  return value ? `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>` : "";
}

// Collapsible block for the issue description (<details> is allowed by the
// description sanitizer).
export function renderContextHtml(ctx: FeedbackContext): string {
  const rows = [
    row("Page", ctx.url),
    row("App version", ctx.app_version),
    row("Platform", [ctx.platform, ctx.os].filter(Boolean).join(" ")),
    row("Viewport", ctx.viewport),
    row("User agent", ctx.user_agent),
    ...Object.entries(ctx.extra ?? {}).map(([k, v]) => row(k, String(v))),
  ].join("");

  const errors = ctx.console_errors?.length
    ? `<p><strong>Console errors (${ctx.console_errors.length})</strong></p><pre><code>${escapeHtml(
        ctx.console_errors
          .map((e) => `[${e.at}] ${e.message}${e.stack ? "\n" + e.stack : ""}`)
          .join("\n\n"),
      )}</code></pre>`
    : "";

  const failed = ctx.failed_requests?.length
    ? `<p><strong>Failed requests (${ctx.failed_requests.length})</strong></p><pre><code>${escapeHtml(
        ctx.failed_requests
          .map(
            (r) =>
              `[${r.at}] ${r.method} ${r.url} → ${r.status === 0 ? "network error" : r.status}`,
          )
          .join("\n"),
      )}</code></pre>`
    : "";

  if (!rows && !errors && !failed) return "";
  return `<details><summary>Context</summary>${
    rows ? `<table><tbody>${rows}</tbody></table>` : ""
  }${errors}${failed}</details>`;
}

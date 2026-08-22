// Shared HTML skeleton for all outbound Atur emails (OTP, notifications,
// CRM customer emails). Pure module — no Workers bindings — so unit tests
// can import it freely.

// Escape HTML special characters for safe text rendering.
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Escape for attribute contexts (href): neutralize quotes too.
export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

export interface EmailLayoutOpts {
  title: string;
  // Inner content, verbatim — callers wrap/escape as appropriate for their
  // body format (plain-text callers should pass <p>-wrapped escaped text).
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  // Small print under the card (why the recipient got this email).
  footerText: string;
}

export function emailLayout(opts: EmailLayoutOpts): string {
  const cta =
    opts.ctaText && opts.ctaUrl
      ? `<p style="margin:24px 0 0;"><a href="${escapeAttr(opts.ctaUrl)}" style="display:inline-block;padding:10px 20px;background:#3b82f6;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(opts.ctaText)}</a></p>`
      : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #ececec;">
<tr><td style="background:#3b82f6;padding:24px 32px;color:#ffffff;">
<h1 style="margin:0;font-size:20px;font-weight:700;letter-spacing:-0.3px;">Atur</h1>
</td></tr>
<tr><td style="padding:32px;">
${opts.bodyHtml}
${cta}
</td></tr>
<tr><td style="padding:16px 32px;background:#f9fafb;color:#6b7280;font-size:12px;text-align:center;line-height:1.5;">
${escapeHtml(opts.footerText)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

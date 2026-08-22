import { EmailMessage } from "cloudflare:email";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { emailLayout } from "./email_layout";

export const OTP_TTL_SECONDS = 600; // 10 minutes
export const OTP_RATE_WINDOW_SECONDS = 900; // 15 minutes
export const OTP_RATE_MAX = 5;

// 6-digit zero-padded code from a CSPRNG.
export function genOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

// SHA-256 hex digest — OTP codes are stored hashed, never in plain text.
export async function hashOtp(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SendResult {
  sent: boolean;
  devCode?: string;
}

export interface NotificationEmail {
  subject: string;
  text: string;
  html: string;
}

// Strip CR/LF from a value used in an RFC822 header line. Template subjects
// are user-editable — a newline there would let a crafted subject inject
// extra headers (e.g. Bcc) into the raw message.
export function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

// Build a multipart/alternative (text + html) RFC822 message for the Cloudflare
// Email binding. Envelope sender must equal the binding's verified_address.
function buildRawEmail(
  fromAddr: string,
  to: string,
  subject: string,
  text: string,
  html: string,
): string {
  const boundary = `atur-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return [
    `From: Atur <${sanitizeHeader(fromAddr)}>`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${sanitizeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    `--${boundary}--`,
  ].join("\r\n");
}

// Send the OTP via the Cloudflare Email `send_email` binding. When the binding
// is absent (e.g. local `wrangler dev` without it) the code is logged and
// returned so the flow is exercisable without a live mail setup.
export async function sendOtpEmail(env: Env, to: string, code: string): Promise<SendResult> {
  // Envelope sender must equal the binding's verified_address.
  const fromAddr = env.EMAIL_FROM || "noreply@diatur.com";

  if (!env.SEND_EMAIL) {
    console.log(`[portal] dev OTP (SEND_EMAIL binding absent) → ${to}: ${code}`);
    return { sent: false, devCode: code };
  }

  const subject = `Your Atur verification code: ${code}`;
  const text = `Your Atur verification code is ${code}.\n\nThis code expires in 10 minutes. If you didn't request it, you can safely ignore this email.`;
  const html = otpEmailHtml(code);
  const raw = buildRawEmail(fromAddr, to, subject, text, html);

  try {
    const msg = new EmailMessage(fromAddr, to, raw);
    await env.SEND_EMAIL.send(msg);
    return { sent: true };
  } catch (err) {
    throw new HTTPException(500, {
      message: `Email send failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// Generic notification email (comment alerts, mentions, due-date reminders).
// Logs and skips when the binding is absent (local dev) — the caller decides
// whether that's a hard failure; notification dispatch treats it as non-fatal.
export async function sendNotificationEmail(
  env: Env,
  to: string,
  email: NotificationEmail,
): Promise<SendResult> {
  const fromAddr = env.EMAIL_FROM || "noreply@diatur.com";

  if (!env.SEND_EMAIL) {
    console.log(`[notify] dev email (SEND_EMAIL binding absent) → ${to}: ${email.subject}`);
    return { sent: false };
  }

  const raw = buildRawEmail(fromAddr, to, email.subject, email.text, email.html);

  try {
    const msg = new EmailMessage(fromAddr, to, raw);
    await env.SEND_EMAIL.send(msg);
    return { sent: true };
  } catch (err) {
    console.error(`[notify] email send failed → ${to}:`, err);
    return { sent: false };
  }
}

// Customer-facing email (CRM communication: feedback requests, follow-ups,
// etc.). Non-fatal when the SEND_EMAIL binding is absent (logged + skipped,
// like sendNotificationEmail).
export async function sendCustomerEmail(
  env: Env,
  to: string,
  email: NotificationEmail,
): Promise<SendResult> {
  return sendNotificationEmail(env, to, email);
}

// Notification email body — inner content wrapped in the shared layout's
// paragraph style. cta renders a button linking back to the app.
export function notificationEmailHtml(opts: {
  title: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
}): string {
  return emailLayout({
    title: opts.title,
    bodyHtml: `<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">${opts.bodyHtml}</p>`,
    ctaText: opts.ctaText,
    ctaUrl: opts.ctaUrl,
    footerText: "You received this email because you follow this issue or were mentioned on Atur.",
  });
}

// The code is rendered as a single contiguous text node — CSS letter-spacing
// gives it the spaced-out one-time-code look, but selecting/copying it yields
// the raw digits ("548936"), not "5 4 8 9 3 6".
function otpEmailHtml(code: string): string {
  const codeBox = `<div style="margin:0 auto;padding:16px 24px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:Menlo,Consolas,monospace;text-align:center;background:#f9fafb;border:1px dashed #9ca3af;border-radius:8px;color:#111827;">${code}</div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Atur verification code</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #ececec;">
<tr><td style="background:#3b82f6;padding:24px 32px;color:#ffffff;">
<h1 style="margin:0;font-size:20px;font-weight:700;letter-spacing:-0.3px;">Atur</h1>
</td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">Hi there,</p>
<p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">Use the verification code below to sign in to your Atur account.</p>
${codeBox}
<p style="margin:24px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
</td></tr>
<tr><td style="padding:16px 32px;background:#f9fafb;color:#6b7280;font-size:12px;text-align:center;line-height:1.5;">
You received this email because someone requested a sign-in code for this address on Atur.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

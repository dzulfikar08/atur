import { EmailMessage } from 'cloudflare:email'
import { HTTPException } from 'hono/http-exception'
import type { Env } from '../lib/env'

export const OTP_TTL_SECONDS = 600 // 10 minutes
export const OTP_RATE_WINDOW_SECONDS = 900 // 15 minutes
export const OTP_RATE_MAX = 5

// 6-digit zero-padded code from a CSPRNG.
export function genOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
  return String(n).padStart(6, '0')
}

// SHA-256 hex digest — OTP codes are stored hashed, never in plain text.
export async function hashOtp(code: string): Promise<string> {
  const data = new TextEncoder().encode(code)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface SendResult {
  sent: boolean
  devCode?: string
}

// Send the OTP via the Cloudflare Email `send_email` binding. When the binding
// is absent (e.g. local `wrangler dev` without it) the code is logged and
// returned so the flow is exercisable without a live mail setup.
export async function sendOtpEmail(env: Env, to: string, code: string): Promise<SendResult> {
  // Envelope sender must equal the binding's verified_address.
  const fromAddr = env.EMAIL_FROM || 'noreply@diatur.com'

  if (!env.SEND_EMAIL) {
    console.log(`[portal] dev OTP (SEND_EMAIL binding absent) → ${to}: ${code}`)
    return { sent: false, devCode: code }
  }

  const subject = `Your Atur verification code: ${code}`
  const html = otpEmailHtml(code)

  // Minimal RFC822 MIME; CRLF line separators.
  const raw = [
    `From: Atur <${fromAddr}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
  ].join('\r\n')

  try {
    const msg = new EmailMessage(fromAddr, to, raw)
    await env.SEND_EMAIL.send(msg)
    return { sent: true }
  } catch (err) {
    throw new HTTPException(500, {
      message: `Email send failed: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

// Table-based layout for maximum email-client compatibility. The code is split
// into individual digits, each in its own pill, so it renders as a clean
// one-time-code entry on any client.
function otpEmailHtml(code: string): string {
  const digits = code.split('').map(
    (d) =>
      `<td align="center" style="width:52px;padding:8px;font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;color:#111827;">${d}</td>`
  )
  const codeTable = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;border-spacing:6px;"><tr>${digits.join('')}</tr></table>`

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
${codeTable}
<p style="margin:24px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
</td></tr>
<tr><td style="padding:16px 32px;background:#f9fafb;color:#6b7280;font-size:12px;text-align:center;line-height:1.5;">
You received this email because someone requested a sign-in code for this address on Atur.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

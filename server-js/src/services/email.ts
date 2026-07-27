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
  const fromAddr = env.EMAIL_FROM || 'support@diatur.com'

  if (!env.SEND_EMAIL) {
    console.log(`[portal] dev OTP (SEND_EMAIL binding absent) → ${to}: ${code}`)
    return { sent: false, devCode: code }
  }

  const subject = `Your Atur support code: ${code}`
  const html =
    `<p>Your verification code is <strong style="font-size:18px;letter-spacing:2px">${code}</strong>.</p>` +
    `<p>It expires in 10 minutes. If you didn't request it, you can ignore this email.</p>`

  // Minimal RFC822 MIME; CRLF line separators.
  const raw = [
    `From: Atur Support <${fromAddr}>`,
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

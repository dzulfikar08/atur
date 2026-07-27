export type Env = {
  DB: D1Database
  R2: R2Bucket
  ASSETS: Fetcher
  RATE_LIMIT?: KVNamespace
  // Cloudflare Email (send_email binding) delivers portal OTP. Absent in local
  // dev → the code is logged + returned in the response instead of being sent.
  SEND_EMAIL?: SendEmail
  EMAIL_FROM?: string
}

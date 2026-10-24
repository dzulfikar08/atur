// ── Polar (payments/CRM import) ──────────────────────────────────────────────
// REST client + webhook signature verification. Credentials are stored
// per-workspace in polar_settings (entered by the user in the Integrations
// page), not in worker env — so every function takes the secret/token as a
// parameter.
//
// Webhooks follow the Standard Webhooks spec: headers webhook-id /
// webhook-timestamp / webhook-signature; signature is HMAC-SHA256 over
// `${id}.${timestamp}.${rawBody}` keyed with the base64-decoded webhook secret.
// https://www.standardwebhooks.com/

export const POLAR_API_BASE = "https://api.polar.sh";
const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

export interface PolarCustomer {
  id: string;
  email: string;
  name: string | null;
  created_at?: string;
  [k: string]: unknown;
}

export interface PolarSubscription {
  id: string;
  status: "active" | "canceled" | "revoked" | "paused" | "past_due" | "incomplete" | "trialing";
  customer: PolarCustomer;
  product: { name: string };
  price_amount: number | null;
  price_currency: string | null;
  current_period_end?: string | null;
  current_period_start?: string | null;
  cancel_at_period_end?: boolean;
  [k: string]: unknown;
}

export interface PolarOrder {
  id: string;
  status: "pending" | "paid" | "refunded" | string;
  billing_reason:
    | "purchase"
    | "subscription_create"
    | "subscription_cycle"
    | "subscription_update"
    | string;
  customer: PolarCustomer;
  product: { name: string };
  net_amount: number | null;
  currency: string | null;
  subscription_id?: string | null;
  created_at?: string;
  [k: string]: unknown;
}

export interface PolarEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  data: T;
  created_at?: string;
}

export class PolarApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "PolarApiError";
  }
}

export interface WebhookHeaders {
  get(name: string): string | null;
}

// Verify a Standard Webhooks signature against the given webhook secret.
// Returns the parsed event, or throws when the signature is invalid, too old,
// or the secret is missing.
export async function verifyWebhookEvent(
  webhookSecret: string | null | undefined,
  rawBody: string,
  headers: WebhookHeaders | Record<string, string>,
): Promise<PolarEvent> {
  if (!webhookSecret) throw new Error("Polar webhook secret is not configured");

  const get = (name: string): string | null => {
    if (typeof headers.get === "function") return headers.get(name);
    // Case-insensitive lookup for plain records.
    const lower = name.toLowerCase();
    const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === lower);
    return entry?.[1] ?? null;
  };

  const id = get("webhook-id");
  const timestamp = get("webhook-timestamp");
  const signatureHeader = get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) {
    throw new Error("Missing webhook signature headers");
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts * 1000) > MAX_WEBHOOK_AGE_MS) {
    throw new Error("Webhook timestamp is stale");
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  // Polar signs with one of two key derivations, both producing a base64
  // HMAC-SHA256: secrets created from 2026-09-08 are Standard Webhooks (key =
  // base64-decoded part after `whsec_`); older ones use the UTF-8 bytes of the
  // whole secret string. Polar's SDKs try both, so do we.
  const keys = [new TextEncoder().encode(webhookSecret.trim())];
  const standardKey = standardWebhooksKey(webhookSecret);
  if (standardKey) keys.unshift(standardKey);
  const expected = await Promise.all(keys.map((key) => hmacSha256Base64(key, signedContent)));

  // Standard Webhooks: the header is space-delimited `v1,<base64>` entries
  // (one per active secret during rotation). Accept if any v1 entry matches.
  const signatures = signatureHeader
    .split(" ")
    .map((entry) => entry.trim().split(","))
    .filter(([version, sig]) => version === "v1" && Boolean(sig))
    .map(([, sig]) => sig);
  const valid = signatures.some((sig) => expected.some((exp) => timingSafeEqual(exp, sig)));
  if (!valid) throw new Error("Invalid webhook signature");

  try {
    return JSON.parse(rawBody) as PolarEvent;
  } catch {
    throw new Error("Webhook body is not valid JSON");
  }
}

// Standard Webhooks secrets are `whsec_<base64>`: the key is the decoded
// payload. Returns null when the remainder is not valid base64.
function standardWebhooksKey(secret: string): Uint8Array | null {
  const b64 = secret.replace(/\s+/g, "").replace(/^whsec_/, "");
  // Tolerate unpadded input (lenient atob implementations reject it).
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  try {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacSha256Base64(key: Uint8Array, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)),
  );
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── REST client (used by the "Sync now" backfill) ──

export async function polarFetch<T>(
  accessToken: string | null | undefined,
  apiUrl: string | null | undefined,
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!accessToken) throw new PolarApiError("Polar access token is not configured", 400);
  const base = apiUrl || POLAR_API_BASE;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PolarApiError(`Polar API ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return (await res.json()) as T;
}

interface PolarListResponse<T> {
  items: T[];
  pagination: { total_count: number; max_page: number };
}

// Walk Polar's page-number pagination (`?page=N&limit=M`, response carries
// `pagination.max_page`) until exhausted. `maxItems` caps total items so a
// huge account can't blow the worker's subrequest budget inside one sync
// request.
export async function polarListAll<T>(
  accessToken: string | null | undefined,
  apiUrl: string | null | undefined,
  path: string,
  limit = 100,
  maxItems = 500,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await polarFetch<PolarListResponse<T>>(
      accessToken,
      apiUrl,
      `${path}${sep}page=${page}&limit=${limit}`,
    );
    out.push(...res.items);
    const maxPage = res.pagination?.max_page ?? page;
    if (page >= maxPage || out.length >= maxItems) break;
  }
  return out;
}

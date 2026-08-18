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
  status:
    | "active"
    | "canceled"
    | "revoked"
    | "paused"
    | "past_due"
    | "incomplete"
    | "trialing";
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

  const secretKey = base64Decode(webhookSecret);
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = await hmacSha256Hex(secretKey, signedContent);

  // Standard Webhooks: the header is `v1,<hex>` — or several of those joined
  // by commas (`v1,<hex>,v1,<hex>`), so after splitting on "," the tokens
  // ALTERNATE version, hex, version, hex… (a token itself never contains a
  // comma). Accept if any v1 signature matches.
  const parts = signatureHeader
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = parts.some((hex, i) => {
    if (i % 2 === 1) return false; // signature slot — already checked at i-1
    const version = parts[i];
    const sig = parts[i + 1];
    if (version !== "v1" || !sig) return false;
    return timingSafeEqualHex(expected, sig);
  });
  if (!valid) throw new Error("Invalid webhook signature");

  try {
    return JSON.parse(rawBody) as PolarEvent;
  } catch {
    throw new Error("Webhook body is not valid JSON");
  }
}

// Base64-decode the secret. Polar/Standard Webhooks secrets are
// `whsec_<base64>` — strip the prefix before decoding (the `_` is not valid
// base64 and would make atob throw on a pasted dashboard secret).
function base64Decode(input: string): Uint8Array {
  const b64 = input.replace(/\s+/g, "").replace(/^whsec_/, "");
  // Tolerate unpadded input (lenient atob implementations reject it).
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSha256Hex(key: Uint8Array, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
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

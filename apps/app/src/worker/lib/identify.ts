// Atur.identify() signatures: hex(HMAC-SHA256(secret, id)). The host app's
// server signs the user id with the board's identify secret; the widget sends
// the result so the email attached to the report can be trusted.

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

// Constant-time on equal-length inputs; length mismatch leaks only the (public)
// expected length of a SHA-256 hex digest.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyIdentitySignature(
  secret: string,
  id: string,
  signature: string | undefined,
): Promise<boolean> {
  if (!signature) return false;
  const expected = await hmacSha256Hex(secret, id);
  return safeEqual(expected, signature.trim().toLowerCase());
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(input)));
}

function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)).buffer as ArrayBuffer);
}

export function newIdentifySecret(): string {
  return "ids_" + randomHex(32);
}

export function newIngestKey(): string {
  return "ik_" + randomHex(24);
}

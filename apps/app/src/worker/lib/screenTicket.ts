// Direct-path screen tickets. The bridge's tailnet listener (apps/bridge/src/
// screen-direct.ts, which documents the format and threat model) accepts only
// a ticket minted here: HMAC-SHA256 keyed with the shared bridge token, valid
// 60 s, single use, scoped to the screen. The token itself never reaches a
// client.
export const SCREEN_TICKET_TTL_MS = 60_000;

const DOMAIN = "atur-screen-ticket-v1\n";

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function mintScreenTicket(
  key: string,
  claims: { sub: string; audit: string; jti: string },
  now = Date.now(),
): Promise<{ ticket: string; expiresAt: number }> {
  const exp = now + SCREEN_TICKET_TTL_MS;
  const enc = new TextEncoder();
  const payload = b64url(enc.encode(JSON.stringify({ v: 1, aud: "screen", ...claims, exp })));
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", hmacKey, enc.encode(DOMAIN + payload));
  return { ticket: `${payload}.${b64url(new Uint8Array(mac))}`, expiresAt: exp };
}

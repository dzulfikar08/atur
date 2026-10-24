import { describe, expect, it } from "vitest";
import { verifyWebhookEvent } from "../polar";

// Reference signer matching the Standard Webhooks scheme Polar uses:
// base64(HMAC-SHA256(key, `${webhook-id}.${webhook-timestamp}.${body}`)) where
// key is the base64-decoded payload of the `whsec_…` secret. Signed with
// WebCrypto (independent of the module's own helpers) as the oracle.
const keyBytes = new TextEncoder().encode("test123");
const rawB64Secret = btoa("test123");
const whsecSecret = `whsec_${rawB64Secret}`;

async function hmacBase64(key: Uint8Array, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

function sign(id: string, ts: number, body: string, key: Uint8Array = keyBytes): Promise<string> {
  return hmacBase64(key, `${id}.${ts}.${body}`);
}

function makeHeaders(id: string, ts: number, signature: string) {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(ts),
    "webhook-signature": signature,
  };
}

const body = JSON.stringify({ id: "evt_1", type: "order.paid", data: {} });

describe("verifyWebhookEvent", () => {
  it("accepts a whsec_-prefixed dashboard secret", async () => {
    const id = "msg_1";
    const ts = Math.floor(Date.now() / 1000);
    const headers = makeHeaders(id, ts, `v1,${await sign(id, ts, body)}`);
    const evt = await verifyWebhookEvent(whsecSecret, body, headers);
    expect(evt.type).toBe("order.paid");
  });

  it("accepts a raw base64 secret (no prefix)", async () => {
    const id = "msg_2";
    const ts = Math.floor(Date.now() / 1000);
    const headers = makeHeaders(id, ts, `v1,${await sign(id, ts, body)}`);
    await expect(verifyWebhookEvent(rawB64Secret, body, headers)).resolves.toMatchObject({
      type: "order.paid",
    });
  });

  it("accepts a multi-signature header when any v1 entry matches", async () => {
    const id = "msg_3";
    const ts = Math.floor(Date.now() / 1000);
    const good = await sign(id, ts, body);
    const bad = btoa("x".repeat(32));
    // Real senders rotate keys: old + new signatures travel space-delimited.
    const headers = makeHeaders(id, ts, `v1,${bad} v1,${good}`);
    await expect(verifyWebhookEvent(whsecSecret, body, headers)).resolves.toMatchObject({
      id: "evt_1",
    });
  });

  it("accepts Polar's legacy signing (key = UTF-8 bytes of the whole secret)", async () => {
    const id = "msg_legacy";
    const ts = Math.floor(Date.now() / 1000);
    const legacyKey = new TextEncoder().encode(whsecSecret);
    const headers = makeHeaders(id, ts, `v1,${await sign(id, ts, body, legacyKey)}`);
    await expect(verifyWebhookEvent(whsecSecret, body, headers)).resolves.toMatchObject({
      id: "evt_1",
    });
  });

  it("rejects a wrong signature", async () => {
    const id = "msg_4";
    const ts = Math.floor(Date.now() / 1000);
    const headers = makeHeaders(id, ts, `v1,${btoa("x".repeat(32))}`);
    await expect(verifyWebhookEvent(whsecSecret, body, headers)).rejects.toThrow(
      "Invalid webhook signature",
    );
  });

  it("rejects an unknown signature version", async () => {
    const id = "msg_5";
    const ts = Math.floor(Date.now() / 1000);
    const headers = makeHeaders(id, ts, `v2,${await sign(id, ts, body)}`);
    await expect(verifyWebhookEvent(whsecSecret, body, headers)).rejects.toThrow(
      "Invalid webhook signature",
    );
  });

  it("rejects a stale timestamp even with a matching signature", async () => {
    const id = "msg_6";
    const staleTs = Math.floor(Date.now() / 1000) - 600;
    const headers = makeHeaders(id, staleTs, `v1,${await sign(id, staleTs, body)}`);
    await expect(verifyWebhookEvent(whsecSecret, body, headers)).rejects.toThrow(
      "Webhook timestamp is stale",
    );
  });

  it("rejects a far-future timestamp even with a matching signature", async () => {
    const id = "msg_7";
    const futureTs = Math.floor(Date.now() / 1000) + 600;
    const headers = makeHeaders(id, futureTs, `v1,${await sign(id, futureTs, body)}`);
    await expect(verifyWebhookEvent(whsecSecret, body, headers)).rejects.toThrow(
      "Webhook timestamp is stale",
    );
  });

  it("rejects when signature headers are missing", async () => {
    await expect(verifyWebhookEvent(whsecSecret, body, {})).rejects.toThrow(
      "Missing webhook signature headers",
    );
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  APPLE_ISSUER,
  AppleAuthError,
  appleSiwaConfig,
  buildAppleClientSecret,
  createAppleJwks,
  verifyAppleIdentityToken,
  type VerifyOptions,
} from "../appleAuth";
import {
  appleClaims,
  createAppleSigner,
  createSiwaKeyPair,
  sha256Hex,
  type AppleTestSigner,
} from "../../test/appleKeys";

const AUDIENCE = "com.diatur.app";
const RAW_NONCE = "raw-nonce-123";
const NOW = Date.parse("2026-10-18T12:00:00Z");
const nowSec = Math.floor(NOW / 1000);

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const json = (v: unknown) => b64url(enc.encode(JSON.stringify(v)));

let key: AppleTestSigner;
let hashedNonce: string;

beforeAll(async () => {
  key = await createAppleSigner("kid-1");
  hashedNonce = await sha256Hex(RAW_NONCE);
});

const sign = (signer: AppleTestSigner, claims: object, header?: object) =>
  signer.sign(claims, header);

const goodClaims = () =>
  appleClaims(
    hashedNonce,
    { sub: "001234.abcdef.5678", email: "Person@Example.com", is_private_email: false },
    nowSec,
  );

const verify = (token: string, over: Partial<VerifyOptions> = {}) =>
  verifyAppleIdentityToken(token, {
    audience: AUDIENCE,
    rawNonce: RAW_NONCE,
    jwks: createAppleJwks(async () => [key.jwk]),
    now: () => NOW,
    ...over,
  });

const rejection = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppleAuthError);
  return err as AppleAuthError;
};

describe("verifyAppleIdentityToken", () => {
  it("accepts a token signed by a published key and returns the identity", async () => {
    const identity = await verify(await sign(key, goodClaims()));
    expect(identity).toEqual({
      sub: "001234.abcdef.5678",
      email: "person@example.com",
      emailVerified: true,
      isPrivateEmail: false,
    });
  });

  it("accepts an audience array containing the bundle id, and boolean email_verified", async () => {
    const token = await sign(key, {
      ...goodClaims(),
      aud: ["other", AUDIENCE],
      email_verified: true,
    });
    expect((await verify(token)).emailVerified).toBe(true);
  });

  it("rejects the wrong audience", async () => {
    const token = await sign(key, { ...goodClaims(), aud: "com.someone.else" });
    expect((await rejection(verify(token))).code).toBe("invalid_token");
  });

  it("rejects the wrong issuer", async () => {
    const token = await sign(key, { ...goodClaims(), iss: "https://evil.example.com" });
    expect((await rejection(verify(token))).code).toBe("invalid_token");
  });

  it("rejects an expired token", async () => {
    const token = await sign(key, { ...goodClaims(), exp: nowSec - 1 });
    expect((await rejection(verify(token))).code).toBe("invalid_token");
  });

  it("rejects an iat far in the future", async () => {
    const token = await sign(key, { ...goodClaims(), iat: nowSec + 3600 });
    expect((await rejection(verify(token))).code).toBe("invalid_token");
  });

  it("rejects a nonce that does not match the raw nonce", async () => {
    const token = await sign(key, goodClaims());
    expect((await rejection(verify(token, { rawNonce: "someone-elses-nonce" }))).code).toBe(
      "invalid_nonce",
    );
  });

  it("rejects the un-hashed nonce in the claim (the claim must be the SHA-256)", async () => {
    const token = await sign(key, { ...goodClaims(), nonce: RAW_NONCE });
    expect((await rejection(verify(token))).code).toBe("invalid_nonce");
  });

  it("rejects a token without a nonce claim", async () => {
    const { nonce: _nonce, ...claims } = goodClaims();
    const token = await sign(key, claims);
    expect((await rejection(verify(token))).code).toBe("invalid_nonce");
  });

  it("rejects a token signed by a different key under the same kid", async () => {
    const attacker = await createAppleSigner("kid-1");
    const token = await sign(attacker, goodClaims());
    expect((await rejection(verify(token))).code).toBe("invalid_token");
  });

  it("rejects a tampered payload", async () => {
    const token = await sign(key, goodClaims());
    const [h, , s] = token.split(".");
    const forged = `${h}.${json({ ...goodClaims(), sub: "someone-else" })}.${s}`;
    expect((await rejection(verify(forged))).code).toBe("invalid_token");
  });

  it("rejects alg=none and non-RS256 headers", async () => {
    const claims = json(goodClaims());
    const none = `${json({ alg: "none", kid: "kid-1" })}.${claims}.`;
    expect((await rejection(verify(none))).code).toBe("invalid_token");
    const hs = await sign(key, goodClaims(), { alg: "HS256", kid: "kid-1" });
    expect((await rejection(verify(hs))).code).toBe("invalid_token");
  });

  it("rejects an unknown kid and malformed tokens", async () => {
    const token = await sign(key, goodClaims(), { alg: "RS256", kid: "nope" });
    expect((await rejection(verify(token))).code).toBe("invalid_token");
    expect((await rejection(verify("not-a-jwt"))).code).toBe("invalid_token");
    expect((await rejection(verify("a.b.c"))).code).toBe("invalid_token");
  });

  it("surfaces an unreachable JWKS endpoint as jwks_unavailable", async () => {
    const token = await sign(key, goodClaims());
    const jwks = createAppleJwks(async () => {
      throw new AppleAuthError("jwks_unavailable", "down");
    });
    expect((await rejection(verify(token, { jwks }))).code).toBe("jwks_unavailable");
  });
});

describe("createAppleJwks", () => {
  it("fetches once and serves later lookups from cache", async () => {
    const fetchKeys = vi.fn(async () => [key.jwk]);
    const jwks = createAppleJwks(fetchKeys, () => NOW);
    await jwks.key("kid-1");
    await jwks.key("kid-1");
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  it("refetches an unknown kid, but not more than once a minute", async () => {
    let t = NOW;
    const fetchKeys = vi.fn(async () => [key.jwk]);
    const jwks = createAppleJwks(fetchKeys, () => t);
    expect(await jwks.key("rotated")).toBeNull();
    expect(await jwks.key("rotated")).toBeNull();
    expect(fetchKeys).toHaveBeenCalledTimes(1);
    t += 61_000;
    expect(await jwks.key("rotated")).toBeNull();
    expect(fetchKeys).toHaveBeenCalledTimes(2);
  });

  it("refetches after the 1h TTL", async () => {
    let t = NOW;
    const fetchKeys = vi.fn(async () => [key.jwk]);
    const jwks = createAppleJwks(fetchKeys, () => t);
    await jwks.key("kid-1");
    t += 61 * 60 * 1000;
    await jwks.key("kid-1");
    expect(fetchKeys).toHaveBeenCalledTimes(2);
  });
});

describe("Sign in with Apple client secret", () => {
  it("is configured only when team, key id and private key are all set", () => {
    expect(appleSiwaConfig({})).toBeNull();
    expect(appleSiwaConfig({ APPLE_TEAM_ID: "T", APPLE_SIWA_KEY_ID: "K" })).toBeNull();
    expect(
      appleSiwaConfig({ APPLE_TEAM_ID: "T", APPLE_SIWA_KEY_ID: "K", APPLE_SIWA_PRIVATE_KEY: "P" }),
    ).toEqual({ teamId: "T", keyId: "K", privateKeyPem: "P", clientId: AUDIENCE });
  });

  it("builds an ES256 JWT that verifies against the key's public half", async () => {
    const { publicKey, pem } = await createSiwaKeyPair();
    const secret = await buildAppleClientSecret(
      { teamId: "TEAM", keyId: "KEY", privateKeyPem: pem, clientId: AUDIENCE },
      NOW,
    );
    const [h, p, s] = secret.split(".") as [string, string, string];
    const pad = (x: string) =>
      x
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(x.length / 4) * 4, "=");
    const decode = (x: string) => JSON.parse(atob(pad(x)));
    expect(decode(h)).toEqual({ alg: "ES256", kid: "KEY", typ: "JWT" });
    expect(decode(p)).toMatchObject({ iss: "TEAM", sub: AUDIENCE, aud: APPLE_ISSUER, iat: nowSec });
    const sig = Uint8Array.from(atob(pad(s)), (c) => c.charCodeAt(0));
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        sig,
        enc.encode(`${h}.${p}`),
      ),
    ).toBe(true);
  });
});

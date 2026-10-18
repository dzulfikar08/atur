// Test-only key material for Sign in with Apple: an RSA signer standing in for
// Apple's identity-token key, and an EC .p8 stand-in for the client-secret key.

import { APPLE_ISSUER, type AppleJwk } from "../lib/appleAuth";

const enc = new TextEncoder();

export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const json = (v: unknown) => b64url(enc.encode(JSON.stringify(v)));

export async function sha256Hex(s: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type AppleTestSigner = {
  kid: string;
  jwk: AppleJwk;
  sign(claims: object, header?: object): Promise<string>;
};

/** A throwaway RSA key pair that signs RS256 JWTs and publishes its JWK. */
export async function createAppleSigner(kid: string): Promise<AppleTestSigner> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid };
  return {
    kid,
    jwk,
    async sign(claims, header = { alg: "RS256", kid }) {
      const input = `${json(header)}.${json(claims)}`;
      const sig = new Uint8Array(
        await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, enc.encode(input)),
      );
      return `${input}.${b64url(sig)}`;
    },
  };
}

/** Claims of a well-formed identity token; override per test. */
export function appleClaims(
  hashedNonce: string,
  over: Record<string, unknown> = {},
  nowSec = Math.floor(Date.now() / 1000),
) {
  return {
    iss: APPLE_ISSUER,
    aud: "com.diatur.app",
    sub: "apple-sub-1",
    iat: nowSec - 10,
    exp: nowSec + 600,
    nonce: hashedNonce,
    email: "apple.user@example.com",
    email_verified: "true",
    ...over,
  };
}

/** A fresh EC P-256 key as the PKCS#8 PEM Apple hands out in a .p8 file. */
export async function createSiwaKeyPair() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  return {
    publicKey: pair.publicKey,
    pem: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----`,
  };
}

/** Env bindings that switch on code redemption + revocation. */
export async function siwaEnv() {
  return {
    APPLE_TEAM_ID: "TEAM",
    APPLE_SIWA_KEY_ID: "KEY",
    APPLE_SIWA_PRIVATE_KEY: (await createSiwaKeyPair()).pem,
  };
}

import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { api } from "@/lib/api";
import { SERVER_URL } from "@/lib/config";
import { startSession } from "@/lib/session";

// The worker hard-codes this as the native OAuth return target
// (routes/auth.ts); app.json registers the `atur` scheme.
const CALLBACK_URL = "atur://auth/callback";

const toBase64Url = (base64: string) =>
  base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Google sign-in for the native app (RFC 8252 + PKCE): the browser leg runs
 * the worker's normal Google flow, which hands back a one-time code on
 * atur://; only this process holds the verifier that redeems it, so another
 * app catching the deep link gets nothing usable.
 *
 * Returns null when the user closes the browser; throws on a server error.
 */
export async function signInWithGoogle(): Promise<"ok" | null> {
  const verifier = toBase64Url(btoa(String.fromCharCode(...Crypto.getRandomBytes(32))));
  const challenge = toBase64Url(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );

  const result = await WebBrowser.openAuthSessionAsync(
    `${SERVER_URL}/auth/google?native_challenge=${challenge}`,
    CALLBACK_URL,
  );
  if (result.type !== "success") return null;

  // RN's URL polyfill has no searchParams; expo-linking parses deep links.
  const params = Linking.parse(result.url).queryParams ?? {};
  const pick = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);
  const error = pick("error_description") ?? pick("error");
  if (error) throw new Error(error);
  const code = pick("code");
  if (!code) throw new Error("Google sign-in returned no code.");

  const { session_token } = await api.exchangeNativeCode(code, verifier);
  await startSession(session_token);
  return "ok";
}

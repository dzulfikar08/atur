import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import { request } from "@/lib/api";
import { startSession } from "@/lib/session";

/** Sign in with Apple exists on iOS 13+ only (never Android or web). */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Native Sign in with Apple. The OS sheet returns a signed identity token; the
 * worker verifies it (POST /auth/apple/native) and answers with the usual
 * session token. Apple embeds SHA-256(nonce) in the token, so the server only
 * accepts it together with the raw nonce generated here.
 *
 * Returns null when the user dismisses the sheet; throws on any other failure.
 */
export async function signInWithApple(): Promise<"ok" | null> {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (e) {
    const code = typeof e === "object" && e !== null && "code" in e ? e.code : undefined;
    if (code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED") return null;
    throw new Error("Sign in with Apple failed. Please try again.");
  }
  if (!credential.identityToken) throw new Error("Apple didn't return a sign-in token.");

  // Apple reveals the name on the very first authorization only, and it is not
  // inside the identity token — pass it along while we have it.
  const { givenName, familyName } = credential.fullName ?? {};
  const { session_token } = await request<{ session_token: string }>("/auth/apple/native", {
    method: "POST",
    body: {
      identity_token: credential.identityToken,
      nonce: rawNonce,
      authorization_code: credential.authorizationCode ?? undefined,
      full_name: givenName || familyName ? { given: givenName, family: familyName } : undefined,
    },
  });
  await startSession(session_token);
  return "ok";
}

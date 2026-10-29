import type { SessionStatus } from "@/lib/session";

/** Where the app opens: the account's screens, the sign-in screen or the Direct area. */
export type StartArea = "wait" | "app" | "login" | "direct";

/**
 * Which area to open at launch. Signed in: the app as always. Signed out: the Direct area when a
 * computer is already paired (the phone works without an account), the sign-in screen otherwise.
 */
export function startRoute(input: { status: SessionStatus; hasCredential: boolean }): StartArea {
  if (input.status === "loading") return "wait";
  if (input.status === "authed") return "app";
  return input.hasCredential ? "direct" : "login";
}

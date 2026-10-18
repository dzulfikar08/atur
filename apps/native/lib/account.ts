import { request } from "@/lib/api";
import { endSession } from "@/lib/session";

/** The word the user types to confirm; the server requires the same string. */
export const DELETE_CONFIRMATION = "DELETE";

/** Public page describing deletion, for the "can't sign in" fallback. */
export const DELETE_ACCOUNT_INFO_URL = "https://diatur.com/privacy#delete-account";

/**
 * Permanently deletes the signed-in account (App Store 5.1.1(v), Play account
 * deletion policy). The server revokes every session, so on success the local
 * session is dropped too, which returns the app to the login screen.
 */
export async function deleteAccount(): Promise<void> {
  await request<{ ok: true }>("/api/users/me", {
    method: "DELETE",
    body: { confirm: DELETE_CONFIRMATION },
  });
  await endSession();
}

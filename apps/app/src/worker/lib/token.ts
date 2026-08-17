// Opaque session token utilities.
// Tokens are random 32-byte base64 (standard, no pad) strings persisted in
// users.token and looked up per-request.

export interface AuthUser {
  sub: string;
  email?: string;
  displayName?: string | null;
  avatar?: string | null;
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, "");
}

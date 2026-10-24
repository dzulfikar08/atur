// Opaque session token utilities.
// Tokens are random 32-byte base64 (standard, no pad) strings. Only their
// SHA-256 is persisted (user_sessions.token_hash); legacy sessions kept the raw
// value in users.token.

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

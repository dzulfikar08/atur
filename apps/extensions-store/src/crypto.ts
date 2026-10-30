const encoder = new TextEncoder();

function base64Bytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

/** Constant-time string comparison (hash both sides so length is not leaked either). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] as number) ^ (y[i] as number);
  return diff === 0;
}

/**
 * Verifies a plain Ed25519 signature (64 raw bytes, standard base64) over `data`
 * against a raw 32-byte base64 public key.
 */
export async function verifyEd25519(
  publicKey: string,
  signature: string,
  data: ArrayBuffer | Uint8Array,
): Promise<boolean> {
  const keyBytes = base64Bytes(publicKey);
  const signatureBytes = base64Bytes(signature);
  if (keyBytes?.length !== 32 || signatureBytes?.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes as BufferSource,
      data as BufferSource,
    );
  } catch {
    return false;
  }
}

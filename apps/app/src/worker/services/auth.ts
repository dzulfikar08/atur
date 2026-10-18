import { z } from "zod";
import type { DbClient } from "../db/index";
import { hashPassword, comparePassword } from "../lib/password";
import { generateToken } from "../lib/token";
import { rateLimit } from "../lib/rateLimit";
import type { Env } from "../lib/env";
import {
  genOtp,
  hashOtp,
  sendOtpEmail,
  OTP_TTL_SECONDS,
  OTP_RATE_WINDOW_SECONDS,
  OTP_RATE_MAX,
} from "./email";
import * as usersRepo from "../repositories/users";
import { sessionExpiryISO } from "../lib/session";
import { HTTPException } from "hono/http-exception";

export const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2).max(50),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function register(db: DbClient, data: z.infer<typeof registerSchema>) {
  const existing = await usersRepo.findByEmail(db, data.email);
  if (existing) {
    throw new HTTPException(409, { message: "Email already registered" });
  }
  const passwordHash = await hashPassword(data.password);
  const token = generateToken();
  const user = await usersRepo.createUser(db, {
    email: data.email,
    username: data.username,
    passwordHash,
    token,
    sessionExpiresAt: sessionExpiryISO(),
  });
  if (!user) throw new HTTPException(500, { message: "Failed to create user" });
  return { user: { id: user.id, email: user.email, username: user.username }, token };
}

export async function login(db: DbClient, data: z.infer<typeof loginSchema>) {
  const user = await usersRepo.findByEmail(db, data.email);
  if (!user || !user.passwordHash || !user.isActive || user.deletedAt) {
    throw new HTTPException(401, { message: "Invalid email or password" });
  }
  const valid = await comparePassword(data.password, user.passwordHash);
  if (!valid) {
    throw new HTTPException(401, { message: "Invalid email or password" });
  }
  const token = await rotateSession(db, user.id);
  return { user: { id: user.id, email: user.email, username: user.username }, token };
}

// The session-mint invariant in one place: fresh opaque token + 24h sliding
// expiry (see lib/session.ts). Every login path (password, OTP, Google) funnels
// through here so session semantics can't drift between them; extra columns
// (e.g. isEmailVerified) ride along on the same write.
export async function rotateSession(
  db: DbClient,
  userId: string,
  extra: Parameters<typeof usersRepo.updateUser>[2] = {},
): Promise<string> {
  const token = generateToken();
  await usersRepo.updateUser(db, userId, {
    token,
    sessionExpiresAt: sessionExpiryISO(),
    ...extra,
  });
  return token;
}

export async function getProfile(db: DbClient, userId: string) {
  const user = await usersRepo.findById(db, userId);
  if (!user) throw new HTTPException(404, { message: "User not found" });
  return { id: user.id, email: user.email, username: user.username };
}

export const requestOtpSchema = z.object({
  email: z.string().email(),
});

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

// KV keys collapse email to lowercase so retries and lookups line up.
function otpStorageKey(email: string) {
  return `auth:otp:${email.toLowerCase()}`;
}
function otpRateKey(email: string) {
  return `auth:otp:rl:${email.toLowerCase()}`;
}

// Derive a unique username from an email's local part. On collision (the bare
// local-part is already taken) append a short random suffix and retry.
export async function usernameFromEmail(db: DbClient, email: string): Promise<string> {
  const base =
    (email.split("@")[0] ?? "user")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 40) || "user";
  let candidate = base;
  for (let i = 0; i < 8; i++) {
    const taken = await usersRepo.findByUsername(db, candidate);
    if (!taken) return candidate;
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 6);
    candidate = `${base}-${suffix}`.slice(0, 50);
  }
  // Near-impossible fallback — fresh randomness keeps it unique-ish.
  const extra = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${base}-${extra}`;
}

// Issue a 6-digit OTP. Always returns { ok: true } — OTP is login AND signup,
// so codes are issued for unknown emails too (the account is created at
// verify). The only silent no-op is a known-but-disabled account. The code is
// stored SHA-256-hashed in KV (TTL-bounded) and emailed via the SEND_EMAIL
// binding; in local dev (no binding) it comes back as dev_code so the flow is
// exercisable without a mail setup.
export async function requestLoginOtp(
  db: DbClient,
  kv: KVNamespace,
  env: Env,
  data: z.infer<typeof requestOtpSchema>,
): Promise<{ ok: true; dev_code?: string }> {
  const allowed = await rateLimit(
    env,
    otpRateKey(data.email),
    OTP_RATE_MAX,
    OTP_RATE_WINDOW_SECONDS,
  );
  if (!allowed) {
    throw new HTTPException(429, { message: "Too many code requests. Try again later." });
  }

  const user = await usersRepo.findByEmail(db, data.email);
  if (user && (!user.isActive || user.deletedAt)) {
    // Known-but-disabled account — silently no-op (response stays uniform ok).
    return { ok: true };
  }

  const code = genOtp();
  const codeHash = await hashOtp(code);
  await kv.put(otpStorageKey(data.email), JSON.stringify({ codeHash }), {
    expirationTtl: OTP_TTL_SECONDS,
  });

  const result = await sendOtpEmail(env, data.email, code);
  return { ok: true, ...(result.devCode ? { dev_code: result.devCode } : {}) };
}

// Verify a 6-digit OTP and establish a session. If no account exists for the
// email, one is created (passwordless) — OTP is both login and signup. The
// stored code is single-use: it is deleted before the hash check so a
// concurrent retry cannot reuse it.
export async function verifyLoginOtp(
  db: DbClient,
  kv: KVNamespace,
  data: z.infer<typeof verifyOtpSchema>,
): Promise<{ user: { id: string; email: string; username: string }; token: string }> {
  const stored = await kv.get(otpStorageKey(data.email));
  if (!stored) {
    throw new HTTPException(401, { message: "Code invalid or expired" });
  }
  const { codeHash } = JSON.parse(stored) as { codeHash: string };
  await kv.delete(otpStorageKey(data.email));
  if ((await hashOtp(data.code)) !== codeHash) {
    throw new HTTPException(401, { message: "Code invalid or expired" });
  }

  const existing = await usersRepo.findByEmail(db, data.email);
  let userId: string;
  let username: string;
  if (existing) {
    if (!existing.isActive || existing.deletedAt) {
      throw new HTTPException(401, { message: "Account is not active" });
    }
    userId = existing.id;
    username = existing.username;
  } else {
    username = await usernameFromEmail(db, data.email);
    const created = await usersRepo.createUser(db, {
      email: data.email,
      username,
      passwordHash: null,
      token: generateToken(),
      sessionExpiresAt: sessionExpiryISO(),
    });
    if (!created) throw new HTTPException(500, { message: "Failed to create user" });
    userId = created.id;
  }

  const token = await rotateSession(db, userId, { isEmailVerified: 1 });
  return { user: { id: userId, email: data.email, username }, token };
}

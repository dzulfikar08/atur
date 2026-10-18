import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { DbClient } from "../db/index";
import type { AppleIdentity } from "../lib/appleAuth";
import { generateToken } from "../lib/token";
import { sessionExpiryISO } from "../lib/session";
import * as usersRepo from "../repositories/users";
import * as accountsRepo from "../repositories/accounts";
import { usernameFromEmail, rotateSession } from "./auth";

const PROVIDER = "apple";

// POST /auth/apple/native body. full_name is only present on a user's very
// first authorization (Apple never repeats it), and it is not in the token.
// authorization_code is optional: when the server holds a Sign in with Apple
// key it is redeemed so the grant can be revoked on account deletion.
export const appleNativeSchema = z.object({
  identity_token: z.string().min(1),
  nonce: z.string().min(1),
  full_name: z
    .object({
      given: z.string().nullish(),
      family: z.string().nullish(),
    })
    .nullish(),
  authorization_code: z.string().min(1).nullish(),
});

export type AppleNativeBody = z.infer<typeof appleNativeSchema>;

export type AppleAuthResult = {
  user: { id: string; email: string; username: string };
  token: string;
};

function fullNameOf(name: AppleNativeBody["full_name"]): string | null {
  const joined = [name?.given, name?.family]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" ");
  return joined || null;
}

function assertActive(user: { isActive: number | null; deletedAt: string | null }) {
  if (!user.isActive || user.deletedAt) {
    throw new HTTPException(403, { message: "Account is not active" });
  }
}

const metadataJson = (identity: AppleIdentity) =>
  JSON.stringify({ email: identity.email, private_email: identity.isPrivateEmail });

// Ladder (same shape as signInWithGoogle): existing link → link by verified
// email → brand-new passwordless user. `refreshToken` is the Apple grant to
// store for revocation, when the server could redeem the authorization code.
export async function signInWithApple(
  db: DbClient,
  identity: AppleIdentity,
  extra: { fullName?: AppleNativeBody["full_name"]; refreshToken?: string | null } = {},
): Promise<AppleAuthResult> {
  const refreshToken = extra.refreshToken ?? null;
  const linked = await accountsRepo.findByProvider(db, PROVIDER, identity.sub);

  if (linked) {
    const user = await usersRepo.findById(db, linked.userId);
    if (!user) throw new HTTPException(403, { message: "Account is not active" });
    assertActive(user);
    if (refreshToken) {
      await accountsRepo
        .updateTokens(db, linked.id, { refreshToken, metadata: metadataJson(identity) })
        .catch(() => {});
    }
    return mintSession(db, user, {});
  }

  const existing = identity.email
    ? await usersRepo.findByEmailCaseInsensitive(db, identity.email)
    : null;
  if (existing && identity.emailVerified) {
    assertActive(existing);
    await accountsRepo.create(db, {
      provider: PROVIDER,
      providerAccountId: identity.sub,
      userId: existing.id,
      refreshToken,
      metadata: metadataJson(identity),
    });
    // Apple verified the address, so the account's email is now verified too.
    return mintSession(db, existing, { isEmailVerified: 1 });
  }

  // Brand-new user. Apple always puts a verified email in the token, but
  // users.email is NOT NULL UNIQUE: if it is absent, or already belongs to an
  // account we may not link to (unverified claim), synthesize one instead of
  // colliding.
  const email = identity.email && !existing ? identity.email : `${identity.sub}@appleid.invalid`;
  const token = generateToken();
  const created = await usersRepo.createUser(db, {
    email,
    username: await usernameFromEmail(db, email),
    passwordHash: null,
    token,
    sessionExpiresAt: sessionExpiryISO(),
    displayName: fullNameOf(extra.fullName),
    avatar: null,
    isEmailVerified: email === identity.email && identity.emailVerified ? 1 : 0,
  });
  if (!created) throw new HTTPException(500, { message: "Failed to create user" });
  await accountsRepo.create(db, {
    provider: PROVIDER,
    providerAccountId: identity.sub,
    userId: created.id,
    refreshToken,
    metadata: metadataJson(identity),
  });
  return {
    user: { id: created.id, email: created.email, username: created.username },
    token,
  };
}

async function mintSession(
  db: DbClient,
  user: { id: string; email: string; username: string },
  extra: Parameters<typeof rotateSession>[2],
): Promise<AppleAuthResult> {
  const token = await rotateSession(db, user.id, extra);
  return { user: { id: user.id, email: user.email, username: user.username }, token };
}

// MCP OAuth 2.1 authorization-server logic: dynamic client registration,
// authorization codes, access/refresh tokens with rotation, revocation.
// Codes and tokens are persisted only as SHA-256 digests (see db/schema.ts).

import { and, eq, gt, isNull, inArray, or } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as usersRepo from "../repositories/users";
import { randomToken } from "../lib/oauth";
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  MAX_REDIRECT_URIS,
  MCP_SCOPE,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TTL_SECONDS,
  sameResource,
  sha256Hex,
  validateRedirectUri,
  verifyPkce,
} from "../lib/mcpOauth";

export class OAuthError extends Error {
  constructor(
    public code: string,
    public description: string,
    public status = 400,
  ) {
    super(description);
  }
}

export type OAuthClient = typeof schema.oauthClients.$inferSelect;

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

// ── Dynamic client registration (RFC 7591) — public clients only ─────────────

const GRANT_TYPES = ["authorization_code", "refresh_token"];

export async function registerClient(
  db: DbClient,
  body: Record<string, unknown>,
): Promise<{ client: OAuthClient; redirectUris: string[] }> {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    throw new OAuthError(
      "invalid_redirect_uri",
      `redirect_uris must be an array of 1-${MAX_REDIRECT_URIS} URIs`,
    );
  }
  for (const uri of uris) {
    const problem = validateRedirectUri(uri);
    if (problem) throw new OAuthError("invalid_redirect_uri", problem);
  }
  const method = body.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    throw new OAuthError(
      "invalid_client_metadata",
      "Only public clients are supported: token_endpoint_auth_method must be 'none'",
    );
  }
  const grants = body.grant_types;
  if (
    grants !== undefined &&
    (!Array.isArray(grants) || grants.some((g) => !GRANT_TYPES.includes(g as string)))
  ) {
    throw new OAuthError(
      "invalid_client_metadata",
      "grant_types must be a subset of authorization_code, refresh_token",
    );
  }
  const responseTypes = body.response_types;
  if (
    responseTypes !== undefined &&
    (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== "code"))
  ) {
    throw new OAuthError("invalid_client_metadata", "response_types must be ['code']");
  }
  const name =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 100)
      : null;

  const redirectUris = [...new Set(uris as string[])];
  const [client] = await db
    .insert(schema.oauthClients)
    .values({
      id: uuid(),
      clientName: name,
      redirectUris: JSON.stringify(redirectUris),
      createdAt: new Date().toISOString(),
    })
    .returning();
  return { client, redirectUris };
}

export async function getClient(
  db: DbClient,
  clientId: string,
): Promise<{ client: OAuthClient; redirectUris: string[] } | null> {
  const [client] = await db
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.id, clientId))
    .limit(1);
  if (!client) return null;
  return { client, redirectUris: JSON.parse(client.redirectUris) as string[] };
}

// ── Authorization codes ──────────────────────────────────────────────────────

export async function createAuthorizationCode(
  db: DbClient,
  input: {
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    resource: string;
  },
): Promise<string> {
  const code = randomToken(32);
  await db.insert(schema.oauthCodes).values({
    codeHash: await sha256Hex(code),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    resource: input.resource,
    scope: MCP_SCOPE,
    expiresAt: Date.now() + CODE_TTL_SECONDS * 1000,
  });
  return code;
}

async function revokeFamily(db: DbClient, familyId: string): Promise<void> {
  await db
    .update(schema.oauthTokens)
    .set({ revokedAt: Date.now() })
    .where(and(eq(schema.oauthTokens.familyId, familyId), isNull(schema.oauthTokens.revokedAt)));
}

async function mintTokens(
  db: DbClient,
  grant: {
    familyId: string;
    clientId: string;
    userId: string;
    resource: string;
    scope: string;
  },
): Promise<TokenResponse> {
  const accessToken = ACCESS_TOKEN_PREFIX + randomToken(32);
  const refreshToken = REFRESH_TOKEN_PREFIX + randomToken(32);
  const now = Date.now();
  await db.insert(schema.oauthTokens).values({
    id: uuid(),
    ...grant,
    accessHash: await sha256Hex(accessToken),
    refreshHash: await sha256Hex(refreshToken),
    accessExpiresAt: now + ACCESS_TTL_SECONDS * 1000,
    refreshExpiresAt: now + REFRESH_TTL_SECONDS * 1000,
    createdAt: now,
  });
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: grant.scope,
  };
}

export async function exchangeAuthorizationCode(
  db: DbClient,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string | undefined;
    resource: string | undefined;
  },
): Promise<TokenResponse> {
  const codeHash = await sha256Hex(input.code);
  const now = Date.now();

  // Claim first, validate second: the single atomic UPDATE makes the code
  // single-use even under concurrent redemption, and a failed verifier burns
  // the code so it cannot be brute-forced.
  const [claimed] = await db
    .update(schema.oauthCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.oauthCodes.codeHash, codeHash), isNull(schema.oauthCodes.usedAt)))
    .returning();

  if (!claimed) {
    // Unknown code, or a replay of an already-redeemed one. On replay, revoke
    // everything minted from it (RFC 6749 §4.1.2 / OAuth 2.1 §4.1.3).
    await revokeFamily(db, codeHash);
    throw new OAuthError("invalid_grant", "Authorization code is invalid or already used");
  }
  if (claimed.expiresAt <= now) {
    throw new OAuthError("invalid_grant", "Authorization code expired");
  }
  if (claimed.clientId !== input.clientId) {
    throw new OAuthError("invalid_grant", "Authorization code was issued to another client");
  }
  if (claimed.redirectUri !== input.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request");
  }
  if (!(await verifyPkce(input.codeVerifier, claimed.codeChallenge))) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }
  if (input.resource !== undefined && !sameResource(input.resource, claimed.resource)) {
    throw new OAuthError("invalid_target", "resource does not match the authorization request");
  }

  return mintTokens(db, {
    familyId: codeHash,
    clientId: claimed.clientId,
    userId: claimed.userId,
    resource: claimed.resource,
    scope: claimed.scope,
  });
}

// ── Refresh with rotation ────────────────────────────────────────────────────

export async function refreshAccessToken(
  db: DbClient,
  input: { refreshToken: string; clientId: string; resource: string | undefined },
): Promise<TokenResponse> {
  const refreshHash = await sha256Hex(input.refreshToken);
  const now = Date.now();

  const [claimed] = await db
    .update(schema.oauthTokens)
    .set({ refreshUsedAt: now })
    .where(
      and(
        eq(schema.oauthTokens.refreshHash, refreshHash),
        eq(schema.oauthTokens.clientId, input.clientId),
        isNull(schema.oauthTokens.refreshUsedAt),
        isNull(schema.oauthTokens.revokedAt),
        gt(schema.oauthTokens.refreshExpiresAt, now),
      ),
    )
    .returning();

  if (!claimed) {
    // A rotated (already used) refresh token being replayed means it leaked:
    // kill the whole chain so neither the thief nor the victim keeps access.
    const [row] = await db
      .select()
      .from(schema.oauthTokens)
      .where(eq(schema.oauthTokens.refreshHash, refreshHash))
      .limit(1);
    if (row && row.clientId === input.clientId && row.refreshUsedAt) {
      await revokeFamily(db, row.familyId);
    }
    throw new OAuthError("invalid_grant", "Refresh token is invalid, expired or already used");
  }
  if (input.resource !== undefined && !sameResource(input.resource, claimed.resource)) {
    throw new OAuthError("invalid_target", "resource does not match the original grant");
  }
  const user = await usersRepo.findById(db, claimed.userId);
  if (!user || !user.isActive || user.deletedAt) {
    throw new OAuthError("invalid_grant", "User is no longer active");
  }

  return mintTokens(db, {
    familyId: claimed.familyId,
    clientId: claimed.clientId,
    userId: claimed.userId,
    resource: claimed.resource,
    scope: claimed.scope,
  });
}

// ── Revocation (RFC 7009) ────────────────────────────────────────────────────

/** Revokes the whole grant the token belongs to. Unknown tokens are a silent no-op. */
export async function revokeToken(db: DbClient, token: string, clientId: string): Promise<void> {
  const hash = await sha256Hex(token);
  const [row] = await db
    .select({ familyId: schema.oauthTokens.familyId, clientId: schema.oauthTokens.clientId })
    .from(schema.oauthTokens)
    .where(or(eq(schema.oauthTokens.accessHash, hash), eq(schema.oauthTokens.refreshHash, hash)))
    .limit(1);
  if (row && row.clientId === clientId) await revokeFamily(db, row.familyId);
}

// ── Resource-server side: validate a bearer access token ─────────────────────

export type ResolvedAccessToken = {
  id: string;
  email: string;
  displayName: string | null;
  avatar: string | null;
};

/**
 * Resolves an OAuth access token to its user. Null for unknown, expired,
 * revoked, rotated-out, wrong-audience or deactivated-user tokens.
 */
export async function resolveAccessToken(
  db: DbClient,
  token: string,
  resource: string,
): Promise<ResolvedAccessToken | null> {
  const [row] = await db
    .select()
    .from(schema.oauthTokens)
    .where(eq(schema.oauthTokens.accessHash, await sha256Hex(token)))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt || row.refreshUsedAt) return null;
  if (row.accessExpiresAt <= Date.now()) return null;
  if (!sameResource(row.resource, resource)) return null;
  const user = await usersRepo.findById(db, row.userId);
  if (!user || !user.isActive || user.deletedAt) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatar: user.avatar,
  };
}

// ── Consent screen data ──────────────────────────────────────────────────────

/** Workspaces (name + slug) the grant will be able to reach: owned or active member. */
export async function listUserWorkspaces(
  db: DbClient,
  userId: string,
): Promise<{ name: string; slug: string }[]> {
  const memberRows = await db
    .select({ id: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.memberId, userId),
        eq(schema.workspaceMembers.isActive, 1),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    );
  const ids = memberRows.map((r) => r.id);
  const visible = ids.length
    ? or(eq(schema.workspaces.ownerId, userId), inArray(schema.workspaces.id, ids))
    : eq(schema.workspaces.ownerId, userId);
  return db
    .select({ name: schema.workspaces.name, slug: schema.workspaces.slug })
    .from(schema.workspaces)
    .where(and(isNull(schema.workspaces.deletedAt), visible));
}

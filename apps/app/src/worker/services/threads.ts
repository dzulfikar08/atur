import { and, desc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import type { Env } from "../lib/env";
import { hmacSha256Hex, safeEqual } from "../lib/identify";
import { nowISO } from "../lib/pagination";
import * as threads from "../lib/threads";
import * as customersRepo from "../repositories/customers";
import * as activitiesService from "./crm_activities";

// The OAuth redirect is an SPA page (it posts the code back to the authed
// connect endpoint), so the URI is the same for every workspace and must be
// registered once in the Meta app's Threads settings.
export const CALLBACK_PATH = "/integrations/threads/callback";

// How many of our latest posts the sync walks for new replies.
const RECENT_POSTS = 10;
// Refresh the 60-day token when it has less than this left.
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// A connect link is good for 15 minutes.
const STATE_TTL_MS = 15 * 60 * 1000;

export type ThreadsAccount = typeof schema.threadsAccounts.$inferSelect;
export type ThreadsInboxItem = typeof schema.threadsInbox.$inferSelect;

function appCredentials(env: Env): { appId: string; appSecret: string } {
  if (!env.THREADS_APP_ID || !env.THREADS_APP_SECRET) {
    throw new HTTPException(503, { message: "Threads is not configured on this server" });
  }
  return { appId: env.THREADS_APP_ID, appSecret: env.THREADS_APP_SECRET };
}

// ── Connect ──────────────────────────────────────────────────────────────────

// state = slug.expiry.hmac(slug.user.expiry): binds the code to the workspace
// and to the member who started the flow, so a leaked callback URL can't
// connect someone else's Threads profile to another workspace.
async function signState(secret: string, slug: string, userId: string, exp: number) {
  return hmacSha256Hex(secret, `${slug}.${userId}.${exp}`);
}

export async function connectUrl(env: Env, origin: string, slug: string, userId: string) {
  const { appId, appSecret } = appCredentials(env);
  const exp = Date.now() + STATE_TTL_MS;
  const state = `${slug}.${exp}.${await signState(appSecret, slug, userId, exp)}`;
  return threads.authorizeUrl(appId, origin + CALLBACK_PATH, state);
}

export async function verifyState(
  secret: string,
  state: string,
  userId: string,
  now = Date.now(),
): Promise<string | null> {
  const parts = state.split(".");
  const sig = parts.pop();
  const exp = Number(parts.pop());
  const slug = parts.join(".");
  if (!slug || !sig || !Number.isFinite(exp) || exp < now) return null;
  return safeEqual(await signState(secret, slug, userId, exp), sig) ? slug : null;
}

export const connectSchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

export async function connect(
  db: DbClient,
  env: Env,
  origin: string,
  workspaceId: string,
  userId: string,
  code: string,
): Promise<ThreadsAccount> {
  const { appId, appSecret } = appCredentials(env);
  // Meta appends "#_" to the code in the redirect.
  const token = await threads.exchangeCode(
    appId,
    appSecret,
    origin + CALLBACK_PATH,
    code.replace(/#_$/, ""),
  );
  const me = await threads.getMe(token.accessToken);
  const now = nowISO();
  const row = {
    workspaceId,
    threadsUserId: me.id,
    username: me.username,
    accessToken: token.accessToken,
    expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    connectedBy: userId,
    lastError: null,
    updatedAt: now,
  };
  await db
    .insert(schema.threadsAccounts)
    .values({ ...row, createdAt: now })
    .onConflictDoUpdate({ target: schema.threadsAccounts.workspaceId, set: row });
  return (await getAccount(db, workspaceId))!;
}

export async function getAccount(db: DbClient, workspaceId: string) {
  const [row] = await db
    .select()
    .from(schema.threadsAccounts)
    .where(eq(schema.threadsAccounts.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function disconnect(db: DbClient, workspaceId: string) {
  await db
    .delete(schema.threadsAccounts)
    .where(eq(schema.threadsAccounts.workspaceId, workspaceId));
}

// The token never leaves the server.
export function publicAccount(account: ThreadsAccount | null) {
  if (!account) return null;
  return {
    username: account.username,
    expiresAt: account.expiresAt,
    lastSyncAt: account.lastSyncAt,
    lastError: account.lastError,
  };
}

// ── Sync ─────────────────────────────────────────────────────────────────────

// Turn Graph posts into inbox rows: our own replies are skipped (they are the
// answers, not the questions), and media already stored is left untouched so
// a rep's triage state survives re-syncs.
export function toInboxRows(
  workspaceId: string,
  ownUsername: string,
  kind: "reply" | "mention",
  posts: threads.ThreadsPost[],
  now: string,
): (typeof schema.threadsInbox.$inferInsert)[] {
  return posts
    .filter((p) => !p.is_reply_owned_by_me && p.username !== ownUsername)
    .map((p) => ({
      id: uuid(),
      workspaceId,
      mediaId: p.id,
      kind,
      username: p.username ?? null,
      text: p.text ?? null,
      permalink: p.permalink ?? null,
      repliedToId: p.replied_to?.id ?? null,
      rootPostId: p.root_post?.id ?? null,
      postedAt: new Date(p.timestamp).toISOString(),
      status: "open",
      createdAt: now,
      updatedAt: now,
    }));
}

async function freshToken(db: DbClient, account: ThreadsAccount): Promise<string> {
  if (Date.parse(account.expiresAt) - Date.now() > REFRESH_WINDOW_MS) return account.accessToken;
  const token = await threads.refreshToken(account.accessToken);
  await db
    .update(schema.threadsAccounts)
    .set({
      accessToken: token.accessToken,
      expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
      updatedAt: nowISO(),
    })
    .where(eq(schema.threadsAccounts.workspaceId, account.workspaceId));
  return token.accessToken;
}

export async function syncAccount(db: DbClient, account: ThreadsAccount): Promise<number> {
  const now = nowISO();
  try {
    const token = await freshToken(db, account);
    const rows = toInboxRows(
      account.workspaceId,
      account.username,
      "mention",
      await threads.listMentions(token, account.threadsUserId),
      now,
    );
    for (const post of await threads.listOwnPosts(token, RECENT_POSTS)) {
      const conversation = await threads.listConversation(token, post.id);
      rows.push(...toInboxRows(account.workspaceId, account.username, "reply", conversation, now));
    }
    let inserted = 0;
    // D1 caps bound parameters per statement; 16 columns × 5 rows stays under.
    for (let i = 0; i < rows.length; i += 5) {
      const res = await db
        .insert(schema.threadsInbox)
        .values(rows.slice(i, i + 5))
        .onConflictDoNothing()
        .returning({ id: schema.threadsInbox.id });
      inserted += res.length;
    }
    await db
      .update(schema.threadsAccounts)
      .set({ lastSyncAt: now, lastError: null, updatedAt: now })
      .where(eq(schema.threadsAccounts.workspaceId, account.workspaceId));
    return inserted;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.threadsAccounts)
      .set({ lastSyncAt: now, lastError: message, updatedAt: now })
      .where(eq(schema.threadsAccounts.workspaceId, account.workspaceId));
    throw e;
  }
}

// Cron entry: every connected workspace, one failure doesn't stop the rest.
export async function syncAll(db: DbClient): Promise<void> {
  const accounts = await db.select().from(schema.threadsAccounts);
  for (const account of accounts) {
    await syncAccount(db, account).catch((e: unknown) => {
      console.error(`threads sync failed for ${account.workspaceId}:`, e);
    });
  }
}

// ── Inbox ────────────────────────────────────────────────────────────────────

export const INBOX_STATUSES = ["open", "done", "hidden"] as const;

export async function listInbox(
  db: DbClient,
  workspaceId: string,
  opts: { status?: string; offset: number; limit: number },
) {
  const where = and(
    eq(schema.threadsInbox.workspaceId, workspaceId),
    opts.status ? eq(schema.threadsInbox.status, opts.status) : undefined,
  );
  const [count] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.threadsInbox)
    .where(where);
  const rows = await db
    .select()
    .from(schema.threadsInbox)
    .where(where)
    .orderBy(desc(schema.threadsInbox.postedAt))
    .offset(opts.offset)
    .limit(opts.limit);
  return { rows, total: count.total };
}

async function getItem(db: DbClient, workspaceId: string, itemId: string) {
  const [item] = await db
    .select()
    .from(schema.threadsInbox)
    .where(
      and(eq(schema.threadsInbox.id, itemId), eq(schema.threadsInbox.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!item) throw new HTTPException(404, { message: "Inbox item not found" });
  return item;
}

async function requireAccount(db: DbClient, workspaceId: string) {
  const account = await getAccount(db, workspaceId);
  if (!account) throw new HTTPException(409, { message: "Connect a Threads account first" });
  return account;
}

async function patchItem(
  db: DbClient,
  itemId: string,
  set: Partial<typeof schema.threadsInbox.$inferInsert>,
): Promise<ThreadsInboxItem> {
  const [row] = await db
    .update(schema.threadsInbox)
    .set({ ...set, updatedAt: nowISO() })
    .where(eq(schema.threadsInbox.id, itemId))
    .returning();
  return row;
}

export const replySchema = z.object({ text: z.string().trim().min(1).max(500) });

export async function reply(
  db: DbClient,
  workspaceId: string,
  itemId: string,
  userId: string,
  text: string,
): Promise<ThreadsInboxItem> {
  const item = await getItem(db, workspaceId, itemId);
  const account = await requireAccount(db, workspaceId);
  const replyMediaId = await threads.publishReply(
    await freshToken(db, account),
    account.threadsUserId,
    item.mediaId,
    text,
  );
  if (item.customerId) {
    await activitiesService.recordActivity(db, workspaceId, {
      customerId: item.customerId,
      type: "MESSAGE",
      subject: "Replied on Threads",
      body: text,
      createdBy: userId,
    });
  }
  return patchItem(db, item.id, { replyMediaId, repliedAt: nowISO(), status: "done" });
}

// Make lead: create (or find) the contact for the author by Threads handle and
// put the post on their timeline.
export async function makeLead(
  db: DbClient,
  workspaceId: string,
  itemId: string,
  userId: string,
): Promise<ThreadsInboxItem> {
  const item = await getItem(db, workspaceId, itemId);
  if (!item.username) throw new HTTPException(422, { message: "This post has no author handle" });
  const contact = await customersRepo.createLead(db, workspaceId, {
    threadsUsername: item.username.toLowerCase(),
    source: "threads",
  });
  if (item.customerId !== contact.id) {
    await activitiesService.recordActivity(db, workspaceId, {
      customerId: contact.id,
      type: "MESSAGE",
      subject: item.kind === "mention" ? "Mentioned us on Threads" : "Replied on Threads",
      body: [item.text, item.permalink].filter(Boolean).join("\n"),
      occurredAt: item.postedAt,
      createdBy: userId,
    });
  }
  return patchItem(db, item.id, { customerId: contact.id });
}

export const statusSchema = z.object({ status: z.enum(["open", "done"]) });

export async function setStatus(
  db: DbClient,
  workspaceId: string,
  itemId: string,
  status: "open" | "done",
): Promise<ThreadsInboxItem> {
  const item = await getItem(db, workspaceId, itemId);
  return patchItem(db, item.id, { status });
}

export async function hide(
  db: DbClient,
  workspaceId: string,
  itemId: string,
): Promise<ThreadsInboxItem> {
  const item = await getItem(db, workspaceId, itemId);
  if (item.kind !== "reply") {
    throw new HTTPException(422, { message: "Only replies on your own posts can be hidden" });
  }
  const account = await requireAccount(db, workspaceId);
  await threads.hideReply(await freshToken(db, account), item.mediaId);
  return patchItem(db, item.id, { status: "hidden" });
}

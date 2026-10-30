// MCP tools about the calling user: whoami, my_issues, my_today, notifications
// and the workspace logo. The Atur Terminal extension only reaches POST /mcp
// (its OAuth tokens are audience-bound to it), so these are thin wrappers over
// the same services the REST routes use (GET /api/me/issues, /api/me/today,
// /api/notifications).
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import type { Env } from "../lib/env";
import * as schema from "../db/schema";
import * as workspaceRepo from "../repositories/workspaces";
import * as assetsService from "./assets";
import { listMyIssues, todayBuckets, toMcpIssueRow, TODAY_BUCKETS } from "./meIssues";
import * as notificationsService from "./notifications";

const ISSUES_PAGE_DEFAULT = 50;
const PAGE_MAX = 100;
const TODAY_BUCKET_CAP = 50;
const LOGO_MAX_BYTES = 200 * 1024;
const LOGO_TYPES: Record<string, true> = {
  "image/png": true,
  "image/jpeg": true,
  "image/webp": true,
  "image/gif": true,
  "image/svg+xml": true,
};

const workspaceProp = {
  type: "string",
  description: "Workspace slug or id",
};
const dateProp = {
  type: "string",
  description: "Caller-local date YYYY-MM-DD (defaults to today in UTC)",
};

export const ME_TOOLS = [
  {
    name: "whoami",
    description: "The authenticated user: { id, email, displayName, avatar }",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "my_issues",
    description:
      "Issues assigned to me across workspaces (or one workspace), newest-updated first. Returns { results, total }.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          ...workspaceProp,
          description: "Workspace slug or id; omit for all workspaces",
        },
        state_key: {
          type: "string",
          description: "Comma-separated canonical state keys, e.g. in_progress,needs_you",
        },
        due: { type: "string", enum: ["overdue", "today", "week"] },
        q: { type: "string", description: "Free-text search over name or key (e.g. DEV-29)" },
        limit: { type: "integer", description: "Default 50, max 100" },
        offset: { type: "integer" },
        today: dateProp,
      },
    },
  },
  {
    name: "my_today",
    description:
      "What I do today: open issues assigned to me (or unassigned in workspaces I own) bucketed into overdue, due_today, needs_you, need_review, in_progress, due_this_week, plus full counts. Each bucket returns at most 50 rows.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { ...workspaceProp, description: "Workspace slug or id, or 'all' (default)" },
        today: dateProp,
      },
    },
  },
  {
    name: "list_notifications",
    description: "My in-app notifications, newest first. Returns { results, total, unread }.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Default 30, max 100" },
        offset: { type: "integer" },
      },
    },
  },
  {
    name: "mark_notification_read",
    description: "Mark one notification read (id) or all of mine read (all: true).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        all: { type: "boolean" },
      },
    },
  },
  {
    name: "get_workspace_logo",
    description:
      "A workspace's logo as a data: URL ({ contentType, dataUrl }); { dataUrl: null } when there is no logo or it is over 200 KB / not a png, jpeg, webp, gif or svg. A logo that is already a public https URL comes back as { logo, dataUrl: null }.",
    inputSchema: {
      type: "object",
      properties: { workspace: { type: "string", description: "Workspace slug" } },
      required: ["workspace"],
    },
  },
];

function intParam(raw: unknown, fallback: number, min: number, max: number) {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

const badRequest = (message: string) => new HTTPException(400, { message });

/** Runs one of the ME_TOOLS other than get_workspace_logo (which needs the MCP workspace resolver). */
export async function handleMeTool(
  db: DbClient,
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
): Promise<unknown> {
  switch (toolName) {
    case "whoami": {
      const [user] = await db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          avatar: schema.users.avatar,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!user) throw new HTTPException(404, { message: "User not found" });
      return user;
    }
    case "my_issues": {
      const due = typeof params.due === "string" ? params.due : undefined;
      if (due !== undefined && due !== "overdue" && due !== "today" && due !== "week") {
        throw badRequest("due must be one of: overdue, today, week");
      }
      const { results, total } = await listMyIssues(db, userId, {
        assignee: "me",
        workspace: typeof params.workspace === "string" ? params.workspace : undefined,
        stateKeys:
          typeof params.state_key === "string"
            ? params.state_key
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean)
            : [],
        due,
        search: typeof params.q === "string" ? params.q : undefined,
        today: typeof params.today === "string" ? params.today : undefined,
        offset: intParam(params.offset, 0, 0, Number.MAX_SAFE_INTEGER),
        limit: intParam(params.limit, ISSUES_PAGE_DEFAULT, 1, PAGE_MAX),
      });
      return { results: results.map(toMcpIssueRow), total };
    }
    case "my_today": {
      const buckets = await todayBuckets(db, userId, {
        workspace: typeof params.workspace === "string" ? params.workspace : undefined,
        today: typeof params.today === "string" ? params.today : undefined,
      });
      const out = { ...buckets };
      for (const bucket of TODAY_BUCKETS) {
        out[bucket] = buckets[bucket].slice(0, TODAY_BUCKET_CAP).map(toMcpIssueRow) as never;
      }
      return out;
    }
    case "list_notifications": {
      const [page, unread] = await Promise.all([
        notificationsService.listForMcp(
          db,
          userId,
          intParam(params.offset, 0, 0, Number.MAX_SAFE_INTEGER),
          intParam(params.limit, 30, 1, PAGE_MAX),
        ),
        notificationsService.unreadCount(db, userId),
      ]);
      return { results: page.results, total: page.total, unread };
    }
    case "mark_notification_read": {
      if (params.all === true) {
        await notificationsService.markAllRead(db, userId);
      } else if (typeof params.id === "string" && params.id) {
        await notificationsService.update(db, params.id, userId, { read: true });
      } else {
        throw badRequest("Pass id (one notification) or all: true");
      }
      return { ok: true };
    }
    default:
      throw new HTTPException(404, { message: `Unknown tool: ${toolName}` });
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const ASSET_PATH = /^\/api\/assets\/([^/?#]+)/;

/**
 * Workspace logo for clients that cannot send auth from `<img>` or read binary
 * bodies. The stored value is `/api/assets/<id>` (an authed route) for uploaded
 * logos; those are read from R2 here and inlined as a data: URL. The caller must
 * already be authorized for `workspaceId`.
 */
export async function workspaceLogo(
  db: DbClient,
  env: Env,
  workspaceId: string,
  origin?: string,
): Promise<{ contentType: string; dataUrl: string } | { logo?: string; dataUrl: null }> {
  const row = await workspaceRepo.findById(db, workspaceId);
  const logo = row?.logo?.trim();
  if (!logo) return { dataUrl: null };

  let assetPath: string | null = null;
  if (logo.startsWith("/")) {
    assetPath = logo;
  } else {
    let url: URL | null = null;
    try {
      url = new URL(logo);
    } catch {
      return { dataUrl: null };
    }
    if (url.protocol !== "https:") return { dataUrl: null };
    // An absolute URL on this deployment is the same authed asset route;
    // anything else that is not an /api/assets path is a public image URL.
    if (origin && url.origin === origin) assetPath = url.pathname;
    else return ASSET_PATH.test(url.pathname) ? { dataUrl: null } : { logo, dataUrl: null };
  }
  const id = ASSET_PATH.exec(assetPath)?.[1];
  if (!id) return { dataUrl: null };

  try {
    const asset = await assetsService.findAsset(db, id);
    const contentType = assetsService.storedContentType(asset.contentType);
    if (!LOGO_TYPES[contentType]) return { dataUrl: null };
    if (asset.size != null && asset.size > LOGO_MAX_BYTES) return { dataUrl: null };
    const { body } = await assetsService.readAsset(env, asset, null);
    const bytes = new Uint8Array(await new Response(body as ReadableStream).arrayBuffer());
    if (bytes.length > LOGO_MAX_BYTES) return { dataUrl: null };
    return { contentType, dataUrl: `data:${contentType};base64,${toBase64(bytes)}` };
  } catch (e) {
    if (e instanceof HTTPException && e.status === 404) return { dataUrl: null };
    throw e;
  }
}

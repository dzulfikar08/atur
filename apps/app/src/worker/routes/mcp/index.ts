import { Hono } from "hono";
import type { Env } from "../../lib/env";
import { getDb } from "../../db/index";
import { mcpAuthMiddleware } from "../../middleware/mcpAuth";
import { nowISO } from "../../lib/pagination";
import { v4 as uuid } from "uuid";
import { HTTPException } from "hono/http-exception";
import { eq, and, desc, isNull, like, or, inArray, asc, sql } from "drizzle-orm";
import * as schema from "../../db/schema";
import * as customersRepo from "../../repositories/customers";
import * as dealsRepo from "../../repositories/deals";
import * as crmService from "../../services/crm";
import * as threadsService from "../../services/threads";
import * as issuesRepo from "../../repositories/issues";
import * as companiesRepo from "../../repositories/companies";
import * as companiesService from "../../services/companies";
import * as factsRepo from "../../repositories/contact_facts";
import * as factsService from "../../services/contact_facts";
import * as activitiesService from "../../services/crm_activities";
import * as workspaceService from "../../services/workspaces";
import * as assetsService from "../../services/assets";
import * as commentsService from "../../services/comments";
import * as issueMoveService from "../../services/issueMove";
import * as projectMoveService from "../../services/projectMove";
import { fieldSettingsSchema, withSettings } from "../../services/customFields";
import * as valuesRepo from "../../repositories/customFieldValues";
import * as workspaceRepo from "../../repositories/workspaces";
import * as linksService from "../../services/workspaceLinks";
import { annotateSlimToolFields, slimResponse } from "./slim";
import { canonicalStateKey } from "../../services/states";
import * as timesheetService from "../../services/timesheet";
import { getIssueFeedback } from "../../services/feedback";

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function ok(id: number | string | null, data: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(data) }] },
  };
}

function err(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export const TOOLS = [
  {
    name: "list_workspaces",
    description: "List all workspaces",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_workspace",
    description: "Create a new workspace (calling user becomes owner and admin member)",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Workspace display name (1-80 chars)" },
        slug: {
          type: "string",
          description: 'URL slug: 1-48 chars, lowercase letters/digits/hyphens (e.g. "my-team")',
        },
        logo: { type: "string" },
        organizationSize: { type: "string" },
        timezone: { type: "string", description: "IANA timezone, defaults to UTC" },
        backgroundColor: { type: "string" },
      },
      required: ["name", "slug"],
    },
  },
  {
    name: "update_workspace",
    description: "Update a workspace's profile (owner or admin only)",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace slug" },
        name: { type: "string" },
        logo: { type: "string" },
        organizationSize: { type: "string" },
        timezone: { type: "string" },
        backgroundColor: { type: "string" },
        // ── Portfolio strategy (DEV-22) — Moat × AI-proof rescore. ──
        moatScore: { type: "integer", minimum: 0, maximum: 5, description: "Moat score 0-5" },
        aiProofScore: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          description: "AI-proofness score 0-5",
        },
        strategyVerdict: {
          type: "string",
          enum: ["invest", "harden", "harvest", "kill", "needs-review"],
        },
        strategyNote: {
          type: "string",
          description: "One-line evidence backing the scores (required discipline)",
        },
      },
      required: ["workspace"],
    },
  },
  {
    name: "list_decisions",
    description:
      "List open decision issues (is_decision=1) across ALL the user's workspaces — the portfolio decision inbox",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "delete_workspace",
    description: "Soft-delete a workspace and hide it from lists (owner or admin only)",
    inputSchema: {
      type: "object",
      properties: { workspace: { type: "string", description: "Workspace slug" } },
      required: ["workspace"],
    },
  },
  {
    name: "list_projects",
    description: "List projects in a workspace",
    inputSchema: {
      type: "object",
      properties: { workspace: { type: "string", description: "Workspace slug" } },
      required: ["workspace"],
    },
  },
  {
    name: "get_project",
    description: "Get a project by ID",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, workspace: { type: "string" } },
      required: ["project_id", "workspace"],
    },
  },
  {
    name: "create_project",
    description: "Create a project",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        name: { type: "string" },
        identifier: { type: "string" },
        description: { type: "string" },
      },
      required: ["workspace", "name", "identifier"],
    },
  },
  {
    name: "list_issues",
    description: "List issues in a project",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        state: { type: "string" },
        state_key: {
          type: "string",
          description:
            "Canonical state key instead of a UUID: backlog|todo|in_progress|needs_you|need_review|done|cancelled",
        },
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
      required: ["project_id", "workspace"],
    },
  },
  {
    name: "create_issue",
    description: "Create an issue",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        name: { type: "string" },
        description_html: { type: "string" },
        priority: { type: "string" },
        state_id: { type: "string" },
        label_ids: { type: "array", items: { type: "string" } },
        assignee_ids: { type: "array", items: { type: "string" } },
        parent_id: {
          type: "string",
          description: "Parent issue UUID to create this as a sub-issue",
        },
        is_decision: {
          type: "boolean",
          description: "Flag as a portfolio-level decision issue (shows in the decision inbox)",
        },
        start_date: { type: "string", description: "YYYY-MM-DD (Gantt start)" },
        target_date: { type: "string", description: "YYYY-MM-DD (due / Gantt end)" },
      },
      required: ["project_id", "workspace", "name"],
    },
  },
  {
    name: "update_issue",
    description: "Update an issue",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
        state_id: { type: "string" },
        priority: { type: "string" },
        name: { type: "string" },
        description_html: { type: "string" },
        is_decision: {
          type: "boolean",
          description: "Flag/unflag as a portfolio-level decision issue",
        },
        start_date: {
          type: ["string", "null"],
          description: "YYYY-MM-DD (Gantt start); null clears",
        },
        target_date: {
          type: ["string", "null"],
          description: "YYYY-MM-DD (due / Gantt end); null clears",
        },
      },
      required: ["project_id", "workspace", "issue_id"],
    },
  },
  {
    name: "move_issue",
    description:
      "Move an issue to another project in the same workspace. Keeps comments, activity, time entries, relations and attachments; assigns the next sequence number of the target project (old key is recorded in the activity trail). State maps to the target's state of the same name/group unless state_id is given; project-scoped labels are remapped by name or dropped; sprint/module/cycle links and custom field values of the old project are removed. Refused while sub-issues remain in the source project (move them first). Returns the slim issue plus previousKey, key and droppedLabels.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Workspace slug" },
        issue_id: { type: "string", description: "Issue UUID to move" },
        target_project_id: { type: "string", description: "Destination project UUID" },
        state_id: {
          type: "string",
          description:
            "Optional state UUID of the TARGET project; default maps the current state by name/group",
        },
      },
      required: ["workspace", "issue_id", "target_project_id"],
    },
  },
  {
    name: "move_project_to_workspace",
    description:
      "Move a whole project to another workspace (owner/admin of BOTH). The project, issues (keys unchanged), comments, activity, time entries, attachments, states, labels, modules, sprints/cycles, custom fields and feedback board come along in one atomic batch. Cross-project links that would span two workspaces are cut and counted in `detached`: sub-issue parents (cleared, activity logged), issue relations, sprint/cycle/module memberships. Workspace-wide labels in use are copied into the target. Optional page_ids move those pages too (pages have no project link). Refused for pipeline projects/deals, support tickets, or an identifier already used in the target.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string", description: "Source workspace slug" },
        project_id: { type: "string", description: "Project UUID to move" },
        target_workspace: { type: "string", description: "Destination workspace slug" },
        page_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional source-workspace page UUIDs that travel with the project",
        },
      },
      required: ["workspace", "project_id", "target_workspace"],
    },
  },
  {
    name: "get_issue",
    description: "Get an issue by ID",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
        sequence_id: { type: "integer" },
      },
      required: ["project_id", "workspace"],
    },
  },
  {
    name: "search_issues",
    description: "Search issues across workspace",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        workspace: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["query", "workspace"],
    },
  },
  {
    name: "delete_issue",
    description: "Delete an issue (soft)",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
      },
      required: ["project_id", "workspace", "issue_id"],
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to an issue",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
        comment_html: { type: "string" },
        access: { type: "string" },
      },
      required: ["project_id", "workspace", "issue_id", "comment_html"],
    },
  },
  {
    name: "list_comments",
    description: "List comments on an issue",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
      },
      required: ["project_id", "workspace", "issue_id"],
    },
  },
  {
    name: "get_issue_feedback",
    description:
      "What a feedback-board / widget / native submission carried: source, kind, reporter, auto-context (page URL, console errors, failed requests, extra) and its attached files (id, filename, content_type, size, url). Fetch a file's bytes (e.g. a .txt log) with GET <url> using the same X-API-Key. 404 when the issue did not come from a feedback submission",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
      },
      required: ["project_id", "workspace", "issue_id"],
    },
  },
  {
    name: "update_comment",
    description: "Update your own comment (comment_html and/or access)",
    inputSchema: {
      type: "object",
      properties: {
        comment_id: { type: "string" },
        comment_html: { type: "string" },
        access: { type: "string" },
      },
      required: ["comment_id"],
    },
  },
  {
    name: "delete_comment",
    description: "Delete your own comment (soft)",
    inputSchema: {
      type: "object",
      properties: { comment_id: { type: "string" } },
      required: ["comment_id"],
    },
  },
  {
    name: "list_states",
    description: "List states for a project",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, workspace: { type: "string" } },
      required: ["project_id", "workspace"],
    },
  },
  {
    name: "list_labels",
    description: "List labels for a project",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, workspace: { type: "string" } },
      required: ["project_id", "workspace"],
    },
  },
  {
    name: "list_members",
    description: "List members of a project",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, workspace: { type: "string" } },
      required: ["project_id", "workspace"],
    },
  },
  {
    name: "list_workspace_members",
    description: "List members of a workspace",
    inputSchema: {
      type: "object",
      properties: { workspace: { type: "string" } },
      required: ["workspace"],
    },
  },
  {
    name: "set_assignee",
    description: "Assign a user to an issue",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
        assignee_id: { type: "string" },
      },
      required: ["project_id", "workspace", "issue_id", "assignee_id"],
    },
  },
  {
    name: "list_sprints",
    description: "List sprints/cycles for a project",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, workspace: { type: "string" } },
      required: ["project_id", "workspace"],
    },
  },
  {
    name: "create_sprint",
    description: "Create a sprint/cycle",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        name: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        description: { type: "string" },
      },
      required: ["project_id", "workspace", "name"],
    },
  },
  {
    name: "get_sprint",
    description: "Get a sprint by ID",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        sprint_id: { type: "string" },
      },
      required: ["project_id", "workspace", "sprint_id"],
    },
  },
  {
    name: "update_sprint",
    description: "Update a sprint",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        sprint_id: { type: "string" },
        name: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
      },
      required: ["project_id", "workspace", "sprint_id"],
    },
  },
  {
    name: "add_issue_to_sprint",
    description: "Add an issue to a sprint",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        sprint_id: { type: "string" },
        issue_id: { type: "string" },
      },
      required: ["project_id", "workspace", "sprint_id", "issue_id"],
    },
  },
  {
    name: "remove_issue_from_sprint",
    description: "Remove an issue from a sprint",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        sprint_id: { type: "string" },
        issue_id: { type: "string" },
      },
      required: ["project_id", "workspace", "sprint_id", "issue_id"],
    },
  },
  {
    name: "get_sprint_progress",
    description: "Get sprint progress",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        sprint_id: { type: "string" },
      },
      required: ["project_id", "workspace", "sprint_id"],
    },
  },
  {
    name: "create_module",
    description:
      "Create a module in a project. ALWAYS pass workspace (slug) and project_id (UUID).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        start_date: { type: "string" },
        target_date: { type: "string" },
      },
      required: ["project_id", "workspace", "name"],
    },
  },
  {
    name: "update_module",
    description:
      "Update a module (name/description/status/dates). ALWAYS pass workspace (slug) and module_id (UUID).",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        module_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        start_date: { type: "string" },
        target_date: { type: "string" },
      },
      required: ["workspace", "module_id"],
    },
  },
  {
    name: "delete_module",
    description:
      "Soft-delete a module (module no longer listed; its issues keep their data). ALWAYS pass workspace (slug) and module_id (UUID).",
    inputSchema: {
      type: "object",
      properties: { workspace: { type: "string" }, module_id: { type: "string" } },
      required: ["workspace", "module_id"],
    },
  },
  {
    name: "create_state",
    description:
      "Create a workflow state in a project (e.g. Need Review). group_name: backlog|started|completed|cancelled. ALWAYS pass workspace (slug) and project_id (UUID).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        name: { type: "string" },
        group_name: { type: "string", enum: ["backlog", "started", "completed", "cancelled"] },
        color: { type: "string" },
        description: { type: "string" },
      },
      required: ["project_id", "workspace", "name", "group_name"],
    },
  },
  {
    name: "list_folders",
    description:
      "List project folders in a workspace (ClickUp-style grouping above projects). ALWAYS pass workspace (slug).",
    inputSchema: {
      type: "object",
      properties: { workspace: { type: "string" } },
      required: ["workspace"],
    },
  },
  {
    name: "create_folder",
    description: "Create a project folder. ALWAYS pass workspace (slug) and name.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        name: { type: "string" },
        color: { type: "string" },
        sort_order: { type: "number" },
      },
      required: ["workspace", "name"],
    },
  },
  {
    name: "update_folder",
    description:
      "Update a folder (name/color/sort_order). ALWAYS pass workspace (slug) and folder_id (UUID).",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        folder_id: { type: "string" },
        name: { type: "string" },
        color: { type: "string" },
        sort_order: { type: "number" },
      },
      required: ["workspace", "folder_id"],
    },
  },
  {
    name: "delete_folder",
    description:
      "Soft-delete a folder (projects keep their data and render under No folder). ALWAYS pass workspace (slug) and folder_id (UUID).",
    inputSchema: {
      type: "object",
      properties: { workspace: { type: "string" }, folder_id: { type: "string" } },
      required: ["workspace", "folder_id"],
    },
  },
  {
    name: "set_project_folder",
    description:
      "Move a project into a folder (or out: pass folder_id null). ALWAYS pass workspace (slug) and project_id (UUID).",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        project_id: { type: "string" },
        folder_id: { type: ["string", "null"] },
      },
      required: ["workspace", "project_id"],
    },
  },
  {
    name: "list_custom_fields",
    description:
      "List custom field definitions for a project (settings includes options/currency). ALWAYS pass workspace (slug) and project_id (UUID).",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, workspace: { type: "string" } },
      required: ["project_id", "workspace"],
    },
  },
  {
    name: "create_custom_field",
    description:
      "Create a custom field on a project. field_type: text|url|number|date|checkbox|select|multi_select|user|currency. Currency fields default to IDR unless settings.currency is set. ALWAYS pass workspace (slug) and project_id (UUID).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        name: { type: "string" },
        field_type: {
          type: "string",
          enum: [
            "text",
            "url",
            "number",
            "date",
            "checkbox",
            "select",
            "multi_select",
            "user",
            "currency",
          ],
        },
        description: { type: "string" },
        is_required: { type: "boolean" },
        settings: { type: "object" },
      },
      required: ["project_id", "workspace", "name", "field_type"],
    },
  },
  {
    name: "set_custom_field_value",
    description:
      'Set one custom field value on an issue. value_json for currency fields: {amount_cents: number, currency: "IDR"}. Pass null to clear. ALWAYS pass workspace (slug), project_id, issue_id and custom_field_id (UUIDs).',
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
        custom_field_id: { type: "string" },
        value_json: {},
      },
      required: ["project_id", "workspace", "issue_id", "custom_field_id"],
    },
  },
  {
    name: "list_modules",
    description: "List modules for a project",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, workspace: { type: "string" } },
      required: ["project_id", "workspace"],
    },
  },
  {
    name: "get_module",
    description: "Get a module by ID",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        module_id: { type: "string" },
      },
      required: ["project_id", "workspace", "module_id"],
    },
  },
  {
    name: "add_issue_to_module",
    description: "Add an issue to a module",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        module_id: { type: "string" },
        issue_id: { type: "string" },
      },
      required: ["project_id", "workspace", "module_id", "issue_id"],
    },
  },
  {
    name: "remove_issue_from_module",
    description: "Remove an issue from a module",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        module_id: { type: "string" },
        issue_id: { type: "string" },
      },
      required: ["project_id", "workspace", "module_id", "issue_id"],
    },
  },
  {
    name: "list_pages",
    description: "List pages in a project",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, workspace: { type: "string" } },
      required: ["project_id", "workspace"],
    },
  },
  {
    name: "get_page",
    description: "Get a page by ID",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        page_id: { type: "string" },
      },
      required: ["project_id", "workspace", "page_id"],
    },
  },
  {
    name: "create_page",
    description: "Create a page",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        name: { type: "string" },
        description_html: { type: "string" },
        access: { type: "integer" },
      },
      required: ["project_id", "workspace", "name"],
    },
  },
  {
    name: "update_page",
    description: "Update a page",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        page_id: { type: "string" },
        name: { type: "string" },
        description_html: { type: "string" },
      },
      required: ["project_id", "workspace", "page_id"],
    },
  },
  {
    name: "upload_image",
    description:
      "Upload an image (or any file) as an asset and get a URL to embed in comments/descriptions. " +
      "This MCP server runs remotely, so it cannot read your local disk: read the file yourself, " +
      "base64-encode the bytes, and pass them as content_base64. Returns { id, url, size, filename }.",
    inputSchema: {
      type: "object",
      properties: {
        content_base64: {
          type: "string",
          description: "File bytes, base64-encoded. A data: URL prefix is tolerated.",
        },
        filename: {
          type: "string",
          description: 'File name, e.g. "evidence.png" — the extension seeds the MIME type.',
        },
        mime_type: {
          type: "string",
          description: "Optional MIME override, e.g. image/png",
        },
        issue_id: {
          type: "string",
          description: "Optional issue UUID to link the asset to (access-checked)",
        },
      },
      required: ["content_base64", "filename"],
    },
  },
  {
    name: "add_issue_relation",
    description: "Add a relation between issues",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
        related_issue_id: { type: "string" },
        relation_type: {
          type: "string",
          enum: ["blocks", "blocked_by", "relates_to", "duplicates"],
        },
      },
      required: ["project_id", "workspace", "issue_id", "related_issue_id", "relation_type"],
    },
  },
  {
    name: "list_issue_relations",
    description: "List relations for an issue",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
      },
      required: ["project_id", "workspace", "issue_id"],
    },
  },
  {
    name: "remove_issue_relation",
    description: "Remove a relation",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        relation_id: { type: "string" },
      },
      required: ["project_id", "workspace", "relation_id"],
    },
  },
  {
    name: "list_time_entries",
    description: "List time entries logged on an issue",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
      },
      required: ["project_id", "workspace", "issue_id"],
    },
  },
  {
    name: "create_time_entry",
    description:
      'Log time on an issue (duration in seconds). AI agents SHOULD pass source="agent" plus agent_name, model and token counts so usage is attributable and KPI-queryable.',
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
        duration_seconds: { type: "integer", description: "Seconds spent" },
        description: { type: "string" },
        source: { type: "string", enum: ["human", "agent"], description: "Default human" },
        agent_name: { type: "string", description: "Agent identifier, e.g. omp/firstmate" },
        model: { type: "string", description: "Model id, e.g. zai/glm-5.3-flash" },
        input_tokens: { type: "integer", description: "Prompt/input tokens" },
        output_tokens: { type: "integer", description: "Completion/output tokens" },
        cache_read_tokens: { type: "integer", description: "Cached input tokens" },
        cache_write_tokens: { type: "integer", description: "Cache-creation tokens" },
        reasoning_tokens: {
          type: "integer",
          description: "Reasoning tokens, if reported separately",
        },
      },
      required: ["project_id", "workspace", "issue_id", "duration_seconds"],
    },
  },
  {
    name: "get_agent_usage",
    description:
      "Agent KPI report for a workspace: token + duration burn per agent/model/issue, with cost_usd rollups when the model has a price row. Use to see where tokens (and money) go and evaluate agent efficiency.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        from: { type: "string", description: "ISO date lower bound (started_at)" },
        to: { type: "string", description: "ISO date upper bound (started_at)" },
        project_id: { type: "string" },
      },
      required: ["workspace"],
    },
  },
  {
    name: "delete_time_entry",
    description: "Delete a time entry on an issue",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        workspace: { type: "string" },
        issue_id: { type: "string" },
        entry_id: { type: "string" },
      },
      required: ["project_id", "workspace", "issue_id", "entry_id"],
    },
  },
  {
    name: "list_contacts",
    description: "List CRM contacts (leads + customers) in a workspace",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        status: { type: "string", enum: ["lead", "active", "churned"] },
        search: { type: "string" },
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
      required: ["workspace"],
    },
  },
  {
    name: "create_contact",
    description:
      "Create a CRM lead/contact (no auth account). Needs email or threads_username (handle, @handle or profile URL); dedupes on either.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        email: { type: "string" },
        threads_username: { type: "string" },
        name: { type: "string" },
        company: { type: "string" },
        phone: { type: "string" },
        source: { type: "string" },
      },
      required: ["workspace"],
    },
  },
  {
    name: "get_contact",
    description: "Get a contact with its deals + tickets",
    inputSchema: {
      type: "object",
      properties: { workspace: { type: "string" }, contact_id: { type: "string" } },
      required: ["workspace", "contact_id"],
    },
  },
  {
    name: "update_contact",
    description:
      "Update a contact (name/company/phone/status/source/email/threads_username). Pass an empty string to clear email or threads_username.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        contact_id: { type: "string" },
        name: { type: "string" },
        company: { type: "string" },
        phone: { type: "string" },
        status: { type: "string", enum: ["lead", "active", "churned"] },
        source: { type: "string" },
        email: { type: "string" },
        threads_username: { type: "string" },
      },
      required: ["workspace", "contact_id"],
    },
  },
  {
    name: "create_deal",
    description: "Create a deal in a sales pipeline (issue + deals side row)",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        project_id: { type: "string" },
        name: { type: "string" },
        customer_id: { type: "string" },
        amount_cents: { type: "integer" },
        currency: { type: "string" },
        expected_close_at: { type: "string" },
        state_id: { type: "string" },
      },
      required: ["workspace", "project_id", "name"],
    },
  },
  {
    name: "list_deals",
    description: "List deals in a pipeline (project)",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        project_id: { type: "string" },
        state_id: { type: "string" },
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
      required: ["workspace", "project_id"],
    },
  },
  {
    name: "move_deal_stage",
    description: "Move a deal to a new pipeline stage (issue state)",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        project_id: { type: "string" },
        issue_id: { type: "string" },
        state_id: { type: "string" },
      },
      required: ["workspace", "project_id", "issue_id", "state_id"],
    },
  },
  {
    name: "update_deal",
    description: "Update a deal (amount/currency/close/customer/name)",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        project_id: { type: "string" },
        issue_id: { type: "string" },
        name: { type: "string" },
        amount_cents: { type: "integer" },
        currency: { type: "string" },
        expected_close_at: { type: "string" },
        customer_id: { type: "string" },
        company_id: { type: "string" },
      },
      required: ["workspace", "project_id", "issue_id"],
    },
  },
  {
    name: "list_companies",
    description: "List companies (accounts) in a workspace",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        search: { type: "string" },
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
      required: ["workspace"],
    },
  },
  {
    name: "create_company",
    description: "Create a company (account) in a workspace",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        name: { type: "string" },
        domain: { type: "string" },
        industry: { type: "string" },
        website: { type: "string" },
        logo_url: { type: "string" },
        brand_color: { type: "string" },
        description: { type: "string" },
      },
      required: ["workspace", "name"],
    },
  },
  {
    name: "get_company",
    description: "Get a company by ID",
    inputSchema: {
      type: "object",
      properties: { workspace: { type: "string" }, company_id: { type: "string" } },
      required: ["workspace", "company_id"],
    },
  },
  {
    name: "update_company",
    description: "Update a company (name/domain/industry/website/description)",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        company_id: { type: "string" },
        name: { type: "string" },
        domain: { type: "string" },
        industry: { type: "string" },
        website: { type: "string" },
        logo_url: { type: "string" },
        brand_color: { type: "string" },
        description: { type: "string" },
      },
      required: ["workspace", "company_id"],
    },
  },
  {
    name: "record_fact",
    description:
      "Record an evidence-led fact about a contact or company. Strong evidence (score >= 1.0 across independent sources) auto-applies to the record; weaker evidence is stored as a PROPOSED suggestion a human can apply/dismiss. Never write contact fields directly — use this.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        customer_id: { type: "string" },
        company_id: { type: "string" },
        field: { type: "string" },
        value: { type: "string" },
        evidence: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source: { type: "string" },
              method: {
                type: "string",
                enum: ["signature", "email_thread", "social", "web_search", "manual", "unknown"],
              },
              url: { type: "string" },
            },
            required: ["source", "method"],
          },
        },
        method: { type: "string" },
        source_url: { type: "string" },
        observed_at: { type: "string" },
      },
      required: ["workspace", "field", "value", "evidence"],
    },
  },
  {
    name: "list_activities",
    description: "List CRM activity timeline entries for a contact or a deal (workspace-scoped)",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        customer_id: { type: "string" },
        deal_id: { type: "string" },
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
      required: ["workspace"],
    },
  },
  {
    name: "log_activity",
    description:
      "Log a timeline entry on a contact by hand: a call, meeting, task, note, email, or MESSAGE (a DM, e.g. a Threads DM follow-up)",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        customer_id: { type: "string" },
        type: { type: "string", enum: ["NOTE", "CALL", "EMAIL", "MEETING", "TASK", "MESSAGE"] },
        subject: { type: "string" },
        body: { type: "string" },
        occurred_at: { type: "string", description: "ISO 8601; defaults to now" },
      },
      required: ["workspace", "customer_id", "type"],
    },
  },
  {
    name: "list_threads_inbox",
    description:
      "List the workspace's Threads inbox: replies to our posts and posts mentioning us (no DMs; the Threads API has none). status: open|done|hidden",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        status: { type: "string", enum: ["open", "done", "hidden"] },
        replied: {
          type: "boolean",
          description:
            "true = we already answered (from Atur or the Threads app), false = needs a reply",
        },
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
      required: ["workspace"],
    },
  },
  {
    name: "reply_threads_item",
    description:
      "Publish a public reply on Threads to an inbox item (max 500 chars) and mark it done. Posts as the connected account; only do this when the human approved the text.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        item_id: { type: "string" },
        text: { type: "string" },
      },
      required: ["workspace", "item_id", "text"],
    },
  },
  {
    name: "make_threads_lead",
    description:
      "Create or link the CRM contact for a Threads inbox item's author (deduped on threads_username) and log the post on their timeline",
    inputSchema: {
      type: "object",
      properties: { workspace: { type: "string" }, item_id: { type: "string" } },
      required: ["workspace", "item_id"],
    },
  },
  {
    name: "list_facts",
    description: "List evidence facts for a contact or company",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        customer_id: { type: "string" },
        company_id: { type: "string" },
        status: { type: "string", enum: ["PROPOSED", "APPLIED", "DISMISSED", "SUPERSEDED"] },
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
      required: ["workspace"],
    },
  },
  {
    name: "get_workspace_links",
    description:
      "Control-plane binding for a workspace: GitHub repo(s), local checkout path, default branch, terminal workspace (herdr_workspace: the herdr workspace or Atur Terminal project name). Pass workspace for one binding (membership required) or omit it to list all bindings",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
      },
    },
  },
  {
    name: "set_workspace_link",
    description:
      "Create or update a workspace binding (repo_urls, local_path, default_branch, herdr_workspace = herdr workspace or Atur Terminal project name, notes, mode, auto_merge). Pass null to clear a field. mode: 'local-only' (default) or 'direct-PR'; auto_merge: 'yolo' lets the agent merge its own PR after green gates. Owner-or-admin only",
    inputSchema: {
      type: "object",
      properties: {
        workspace: { type: "string" },
        repo_urls: { type: "array", items: { type: "string" } },
        local_path: { type: "string" },
        default_branch: { type: "string" },
        herdr_workspace: { type: "string" },
        notes: { type: "string" },
        mode: { type: "string", enum: ["local-only", "direct-PR"] },
        auto_merge: { type: "string", enum: ["yolo"] },
      },
      required: ["workspace"],
    },
  },
];

// Advertise the default-on slim/include arguments in tools/list — one source
// of truth with the response projection in ./slim.
annotateSlimToolFields(TOOLS);

async function getWorkspaceId(db: ReturnType<typeof getDb>, slug: string, userId?: string) {
  // Slugs are the canonical identifier; workspace display names are accepted as
  // a convenience fallback so callers don't have to remember the slug.
  let [ws] = await db
    .select({ id: schema.workspaces.id, ownerId: schema.workspaces.ownerId })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.slug, slug), isNull(schema.workspaces.deletedAt)))
    .limit(1);
  if (!ws) {
    // Names are not unique — prefer an exact-case match, else a
    // case-insensitive exact match among active workspaces. Uses lower()
    // rather than LIKE so names containing % or _ can't wildcard-match.
    [ws] = await db
      .select({ id: schema.workspaces.id, ownerId: schema.workspaces.ownerId })
      .from(schema.workspaces)
      .where(
        and(
          or(
            eq(schema.workspaces.name, slug),
            sql`lower(${schema.workspaces.name}) = lower(${slug})`,
          ),
          isNull(schema.workspaces.deletedAt),
        ),
      )
      .orderBy(asc(schema.workspaces.createdAt))
      .limit(1);
  }
  if (!ws) throw new HTTPException(404, { message: `Workspace "${slug}" not found` });
  if (userId) {
    const ok = ws.ownerId === userId || (await isWorkspaceMember(db, ws.id, userId));
    if (!ok) throw new HTTPException(403, { message: "Not a member of this workspace" });
  }
  return ws.id;
}

async function isWorkspaceMember(
  db: ReturnType<typeof getDb>,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [m] = await db
    .select({ id: schema.workspaceMembers.id })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.memberId, userId),
        eq(schema.workspaceMembers.isActive, 1),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  return !!m;
}

// MCP mirror of requireWorkspaceAdmin (middleware/workspace.ts): workspace
// mutations (rename, settings, delete) are owner-or-admin only. Run after
// getWorkspaceId, which has already proven active membership — this adds the
// role gate on top: owner, or an ACTIVE member with role >= 20. Suspended
// members (isActive = 0) are denied even with an admin role.
async function assertWorkspaceAdmin(
  db: ReturnType<typeof getDb>,
  workspaceId: string,
  userId: string,
) {
  const [ws] = await db
    .select({ ownerId: schema.workspaces.ownerId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  if (ws.ownerId === userId) return;
  const [m] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.memberId, userId),
        eq(schema.workspaceMembers.isActive, 1),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  if (!m || m.role < 20) {
    throw new HTTPException(403, {
      message: "Only the workspace owner or an admin can perform this action",
    });
  }
}

// Gate project-scoped tools: resolve project -> workspace, then require the
// user be that workspace's owner or an active member.
async function assertProjectAccess(
  db: ReturnType<typeof getDb>,
  projectId: string,
  userId: string,
) {
  const [proj] = await db
    .select({ workspaceId: schema.projects.workspaceId })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)))
    .limit(1);
  if (!proj) throw new HTTPException(404, { message: "Project not found" });
  const [ws] = await db
    .select({ ownerId: schema.workspaces.ownerId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, proj.workspaceId))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  const ok = ws.ownerId === userId || (await isWorkspaceMember(db, proj.workspaceId, userId));
  if (!ok) throw new HTTPException(403, { message: "Not a member of this workspace" });
}

// Bind a client-supplied project to the workspace a tool already resolved +
// membership-checked. assertProjectAccess alone is not enough for creates:
// it only proves the caller is a member of the project's OWN workspace, so a
// member of ws A naming workspace A with ws B's project_id would pass and
// mint rows attached to the foreign project. This requires the project to
// actually live in the named workspace (404 otherwise — same as the HTTP
// routes' requireWorkspaceProject).
async function assertProjectInWorkspace(
  db: ReturnType<typeof getDb>,
  projectId: string,
  workspaceId: string,
) {
  const [proj] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.workspaceId, workspaceId),
        isNull(schema.projects.deletedAt),
      ),
    )
    .limit(1);
  if (!proj) throw new HTTPException(404, { message: "Project not found" });
}

// Bind client-supplied state/label/assignee ids to the workspace a tool call
// already resolved + membership-checked. Without this a member of ws A could
// attach ws B's state or label UUIDs to their own issues — cross-workspace
// linkage plus name leaks through the returned rows and activity trail.
async function assertStateInWorkspace(
  db: ReturnType<typeof getDb>,
  stateId: string,
  workspaceId: string,
) {
  const [state] = await db
    .select({ id: schema.states.id })
    .from(schema.states)
    .where(
      and(
        eq(schema.states.id, stateId),
        eq(schema.states.workspaceId, workspaceId),
        isNull(schema.states.deletedAt),
      ),
    )
    .limit(1);
  if (!state) throw new HTTPException(404, { message: "State not found" });
}

// A folder must live in the workspace the tool call already resolved —
// same shape as assertStateInWorkspace below.
async function assertFolderInWorkspace(
  db: ReturnType<typeof getDb>,
  folderId: string,
  workspaceId: string,
) {
  const [folder] = await db
    .select({ id: schema.projectFolders.id })
    .from(schema.projectFolders)
    .where(
      and(
        eq(schema.projectFolders.id, folderId),
        eq(schema.projectFolders.workspaceId, workspaceId),
        isNull(schema.projectFolders.deletedAt),
      ),
    )
    .limit(1);
  if (!folder) throw new HTTPException(404, { message: "Folder not found" });
}

// Labels carry workspaceId directly (they are workspace-scoped, not
// project-scoped), so the same id + workspace + not-deleted shape applies.
// One inArray select covers the whole list; row count must match unique ids.
async function assertLabelsInWorkspace(
  db: ReturnType<typeof getDb>,
  labelIds: string[],
  workspaceId: string,
) {
  const unique = [...new Set(labelIds)];
  if (unique.length === 0) return;
  const rows = await db
    .select({ id: schema.labels.id })
    .from(schema.labels)
    .where(
      and(
        inArray(schema.labels.id, unique),
        eq(schema.labels.workspaceId, workspaceId),
        isNull(schema.labels.deletedAt),
      ),
    );
  if (rows.length !== unique.length) {
    throw new HTTPException(404, { message: "Label not found" });
  }
}

// Assignees must be owner or ACTIVE member of the workspace — the same
// owner-or-member rule every other auth path uses, so a workspace whose
// owner row is missing/deleted in workspace_members can still assign the
// owner. Any remaining unknown id → 404 before a row is written.
async function assertAssigneesInWorkspace(
  db: ReturnType<typeof getDb>,
  assigneeIds: string[],
  workspaceId: string,
) {
  const unique = [...new Set(assigneeIds)];
  const [ws] = await db
    .select({ ownerId: schema.workspaces.ownerId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  const rows = await db
    .select({ memberId: schema.workspaceMembers.memberId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        inArray(schema.workspaceMembers.memberId, unique),
        eq(schema.workspaceMembers.isActive, 1),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    );
  const found = new Set(rows.map((r) => r.memberId));
  const missing = unique.filter((id) => !found.has(id) && id !== ws.ownerId);
  if (missing.length > 0) {
    throw new HTTPException(404, { message: "Assignee not found in this workspace" });
  }
}

// Entity-resolve helpers: map an entity id to its project/workspace, then
// run the same owner-or-member check. Close IDOR on tools keyed only by id.
async function assertIssueAccess(db: ReturnType<typeof getDb>, issueId: string, userId: string) {
  const [iss] = await db
    .select({ projectId: schema.issues.projectId })
    .from(schema.issues)
    .where(and(eq(schema.issues.id, issueId), isNull(schema.issues.deletedAt)))
    .limit(1);
  if (!iss) throw new HTTPException(404, { message: "Issue not found" });
  await assertProjectAccess(db, iss.projectId, userId);
}

// Comment-scoped tools are keyed only by comment id, so resolve comment →
// issue → project access first. (commentsRepo also filters soft-deleted rows,
// so the isNull here is defense-in-depth, not the only guard.)
async function assertCommentAccess(
  db: ReturnType<typeof getDb>,
  commentId: string,
  userId: string,
) {
  const [comment] = await db
    .select({ issueId: schema.issueComments.issueId })
    .from(schema.issueComments)
    .where(and(eq(schema.issueComments.id, commentId), isNull(schema.issueComments.deletedAt)))
    .limit(1);
  if (!comment) throw new HTTPException(404, { message: "Comment not found" });
  await assertIssueAccess(db, comment.issueId, userId);
}

async function assertCycleAccess(db: ReturnType<typeof getDb>, cycleId: string, userId: string) {
  const [cyc] = await db
    .select({ projectId: schema.cycles.projectId })
    .from(schema.cycles)
    .where(and(eq(schema.cycles.id, cycleId), isNull(schema.cycles.deletedAt)))
    .limit(1);
  if (!cyc) throw new HTTPException(404, { message: "Sprint not found" });
  await assertProjectAccess(db, cyc.projectId, userId);
}

async function assertModuleAccess(db: ReturnType<typeof getDb>, moduleId: string, userId: string) {
  const [mod] = await db
    .select({ projectId: schema.modules.projectId })
    .from(schema.modules)
    .where(and(eq(schema.modules.id, moduleId), isNull(schema.modules.deletedAt)))
    .limit(1);
  if (!mod) throw new HTTPException(404, { message: "Module not found" });
  await assertProjectAccess(db, mod.projectId, userId);
}

async function assertPageAccess(db: ReturnType<typeof getDb>, pageId: string, userId: string) {
  const [pg] = await db
    .select({ workspaceId: schema.pages.workspaceId })
    .from(schema.pages)
    .where(and(eq(schema.pages.id, pageId), isNull(schema.pages.deletedAt)))
    .limit(1);
  if (!pg) throw new HTTPException(404, { message: "Page not found" });
  const [ws] = await db
    .select({ ownerId: schema.workspaces.ownerId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, pg.workspaceId))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  if (ws.ownerId !== userId && !(await isWorkspaceMember(db, pg.workspaceId, userId)))
    throw new HTTPException(403, { message: "Not a member of this workspace" });
}
// Exported for tests: DEV-19 authz suites drive the tool handler directly
// with a mocked db instead of standing up the whole MCP HTTP transport.
// ── upload_image ────────────────────────────────────────────────────────────
// The MCP server is remote, so callers ship file bytes as base64 rather than
// local paths. Size is capped in assetsService.uploadBytes for all entry
// points; this gate just rejects oversized payloads before the decode.

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
};

function decodeBase64Upload(raw: string): Uint8Array {
  // Tolerate data: URLs (any MIME/params shape) and stray whitespace — agents
  // copy bytes from many places.
  const b64 = raw.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
  if (!b64) {
    throw new HTTPException(400, {
      message:
        "content_base64 is required — this MCP server runs remotely and cannot read local file paths, so read the file yourself and pass its bytes base64-encoded",
    });
  }
  // Reject oversized payloads BEFORE paying for the decode (4 chars ↔ 3 bytes).
  const max = assetsService.MAX_UPLOAD_BYTES;
  if (b64.length > Math.ceil(max / 3) * 4) {
    throw new HTTPException(413, {
      message: `File too large; MCP uploads are capped at ${max} bytes`,
    });
  }
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new HTTPException(400, { message: "content_base64 is not valid base64" });
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength === 0) {
    throw new HTTPException(400, { message: "content_base64 decoded to zero bytes" });
  }
  return bytes;
}

async function handleToolRaw(
  db: ReturnType<typeof getDb>,
  env: Env,
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
  origin?: string,
): Promise<unknown> {
  switch (toolName) {
    case "list_workspaces": {
      // Only workspaces the user owns or is an active member of.
      const memberRows = await db
        .select({ wsId: schema.workspaceMembers.workspaceId })
        .from(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.memberId, userId),
            eq(schema.workspaceMembers.isActive, 1),
            isNull(schema.workspaceMembers.deletedAt),
          ),
        );
      const memberWsIds = memberRows.map((r) => r.wsId);
      const rows = memberWsIds.length
        ? await db
            .select()
            .from(schema.workspaces)
            .where(
              and(
                isNull(schema.workspaces.deletedAt),
                or(
                  eq(schema.workspaces.ownerId, userId),
                  inArray(schema.workspaces.id, memberWsIds),
                ),
              ),
            )
        : await db
            .select()
            .from(schema.workspaces)
            .where(and(isNull(schema.workspaces.deletedAt), eq(schema.workspaces.ownerId, userId)));
      return rows;
    }
    case "create_workspace": {
      const parsed = workspaceService.createWorkspaceSchema.safeParse(params);
      if (!parsed.success) {
        throw new HTTPException(400, {
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }
      // Service checks slug uniqueness (409) and inserts the owner as an
      // admin member, mirroring POST /api/workspaces.
      return workspaceService.create(db, userId, parsed.data);
    }
    case "update_workspace": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      await assertWorkspaceAdmin(db, workspaceId, userId);
      const parsed = workspaceService.updateWorkspaceSchema.safeParse(params);
      if (!parsed.success) {
        throw new HTTPException(400, {
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }
      if (Object.keys(parsed.data).length === 0) {
        throw new HTTPException(400, { message: "No updatable fields provided" });
      }
      // Service.update (not repo.update) so strategy rescors flow through the
      // reviewed_at stamp + workspace_score_history append (DEV-22) — same as
      // REST PATCH /api/workspaces/:slug. Re-resolve the slug from the id
      // getWorkspaceId returned: params.workspace may be a display NAME (the
      // documented convenience fallback), which service.update's findBySlug
      // would 404 on.
      const row = await workspaceRepo.findById(db, workspaceId);
      if (!row) throw new HTTPException(404, { message: "Workspace not found" });
      return workspaceService.update(db, row.slug, parsed.data);
    }
    case "delete_workspace": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      await assertWorkspaceAdmin(db, workspaceId, userId);
      await workspaceRepo.softDelete(db, workspaceId);
      return { success: true, deleted: params.workspace as string };
    }
    case "list_decisions": {
      // Cross-workspace decision inbox (DEV-22) — mirrors GET /api/me/decisions.
      // Open (not completed, not deleted) issues with is_decision=1 across all
      // workspaces the user owns or belongs to; dated first ascending.
      const ids = await workspaceRepo.listIdsByUser(db, userId);
      if (!ids.length) return [];
      return db
        .select({
          id: schema.issues.id,
          name: schema.issues.name,
          sequenceId: schema.issues.sequenceId,
          priority: schema.issues.priority,
          targetDate: schema.issues.targetDate,
          projectId: schema.projects.id,
          projectName: schema.projects.name,
          projectIdentifier: schema.projects.identifier,
          workspaceSlug: schema.workspaces.slug,
          workspaceName: schema.workspaces.name,
          stateName: schema.states.name,
          stateColor: schema.states.color,
        })
        .from(schema.issues)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.issues.projectId))
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.issues.workspaceId))
        .leftJoin(schema.states, eq(schema.states.id, schema.issues.stateId))
        .where(
          and(
            inArray(schema.issues.workspaceId, ids),
            eq(schema.issues.isDecision, 1),
            isNull(schema.issues.deletedAt),
            isNull(schema.issues.completedAt),
          ),
        )
        .orderBy(
          sql`CASE WHEN ${schema.issues.targetDate} IS NULL THEN 1 ELSE 0 END`,
          sql`${schema.issues.targetDate} ASC`,
          desc(schema.issues.updatedAt),
        )
        .limit(200);
    }
    case "list_projects": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const rows = await db
        .select()
        .from(schema.projects)
        .where(
          and(eq(schema.projects.workspaceId, workspaceId), isNull(schema.projects.deletedAt)),
        );
      return rows;
    }
    case "get_project": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const [project] = await db
        .select()
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.id, params.project_id as string),
            eq(schema.projects.workspaceId, workspaceId),
            isNull(schema.projects.deletedAt),
          ),
        )
        .limit(1);
      if (!project) throw new HTTPException(404, { message: "Project not found" });
      return project;
    }
    case "create_project": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.projects).values({
        id,
        name: params.name as string,
        identifier: params.identifier as string,
        description: (params.description as string) ?? null,
        workspaceId,
        createdAt: now,
        updatedAt: now,
      });
      return db.select().from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
    }
    case "list_issues": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const conditions = [
        eq(schema.issues.projectId, params.project_id as string),
        eq(schema.issues.workspaceId, workspaceId),
        isNull(schema.issues.deletedAt),
      ];
      if (params.state) conditions.push(eq(schema.issues.stateId, params.state as string));
      if (params.state_key)
        conditions.push(
          inArray(
            schema.issues.stateId,
            db
              .select({ id: schema.states.id })
              .from(schema.states)
              .where(
                and(
                  eq(schema.states.projectId, params.project_id as string),
                  eq(schema.states.key, params.state_key as string),
                  isNull(schema.states.deletedAt),
                ),
              ),
          ),
        );
      const limit = Math.min(Number(params.limit) || 50, 100);
      const offset = Number(params.offset) || 0;
      const rows = await db
        .select()
        .from(schema.issues)
        .where(and(...conditions))
        .orderBy(desc(schema.issues.createdAt))
        .limit(limit)
        .offset(offset);
      return rows;
    }
    case "create_issue": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const projectId = params.project_id as string;
      // The project must belong to the named workspace — otherwise a member of
      // ws A could mint issues inside ws B by passing its project UUID.
      await assertProjectInWorkspace(db, projectId, workspaceId);
      // Same binding for the optional state/label/assignee ids: they must
      // belong to the named workspace, else the issue row (or its join rows)
      // would reference a foreign workspace's entities.
      // Guards are `!== undefined` (not truthiness): an empty-string id must
      // run through validation and 404 there, not skip it and get inserted.
      if (params.state_id !== undefined) {
        await assertStateInWorkspace(db, params.state_id as string, workspaceId);
      }
      if (Array.isArray(params.label_ids)) {
        await assertLabelsInWorkspace(db, params.label_ids as string[], workspaceId);
      }
      if (Array.isArray(params.assignee_ids) && (params.assignee_ids as string[]).length > 0) {
        await assertAssigneesInWorkspace(db, params.assignee_ids as string[], workspaceId);
      }
      if (params.parent_id !== undefined) {
        // The parent issue must live in the named workspace too — else a
        // member of ws A could nest their issue under ws B's issue tree.
        const [parent] = await db
          .select({ id: schema.issues.id })
          .from(schema.issues)
          .where(
            and(
              eq(schema.issues.id, params.parent_id as string),
              eq(schema.issues.workspaceId, workspaceId),
              isNull(schema.issues.deletedAt),
            ),
          )
          .limit(1);
        if (!parent) throw new HTTPException(404, { message: "Parent issue not found" });
      }
      const id = uuid();
      const now = nowISO();
      const row: typeof schema.issues.$inferInsert = {
        id,
        name: params.name as string,
        descriptionHtml: (params.description_html as string) ?? null,
        priority: (params.priority as string) ?? "none",
        stateId: (params.state_id as string) ?? null,
        completedAt: await issuesRepo.completedAtForState(db, params.state_id as string, now),
        parentId: (params.parent_id as string) ?? null,
        sequenceId: await issuesRepo.allocateNextSequence(db, projectId),
        projectId,
        workspaceId,
        isDecision: params.is_decision ? 1 : 0,
        startDate: (params.start_date as string) ?? null,
        targetDate: (params.target_date as string) ?? null,
        createdAt: now,
        updatedAt: now,
      };
      // sequenceId comes from the atomic per-project counter (UPDATE ...
      // RETURNING), so concurrent creators get distinct ids — no collisions,
      // no retry loop.
      await db.insert(schema.issues).values(row);
      if (params.label_ids && Array.isArray(params.label_ids)) {
        for (const labelId of params.label_ids as string[]) {
          await db
            .insert(schema.issueLabels)
            .values({ id: uuid(), issueId: id, labelId, createdAt: now, updatedAt: now });
        }
      }
      if (params.assignee_ids && Array.isArray(params.assignee_ids)) {
        for (const assigneeId of params.assignee_ids as string[]) {
          await db
            .insert(schema.issueAssignees)
            .values({ id: uuid(), issueId: id, assigneeId, createdAt: now, updatedAt: now });
        }
      }
      return db
        .select()
        .from(schema.issues)
        .where(
          and(
            eq(schema.issues.id, id),
            eq(schema.issues.projectId, projectId),
            eq(schema.issues.workspaceId, workspaceId),
            isNull(schema.issues.deletedAt),
          ),
        )
        .limit(1);
    }
    case "update_issue": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const updates: Record<string, unknown> = { updatedAt: nowISO() };
      if (params.state_id !== undefined) {
        // The new state must live in the named workspace before any write.
        await assertStateInWorkspace(db, params.state_id as string, workspaceId);
        updates.stateId = params.state_id;
        updates.completedAt = await issuesRepo.completedAtForState(db, params.state_id as string);
      }
      if (params.priority !== undefined) updates.priority = params.priority;
      if (params.name !== undefined) updates.name = params.name;
      if (params.description_html !== undefined) updates.descriptionHtml = params.description_html;
      if (params.is_decision !== undefined) updates.isDecision = params.is_decision ? 1 : 0;
      if (params.start_date !== undefined) updates.startDate = params.start_date;
      if (params.target_date !== undefined) updates.targetDate = params.target_date;
      await db
        .update(schema.issues)
        .set(updates)
        .where(
          and(
            eq(schema.issues.id, params.issue_id as string),
            eq(schema.issues.projectId, params.project_id as string),
            eq(schema.issues.workspaceId, workspaceId),
            isNull(schema.issues.deletedAt),
          ),
        );
      return db
        .select()
        .from(schema.issues)
        .where(
          and(
            eq(schema.issues.id, params.issue_id as string),
            eq(schema.issues.projectId, params.project_id as string),
            eq(schema.issues.workspaceId, workspaceId),
            isNull(schema.issues.deletedAt),
          ),
        )
        .limit(1);
    }
    case "move_issue": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      if (typeof params.issue_id !== "string" || typeof params.target_project_id !== "string") {
        throw new HTTPException(400, { message: "issue_id and target_project_id are required" });
      }
      // Both ends are bound to the named workspace inside moveIssue (issue and
      // target project each looked up by workspace_id → cross-workspace 404).
      const moved = await issueMoveService.moveIssue(
        db,
        workspaceId,
        params.issue_id,
        params.target_project_id,
        {
          stateId: params.state_id !== undefined ? String(params.state_id) : undefined,
          actorId: userId,
        },
      );
      return {
        ...moved.issue,
        previousKey: moved.previousKey,
        key: moved.key,
        droppedLabels: moved.droppedLabels,
      };
    }
    case "move_project_to_workspace": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const parsed = projectMoveService.moveProjectSchema.safeParse({
        target_workspace: params.target_workspace,
        page_ids: params.page_ids,
      });
      if (!parsed.success || typeof params.project_id !== "string") {
        throw new HTTPException(400, {
          message: parsed.success
            ? "project_id is required"
            : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
      }
      // Admin of both ends is enforced inside the service; the project is
      // bound to the named source workspace there (cross-workspace → 404).
      return projectMoveService.moveProjectToWorkspace(db, {
        sourceWorkspaceId: workspaceId,
        projectId: params.project_id,
        targetWorkspaceSlug: parsed.data.target_workspace,
        actorId: userId,
        pageIds: parsed.data.page_ids,
      });
    }
    case "get_issue": {
      // Accept issue_id (UUID) or sequence_id (human number within a project).
      // Sequence lookups resolve scoped to project_id so numbers stay unique.
      let issueId = params.issue_id as string | undefined;
      if (!issueId && params.sequence_id != null) {
        if (!params.project_id)
          throw new HTTPException(400, { message: "project_id is required with sequence_id" });
        const [ref] = await db
          .select({ id: schema.issues.id })
          .from(schema.issues)
          .where(
            and(
              eq(schema.issues.projectId, params.project_id as string),
              eq(schema.issues.sequenceId, Number(params.sequence_id)),
              isNull(schema.issues.deletedAt),
            ),
          )
          .limit(1);
        if (!ref) throw new HTTPException(404, { message: "Issue not found" });
        issueId = ref.id;
      }
      await assertIssueAccess(db, issueId as string, userId);
      const [issue] = await db
        .select()
        .from(schema.issues)
        .where(and(isNull(schema.issues.deletedAt), eq(schema.issues.id, issueId as string)))
        .limit(1);
      if (!issue) throw new HTTPException(404, { message: "Issue not found" });
      return issue;
    }
    case "search_issues": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const query = params.query as string;
      const rows = await db
        .select()
        .from(schema.issues)
        .where(
          and(
            eq(schema.issues.workspaceId, workspaceId),
            isNull(schema.issues.deletedAt),
            issuesRepo.issueTextCondition(query, [
              like(schema.issues.descriptionStripped, `%${query.trim()}%`),
            ]),
          ),
        )
        .limit(Math.min(Number(params.limit) || 50, 100));
      return rows;
    }
    case "delete_issue": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const now = nowISO();
      await db
        .update(schema.issues)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.issues.id, params.issue_id as string),
            eq(schema.issues.projectId, params.project_id as string),
            eq(schema.issues.workspaceId, workspaceId),
          ),
        );
      return { success: true };
    }
    case "list_folders": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const rows = await db
        .select()
        .from(schema.projectFolders)
        .where(
          and(
            eq(schema.projectFolders.workspaceId, workspaceId),
            isNull(schema.projectFolders.deletedAt),
          ),
        )
        .orderBy(asc(schema.projectFolders.sortOrder));
      return rows;
    }
    case "get_workspace_links": {
      // Single binding needs membership; the unscoped list is the operator's
      // agent seeding/lookup path (API keys are owner-minted) and returns only
      // ops config — repo paths, never credentials.
      if (params.workspace) {
        await getWorkspaceId(db, params.workspace as string, userId);
        return linksService.get(db, params.workspace as string);
      }
      return linksService.list(db);
    }
    case "set_workspace_link": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      await assertWorkspaceAdmin(db, workspaceId, userId);
      const input = linksService.upsertLinkSchema.parse(params);
      return linksService.upsert(db, params.workspace as string, input);
    }
    case "create_folder": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.projectFolders).values({
        id,
        name: params.name as string,
        color: (params.color as string) ?? null,
        sortOrder: (params.sort_order as number) ?? 65535.0,
        workspaceId,
        createdAt: now,
        updatedAt: now,
      });
      const [created] = await db
        .select()
        .from(schema.projectFolders)
        .where(eq(schema.projectFolders.id, id))
        .limit(1);
      return created;
    }
    case "update_folder": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      await assertFolderInWorkspace(db, params.folder_id as string, workspaceId);
      const updates: Record<string, unknown> = { updatedAt: nowISO() };
      if (params.name !== undefined) updates.name = params.name;
      if (params.color !== undefined) updates.color = params.color;
      if (params.sort_order !== undefined) updates.sortOrder = params.sort_order;
      await db
        .update(schema.projectFolders)
        .set(updates)
        .where(
          and(
            eq(schema.projectFolders.id, params.folder_id as string),
            eq(schema.projectFolders.workspaceId, workspaceId),
          ),
        );
      const [updated] = await db
        .select()
        .from(schema.projectFolders)
        .where(eq(schema.projectFolders.id, params.folder_id as string))
        .limit(1);
      return updated;
    }
    case "delete_folder": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      await assertFolderInWorkspace(db, params.folder_id as string, workspaceId);
      const now = nowISO();
      await db
        .update(schema.projectFolders)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.projectFolders.id, params.folder_id as string),
            eq(schema.projectFolders.workspaceId, workspaceId),
          ),
        );
      return { success: true };
    }
    case "set_project_folder": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      await assertProjectInWorkspace(db, params.project_id as string, workspaceId);
      // Folder (when set) must belong to the same workspace — the binding
      // rule the REST update enforces.
      if (params.folder_id)
        await assertFolderInWorkspace(db, params.folder_id as string, workspaceId);
      await db
        .update(schema.projects)
        .set({ folderId: (params.folder_id as string | null) ?? null, updatedAt: nowISO() })
        .where(
          and(
            eq(schema.projects.id, params.project_id as string),
            eq(schema.projects.workspaceId, workspaceId),
          ),
        );
      return { success: true };
    }
    case "list_custom_fields": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      await assertProjectInWorkspace(db, params.project_id as string, workspaceId);
      const rows = await db
        .select()
        .from(schema.customFields)
        .where(
          and(
            eq(schema.customFields.projectId, params.project_id as string),
            isNull(schema.customFields.deletedAt),
          ),
        );
      // Parsed settings (options/currency) instead of the raw options string.
      return rows.map((row) => withSettings(row));
    }
    case "create_custom_field": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      await assertProjectInWorkspace(db, params.project_id as string, workspaceId);
      const id = uuid();
      const now = nowISO();
      // Validate settings like the REST service — a malformed currency code
      // would crash Intl.NumberFormat in the client's currency renderer.
      const settings = fieldSettingsSchema.parse(params.settings ?? {}) as {
        options?: unknown;
        currency?: string;
      };
      if (params.field_type === "currency" && !settings.currency) settings.currency = "IDR";
      await db.insert(schema.customFields).values({
        id,
        name: params.name as string,
        fieldType: params.field_type as string,
        description: (params.description as string) ?? null,
        isRequired: params.is_required ? 1 : 0,
        options: JSON.stringify(settings),
        projectId: params.project_id as string,
        workspaceId,
        createdAt: now,
        updatedAt: now,
      });
      const [created] = await db
        .select()
        .from(schema.customFields)
        .where(eq(schema.customFields.id, id))
        .limit(1);
      return created;
    }
    case "set_custom_field_value": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      await assertProjectInWorkspace(db, params.project_id as string, workspaceId);
      // Issue must live in the named project; the field must belong to the
      // SAME project — the cross-project linkage guard from the REST service.
      const [issue] = await db
        .select({ id: schema.issues.id, workspaceId: schema.issues.workspaceId })
        .from(schema.issues)
        .where(
          and(
            eq(schema.issues.id, params.issue_id as string),
            eq(schema.issues.projectId, params.project_id as string),
            eq(schema.issues.workspaceId, workspaceId),
            isNull(schema.issues.deletedAt),
          ),
        )
        .limit(1);
      if (!issue) throw new HTTPException(404, { message: "Issue not found" });
      const [field] = await db
        .select({ id: schema.customFields.id })
        .from(schema.customFields)
        .where(
          and(
            eq(schema.customFields.id, params.custom_field_id as string),
            eq(schema.customFields.projectId, params.project_id as string),
            isNull(schema.customFields.deletedAt),
          ),
        )
        .limit(1);
      if (!field) throw new HTTPException(404, { message: "Custom field not found" });
      const valueJson =
        params.value_json === undefined || params.value_json === null
          ? null
          : JSON.stringify(params.value_json);
      await valuesRepo.upsert(db, {
        id: uuid(),
        issueId: issue.id,
        customFieldId: params.custom_field_id as string,
        valueJson,
        workspaceId,
        now: nowISO(),
      });
      return { success: true };
    }
    case "add_comment": {
      await assertIssueAccess(db, params.issue_id as string, userId);
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.issueComments).values({
        id,
        commentHtml: params.comment_html as string,
        access: (params.access as string) ?? "internal",
        issueId: params.issue_id as string,
        actorId: userId,
        createdAt: now,
        updatedAt: now,
      });
      return db.select().from(schema.issueComments).where(eq(schema.issueComments.id, id)).limit(1);
    }
    case "list_comments": {
      await assertIssueAccess(db, params.issue_id as string, userId);
      const rows = await db
        .select()
        .from(schema.issueComments)
        .where(
          and(
            eq(schema.issueComments.issueId, params.issue_id as string),
            isNull(schema.issueComments.deletedAt),
          ),
        )
        .orderBy(desc(schema.issueComments.createdAt));
      return rows;
    }
    case "get_issue_feedback": {
      await assertIssueAccess(db, params.issue_id as string, userId);
      return getIssueFeedback(db, params.issue_id as string, origin);
    }
    case "update_comment": {
      await assertCommentAccess(db, params.comment_id as string, userId);
      // REST parity: updateCommentSchema's min(1) is not applied on this path,
      // so reject an empty body here instead of writing one.
      if (typeof params.comment_html === "string" && params.comment_html.trim() === "") {
        throw new HTTPException(400, { message: "comment_html cannot be empty" });
      }
      // Ownership + the write itself live in the service — same rules as the
      // REST PATCH route (404 unknown/deleted, 403 not the author).
      return commentsService.update(db, userId, params.comment_id as string, {
        comment_html: params.comment_html as string | undefined,
        access: params.access as string | undefined,
      });
    }
    case "delete_comment": {
      await assertCommentAccess(db, params.comment_id as string, userId);
      // Same author-only rule as the REST DELETE route.
      await commentsService.remove(db, userId, params.comment_id as string);
      return { success: true };
    }
    case "list_states": {
      await assertProjectAccess(db, params.project_id as string, userId);
      const rows = await db
        .select()
        .from(schema.states)
        .where(
          and(
            eq(schema.states.projectId, params.project_id as string),
            isNull(schema.states.deletedAt),
          ),
        )
        .orderBy(schema.states.sequence);
      return rows;
    }
    case "list_labels": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const rows = await db
        .select()
        .from(schema.labels)
        .where(and(eq(schema.labels.workspaceId, workspaceId), isNull(schema.labels.deletedAt)))
        .orderBy(schema.labels.sortOrder);
      return rows;
    }
    case "list_members": {
      await assertProjectAccess(db, params.project_id as string, userId);
      const rows = await db
        .select()
        .from(schema.projectMembers)
        .where(
          and(
            eq(schema.projectMembers.projectId, params.project_id as string),
            isNull(schema.projectMembers.deletedAt),
          ),
        );
      return rows;
    }
    case "list_workspace_members": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const rows = await db
        .select()
        .from(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, workspaceId),
            isNull(schema.workspaceMembers.deletedAt),
          ),
        );
      return rows;
    }
    case "set_assignee": {
      await assertIssueAccess(db, params.issue_id as string, userId);
      // assertIssueAccess checks the CALLER, not the assignee — resolve the
      // issue's workspace and require the assignee be an active member of it.
      const [iss] = await db
        .select({ workspaceId: schema.issues.workspaceId })
        .from(schema.issues)
        .where(
          and(eq(schema.issues.id, params.issue_id as string), isNull(schema.issues.deletedAt)),
        )
        .limit(1);
      if (!iss) throw new HTTPException(404, { message: "Issue not found" });
      await assertAssigneesInWorkspace(db, [params.assignee_id as string], iss.workspaceId);
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.issueAssignees).values({
        id,
        issueId: params.issue_id as string,
        assigneeId: params.assignee_id as string,
        createdAt: now,
        updatedAt: now,
      });
      return { success: true };
    }
    case "list_sprints": {
      await assertProjectAccess(db, params.project_id as string, userId);
      const rows = await db
        .select()
        .from(schema.cycles)
        .where(
          and(
            eq(schema.cycles.projectId, params.project_id as string),
            isNull(schema.cycles.deletedAt),
          ),
        )
        .orderBy(desc(schema.cycles.startDate));
      return rows;
    }
    case "create_sprint": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      // Same project-binding rule as create_issue above.
      await assertProjectInWorkspace(db, params.project_id as string, workspaceId);
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.cycles).values({
        id,
        name: params.name as string,
        description: (params.description as string) ?? null,
        startDate: (params.start_date as string) ?? null,
        endDate: (params.end_date as string) ?? null,
        projectId: params.project_id as string,
        workspaceId,
        ownedById: userId,
        createdAt: now,
        updatedAt: now,
      });
      return db.select().from(schema.cycles).where(eq(schema.cycles.id, id)).limit(1);
    }
    case "get_sprint": {
      await assertCycleAccess(db, params.sprint_id as string, userId);
      const [sprint] = await db
        .select()
        .from(schema.cycles)
        .where(
          and(eq(schema.cycles.id, params.sprint_id as string), isNull(schema.cycles.deletedAt)),
        )
        .limit(1);
      if (!sprint) throw new HTTPException(404, { message: "Sprint not found" });
      return sprint;
    }
    case "update_sprint": {
      await assertCycleAccess(db, params.sprint_id as string, userId);
      const updates: Record<string, unknown> = { updatedAt: nowISO() };
      if (params.name !== undefined) updates.name = params.name;
      if (params.start_date !== undefined) updates.startDate = params.start_date;
      if (params.end_date !== undefined) updates.endDate = params.end_date;
      await db
        .update(schema.cycles)
        .set(updates)
        .where(eq(schema.cycles.id, params.sprint_id as string));
      return db
        .select()
        .from(schema.cycles)
        .where(eq(schema.cycles.id, params.sprint_id as string))
        .limit(1);
    }
    case "add_issue_to_sprint": {
      await assertCycleAccess(db, params.sprint_id as string, userId);
      await assertIssueAccess(db, params.issue_id as string, userId);
      const [existing] = await db
        .select()
        .from(schema.cycleIssues)
        .where(
          and(
            eq(schema.cycleIssues.cycleId, params.sprint_id as string),
            eq(schema.cycleIssues.issueId, params.issue_id as string),
          ),
        )
        .limit(1);
      if (!existing) {
        const id = uuid();
        const now = nowISO();
        await db.insert(schema.cycleIssues).values({
          id,
          cycleId: params.sprint_id as string,
          issueId: params.issue_id as string,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { success: true };
    }
    case "remove_issue_from_sprint": {
      await assertCycleAccess(db, params.sprint_id as string, userId);
      await assertIssueAccess(db, params.issue_id as string, userId);
      await db
        .delete(schema.cycleIssues)
        .where(
          and(
            eq(schema.cycleIssues.cycleId, params.sprint_id as string),
            eq(schema.cycleIssues.issueId, params.issue_id as string),
          ),
        );
      return { success: true };
    }
    case "get_sprint_progress": {
      await assertProjectAccess(db, params.project_id as string, userId);
      const sprintId = params.sprint_id as string;
      const total = await db
        .select()
        .from(schema.cycleIssues)
        .where(eq(schema.cycleIssues.cycleId, sprintId));
      const totalCount = total.length;
      if (totalCount === 0) return { total: 0, completed: 0, percentage: 0 };
      const issueIds = total.map((ci) => ci.issueId);
      const completedStates = await db
        .select()
        .from(schema.states)
        .where(
          and(
            eq(schema.states.groupName, "completed"),
            eq(schema.states.projectId, params.project_id as string),
          ),
        );
      const completedStateIds = completedStates.map((s) => s.id);
      let completedCount = 0;
      for (const issueId of issueIds) {
        const [issue] = await db
          .select({ stateId: schema.issues.stateId })
          .from(schema.issues)
          .where(eq(schema.issues.id, issueId))
          .limit(1);
        if (issue && completedStateIds.includes(issue.stateId ?? "")) completedCount++;
      }
      return {
        total: totalCount,
        completed: completedCount,
        percentage: Math.round((completedCount / totalCount) * 100),
      };
    }
    case "create_module": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      // Same project-binding rule as create_issue / create_sprint.
      await assertProjectInWorkspace(db, params.project_id as string, workspaceId);
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.modules).values({
        id,
        name: params.name as string,
        description: (params.description as string) ?? null,
        status: (params.status as string) ?? "planned",
        startDate: (params.start_date as string) ?? null,
        targetDate: (params.target_date as string) ?? null,
        projectId: params.project_id as string,
        workspaceId,
        createdAt: now,
        updatedAt: now,
      });
      const [created] = await db
        .select()
        .from(schema.modules)
        .where(eq(schema.modules.id, id))
        .limit(1);
      return created;
    }
    case "update_module": {
      await assertModuleAccess(db, params.module_id as string, userId);
      const updates: Record<string, unknown> = { updatedAt: nowISO() };
      if (params.name !== undefined) updates.name = params.name;
      if (params.description !== undefined) updates.description = params.description;
      if (params.status !== undefined) updates.status = params.status;
      if (params.start_date !== undefined) updates.startDate = params.start_date;
      if (params.target_date !== undefined) updates.targetDate = params.target_date;
      await db
        .update(schema.modules)
        .set(updates)
        .where(eq(schema.modules.id, params.module_id as string));
      const [updated] = await db
        .select()
        .from(schema.modules)
        .where(eq(schema.modules.id, params.module_id as string))
        .limit(1);
      return updated;
    }
    case "delete_module": {
      await assertModuleAccess(db, params.module_id as string, userId);
      const now = nowISO();
      await db
        .update(schema.modules)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(schema.modules.id, params.module_id as string));
      return { success: true };
    }
    case "create_state": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      await assertProjectInWorkspace(db, params.project_id as string, workspaceId);
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.states).values({
        id,
        name: params.name as string,
        color: (params.color as string) || "#808080",
        groupName: params.group_name as string,
        key: canonicalStateKey(params.name as string, params.group_name as string),
        description: (params.description as string) ?? null,
        projectId: params.project_id as string,
        workspaceId,
        createdAt: now,
        updatedAt: now,
      });
      const [created] = await db
        .select()
        .from(schema.states)
        .where(eq(schema.states.id, id))
        .limit(1);
      return created;
    }
    case "list_modules": {
      await assertProjectAccess(db, params.project_id as string, userId);
      const rows = await db
        .select()
        .from(schema.modules)
        .where(
          and(
            eq(schema.modules.projectId, params.project_id as string),
            isNull(schema.modules.deletedAt),
          ),
        )
        .orderBy(desc(schema.modules.createdAt));
      return rows;
    }
    case "get_module": {
      await assertModuleAccess(db, params.module_id as string, userId);
      const [mod] = await db
        .select()
        .from(schema.modules)
        .where(
          and(eq(schema.modules.id, params.module_id as string), isNull(schema.modules.deletedAt)),
        )
        .limit(1);
      if (!mod) throw new HTTPException(404, { message: "Module not found" });
      return mod;
    }
    case "add_issue_to_module": {
      await assertModuleAccess(db, params.module_id as string, userId);
      await assertIssueAccess(db, params.issue_id as string, userId);
      const [existing] = await db
        .select()
        .from(schema.moduleIssues)
        .where(
          and(
            eq(schema.moduleIssues.moduleId, params.module_id as string),
            eq(schema.moduleIssues.issueId, params.issue_id as string),
          ),
        )
        .limit(1);
      if (!existing) {
        const id = uuid();
        const now = nowISO();
        await db.insert(schema.moduleIssues).values({
          id,
          moduleId: params.module_id as string,
          issueId: params.issue_id as string,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { success: true };
    }
    case "remove_issue_from_module": {
      await assertModuleAccess(db, params.module_id as string, userId);
      await assertIssueAccess(db, params.issue_id as string, userId);
      await db
        .delete(schema.moduleIssues)
        .where(
          and(
            eq(schema.moduleIssues.moduleId, params.module_id as string),
            eq(schema.moduleIssues.issueId, params.issue_id as string),
          ),
        );
      return { success: true };
    }
    case "list_pages": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const rows = await db
        .select()
        .from(schema.pages)
        .where(and(eq(schema.pages.workspaceId, workspaceId), isNull(schema.pages.deletedAt)))
        .orderBy(desc(schema.pages.createdAt));
      return rows;
    }
    case "get_page": {
      await assertPageAccess(db, params.page_id as string, userId);
      const [page] = await db
        .select()
        .from(schema.pages)
        .where(and(eq(schema.pages.id, params.page_id as string), isNull(schema.pages.deletedAt)))
        .limit(1);
      if (!page) throw new HTTPException(404, { message: "Page not found" });
      return page;
    }
    case "create_page": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.pages).values({
        id,
        name: params.name as string,
        descriptionHtml: (params.description_html as string) ?? null,
        access: (params.access as number) ?? 0,
        workspaceId,
        ownedById: userId,
        createdAt: now,
        updatedAt: now,
      });
      return db.select().from(schema.pages).where(eq(schema.pages.id, id)).limit(1);
    }
    case "update_page": {
      await assertPageAccess(db, params.page_id as string, userId);
      const updates: Record<string, unknown> = { updatedAt: nowISO() };
      if (params.name !== undefined) updates.name = params.name;
      if (params.description_html !== undefined) updates.descriptionHtml = params.description_html;
      await db
        .update(schema.pages)
        .set(updates)
        .where(eq(schema.pages.id, params.page_id as string));
      return db
        .select()
        .from(schema.pages)
        .where(eq(schema.pages.id, params.page_id as string))
        .limit(1);
    }
    case "upload_image": {
      const bytes = decodeBase64Upload(
        typeof params.content_base64 === "string" ? params.content_base64 : "",
      );
      // Only the basename is kept — a caller-supplied path separator must not
      // smuggle directory structure into the stored filename.
      const filename =
        String(params.filename ?? "image.png")
          .split(/[\\/]/)
          .pop()!
          .trim() || "image.png";
      const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
      // Caller-supplied MIME is accepted only within the safe set — a stored
      // text/html type would be served inline by GET /api/assets/:id (XSS).
      const requested =
        typeof params.mime_type === "string" ? params.mime_type.trim().toLowerCase() : "";
      const safeMime = /^(image\/[\w.+-]+|application\/pdf)$/.test(requested) ? requested : "";
      // hasOwn keeps filenames like "x.toString" from reading the prototype.
      const extMime = Object.hasOwn(EXT_MIME, ext) ? EXT_MIME[ext] : undefined;
      const mime = safeMime || extMime || "application/octet-stream";

      const issueId =
        typeof params.issue_id === "string" && params.issue_id ? params.issue_id : undefined;
      if (issueId) await assertIssueAccess(db, issueId, userId);

      const result = await assetsService.uploadBytes(
        db,
        env,
        userId,
        { bytes, type: mime, size: bytes.byteLength },
        issueId,
        issueId ? "issue" : undefined,
      );
      return {
        id: result.id,
        // Absolute so agents working outside this repo can embed it verbatim.
        url: origin ? `${origin}${result.url}` : result.url,
        size: result.size,
        filename,
      };
    }
    case "add_issue_relation": {
      await assertIssueAccess(db, params.issue_id as string, userId);
      await assertIssueAccess(db, params.related_issue_id as string, userId);
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.issueRelations).values({
        id,
        issueId: params.issue_id as string,
        relatedIssueId: params.related_issue_id as string,
        relationType: params.relation_type as string,
        createdAt: now,
        updatedAt: now,
      });
      return db
        .select()
        .from(schema.issueRelations)
        .where(eq(schema.issueRelations.id, id))
        .limit(1);
    }
    case "list_issue_relations": {
      await assertIssueAccess(db, params.issue_id as string, userId);
      const rows = await db
        .select()
        .from(schema.issueRelations)
        .where(
          and(
            eq(schema.issueRelations.issueId, params.issue_id as string),
            isNull(schema.issueRelations.deletedAt),
          ),
        );
      return rows;
    }
    case "remove_issue_relation": {
      // Mirror add_issue_relation: BOTH sides of the relation must be issues
      // the caller can access. The old single-sided check (primary issue only)
      // let a relation pointing at a foreign workspace's issue be removed by
      // anyone who could read the primary one. A missing relation 404s before
      // any write.
      const [rel] = await db
        .select({
          issueId: schema.issueRelations.issueId,
          relatedIssueId: schema.issueRelations.relatedIssueId,
        })
        .from(schema.issueRelations)
        .where(
          and(
            eq(schema.issueRelations.id, params.relation_id as string),
            isNull(schema.issueRelations.deletedAt),
          ),
        )
        .limit(1);
      if (!rel) throw new HTTPException(404, { message: "Relation not found" });
      await assertIssueAccess(db, rel.issueId, userId);
      await assertIssueAccess(db, rel.relatedIssueId, userId);
      await db
        .update(schema.issueRelations)
        .set({ deletedAt: nowISO(), updatedAt: nowISO() })
        .where(eq(schema.issueRelations.id, params.relation_id as string));
      return { success: true };
    }
    case "list_time_entries": {
      await assertIssueAccess(db, params.issue_id as string, userId);
      const rows = await db
        .select()
        .from(schema.timeEntries)
        .where(
          and(
            eq(schema.timeEntries.issueId, params.issue_id as string),
            isNull(schema.timeEntries.deletedAt),
          ),
        )
        .orderBy(desc(schema.timeEntries.startedAt));
      return rows;
    }
    case "create_time_entry": {
      await assertIssueAccess(db, params.issue_id as string, userId);
      const [iss] = await db
        .select({ workspaceId: schema.issues.workspaceId })
        .from(schema.issues)
        .where(eq(schema.issues.id, params.issue_id as string))
        .limit(1);
      // Token counts: non-negative integers; anything else (missing, junk,
      // negative) is stored as null rather than failing the whole log.
      const tokens = (key: string): number | null => {
        const n = Number(params[key]);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
      };
      const source = params.source === "agent" ? "agent" : "human";
      if (source === "agent" && !params.agent_name) {
        throw new HTTPException(400, {
          message: 'agent_name is required when source is "agent"',
        });
      }
      const id = uuid();
      const now = nowISO();
      await db.insert(schema.timeEntries).values({
        id,
        issueId: params.issue_id as string,
        workspaceId: iss!.workspaceId,
        userId,
        durationSeconds: params.duration_seconds as number,
        description: (params.description as string) ?? null,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
        source,
        agentName: source === "agent" ? ((params.agent_name as string) ?? null) : null,
        model: (params.model as string) ?? null,
        inputTokens: tokens("input_tokens"),
        outputTokens: tokens("output_tokens"),
        cacheReadTokens: tokens("cache_read_tokens"),
        cacheWriteTokens: tokens("cache_write_tokens"),
        reasoningTokens: tokens("reasoning_tokens"),
      });
      return db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, id)).limit(1);
    }
    case "get_agent_usage": {
      return timesheetService.getAgentUsage(db, params.workspace as string, userId, {
        from: (params.from as string) || undefined,
        to: (params.to as string) || undefined,
        projectId: (params.project_id as string) || undefined,
      });
    }
    case "delete_time_entry": {
      // Scoped to the path issue (IDOR): a caller can only delete entries that
      // belong to an issue they can already access.
      await assertIssueAccess(db, params.issue_id as string, userId);
      await db
        .update(schema.timeEntries)
        .set({ deletedAt: nowISO(), updatedAt: nowISO() })
        .where(
          and(
            eq(schema.timeEntries.id, params.entry_id as string),
            eq(schema.timeEntries.issueId, params.issue_id as string),
          ),
        );
      return { success: true };
    }
    case "list_contacts": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const limit = Math.min(Number(params.limit) || 50, 100);
      const offset = Number(params.offset) || 0;
      const { rows, total } = await customersRepo.listContacts(db, workspaceId, {
        status: params.status as "lead" | "active" | "churned" | undefined,
        search: params.search as string | undefined,
        offset,
        limit,
      });
      return { results: rows, total };
    }
    case "create_contact": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      return crmService.createContact(
        db,
        workspaceId,
        crmService.createContactSchema.parse({
          email: params.email,
          threads_username: params.threads_username,
          name: params.name,
          company: params.company,
          phone: params.phone,
          source: params.source,
        }),
      );
    }
    case "get_contact": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      return crmService.getContact(db, workspaceId, params.contact_id as string);
    }
    case "update_contact": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      return crmService.updateContact(
        db,
        workspaceId,
        params.contact_id as string,
        crmService.updateContactSchema.parse({
          name: params.name,
          company: params.company,
          phone: params.phone,
          status: params.status,
          source: params.source,
          email: params.email,
          threads_username: params.threads_username,
        }),
      );
    }
    case "create_deal": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      // Bound to the named workspace: the deal's workspaceId comes from the
      // slug but its projectId from the param. assertProjectAccess alone only
      // proves membership of the project's OWN workspace, so a member of ws A
      // naming ws A + a ws B project could cross-link the deal (workspaceId=A,
      // projectId=B). assertProjectInWorkspace requires the project to live in
      // the named workspace.
      await assertProjectInWorkspace(db, params.project_id as string, workspaceId);
      return crmService.createDeal(
        db,
        workspaceId,
        params.project_id as string,
        {
          name: params.name as string,
          customer_id: params.customer_id as string | undefined,
          amount_cents: params.amount_cents as number | undefined,
          currency: params.currency as string | undefined,
          expected_close_at: params.expected_close_at as string | undefined,
          state_id: params.state_id as string | undefined,
        },
        userId,
      );
    }
    case "list_deals": {
      await assertProjectAccess(db, params.project_id as string, userId);
      const limit = Math.min(Number(params.limit) || 50, 100);
      const offset = Number(params.offset) || 0;
      const { rows, total } = await dealsRepo.listByProject(db, params.project_id as string, {
        stateId: params.state_id as string | undefined,
        offset,
        limit,
      });
      return { results: rows, total };
    }
    case "move_deal_stage": {
      await assertProjectAccess(db, params.project_id as string, userId);
      return crmService.moveDealStage(
        db,
        params.project_id as string,
        params.issue_id as string,
        params.state_id as string,
        userId,
      );
    }
    case "update_deal": {
      await assertProjectAccess(db, params.project_id as string, userId);
      return crmService.updateDeal(db, params.project_id as string, params.issue_id as string, {
        name: params.name as string | undefined,
        amount_cents: params.amount_cents as number | undefined,
        currency: params.currency as string | undefined,
        expected_close_at: (params.expected_close_at as string | null) ?? undefined,
        customer_id: (params.customer_id as string | null) ?? undefined,
        company_id: (params.company_id as string | null) ?? undefined,
      });
    }
    case "list_companies": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const limit = Math.min(Number(params.limit) || 50, 100);
      const offset = Number(params.offset) || 0;
      const { rows, total } = await companiesRepo.listCompanies(db, workspaceId, {
        search: params.search as string | undefined,
        offset,
        limit,
      });
      return { results: rows, total };
    }
    case "create_company": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      return companiesService.createCompany(db, workspaceId, {
        name: params.name as string,
        domain: (params.domain as string) ?? undefined,
        industry: (params.industry as string) ?? undefined,
        website: (params.website as string) ?? undefined,
        logoUrl: (params.logo_url as string) ?? undefined,
        brandColor: (params.brand_color as string) ?? undefined,
        description: (params.description as string) ?? undefined,
      });
    }
    case "get_company": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      return companiesService.getCompany(db, workspaceId, params.company_id as string);
    }
    case "update_company": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      return companiesService.updateCompany(db, workspaceId, params.company_id as string, {
        name: params.name as string | undefined,
        domain: (params.domain as string | null) ?? undefined,
        industry: (params.industry as string | null) ?? undefined,
        website: (params.website as string | null) ?? undefined,
        logoUrl: (params.logo_url as string | null) ?? undefined,
        brandColor: (params.brand_color as string | null) ?? undefined,
        description: (params.description as string | null) ?? undefined,
      });
    }
    case "record_fact": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      return factsService.recordFact(db, workspaceId, userId, {
        customer_id: params.customer_id as string | undefined,
        company_id: params.company_id as string | undefined,
        field: params.field as string,
        value: params.value as string,
        evidence: params.evidence as {
          source: string;
          method: string;
          url?: string;
        }[],
        method: params.method as string | undefined,
        source_url: params.source_url as string | undefined,
        observed_at: params.observed_at as string | undefined,
      });
    }
    case "list_facts": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const limit = Math.min(Number(params.limit) || 50, 100);
      const offset = Number(params.offset) || 0;
      const { rows, total } = await factsRepo.listFacts(db, workspaceId, {
        customerId: params.customer_id as string | undefined,
        companyId: params.company_id as string | undefined,
        status: params.status as string | undefined,
        offset,
        limit,
      });
      return { results: rows, total };
    }
    case "list_activities": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const limit = Math.min(Number(params.limit) || 50, 100);
      const offset = Number(params.offset) || 0;
      return activitiesService.listActivities(db, workspaceId, {
        customerId: params.customer_id as string | undefined,
        dealId: params.deal_id as string | undefined,
        offset,
        limit,
      });
    }
    case "log_activity": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      return crmService.logActivity(
        db,
        workspaceId,
        params.customer_id as string,
        userId,
        crmService.logActivitySchema.parse({
          type: params.type,
          subject: params.subject,
          body: params.body,
          occurred_at: params.occurred_at,
        }),
      );
    }
    case "list_threads_inbox": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const { rows, total } = await threadsService.listInbox(db, workspaceId, {
        status: params.status as string | undefined,
        replied: params.replied === true ? "yes" : params.replied === false ? "no" : undefined,
        offset: Number(params.offset) || 0,
        limit: Math.min(Number(params.limit) || 50, 100),
      });
      return { results: rows, total };
    }
    case "reply_threads_item": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      const { text } = threadsService.replySchema.parse({ text: params.text });
      return threadsService.reply(db, workspaceId, params.item_id as string, userId, text);
    }
    case "make_threads_lead": {
      const workspaceId = await getWorkspaceId(db, params.workspace as string, userId);
      return threadsService.makeLead(db, workspaceId, params.item_id as string, userId);
    }
    default:
      throw new HTTPException(400, { message: `Unknown tool: ${toolName}` });
  }
}

// Public entry: runs the raw tool handler, then applies the central
// slim-by-default projection from ./slim. With `slim: false` in the tool
// arguments the handler result is returned untouched, so callers needing
// full fidelity get byte-identical responses.
export async function handleTool(
  db: ReturnType<typeof getDb>,
  env: Env,
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
  origin?: string,
): Promise<unknown> {
  const result = await handleToolRaw(db, env, toolName, params, userId, origin);
  return slimResponse(toolName, params, result);
}

export const mcpRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", (c) => {
    // The MCP Streamable HTTP transport probes GET with Accept: text/event-stream
    // to open a server→client stream. We are stateless (no streaming), so respond
    // 405 — the client then falls back to plain POST request/response. Returning
    // 200 JSON here violates the spec and breaks the SDK handshake.
    const accept = c.req.header("Accept") || "";
    if (accept.includes("text/event-stream")) {
      return c.body(null, 405);
    }
    return c.json({
      name: "atur-mcp",
      version: "1.0.0",
      description: "Atur MCP Server - Project Management",
      protocolVersion: "2024-11-05",
    });
  })
  .post("/", mcpAuthMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const body = await c.req.json<JsonRpcRequest>();

    if (!body || body.jsonrpc !== "2.0") {
      return c.json(err(null, -32600, "Invalid Request"), 400);
    }

    try {
      switch (body.method) {
        case "initialize": {
          return c.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "atur-mcp", version: "1.0.0" },
            },
          });
        }
        case "notifications/initialized": {
          // Client-to-server notification: no response body.
          return c.body(null, 202);
        }
        case "ping": {
          return c.json({ jsonrpc: "2.0", id: body.id, result: {} });
        }
        case "tools/list": {
          // MCP spec: result is { tools: [...] } directly, NOT content-wrapped.
          return c.json({ jsonrpc: "2.0", id: body.id, result: { tools: TOOLS } });
        }
        case "tools/call": {
          const params = body.params as
            | { name?: string; arguments?: Record<string, unknown> }
            | undefined;
          if (!params?.name) {
            return c.json(err(body.id, -32602, "Missing tool name"), 400);
          }
          const result = await handleTool(
            db,
            c.env,
            params.name,
            params.arguments || {},
            c.get("user").sub,
            new URL(c.req.url).origin,
          );
          return c.json(ok(body.id, result));
        }
        default:
          return c.json(err(body.id, -32601, `Method not found: ${body.method}`), 404);
      }
    } catch (error) {
      if (error instanceof HTTPException) {
        return c.json(err(body.id, -32000, error.message), error.status);
      }
      const message = error instanceof Error ? error.message : "Internal error";
      return c.json(err(body.id, -32603, message), 500);
    }
  });

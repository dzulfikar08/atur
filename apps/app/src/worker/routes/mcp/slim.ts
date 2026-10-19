// Slim-by-default responses for the Atur MCP server.
//
// Handlers always produce the full-fidelity result they always have. The
// projection below applies by DEFAULT; passing `slim: false` in the tool
// arguments opts out and returns the result object untouched, so callers
// needing the full payload get byte-identical output on the next call.
//
// Slim contract:
// - Mutations project to identity fields (id/name/sequenceId/stateId/…), never
//   description_html or other heavy columns.
// - Lists/searches project every row the same way and omit heavy fields
//   entirely; `include: ["description"]` (any heavy-field name, matched as a
//   case/underscore-insensitive prefix — so "description" restores
//   descriptionHtml/descriptionStripped too) opts back in.
// - Any string kept in a slim response longer than SLIM_STRING_LIMIT chars is
//   truncated with an explicit `…[truncated]` marker.
//
// One table (SLIM_TOOLS) drives both the response projection and the
// `slim`/`include` fields advertised in tools/list, so the wire schema cannot
// drift from the behavior.

export const SLIM_STRING_LIMIT = 500;
const TRUNCATION_MARKER = "…[truncated]";

// Heavy columns dropped from slim rows unless restored via `include`.
const HEAVY_FIELDS = [
  "descriptionHtml",
  "description",
  "descriptionStripped",
  "commentHtml",
  "body",
] as const;

type Row = Record<string, unknown>;

type ToolSchema = {
  name: string;
  description: string;
  inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] };
};

// Identity fields per tool family (Drizzle runtime keys are camelCase — that
// is what the JSON-RPC payload has always carried).
const ISSUE = ["id", "name", "sequenceId", "stateId", "priority", "projectId"];
const PROJECT = ["id", "name", "identifier", "folderId"];
const WORKSPACE = ["id", "name", "slug"];
const FOLDER = ["id", "name", "color", "sortOrder"];
const STATE = ["id", "name", "groupName", "color", "key", "sequence"];
const LABEL = ["id", "name", "color"];
const MEMBER = ["id", "memberId", "role", "isActive"];
const SPRINT = ["id", "name", "startDate", "endDate"];
const MODULE = ["id", "name", "status", "startDate", "targetDate"];
const PAGE = ["id", "name", "access", "createdAt"];
const CUSTOM_FIELD = ["id", "name", "fieldType", "isRequired", "settings"];
const COMMENT = ["id", "issueId", "actorId", "access", "createdAt"];
const RELATION = ["id", "issueId", "relatedIssueId", "relationType"];
const TIME_ENTRY = ["id", "issueId", "userId", "durationSeconds", "description", "startedAt"];
const CONTACT = [
  "id",
  "email",
  "threadsUsername",
  "name",
  "company",
  "phone",
  "status",
  "source",
  "companyId",
];
const DEAL = [
  "id",
  "issueId",
  "name",
  "sequenceId",
  "stateId",
  "amountCents",
  "currency",
  "expectedCloseAt",
  "customerId",
  "companyId",
];
const COMPANY = ["id", "name", "domain", "industry", "website"];
const FACT = ["id", "customerId", "companyId", "field", "value", "status", "band"];
const ACTIVITY = ["id", "customerId", "dealId", "type", "subject", "occurredAt"];

// Tools whose slim response projects rows. Tools absent here (delete_* and
// other `{ success: true }` mutators, upload_image, get_sprint_progress,
// list_decisions, workspace links — all already minimal) pass through
// unchanged even with slim on.
const SLIM_TOOLS: Record<string, string[]> = {
  // Issues
  list_issues: ISSUE,
  search_issues: ISSUE,
  get_issue: ISSUE,
  create_issue: ISSUE,
  update_issue: ISSUE,
  // Projects / folders / workspaces
  list_projects: PROJECT,
  get_project: PROJECT,
  create_project: PROJECT,
  list_folders: FOLDER,
  create_folder: FOLDER,
  update_folder: FOLDER,
  list_workspaces: WORKSPACE,
  create_workspace: WORKSPACE,
  update_workspace: WORKSPACE,
  // States / labels / members
  list_states: STATE,
  create_state: STATE,
  list_labels: LABEL,
  list_members: MEMBER,
  list_workspace_members: MEMBER,
  // Sprints / modules / pages
  list_sprints: SPRINT,
  get_sprint: SPRINT,
  create_sprint: SPRINT,
  update_sprint: SPRINT,
  list_modules: MODULE,
  get_module: MODULE,
  create_module: MODULE,
  update_module: MODULE,
  list_pages: PAGE,
  get_page: PAGE,
  create_page: PAGE,
  update_page: PAGE,
  // Comments / relations / time
  add_comment: COMMENT,
  update_comment: COMMENT,
  list_comments: COMMENT,
  list_issue_relations: RELATION,
  add_issue_relation: RELATION,
  list_time_entries: TIME_ENTRY,
  create_time_entry: TIME_ENTRY,
  // Custom fields
  list_custom_fields: CUSTOM_FIELD,
  create_custom_field: CUSTOM_FIELD,
  // CRM
  list_contacts: CONTACT,
  create_contact: CONTACT,
  update_contact: CONTACT,
  list_deals: DEAL,
  create_deal: DEAL,
  get_contact: CONTACT,
  move_deal_stage: DEAL,
  update_deal: DEAL,
  list_companies: COMPANY,
  create_company: COMPANY,
  get_company: COMPANY,
  update_company: COMPANY,
  record_fact: FACT,
  list_facts: FACT,
  list_activities: ACTIVITY,
};

function isPlainObject(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function truncateDeep(v: unknown): unknown {
  if (typeof v === "string") {
    return v.length > SLIM_STRING_LIMIT ? v.slice(0, SLIM_STRING_LIMIT) + TRUNCATION_MARKER : v;
  }
  if (Array.isArray(v)) return v.map(truncateDeep);
  if (isPlainObject(v)) {
    const out: Row = {};
    for (const [k, val] of Object.entries(v)) out[k] = truncateDeep(val);
    return out;
  }
  return v;
}

function wantsField(include: string[], field: string): boolean {
  // Case/underscore-insensitive prefix match: "description" restores
  // descriptionHtml/descriptionStripped, "comment_html" restores commentHtml.
  const n = field.toLowerCase().replace(/_/g, "");
  return include.some((token) => n.startsWith(token.toLowerCase().replace(/_/g, "")));
}
function projectRow(row: unknown, fields: string[], include: string[]): unknown {
  if (!isPlainObject(row)) return row;
  const out: Row = {};
  for (const f of fields) {
    if (f in row) out[f] = truncateDeep(row[f]);
  }
  // `include` only ever RESTORES known-heavy fields — it cannot smuggle
  // arbitrary row content back into a slim response.
  for (const h of HEAVY_FIELDS) {
    if (h in row && wantsField(include, h)) out[h] = truncateDeep(row[h]);
  }
  return out;
}

// get_contact is the one irregular shape: a bundle of contact + company +
// every related collection. Slim keeps the two identity rows, drops the
// collections (deals/tickets/emails/activities/facts/suggestions).
function projectContactBundle(result: Row, include: string[]): Row {
  const out: Row = {};
  if (isPlainObject(result.contact)) out.contact = projectRow(result.contact, CONTACT, include);
  if (isPlainObject(result.company)) out.company = projectRow(result.company, COMPANY, include);
  return out;
}

export function slimResponse(toolName: string, args: Record<string, unknown>, result: unknown) {
  if (args?.slim === false) return result; // explicit opt-out → byte-identical passthrough
  const fields = SLIM_TOOLS[toolName];
  if (!fields) return result;
  const include = Array.isArray(args.include)
    ? args.include.filter((t): t is string => typeof t === "string")
    : [];

  if (Array.isArray(result)) return result.map((row) => projectRow(row, fields, include));
  if (isPlainObject(result)) {
    if (toolName === "get_contact") return projectContactBundle(result, include);
    // { results: [...], total, ... } pagination wrappers keep their envelope,
    // only the rows are projected.
    if (Array.isArray(result.results)) {
      return {
        ...result,
        results: result.results.map((row) => projectRow(row, fields, include)),
      };
    }
    return projectRow(result, fields, include);
  }
  return result;
}

// Advertise the slim/include fields in tools/list. `slim` goes on every tool
// (the contract's per-tool flag; a no-op on already-minimal responses),
// `include` only on tools whose slim projection can restore heavy fields.
export function annotateSlimToolFields(tools: ToolSchema[]): void {
  for (const tool of tools) {
    const schema = tool.inputSchema;
    if (!schema.properties) schema.properties = {};
    schema.properties.slim = {
      type: "boolean",
      default: true,
      description:
        "Slim response by default: mutations return identity fields only, lists return slim rows without heavy fields like description_html. Pass slim:false for the full response.",
    };
    if (SLIM_TOOLS[tool.name]) {
      schema.properties.include = {
        type: "array",
        items: { type: "string" },
        description:
          'With slim (the default), restore heavy fields by name prefix, e.g. ["description"] brings back description_html in get_issue/list_issues responses.',
      };
    }
  }
}

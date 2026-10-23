import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  index,
  uniqueIndex,
  primaryKey,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    username: text("username").notNull().unique(),
    displayName: text("display_name"),
    passwordHash: text("password_hash"),
    avatar: text("avatar"),
    token: text("token"),
    // Session validity: ISO instant when users.token stops being accepted.
    // Set to now+SESSION_TTL_SECONDS on login/register/OTP; a sliding window is
    // enforced by authMiddleware (extends on activity). NULL = treat as always
    // valid (legacy rows from before this column existed).
    sessionExpiresAt: text("session_expires_at"),
    userTimezone: text("user_timezone").default("UTC"),
    isActive: integer("is_active").notNull().default(1),
    isSuperuser: integer("is_superuser").notNull().default(0),
    isEmailVerified: integer("is_email_verified").notNull().default(0),
    isBot: integer("is_bot").notNull().default(0),
    isCustomer: integer("is_customer").notNull().default(0),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_users_email").on(table.email),
    index("idx_users_token").on(table.token),
    index("idx_users_deleted_at").on(table.deletedAt),
  ],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    metadata: text("metadata"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [uniqueIndex("uq_accounts_provider").on(table.provider, table.providerAccountId)],
);

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  theme: text("theme"),
  isOnboarded: integer("is_onboarded").notNull().default(0),
  onboardingStep: text("onboarding_step"),
  useCase: text("use_case"),
  role: text("role"),
  language: text("language").default("en"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    organizationSize: text("organization_size"),
    timezone: text("timezone").default("UTC"),
    backgroundColor: text("background_color"),
    // Signature appended to CRM customer emails ({{footer}} placeholder).
    // Null → fallback "Regards,\n<workspace name> team".
    emailFooter: text("email_footer"),
    // ── Portfolio strategy (DEV-22) ──
    // Moat × AI-proof scores (0–5) from the monthly portfolio review; verdict
    // maps to the 2×2 matrix quadrant action. History lands in
    // workspace_score_history on every changed rescore (services/workspaces.ts).
    moatScore: integer("moat_score"),
    aiProofScore: integer("ai_proof_score"),
    strategyVerdict: text("strategy_verdict"),
    strategyNote: text("strategy_note"),
    reviewedAt: text("reviewed_at"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("idx_workspaces_slug").on(table.slug)],
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: integer("role").notNull().default(15),
    isActive: integer("is_active").notNull().default(1),
    viewProps: text("view_props"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("uq_workspace_member").on(table.workspaceId, table.memberId),
    index("idx_workspace_members_workspace").on(table.workspaceId),
    index("idx_workspace_members_member").on(table.memberId),
  ],
);

export const workspaceInvites = sqliteTable("workspace_invites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: integer("role").notNull().default(15),
  token: text("token"),
  accepted: integer("accepted").notNull().default(0),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

// ── Portfolio strategy score history (DEV-22) ──
// One row per CHANGED rescore of a workspace's Moat × AI-proof scores —
// written only from services/workspaces.ts update(). The latest-but-one row
// vs the current workspaces row gives the /strategy view its trend arrows.
export const workspaceScoreHistory = sqliteTable(
  "workspace_score_history",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    moatScore: integer("moat_score"),
    aiProofScore: integer("ai_proof_score"),
    strategyVerdict: text("strategy_verdict"),
    strategyNote: text("strategy_note"),
    createdAt: text("created_at"),
  },
  (table) => [index("idx_workspace_score_history_workspace").on(table.workspaceId)],
);

// ClickUp-style folder level: workspace → folder → project. Nullable FK —
// projects without a folder simply render under "No folder".
export const projectFolders = sqliteTable(
  "project_folders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color"),
    sortOrder: real("sort_order").notNull().default(65535.0),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("idx_project_folders_workspace").on(table.workspaceId)],
);

// Control-plane registry (DEV-29): binds a workspace slug to its execution
// context — GitHub repo(s), local checkout path, default branch, herdr
// workspace. Keyed by slug (the canonical MCP identifier) with a UNIQUE
// constraint instead of a workspaces FK so rows survive workspace recreation
// and agents can address them by slug; every read/write path still resolves +
// membership-checks the slug first.
export const workspaceLinks = sqliteTable("workspace_links", {
  id: text("id").primaryKey(),
  workspaceSlug: text("workspace_slug").notNull().unique(),
  // JSON array of repo URLs / "owner/repo" identifiers; NULL = no repo.
  repoUrls: text("repo_urls"),
  localPath: text("local_path"),
  defaultBranch: text("default_branch"),
  herdrWorkspace: text("herdr_workspace"),
  notes: text("notes"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  // Autonomy (firstmate port): NULL mode = local-only; 'direct-PR' lets the
  // agent push + open a PR; auto_merge 'yolo' additionally lets it merge after
  // green gates. Explicit per-workspace, off by default.
  mode: text("mode"),
  autoMerge: text("auto_merge"),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    identifier: text("identifier").notNull(),
    description: text("description"),
    descriptionHtml: text("description_html"),
    descriptionJson: text("description_json"),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    network: integer("network").notNull().default(0),
    emoji: text("emoji"),
    iconProp: text("icon_prop"),
    coverImage: text("cover_image"),
    defaultAssigneeId: text("default_assignee_id"),
    projectLeadId: text("project_lead_id"),
    defaultStateId: text("default_state_id"),
    folderId: text("folder_id").references(() => projectFolders.id, { onDelete: "set null" }),
    moduleView: integer("module_view").notNull().default(1),
    cycleView: integer("cycle_view").notNull().default(1),
    pageView: integer("page_view").notNull().default(1),
    intakeView: integer("intake_view").notNull().default(1),
    isTimeTrackingEnabled: integer("is_time_tracking_enabled").notNull().default(0),
    // CRM: this project doubles as a sales pipeline (deal board + seeded sales stages).
    isPipeline: integer("is_pipeline").notNull().default(0),
    archiveIn: integer("archive_in"),
    closeIn: integer("close_in"),
    timezone: text("timezone").default("UTC"),
    archivedAt: text("archived_at"),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("uq_project_identifier").on(table.identifier, table.workspaceId),
    index("idx_projects_workspace").on(table.workspaceId),
  ],
);

export const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(),
  memberId: text("member_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: integer("role").notNull().default(15),
  isActive: integer("is_active").notNull().default(1),
  sortOrder: real("sort_order").notNull().default(65535.0),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const states = sqliteTable(
  "states",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color"),
    slug: text("slug"),
    key: text("key"),
    sequence: real("sequence").notNull().default(65535.0),
    groupName: text("group_name").notNull(),
    isTriage: integer("is_triage").notNull().default(0),
    isDefault: integer("is_default").notNull().default(0),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_states_project").on(table.projectId),
    index("idx_states_project_sequence").on(table.projectId, table.sequence),
  ],
);

export const labels = sqliteTable(
  "labels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color"),
    sortOrder: real("sort_order").notNull().default(65535.0),
    parentId: text("parent_id").references((): any => labels.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("idx_labels_workspace").on(table.workspaceId)],
);

export const estimates = sqliteTable("estimates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const estimatePoints = sqliteTable("estimate_points", {
  id: text("id").primaryKey(),
  estimateId: text("estimate_id").notNull(),
  key: text("key").notNull(),
  value: text("value"),
  sortOrder: real("sort_order").notNull().default(65535.0),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const issues = sqliteTable(
  "issues",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sequenceId: integer("sequence_id").notNull(),
    sortOrder: real("sort_order").notNull().default(65535.0),
    priority: text("priority").default("none"),
    startDate: text("start_date"),
    targetDate: text("target_date"),
    completedAt: text("completed_at"),
    archivedAt: text("archived_at"),
    isDraft: integer("is_draft").notNull().default(0),
    // DEV-22: marks portfolio-level decision issues (strategy gates, kill
    // switches). Feeds the cross-workspace decision inbox (/api/me/decisions).
    isDecision: integer("is_decision").notNull().default(0),
    descriptionJson: text("description_json"),
    descriptionHtml: text("description_html"),
    descriptionStripped: text("description_stripped"),
    descriptionBinary: blob("description_binary"),
    parentId: text("parent_id").references((): any => issues.id, { onDelete: "cascade" }),
    stateId: text("state_id").references(() => states.id, { onDelete: "cascade" }),
    estimatePointId: text("estimate_point_id"),
    estimatePoints: integer("estimate_points"),
    typeId: text("type_id"),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    createdById: text("created_by_id"),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("uq_issue_sequence").on(table.projectId, table.sequenceId),
    index("idx_issues_project").on(table.projectId),
    index("idx_issues_workspace").on(table.workspaceId),
    index("idx_issues_state").on(table.stateId),
    index("idx_issues_deleted_at").on(table.deletedAt),
    index("idx_issues_project_deleted").on(table.projectId, table.deletedAt),
    index("idx_issues_target_date").on(table.targetDate),
    index("idx_issues_workspace_updated").on(table.workspaceId, table.updatedAt),
  ],
);

// Per-project atomic sequence counter for issues. One row per project;
// allocateNextSequence bumps it with a single UPDATE...RETURNING, which D1
// executes atomically, so concurrent creators get distinct sequence ids
// without retry loops. Seeded lazily from MAX(issues.sequence_id).
export const issueSequenceCounters = sqliteTable("issue_sequence_counters", {
  projectId: text("project_id").primaryKey(),
  nextSequence: integer("next_sequence").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

export const issueAssignees = sqliteTable(
  "issue_assignees",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    assigneeId: text("assignee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_issue_assignees_issue").on(table.issueId),
    index("idx_issue_assignees_assignee").on(table.assigneeId),
  ],
);

export const issueLabels = sqliteTable(
  "issue_labels",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_issue_labels_issue").on(table.issueId),
    index("idx_issue_labels_label").on(table.labelId),
  ],
);

export const issueComments = sqliteTable(
  "issue_comments",
  {
    id: text("id").primaryKey(),
    commentStripped: text("comment_stripped"),
    commentJson: text("comment_json"),
    commentHtml: text("comment_html"),
    access: text("access").default("internal"),
    parentId: text("parent_id"),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("idx_issue_comments_issue").on(table.issueId)],
);

export const issueActivities = sqliteTable("issue_activities", {
  id: text("id").primaryKey(),
  verb: text("verb").default("created"),
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  issueId: text("issue_id").references(() => issues.id, { onDelete: "cascade" }),
  issueCommentId: text("issue_comment_id"),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const issueRelations = sqliteTable("issue_relations", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  relatedIssueId: text("related_issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  relationType: text("relation_type").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const issueSubscribers = sqliteTable(
  "issue_subscribers",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    subscriberId: text("subscriber_id").notNull(),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [uniqueIndex("uq_issue_subscribers_issue_user").on(table.issueId, table.subscriberId)],
);

export const issueReminders = sqliteTable(
  "issue_reminders",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    // The date the reminder fired for (YYYY-MM-DD in the recipient's timezone) —
    // dedupes so a due-date email goes out once per issue per day.
    reminderDate: text("reminder_date").notNull(),
    reminderType: text("reminder_type").notNull().default("target_date"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => [index("idx_issue_reminders_issue").on(table.issueId)],
);

export const issueAttachments = sqliteTable("issue_attachments", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  asset: text("asset"),
  attributes: text("attributes"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const issueLinks = sqliteTable("issue_links", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  title: text("title"),
  url: text("url"),
  metadata: text("metadata"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const issueReactions = sqliteTable("issue_reactions", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  reaction: text("reaction").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const issueSequences = sqliteTable("issue_sequences", {
  id: text("id").primaryKey(),
  sequence: integer("sequence").notNull(),
  issueId: text("issue_id").references(() => issues.id, { onDelete: "set null" }),
  projectId: text("project_id").notNull(),
  isDeleted: integer("is_deleted").notNull().default(0),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const cycles = sqliteTable(
  "cycles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    sortOrder: real("sort_order").notNull().default(65535.0),
    progressSnapshot: text("progress_snapshot"),
    archivedAt: text("archived_at"),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    ownedById: text("owned_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("idx_cycles_project").on(table.projectId)],
);

export const cycleIssues = sqliteTable("cycle_issues", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id")
    .notNull()
    .references(() => cycles.id, { onDelete: "cascade" }),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const modules = sqliteTable(
  "modules",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").default("planned"),
    startDate: text("start_date"),
    targetDate: text("target_date"),
    sortOrder: real("sort_order").notNull().default(65535.0),
    archivedAt: text("archived_at"),
    leadId: text("lead_id").references(() => users.id, { onDelete: "set null" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("idx_modules_project").on(table.projectId)],
);

export const moduleIssues = sqliteTable("module_issues", {
  id: text("id").primaryKey(),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const moduleMembers = sqliteTable("module_members", {
  id: text("id").primaryKey(),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    descriptionJson: text("description_json"),
    descriptionBinary: blob("description_binary"),
    descriptionHtml: text("description_html"),
    descriptionStripped: text("description_stripped"),
    access: integer("access").notNull().default(0),
    color: text("color"),
    archivedAt: text("archived_at"),
    isLocked: integer("is_locked").notNull().default(0),
    sortOrder: real("sort_order").notNull().default(65535.0),
    parentId: text("parent_id").references((): any => pages.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ownedById: text("owned_by_id").notNull(),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("idx_pages_workspace").on(table.workspaceId)],
);

export const pageVersions = sqliteTable("page_versions", {
  id: text("id").primaryKey(),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  descriptionBinary: blob("description_binary"),
  descriptionHtml: text("description_html"),
  descriptionJson: text("description_json"),
  lastSavedAt: text("last_saved_at"),
  ownedById: text("owned_by_id"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    data: text("data"),
    entityIdentifier: text("entity_identifier"),
    entityName: text("entity_name"),
    title: text("title"),
    message: text("message"),
    readAt: text("read_at"),
    archivedAt: text("archived_at"),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    triggeredById: text("triggered_by_id"),
    receiverId: text("receiver_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_notifications_receiver").on(table.receiverId),
    index("idx_notifications_workspace").on(table.workspaceId),
  ],
);

export const notificationPreferences = sqliteTable("notification_preferences", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  workspaceId: text("workspace_id"),
  notificationType: text("notification_type").notNull(),
  emailEnabled: integer("email_enabled").notNull().default(1),
  pushEnabled: integer("push_enabled").notNull().default(1),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

// Workspaces a user hid from their own workspace switcher. Presentation only:
// membership, permissions and every API listing are untouched.
export const userHiddenWorkspaces = sqliteTable(
  "user_hidden_workspaces",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdAt: text("created_at"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.workspaceId] })],
);

// Expo push tokens of the user's devices (native app). A token belongs to one
// user at a time: signing in on a device reassigns it.
export const pushTokens = sqliteTable(
  "push_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_push_tokens_token").on(table.token),
    index("idx_push_tokens_user").on(table.userId),
  ],
);

export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  secret: text("secret"),
  events: text("events"),
  isActive: integer("is_active").notNull().default(1),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const fileAssets = sqliteTable(
  "file_assets",
  {
    id: text("id").primaryKey(),
    asset: text("asset"),
    attributes: text("attributes"),
    entityId: text("entity_id"),
    entityType: text("entity_type"),
    size: integer("size"),
    contentType: text("content_type"),
    isUploaded: integer("is_uploaded").notNull().default(0),
    createdById: text("created_by_id").notNull(),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("idx_file_assets_entity").on(table.entityId, table.entityType)],
);

export const exports_ = sqliteTable("exports", {
  id: text("id").primaryKey(),
  service: text("service").notNull(),
  status: text("status").default("queued"),
  metadata: text("metadata"),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  createdById: text("created_by_id").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const imports = sqliteTable("imports", {
  id: text("id").primaryKey(),
  service: text("service").notNull(),
  status: text("status").default("queued"),
  data: text("data"),
  metadata: text("metadata"),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: text("project_id"),
  createdById: text("created_by_id").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const apiLogs = sqliteTable("api_logs", {
  id: text("id").primaryKey(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  status: integer("status"),
  durationMs: integer("duration_ms"),
  userId: text("user_id"),
  workspaceId: text("workspace_id"),
  createdAt: text("created_at"),
});

export const integrationTokens = sqliteTable("integration_tokens", {
  id: text("id").primaryKey(),
  service: text("service").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: text("expires_at"),
  userId: text("user_id").notNull(),
  workspaceId: text("workspace_id"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const customFields = sqliteTable("custom_fields", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  fieldType: text("field_type").notNull(),
  description: text("description"),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(),
  isRequired: integer("is_required").notNull().default(0),
  sortOrder: real("sort_order").notNull().default(65535.0),
  options: text("options"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

// Values attach a typed JSON payload to an issue per field. Currency values
// are { amount_cents: number, currency: string } — cents keep the deals
// precedent; currency travels with the value.
export const customFieldValues = sqliteTable(
  "custom_field_values",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    customFieldId: text("custom_field_id")
      .notNull()
      .references(() => customFields.id, { onDelete: "cascade" }),
    valueJson: text("value_json"),
    workspaceId: text("workspace_id").notNull(),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("uq_custom_field_value").on(t.issueId, t.customFieldId),
    index("idx_cfv_field").on(t.customFieldId),
  ],
);

export const sprints = sqliteTable(
  "sprints",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    sortOrder: real("sort_order").notNull().default(65535.0),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    ownedById: text("owned_by_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("idx_sprints_project").on(table.projectId)],
);

export const sprintIssues = sqliteTable("sprint_issues", {
  id: text("id").primaryKey(),
  sprintId: text("sprint_id")
    .notNull()
    .references(() => sprints.id, { onDelete: "cascade" }),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  keyHash: text("key_hash").notNull(),
  label: text("label"),
  userId: text("user_id").notNull(),
  workspaceId: text("workspace_id"),
  isActive: integer("is_active").notNull().default(1),
  expiresAt: text("expires_at"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

// ── CRM contacts + customer support portal ──
// A customer is a workspace-scoped contact. Portal customers also have a
// users row (is_customer=1, no password) so they can author issue_comments;
// the session lives on customers.session_token (not users.token) so portal
// customers cannot reach /api/*. A lead/prospect has user_id NULL — no auth
// account. CRM identity key is (workspace, email).
export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    email: text("email"),
    name: text("name"),
    company: text("company"),
    phone: text("phone"),
    status: text("status").notNull().default("active"),
    source: text("source"),
    sessionToken: text("session_token"),
    // Polar customer id when this contact was imported from Polar.
    polarCustomerId: text("polar_customer_id"),
    // ISO timestamp of the last CRM email sent to this contact (rate limit).
    lastEmailAt: text("last_email_at"),
    // Enrichment fields (DEV-9/DEV-12): optional company link + profile data.
    // company stays as a denormalized convenience; company_id is the FK.
    // Forward reference: companies is declared below (circular FK via
    // companies.primary_contact_id) — AnySQLiteColumn breaks the type cycle.
    companyId: text("company_id").references((): AnySQLiteColumn => companies.id, {
      onDelete: "set null",
    }),
    title: text("title"),
    seniority: text("seniority"),
    function: text("function"),
    linkedinUrl: text("linkedin_url"),
    // Threads handle, lowercase without "@". Prospects found on Threads rarely
    // share an email, so this is the contact's second identity key.
    threadsUsername: text("threads_username"),
    imageUrl: text("image_url"),
    // Rollup stamped by the CRM activity timeline (crm_activities).
    lastActivityAt: text("last_activity_at"),
    // When the evidence ledger (contact_facts) last wrote to this contact.
    enrichedAt: text("enriched_at"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => [
    uniqueIndex("uq_customers_workspace_user").on(table.workspaceId, table.userId),
    uniqueIndex("uq_customers_workspace_email").on(table.workspaceId, table.email),
    uniqueIndex("uq_customers_workspace_threads").on(table.workspaceId, table.threadsUsername),
    index("idx_customers_session_token").on(table.sessionToken),
    index("idx_customers_company").on(table.companyId),
  ],
);

// Per-workspace portal config: which project receives tickets + enabled flag.
export const portalSettings = sqliteTable("portal_settings", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  supportProjectId: text("support_project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  isEnabled: integer("is_enabled").notNull().default(0),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

// 1:1 link between a portal ticket and the underlying issue.
export const supportTickets = sqliteTable(
  "support_tickets",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .unique()
      .references(() => issues.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    createdAt: text("created_at"),
  },
  (table) => [index("idx_support_tickets_customer").on(table.customerId)],
);

// ── Time tracking ──
// Time entries logged against an issue. clockifyId reserved for a future
// Clockify sync; unused now.
export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    durationSeconds: integer("duration_seconds").notNull(),
    description: text("description"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    // Agent telemetry lane. `source` splits human timesheets from AI-agent
    // entries; humans always leave the agent columns null. Agent identity is
    // free-text (harness/pane/model string) because API keys are bound to a
    // human user — without it, two agents on one key are indistinguishable.
    source: text("source").notNull().default("human"), // "human" | "agent"
    agentName: text("agent_name"), // e.g. "omp/firstmate", "codex/pane-12"
    model: text("model"), // e.g. "zai/glm-5.3-flash"
    // Token usage as reported by the harness. input/output are the billing
    // buckets; cache/reasoning are reported separately where the provider
    // distinguishes them (Anthropic cache read/write, OpenAI cached/reasoning).
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    clockifyId: text("clockify_id"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_time_entries_issue").on(table.issueId),
    index("idx_time_entries_workspace").on(table.workspaceId),
    index("idx_time_entries_user").on(table.userId),
  ],
);

// ── Model pricing ──
// USD per 1M tokens, per billing bucket. `model` matches time_entries.model
// exactly (the harness-reported string, e.g. "zai/glm-5.3-flash"); models
// without a row are unpriced — aggregate cost surfaces as null, never a guess.
export const modelPrices = sqliteTable("model_prices", {
  model: text("model").primaryKey(),
  inputPerMtok: real("input_per_mtok").notNull(),
  outputPerMtok: real("output_per_mtok").notNull(),
  cacheReadPerMtok: real("cache_read_per_mtok").notNull(),
  cacheWritePerMtok: real("cache_write_per_mtok").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

// ── Feedback portal + embeddable widget ──
// Public feedback boards keyed by an unguessable token. Submissions land as
// issues (external_source='feedback') inside the linked project. Anonymous,
// token-based access only — no customer accounts (unlike the support portal).
export const feedbackBoards = sqliteTable(
  "feedback_boards",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    publicToken: text("public_token").notNull().unique(),
    slug: text("slug"),
    title: text("title").notNull(),
    description: text("description"),
    allowSubmit: integer("allow_submit").notNull().default(1),
    allowVoting: integer("allow_voting").notNull().default(1),
    requireEmail: integer("require_email").notNull().default(0),
    allowComments: integer("allow_comments").notNull().default(1),
    defaultStateId: text("default_state_id"),
    submitLabelId: text("submit_label_id"),
    brandColor: text("brand_color").notNull().default("#6366f1"),
    position: text("position").notNull().default("bottom-right"),
    // HMAC-SHA256 key for Atur.identify() signatures (hex(HMAC(secret, id))).
    // NULL = identify not enforced; email from the widget is accepted as typed.
    identifySecret: text("identify_secret"),
    // Bearer secret in POST /api/ingest/:key. NULL = log ingest disabled.
    ingestKey: text("ingest_key"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => [
    uniqueIndex("uq_feedback_boards_token").on(table.publicToken),
    uniqueIndex("uq_feedback_boards_ingest_key").on(table.ingestKey),
    index("idx_feedback_boards_project").on(table.projectId),
  ],
);

// One row per (issue, voter_hash). Toggle = insert/delete. Upvote-only.
export const feedbackVotes = sqliteTable(
  "feedback_votes",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    voterHash: text("voter_hash").notNull(),
    createdAt: text("created_at"),
  },
  (table) => [
    uniqueIndex("uq_feedback_votes").on(table.issueId, table.voterHash),
    index("idx_feedback_votes_issue").on(table.issueId),
  ],
);

// Public-origin author metadata, kept off the issues row itself.
export const feedbackMeta = sqliteTable(
  "feedback_meta",
  {
    issueId: text("issue_id")
      .primaryKey()
      .references(() => issues.id, { onDelete: "cascade" }),
    authorEmail: text("author_email"),
    authorName: text("author_name"),
    source: text("source"),
    // idea | bug | question. Ideas live on the public board; the rest are tickets.
    kind: text("kind").notNull().default("idea"),
    // Structured auto-context captured by the widget/native app (JSON).
    contextJson: text("context_json"),
    // Host-app user id from Atur.identify().
    externalUserId: text("external_user_id"),
    // 1 when the identify signature (HMAC of `${id}:${email}`) checked out against
    // the board secret, i.e. author_email is proven. 0 = typed/unsigned email: kept
    // for staff and shown "unverified", never linked to a customer or ticket.
    identityVerified: integer("identity_verified").notNull().default(0),
    createdAt: text("created_at"),
  },
  (table) => [index("idx_feedback_meta_email").on(table.authorEmail)],
);

// Files uploaded through the public attachments endpoint. issue_id stays NULL
// until a submission claims the file; unclaimed rows older than the 2h TTL are
// garbage-collected (services/feedback_attachments.ts).
export const feedbackAttachments = sqliteTable(
  "feedback_attachments",
  {
    assetId: text("asset_id")
      .primaryKey()
      .references(() => fileAssets.id, { onDelete: "cascade" }),
    boardId: text("board_id")
      .notNull()
      .references(() => feedbackBoards.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    issueId: text("issue_id").references(() => issues.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_feedback_attachments_issue").on(table.issueId),
    index("idx_feedback_attachments_unclaimed").on(table.issueId, table.createdAt),
  ],
);

// One row per fingerprint per project: log-ingest occurrences collapse into the
// issue referenced here (POST /api/ingest/:key).
export const ingestGroups = sqliteTable(
  "ingest_groups",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    occurrences: integer("occurrences").notNull().default(1),
    level: text("level").notNull().default("error"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_ingest_groups_fingerprint").on(table.projectId, table.fingerprint),
    index("idx_ingest_groups_issue").on(table.issueId),
  ],
);

// ── CRM deals pipeline ──
// A deal IS an issue (issue_id 1:1): the pipeline is the issue's project, the
// stage is the issue's state. Typed amount_cents enables SUM-by-state rollups
// for pipeline totals. customer_id nullable + ON DELETE SET NULL keeps deal
// history when a contact is removed.
export const deals = sqliteTable(
  "deals",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .unique()
      .references(() => issues.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    // Optional account-level link so the pipeline can filter by company.
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    workspaceId: text("workspace_id").notNull(),
    amountCents: integer("amount_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    expectedCloseAt: text("expected_close_at"),
    // Polar provenance on the deal side (external ids — no FK).
    polarSubscriptionId: text("polar_subscription_id"),
    polarOrderId: text("polar_order_id"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => [
    index("idx_deals_customer").on(table.customerId),
    index("idx_deals_workspace").on(table.workspaceId),
  ],
);

// ── CRM Companies (DEV-9) ────────────────────────────────────────────────────
// First-class org entity borrowed conceptually from trycompai/crm's Company.
// Contacts hang off a company via customers.company_id; deals optionally via
// deals.company_id. Soft-deleted (deleted_at) like projects; a deleted company
// set-nulls customer/deal links (no data loss).
export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Nullable-unique per workspace: SQLite unique indexes treat NULLs as
    // distinct, so multiple rows may share a NULL domain.
    domain: text("domain"),
    industry: text("industry"),
    website: text("website"),
    logoUrl: text("logo_url"),
    brandColor: text("brand_color"),
    description: text("description"),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    // Forward reference: customers is declared above (circular FK via
    // customers.company_id) — AnySQLiteColumn breaks the type cycle.
    primaryContactId: text("primary_contact_id").references((): AnySQLiteColumn => customers.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_companies_workspace").on(table.workspaceId),
    uniqueIndex("uq_companies_workspace_domain").on(table.workspaceId, table.domain),
  ],
);

// ── CRM evidence ledger (DEV-11) ──────────────────────────────────────────────
// Drizzle/D1 port of trycompai/crm's ContactFact concept (Prisma/Postgres
// there — concept only, no code). Every write to a contact/company field from
// an agent goes through this ledger: facts whose evidence score clears
// FACT_APPLY_THRESHOLD auto-apply; weaker ones stay PROPOSED until a rep
// applies/dismisses them. Superseded facts are flagged, never deleted.
export const contactFacts = sqliteTable(
  "contact_facts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // A fact targets exactly one entity: either a customer OR a company.
    // customer_id is nullable because company-targeted facts have no contact.
    customerId: text("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    // Optional company target (facts can enrich companies too).
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    field: text("field").notNull(),
    value: text("value").notNull(),
    score: real("score").notNull().default(0),
    // VERIFIED | PROBABLE | POSSIBLE (derived from score).
    band: text("band").notNull().default("POSSIBLE"),
    // JSON array of { source, method, url } — the evidence that backs this fact.
    evidence: text("evidence"),
    method: text("method"),
    sourceUrl: text("source_url"),
    // PROPOSED | APPLIED | DISMISSED | SUPERSEDED.
    status: text("status").notNull().default("PROPOSED"),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: text("decided_at"),
    observedAt: text("observed_at").notNull(),
    supersededAt: text("superseded_at"),
    createdAt: text("created_at"),
  },
  (table) => [
    index("idx_contact_facts_customer_field_status").on(
      table.customerId,
      table.field,
      table.status,
    ),
    index("idx_contact_facts_status_observed").on(table.status, table.observedAt),
    index("idx_contact_facts_company").on(table.companyId),
  ],
);

// ── CRM activity timeline (DEV-12) ────────────────────────────────────────────
// Unified per-contact (and per-deal) timeline. Emitted at CRM mutation points:
// contact created/updated, deal created/stage moved, templated email sent,
// support ticket created, Polar import, ledger enrichment. customers.last_activity_at
// is the rollup for "stale contact" flags in list views.
export const crmActivities = sqliteTable(
  "crm_activities",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    dealId: text("deal_id").references(() => deals.id, { onDelete: "set null" }),
    // NOTE | CALL | EMAIL | MEETING | TASK | MESSAGE | STAGE_CHANGE | ENRICHMENT.
    type: text("type").notNull(),
    subject: text("subject"),
    body: text("body"),
    occurredAt: text("occurred_at").notNull(),
    createdBy: text("created_by"),
    createdAt: text("created_at"),
  },
  (table) => [
    index("idx_crm_activities_customer").on(table.customerId, table.occurredAt),
    index("idx_crm_activities_deal").on(table.dealId, table.occurredAt),
  ],
);

// ── Threads integration ──
// One connected Threads profile per workspace. The long-lived user token
// (60 days) is refreshed by the sync cron before it expires.
export const threadsAccounts = sqliteTable("threads_accounts", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  threadsUserId: text("threads_user_id").notNull(),
  username: text("username").notNull(),
  accessToken: text("access_token").notNull(),
  expiresAt: text("expires_at").notNull(),
  connectedBy: text("connected_by"),
  lastSyncAt: text("last_sync_at"),
  // Last sync failure (Graph error text), cleared by the next good sync.
  lastError: text("last_error"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

// Replies to the account's posts and posts mentioning it, pulled by the sync
// cron. media_id is the Threads post id (dedupe key); status is the rep's
// triage state: open → done (handled) or hidden (hidden on Threads too).
export const threadsInbox = sqliteTable(
  "threads_inbox",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mediaId: text("media_id").notNull(),
    // reply | mention
    kind: text("kind").notNull(),
    username: text("username"),
    text: text("text"),
    permalink: text("permalink"),
    // The post this item answers (for replies: our post or a reply under it).
    repliedToId: text("replied_to_id"),
    rootPostId: text("root_post_id"),
    postedAt: text("posted_at").notNull(),
    status: text("status").notNull().default("open"),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }),
    // Our published reply, when answered from Atur.
    replyMediaId: text("reply_media_id"),
    repliedAt: text("replied_at"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => [
    uniqueIndex("uq_threads_inbox_media").on(table.workspaceId, table.mediaId),
    index("idx_threads_inbox_status").on(table.workspaceId, table.status, table.postedAt),
  ],
);

// ── Polar integration ──
// One row per Polar entity imported into the CRM. Gives idempotency (unique
// on service+type+polar_id) and provenance (which contact/deal a Polar
// customer/subscription/order mapped to). raw holds the latest webhook payload
// for debugging.
export const polarLinks = sqliteTable(
  "polar_links",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    service: text("service").notNull().default("polar"),
    polarType: text("polar_type").notNull(), // 'customer' | 'subscription' | 'order'
    polarId: text("polar_id").notNull(),
    customerId: text("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    dealId: text("deal_id").references(() => deals.id, { onDelete: "cascade" }),
    raw: text("raw"),
    lastEvent: text("last_event"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => [
    // Scoped per workspace: two workspaces may legitimately link the same
    // Polar entity (e.g. both connect the same Polar org) — without
    // workspaceId in the key the second one's inserts hit the constraint.
    uniqueIndex("uq_polar_links_entity").on(
      table.workspaceId,
      table.service,
      table.polarType,
      table.polarId,
    ),
    index("idx_polar_links_customer").on(table.customerId),
    index("idx_polar_links_workspace").on(table.workspaceId),
  ],
);

// Per-workspace Polar configuration: API credentials (entered by the user in
// the Integrations page), which pipeline project imported deals land in, the
// default stage, and whether the webhook receiver is active. The webhook
// endpoint is /webhooks/polar/:slug so each workspace verifies with its own
// webhook secret.
export const polarSettings = sqliteTable("polar_settings", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  webhookSecret: text("webhook_secret"),
  pipelineProjectId: text("pipeline_project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  defaultStateId: text("default_state_id"),
  webhookEnabled: integer("webhook_enabled").notNull().default(0),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

// ── CRM customer email templates ──────────────────────────────────────────────
// Purposes (cold_outreach, welcome, …) live in a code registry
// (services/crm_email_templates.ts); users save arbitrary VARIANTS per
// purpose here, one flagged default per (workspace, purpose). When no
// variant exists the curated code default is used.

export const crmEmailVariants = sqliteTable(
  "crm_email_variants",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    isHtml: integer("is_html").notNull().default(0),
    isDefault: integer("is_default").notNull().default(0),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => [
    uniqueIndex("uq_crm_email_variants").on(table.workspaceId, table.purpose, table.name),
    index("idx_crm_email_variants_workspace").on(table.workspaceId, table.purpose),
  ],
);

// One row per templated-email send attempt (history + per-contact visibility).
export const crmEmailLog = sqliteTable(
  "crm_email_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    // Null when the curated code default was sent (no variant row).
    variantId: text("variant_id"),
    variantName: text("variant_name"),
    subject: text("subject").notNull(),
    sentAt: text("sent_at").notNull(),
    // 0 = attempt logged but the email didn't go out (SEND_EMAIL absent in dev).
    sent: integer("sent").notNull().default(1),
  },
  (table) => [index("idx_crm_email_log_customer").on(table.customerId, table.sentAt)],
);

// Herdr execution-plane audit (ATUR-2). One row per successful WebSocket
// attach to a bridge pane; detached_at is stamped (epoch ms) when either side
// closes the socket. user_id is intentionally not an FK — audit rows must
// survive user deletion. Single-tenant phase: any authenticated user may reach
// any bridge pane (no per-pane workspace ACL yet).
export const paneAudit = sqliteTable(
  "pane_audit",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    paneId: text("pane_id").notNull(),
    attachedAt: integer("attached_at").notNull(),
    detachedAt: integer("detached_at"),
  },
  (table) => [index("idx_pane_audit_user").on(table.userId, table.attachedAt)],
);

// One-time WebSocket tickets for clients that cannot set an Authorization
// header on a WS upgrade (the native app's noVNC WebView). Minted by an
// authenticated POST /api/ws-tickets, redeemed exactly once on the upgrade.
// Only the SHA-256 of the ticket is stored; expires_at / used_at are epoch ms.
export const wsTickets = sqliteTable(
  "ws_tickets",
  {
    hash: text("hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (table) => [index("idx_ws_tickets_expires").on(table.expiresAt)],
);

// Personal quick notes (braindump). Plain-text content; @mentions of
// workspaces/projects/issues are parsed from the text at render time
// (client lib/mentions.ts) — no structured mention columns by design.
// Private to the author: routes/notes.ts only ever touches user_id rows.
export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => [index("idx_notes_user").on(table.userId, table.createdAt)],
);

// ── MCP OAuth 2.1 authorization server (RFC 6749 / 7591 / 7009, PKCE, RFC 8707) ──
// Lets MCP clients (omp, Claude Code, Cursor…) sign in through the browser
// instead of pasting a pk_live_ key. Codes and tokens are stored as SHA-256
// hex digests only — the raw values exist solely in the HTTP responses.

// Dynamically registered public clients (RFC 7591). client_id is a public
// identifier, so it is stored as-is; there is no client secret (PKCE only).
export const oauthClients = sqliteTable("oauth_clients", {
  id: text("id").primaryKey(),
  clientName: text("client_name"),
  redirectUris: text("redirect_uris").notNull(), // JSON string[]
  createdAt: text("created_at"),
});

// Single-use authorization codes. used_at marks redemption; a second
// redemption attempt revokes every token minted from the code (family_id).
export const oauthCodes = sqliteTable(
  "oauth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (table) => [index("idx_oauth_codes_expires").on(table.expiresAt)],
);

// One row per issued access/refresh pair. family_id ties every rotation of a
// grant together (= the authorization code hash) so reuse of a rotated refresh
// token — or of a code — can revoke the whole chain.
export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessHash: text("access_hash").notNull(),
    refreshHash: text("refresh_hash").notNull(),
    resource: text("resource").notNull(),
    scope: text("scope").notNull(),
    accessExpiresAt: integer("access_expires_at").notNull(),
    refreshExpiresAt: integer("refresh_expires_at").notNull(),
    refreshUsedAt: integer("refresh_used_at"),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_oauth_tokens_access").on(table.accessHash),
    uniqueIndex("uq_oauth_tokens_refresh").on(table.refreshHash),
    index("idx_oauth_tokens_family").on(table.familyId),
    index("idx_oauth_tokens_user").on(table.userId),
  ],
);

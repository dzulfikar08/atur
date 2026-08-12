import { sqliteTable, text, integer, real, blob, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  passwordHash: text('password_hash'),
  avatar: text('avatar'),
  token: text('token'),
  userTimezone: text('user_timezone').default('UTC'),
  isActive: integer('is_active').notNull().default(1),
  isSuperuser: integer('is_superuser').notNull().default(0),
  isEmailVerified: integer('is_email_verified').notNull().default(0),
  isBot: integer('is_bot').notNull().default(0),
  isCustomer: integer('is_customer').notNull().default(0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_users_email').on(table.email),
  index('idx_users_token').on(table.token),
  index('idx_users_deleted_at').on(table.deletedAt),
])

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  metadata: text('metadata'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  uniqueIndex('uq_accounts_provider').on(table.provider, table.providerAccountId),
])

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  theme: text('theme'),
  isOnboarded: integer('is_onboarded').notNull().default(0),
  onboardingStep: text('onboarding_step'),
  useCase: text('use_case'),
  role: text('role'),
  language: text('language').default('en'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  organizationSize: text('organization_size'),
  timezone: text('timezone').default('UTC'),
  backgroundColor: text('background_color'),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_workspaces_slug').on(table.slug),
])

export const workspaceMembers = sqliteTable('workspace_members', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: integer('role').notNull().default(15),
  isActive: integer('is_active').notNull().default(1),
  viewProps: text('view_props'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  uniqueIndex('uq_workspace_member').on(table.workspaceId, table.memberId),
  index('idx_workspace_members_workspace').on(table.workspaceId),
  index('idx_workspace_members_member').on(table.memberId),
])

export const workspaceInvites = sqliteTable('workspace_invites', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: integer('role').notNull().default(15),
  token: text('token'),
  accepted: integer('accepted').notNull().default(0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  identifier: text('identifier').notNull(),
  description: text('description'),
  descriptionHtml: text('description_html'),
  descriptionJson: text('description_json'),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  network: integer('network').notNull().default(0),
  emoji: text('emoji'),
  iconProp: text('icon_prop'),
  coverImage: text('cover_image'),
  defaultAssigneeId: text('default_assignee_id'),
  projectLeadId: text('project_lead_id'),
  defaultStateId: text('default_state_id'),
  moduleView: integer('module_view').notNull().default(1),
  cycleView: integer('cycle_view').notNull().default(1),
  pageView: integer('page_view').notNull().default(1),
  intakeView: integer('intake_view').notNull().default(1),
  isTimeTrackingEnabled: integer('is_time_tracking_enabled').notNull().default(0),
  archiveIn: integer('archive_in'),
  closeIn: integer('close_in'),
  timezone: text('timezone').default('UTC'),
  archivedAt: text('archived_at'),
  externalSource: text('external_source'),
  externalId: text('external_id'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  uniqueIndex('uq_project_identifier').on(table.identifier, table.workspaceId),
  index('idx_projects_workspace').on(table.workspaceId),
])

export const projectMembers = sqliteTable('project_members', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  memberId: text('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: integer('role').notNull().default(15),
  isActive: integer('is_active').notNull().default(1),
  sortOrder: real('sort_order').notNull().default(65535.0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const states = sqliteTable('states', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  slug: text('slug'),
  sequence: real('sequence').notNull().default(65535.0),
  groupName: text('group_name').notNull(),
  isTriage: integer('is_triage').notNull().default(0),
  isDefault: integer('is_default').notNull().default(0),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_states_project').on(table.projectId),
])

export const labels = sqliteTable('labels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  sortOrder: real('sort_order').notNull().default(65535.0),
  parentId: text('parent_id').references((): any => labels.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  projectId: text('project_id'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_labels_workspace').on(table.workspaceId),
])

export const estimates = sqliteTable('estimates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const estimatePoints = sqliteTable('estimate_points', {
  id: text('id').primaryKey(),
  estimateId: text('estimate_id').notNull(),
  key: text('key').notNull(),
  value: text('value'),
  sortOrder: real('sort_order').notNull().default(65535.0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const issues = sqliteTable('issues', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sequenceId: integer('sequence_id').notNull(),
  sortOrder: real('sort_order').notNull().default(65535.0),
  priority: text('priority').default('none'),
  startDate: text('start_date'),
  targetDate: text('target_date'),
  completedAt: text('completed_at'),
  archivedAt: text('archived_at'),
  isDraft: integer('is_draft').notNull().default(0),
  descriptionJson: text('description_json'),
  descriptionHtml: text('description_html'),
  descriptionStripped: text('description_stripped'),
  descriptionBinary: blob('description_binary'),
  parentId: text('parent_id').references((): any => issues.id, { onDelete: 'cascade' }),
  stateId: text('state_id').references(() => states.id, { onDelete: 'cascade' }),
  estimatePointId: text('estimate_point_id'),
  estimatePoints: integer('estimate_points'),
  typeId: text('type_id'),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  createdById: text('created_by_id'),
  externalSource: text('external_source'),
  externalId: text('external_id'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  uniqueIndex('uq_issue_sequence').on(table.projectId, table.sequenceId),
  index('idx_issues_project').on(table.projectId),
  index('idx_issues_workspace').on(table.workspaceId),
  index('idx_issues_state').on(table.stateId),
  index('idx_issues_deleted_at').on(table.deletedAt),
])

export const issueAssignees = sqliteTable('issue_assignees', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  assigneeId: text('assignee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_issue_assignees_issue').on(table.issueId),
])

export const issueLabels = sqliteTable('issue_labels', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  labelId: text('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_issue_labels_issue').on(table.issueId),
])

export const issueComments = sqliteTable('issue_comments', {
  id: text('id').primaryKey(),
  commentStripped: text('comment_stripped'),
  commentJson: text('comment_json'),
  commentHtml: text('comment_html'),
  access: text('access').default('internal'),
  parentId: text('parent_id'),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_issue_comments_issue').on(table.issueId),
])

export const issueActivities = sqliteTable('issue_activities', {
  id: text('id').primaryKey(),
  verb: text('verb').default('created'),
  field: text('field'),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  issueId: text('issue_id').references(() => issues.id, { onDelete: 'cascade' }),
  issueCommentId: text('issue_comment_id'),
  actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const issueRelations = sqliteTable('issue_relations', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  relatedIssueId: text('related_issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  relationType: text('relation_type').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const issueSubscribers = sqliteTable('issue_subscribers', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  subscriberId: text('subscriber_id').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const issueAttachments = sqliteTable('issue_attachments', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  asset: text('asset'),
  attributes: text('attributes'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const issueLinks = sqliteTable('issue_links', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  title: text('title'),
  url: text('url'),
  metadata: text('metadata'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const issueReactions = sqliteTable('issue_reactions', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull(),
  reaction: text('reaction').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const issueSequences = sqliteTable('issue_sequences', {
  id: text('id').primaryKey(),
  sequence: integer('sequence').notNull(),
  issueId: text('issue_id').references(() => issues.id, { onDelete: 'set null' }),
  projectId: text('project_id').notNull(),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const cycles = sqliteTable('cycles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  sortOrder: real('sort_order').notNull().default(65535.0),
  progressSnapshot: text('progress_snapshot'),
  archivedAt: text('archived_at'),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  ownedById: text('owned_by_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_cycles_project').on(table.projectId),
])

export const cycleIssues = sqliteTable('cycle_issues', {
  id: text('id').primaryKey(),
  cycleId: text('cycle_id').notNull().references(() => cycles.id, { onDelete: 'cascade' }),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const modules = sqliteTable('modules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').default('planned'),
  startDate: text('start_date'),
  targetDate: text('target_date'),
  sortOrder: real('sort_order').notNull().default(65535.0),
  archivedAt: text('archived_at'),
  leadId: text('lead_id').references(() => users.id, { onDelete: 'set null' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_modules_project').on(table.projectId),
])

export const moduleIssues = sqliteTable('module_issues', {
  id: text('id').primaryKey(),
  moduleId: text('module_id').notNull().references(() => modules.id, { onDelete: 'cascade' }),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const moduleMembers = sqliteTable('module_members', {
  id: text('id').primaryKey(),
  moduleId: text('module_id').notNull().references(() => modules.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const pages = sqliteTable('pages', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  descriptionJson: text('description_json'),
  descriptionBinary: blob('description_binary'),
  descriptionHtml: text('description_html'),
  descriptionStripped: text('description_stripped'),
  access: integer('access').notNull().default(0),
  color: text('color'),
  archivedAt: text('archived_at'),
  isLocked: integer('is_locked').notNull().default(0),
  sortOrder: real('sort_order').notNull().default(65535.0),
  parentId: text('parent_id').references((): any => pages.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  ownedById: text('owned_by_id').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_pages_workspace').on(table.workspaceId),
])

export const pageVersions = sqliteTable('page_versions', {
  id: text('id').primaryKey(),
  pageId: text('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  descriptionBinary: blob('description_binary'),
  descriptionHtml: text('description_html'),
  descriptionJson: text('description_json'),
  lastSavedAt: text('last_saved_at'),
  ownedById: text('owned_by_id'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  data: text('data'),
  entityIdentifier: text('entity_identifier'),
  entityName: text('entity_name'),
  title: text('title'),
  message: text('message'),
  readAt: text('read_at'),
  archivedAt: text('archived_at'),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  projectId: text('project_id'),
  triggeredById: text('triggered_by_id'),
  receiverId: text('receiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_notifications_receiver').on(table.receiverId),
  index('idx_notifications_workspace').on(table.workspaceId),
])

export const notificationPreferences = sqliteTable('notification_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  workspaceId: text('workspace_id'),
  notificationType: text('notification_type').notNull(),
  emailEnabled: integer('email_enabled').notNull().default(1),
  pushEnabled: integer('push_enabled').notNull().default(1),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  secret: text('secret'),
  events: text('events'),
  isActive: integer('is_active').notNull().default(1),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const fileAssets = sqliteTable('file_assets', {
  id: text('id').primaryKey(),
  asset: text('asset'),
  attributes: text('attributes'),
  entityId: text('entity_id'),
  entityType: text('entity_type'),
  size: integer('size'),
  contentType: text('content_type'),
  isUploaded: integer('is_uploaded').notNull().default(0),
  createdById: text('created_by_id').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_file_assets_entity').on(table.entityId, table.entityType),
])

export const exports_ = sqliteTable('exports', {
  id: text('id').primaryKey(),
  service: text('service').notNull(),
  status: text('status').default('queued'),
  metadata: text('metadata'),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  createdById: text('created_by_id').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const imports = sqliteTable('imports', {
  id: text('id').primaryKey(),
  service: text('service').notNull(),
  status: text('status').default('queued'),
  data: text('data'),
  metadata: text('metadata'),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  projectId: text('project_id'),
  createdById: text('created_by_id').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const apiLogs = sqliteTable('api_logs', {
  id: text('id').primaryKey(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  status: integer('status'),
  durationMs: integer('duration_ms'),
  userId: text('user_id'),
  workspaceId: text('workspace_id'),
  createdAt: text('created_at'),
})

export const integrationTokens = sqliteTable('integration_tokens', {
  id: text('id').primaryKey(),
  service: text('service').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: text('expires_at'),
  userId: text('user_id').notNull(),
  workspaceId: text('workspace_id'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const customFields = sqliteTable('custom_fields', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  fieldType: text('field_type').notNull(),
  description: text('description'),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  isRequired: integer('is_required').notNull().default(0),
  sortOrder: real('sort_order').notNull().default(65535.0),
  options: text('options'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const sprints = sqliteTable('sprints', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  sortOrder: real('sort_order').notNull().default(65535.0),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  ownedById: text('owned_by_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_sprints_project').on(table.projectId),
])

export const sprintIssues = sqliteTable('sprint_issues', {
  id: text('id').primaryKey(),
  sprintId: text('sprint_id').notNull().references(() => sprints.id, { onDelete: 'cascade' }),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  keyHash: text('key_hash').notNull(),
  label: text('label'),
  userId: text('user_id').notNull(),
  workspaceId: text('workspace_id'),
  isActive: integer('is_active').notNull().default(1),
  expiresAt: text('expires_at'),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
})

// ── CRM contacts + customer support portal ──
// A customer is a workspace-scoped contact. Portal customers also have a
// users row (is_customer=1, no password) so they can author issue_comments;
// the session lives on customers.session_token (not users.token) so portal
// customers cannot reach /api/*. A lead/prospect has user_id NULL — no auth
// account. CRM identity key is (workspace, email).
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  email: text('email'),
  name: text('name'),
  company: text('company'),
  phone: text('phone'),
  status: text('status').notNull().default('active'),
  source: text('source'),
  sessionToken: text('session_token'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
}, (table) => [
  uniqueIndex('uq_customers_workspace_user').on(table.workspaceId, table.userId),
  uniqueIndex('uq_customers_workspace_email').on(table.workspaceId, table.email),
  index('idx_customers_session_token').on(table.sessionToken),
])

// Per-workspace portal config: which project receives tickets + enabled flag.
export const portalSettings = sqliteTable('portal_settings', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  supportProjectId: text('support_project_id').references(() => projects.id, { onDelete: 'set null' }),
  isEnabled: integer('is_enabled').notNull().default(0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
})

// 1:1 link between a portal ticket and the underlying issue.
export const supportTickets = sqliteTable('support_tickets', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().unique().references(() => issues.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  createdAt: text('created_at'),
}, (table) => [
  index('idx_support_tickets_customer').on(table.customerId),
])

// ── Time tracking ──
// Time entries logged against an issue. Mirror of the legacy Rust entity
// (crates/db/src/entities/time_entries.rs). clockifyId reserved for a future
// Clockify sync; unused now.
export const timeEntries = sqliteTable('time_entries', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  durationSeconds: integer('duration_seconds').notNull(),
  description: text('description'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  clockifyId: text('clockify_id'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_time_entries_issue').on(table.issueId),
  index('idx_time_entries_workspace').on(table.workspaceId),
  index('idx_time_entries_user').on(table.userId),
])

// ── Feedback portal + embeddable widget ──
// Public feedback boards keyed by an unguessable token. Submissions land as
// issues (external_source='feedback') inside the linked project. Anonymous,
// token-based access only — no customer accounts (unlike the support portal).
export const feedbackBoards = sqliteTable('feedback_boards', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  publicToken: text('public_token').notNull().unique(),
  slug: text('slug'),
  title: text('title').notNull(),
  description: text('description'),
  allowSubmit: integer('allow_submit').notNull().default(1),
  allowVoting: integer('allow_voting').notNull().default(1),
  requireEmail: integer('require_email').notNull().default(0),
  allowComments: integer('allow_comments').notNull().default(1),
  defaultStateId: text('default_state_id'),
  submitLabelId: text('submit_label_id'),
  brandColor: text('brand_color').notNull().default('#6366f1'),
  position: text('position').notNull().default('bottom-right'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
}, (table) => [
  uniqueIndex('uq_feedback_boards_token').on(table.publicToken),
  index('idx_feedback_boards_project').on(table.projectId),
])

// One row per (issue, voter_hash). Toggle = insert/delete. Upvote-only.
export const feedbackVotes = sqliteTable('feedback_votes', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  voterHash: text('voter_hash').notNull(),
  createdAt: text('created_at'),
}, (table) => [
  uniqueIndex('uq_feedback_votes').on(table.issueId, table.voterHash),
  index('idx_feedback_votes_issue').on(table.issueId),
])

// Public-origin author metadata, kept off the issues row itself.
export const feedbackMeta = sqliteTable('feedback_meta', {
  issueId: text('issue_id').primaryKey().references(() => issues.id, { onDelete: 'cascade' }),
  authorEmail: text('author_email'),
  authorName: text('author_name'),
  source: text('source'),
  createdAt: text('created_at'),
})

// ── CRM deals pipeline ──
// A deal IS an issue (issue_id 1:1): the pipeline is the issue's project, the
// stage is the issue's state. Typed amount_cents enables SUM-by-state rollups
// for pipeline totals. customer_id nullable + ON DELETE SET NULL keeps deal
// history when a contact is removed.
export const deals = sqliteTable('deals', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().unique().references(() => issues.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  workspaceId: text('workspace_id').notNull(),
  amountCents: integer('amount_cents').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  expectedCloseAt: text('expected_close_at'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
}, (table) => [
  index('idx_deals_customer').on(table.customerId),
  index('idx_deals_workspace').on(table.workspaceId),
])

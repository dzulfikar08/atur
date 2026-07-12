CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT,
    password_hash TEXT,
    avatar TEXT,
    token TEXT,
    user_timezone TEXT DEFAULT 'UTC',
    is_active INTEGER NOT NULL DEFAULT 1,
    is_superuser INTEGER NOT NULL DEFAULT 0,
    is_email_verified INTEGER NOT NULL DEFAULT 0,
    is_bot INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    metadata TEXT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    theme TEXT,
    is_onboarded INTEGER NOT NULL DEFAULT 0,
    onboarding_step TEXT,
    use_case TEXT,
    role TEXT,
    language TEXT DEFAULT 'en',
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo TEXT,
    organization_size TEXT,
    timezone TEXT DEFAULT 'UTC',
    background_color TEXT,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS workspace_members (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INTEGER NOT NULL DEFAULT 15,
    is_active INTEGER NOT NULL DEFAULT 1,
    view_props TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    UNIQUE(workspace_id, member_id)
);

CREATE TABLE IF NOT EXISTS workspace_invites (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role INTEGER NOT NULL DEFAULT 15,
    token TEXT,
    accepted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL,
    description TEXT,
    description_html TEXT,
    description_json TEXT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    network INTEGER NOT NULL DEFAULT 0,
    emoji TEXT,
    icon_prop TEXT,
    cover_image TEXT,
    default_assignee_id TEXT,
    project_lead_id TEXT,
    default_state_id TEXT,
    module_view INTEGER NOT NULL DEFAULT 1,
    cycle_view INTEGER NOT NULL DEFAULT 1,
    page_view INTEGER NOT NULL DEFAULT 1,
    intake_view INTEGER NOT NULL DEFAULT 1,
    is_time_tracking_enabled INTEGER NOT NULL DEFAULT 0,
    archive_in INTEGER,
    close_in INTEGER,
    timezone TEXT DEFAULT 'UTC',
    archived_at TEXT,
    external_source TEXT,
    external_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    UNIQUE(identifier, workspace_id)
);

CREATE TABLE IF NOT EXISTS project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INTEGER NOT NULL DEFAULT 15,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order REAL NOT NULL DEFAULT 65535.0,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS states (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    slug TEXT,
    sequence REAL NOT NULL DEFAULT 65535.0,
    group_name TEXT NOT NULL,
    is_triage INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    sort_order REAL NOT NULL DEFAULT 65535.0,
    parent_id TEXT REFERENCES labels(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS estimates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS estimate_points (
    id TEXT PRIMARY KEY,
    estimate_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    sort_order REAL NOT NULL DEFAULT 65535.0,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sequence_id INTEGER NOT NULL,
    sort_order REAL NOT NULL DEFAULT 65535.0,
    priority TEXT DEFAULT 'none',
    start_date TEXT,
    target_date TEXT,
    completed_at TEXT,
    archived_at TEXT,
    is_draft INTEGER NOT NULL DEFAULT 0,
    description_json TEXT,
    description_html TEXT,
    description_stripped TEXT,
    description_binary BLOB,
    parent_id TEXT REFERENCES issues(id) ON DELETE CASCADE,
    state_id TEXT REFERENCES states(id) ON DELETE CASCADE,
    estimate_point_id TEXT,
    type_id TEXT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    created_by_id TEXT,
    external_source TEXT,
    external_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    UNIQUE(project_id, sequence_id)
);

CREATE TABLE IF NOT EXISTS issue_assignees (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    assignee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_labels (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_comments (
    id TEXT PRIMARY KEY,
    comment_stripped TEXT,
    comment_json TEXT,
    comment_html TEXT,
    access TEXT DEFAULT 'internal',
    parent_id TEXT,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_activities (
    id TEXT PRIMARY KEY,
    verb TEXT DEFAULT 'created',
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    issue_id TEXT REFERENCES issues(id) ON DELETE CASCADE,
    issue_comment_id TEXT,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_relations (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    related_issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_subscribers (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    subscriber_id TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_attachments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    asset TEXT,
    attributes TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_links (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    title TEXT,
    url TEXT,
    metadata TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_reactions (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    reaction TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_sequences (
    id TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL,
    issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
    project_id TEXT NOT NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS cycles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    start_date TEXT,
    end_date TEXT,
    sort_order REAL NOT NULL DEFAULT 65535.0,
    progress_snapshot TEXT,
    archived_at TEXT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    owned_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS cycle_issues (
    id TEXT PRIMARY KEY,
    cycle_id TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS modules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'planned',
    start_date TEXT,
    target_date TEXT,
    sort_order REAL NOT NULL DEFAULT 65535.0,
    archived_at TEXT,
    lead_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS module_issues (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS module_members (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description_json TEXT,
    description_binary BLOB,
    description_html TEXT,
    description_stripped TEXT,
    access INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    archived_at TEXT,
    is_locked INTEGER NOT NULL DEFAULT 0,
    sort_order REAL NOT NULL DEFAULT 65535.0,
    parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    owned_by_id TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS page_versions (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    description_binary BLOB,
    description_html TEXT,
    description_json TEXT,
    last_saved_at TEXT,
    owned_by_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    data TEXT,
    entity_identifier TEXT,
    entity_name TEXT,
    title TEXT,
    message TEXT,
    read_at TEXT,
    archived_at TEXT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT,
    triggered_by_id TEXT,
    receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS notification_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT,
    notification_type TEXT NOT NULL,
    email_enabled INTEGER NOT NULL DEFAULT 1,
    push_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    secret TEXT,
    events TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS file_assets (
    id TEXT PRIMARY KEY,
    asset TEXT,
    attributes TEXT,
    entity_id TEXT,
    entity_type TEXT,
    size INTEGER,
    content_type TEXT,
    is_uploaded INTEGER NOT NULL DEFAULT 0,
    created_by_id TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY,
    service TEXT NOT NULL,
    status TEXT DEFAULT 'queued',
    data TEXT,
    metadata TEXT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT,
    created_by_id TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS api_logs (
    id TEXT PRIMARY KEY,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER,
    duration_ms INTEGER,
    user_id TEXT,
    workspace_id TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS integration_tokens (
    id TEXT PRIMARY KEY,
    service TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TEXT,
    user_id TEXT NOT NULL,
    workspace_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS custom_fields (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    field_type TEXT NOT NULL,
    description TEXT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 0,
    sort_order REAL NOT NULL DEFAULT 65535.0,
    options TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL,
    label TEXT,
    user_id TEXT NOT NULL,
    workspace_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT,
    last_used_at TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_member ON workspace_members(member_id);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
CREATE INDEX IF NOT EXISTS idx_issues_workspace ON issues(workspace_id);
CREATE INDEX IF NOT EXISTS idx_issues_state ON issues(state_id);
CREATE INDEX IF NOT EXISTS idx_issues_deleted_at ON issues(deleted_at);
CREATE INDEX IF NOT EXISTS idx_issue_assignees_issue ON issue_assignees(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_labels_issue ON issue_labels(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_comments_issue ON issue_comments(issue_id);
CREATE INDEX IF NOT EXISTS idx_cycles_project ON cycles(project_id);
CREATE INDEX IF NOT EXISTS idx_modules_project ON modules(project_id);
CREATE INDEX IF NOT EXISTS idx_pages_workspace ON pages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notifications_receiver ON notifications(receiver_id);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_file_assets_entity ON file_assets(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_labels_workspace ON labels(workspace_id);
CREATE INDEX IF NOT EXISTS idx_states_project ON states(project_id);

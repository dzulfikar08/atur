-- Fresh-DB seed for atur-hono (server-js).
-- Login: dev@atur.local / password123
-- Password hash = sha256("password123" + "HelloWorldFoo123") : saltHex
-- Run: wrangler d1 execute DB --local --file=seed.sql   (or --remote for prod)

-- ---- User + profile ----
INSERT OR IGNORE INTO users (id, email, username, display_name, password_hash, token, user_timezone, is_active, is_superuser, is_email_verified, is_bot, created_at, updated_at)
VALUES ('dev-user-001', 'dev@atur.local', 'dev', 'Dev User',
        'a1f136d6cce2e126c85ebccc16206142c1e476e71079203e797d36edf0b26f1c:48656c6c6f576f726c64466f6f313233',
        'dev-token-00000000000000000000000000', 'UTC', 1, 1, 1, 0, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO profiles (id, theme, is_onboarded, onboarding_step, use_case, role, language, user_id, created_at, updated_at)
VALUES ('dev-profile-001', NULL, 1, NULL, 'software', 'admin', 'en', 'dev-user-001', datetime('now'), datetime('now'));

-- ---- Workspace + owner membership ----
INSERT OR IGNORE INTO workspaces (id, name, slug, logo, organization_size, timezone, owner_id, created_at, updated_at)
VALUES ('ws-demo', 'Demo Workspace', 'demo', NULL, '2-10', 'UTC', 'dev-user-001', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO workspace_members (id, workspace_id, member_id, role, is_active, created_at, updated_at)
VALUES ('wm-001', 'ws-demo', 'dev-user-001', 20, 1, datetime('now'), datetime('now'));

-- ---- Project ----
INSERT OR IGNORE INTO projects (id, name, identifier, description, workspace_id, network, default_state_id, module_view, cycle_view, page_view, intake_view, is_time_tracking_enabled, timezone, created_at, updated_at)
VALUES ('proj-demo', 'Demo Project', 'DEMO', 'Seed project for exploration', 'ws-demo', 0, 'st-done', 1, 1, 1, 1, 0, 'UTC', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO project_members (id, project_id, workspace_id, member_id, role, is_active, created_at, updated_at)
VALUES ('pm-001', 'proj-demo', 'ws-demo', 'dev-user-001', 20, 1, datetime('now'), datetime('now'));

-- ---- States ----
INSERT OR IGNORE INTO states (id, name, description, color, slug, sequence, group_name, is_triage, is_default, project_id, workspace_id, created_at, updated_at) VALUES
 ('st-backlog', 'Backlog',   'Backlog items',     '#808080', 'backlog',     65535, 'backlog',   0, 0, 'proj-demo', 'ws-demo', datetime('now'), datetime('now')),
 ('st-todo',    'Todo',      'Ready to start',    '#8b5cf6', 'todo',        65535, 'started',   0, 1, 'proj-demo', 'ws-demo', datetime('now'), datetime('now')),
 ('st-progress','In Progress','Being worked on',  '#f59e0b', 'in-progress', 65535, 'started',   0, 0, 'proj-demo', 'ws-demo', datetime('now'), datetime('now')),
 ('st-done',    'Done',      'Completed',         '#22c55e', 'done',        65535, 'completed', 0, 0, 'proj-demo', 'ws-demo', datetime('now'), datetime('now'));

-- ---- Labels ----
INSERT OR IGNORE INTO labels (id, name, description, color, sort_order, workspace_id, project_id, created_at, updated_at) VALUES
 ('lbl-bug',  'Bug',     'Something is broken',   '#ef4444', 65535, 'ws-demo', 'proj-demo', datetime('now'), datetime('now')),
 ('lbl-feat', 'Feature', 'New functionality',     '#22c55e', 65535, 'ws-demo', 'proj-demo', datetime('now'), datetime('now')),
 ('lbl-doc',  'Docs',    'Documentation',         '#3b82f6', 65535, 'ws-demo', 'proj-demo', datetime('now'), datetime('now'));

-- ---- Sample issues ----
INSERT OR IGNORE INTO issues (id, name, sequence_id, sort_order, priority, description_html, description_stripped, state_id, project_id, workspace_id, created_by_id, created_at, updated_at) VALUES
 ('isu-001', 'Set up project board',         1, 65535, 'high',   '<p>Initial board setup</p>', 'Initial board setup',         'st-done',    'proj-demo', 'ws-demo', 'dev-user-001', datetime('now'), datetime('now')),
 ('isu-002', 'Implement authentication',     2, 65535, 'urgent', '<p>Login + register flow</p>','Login + register flow',      'st-progress','proj-demo', 'ws-demo', 'dev-user-001', datetime('now'), datetime('now')),
 ('isu-003', 'Add issue detail view',        3, 65535, 'medium', '<p>Detail sidebar</p>',       'Detail sidebar',             'st-todo',    'proj-demo', 'ws-demo', 'dev-user-001', datetime('now'), datetime('now')),
 ('isu-004', 'Write README',                 4, 65535, 'low',    '<p>Project docs</p>',         'Project docs',               'st-backlog', 'proj-demo', 'ws-demo', 'dev-user-001', datetime('now'), datetime('now'));

-- ---- Sample module + cycle ----
INSERT OR IGNORE INTO modules (id, name, description, status, project_id, workspace_id, created_at, updated_at)
VALUES ('mod-mvp', 'MVP', 'Minimum viable scope', 'in-progress', 'proj-demo', 'ws-demo', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO module_issues (id, module_id, issue_id, created_at, updated_at)
VALUES ('mi-001', 'mod-mvp', 'isu-001', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO cycles (id, name, description, start_date, end_date, project_id, workspace_id, owned_by_id, created_at, updated_at)
VALUES ('cyc-sprint1', 'Sprint 1', 'First sprint', date('now','-6 days'), date('now','+1 day'), 'proj-demo', 'ws-demo', 'dev-user-001', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO cycle_issues (id, cycle_id, issue_id, created_at, updated_at)
VALUES ('ci-001', 'cyc-sprint1', 'isu-002', datetime('now'), datetime('now'));

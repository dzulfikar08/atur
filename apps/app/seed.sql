-- Fresh-DB seed for atur-hono (server-js).
-- Login: dev@atur.local / password123
-- Password hash = sha256("password123" + "HelloWorldFoo123") : saltHex
-- Run: wrangler d1 execute DB --local --file=seed.sql   (or --remote for prod)
--
-- NOTE: IDs must be UUID-format — write routes validate ids with z.string().uuid()
-- (e.g. issues.state_id, label_ids). Deterministic UUIDs (e.g. '00000000-0000-4000-8000-000000000001')
-- keep the seed readable while satisfying the schemas.

-- ---- User + profile ----
INSERT OR IGNORE INTO users (id, email, username, display_name, password_hash, token, user_timezone, is_active, is_superuser, is_email_verified, is_bot, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', 'dev@atur.local', 'dev', 'Dev User',
        'a1f136d6cce2e126c85ebccc16206142c1e476e71079203e797d36edf0b26f1c:48656c6c6f576f726c64466f6f313233',
        'dev-token-00000000000000000000000000', 'UTC', 1, 1, 1, 0, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO profiles (id, theme, is_onboarded, onboarding_step, use_case, role, language, user_id, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000002', NULL, 1, NULL, 'software', 'admin', 'en', '00000000-0000-4000-8000-000000000001', datetime('now'), datetime('now'));

-- ---- Workspace + owner membership ----
INSERT OR IGNORE INTO workspaces (id, name, slug, logo, organization_size, timezone, owner_id, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000003', 'Demo Workspace', 'demo', NULL, '2-10', 'UTC', '00000000-0000-4000-8000-000000000001', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO workspace_members (id, workspace_id, member_id, role, is_active, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 20, 1, datetime('now'), datetime('now'));

-- ---- Project ----
INSERT OR IGNORE INTO projects (id, name, identifier, description, workspace_id, network, default_state_id, module_view, cycle_view, page_view, intake_view, is_time_tracking_enabled, timezone, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000005', 'Demo Project', 'DEMO', 'Seed project for exploration', '00000000-0000-4000-8000-000000000003', 0, '00000000-0000-4000-8000-000000000009', 1, 1, 1, 1, 0, 'UTC', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO project_members (id, project_id, workspace_id, member_id, role, is_active, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 20, 1, datetime('now'), datetime('now'));

-- ---- States ----
INSERT OR IGNORE INTO states (id, name, description, color, slug, sequence, group_name, `key`, is_triage, is_default, project_id, workspace_id, created_at, updated_at) VALUES
 ('00000000-0000-4000-8000-000000000007', 'Backlog',   'Backlog items',     '#808080', 'backlog',     65535, 'backlog',   'backlog',     0, 0, '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', datetime('now'), datetime('now')),
 ('00000000-0000-4000-8000-000000000008', 'Todo',      'Ready to start',    '#8b5cf6', 'todo',        65535, 'started',   'todo',        0, 1, '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', datetime('now'), datetime('now')),
 ('00000000-0000-4000-8000-000000000009', 'In Progress','Being worked on',  '#f59e0b', 'in-progress', 65535, 'started',   'in_progress', 0, 0, '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', datetime('now'), datetime('now')),
 ('00000000-0000-4000-8000-000000000010', 'Done',      'Completed',         '#22c55e', 'done',        65535, 'completed', 'done',        0, 0, '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', datetime('now'), datetime('now'));

-- ---- Labels ----
INSERT OR IGNORE INTO labels (id, name, description, color, sort_order, workspace_id, project_id, created_at, updated_at) VALUES
 ('00000000-0000-4000-8000-000000000011', 'Bug',     'Something is broken',   '#ef4444', 65535, '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005', datetime('now'), datetime('now')),
 ('00000000-0000-4000-8000-000000000012', 'Feature', 'New functionality',     '#22c55e', 65535, '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005', datetime('now'), datetime('now')),
 ('00000000-0000-4000-8000-000000000013', 'Docs',    'Documentation',         '#3b82f6', 65535, '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005', datetime('now'), datetime('now'));

-- ---- Sample issues ----
INSERT OR IGNORE INTO issues (id, name, sequence_id, sort_order, priority, description_html, description_stripped, state_id, project_id, workspace_id, created_by_id, created_at, updated_at) VALUES
 ('00000000-0000-4000-8000-000000000014', 'Set up project board',         1, 65535, 'high',   '<p>Initial board setup</p>', 'Initial board setup',         '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', datetime('now'), datetime('now')),
 ('00000000-0000-4000-8000-000000000015', 'Implement authentication',     2, 65535, 'urgent', '<p>Login + register flow</p>','Login + register flow',      '00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', datetime('now'), datetime('now')),
 ('00000000-0000-4000-8000-000000000016', 'Add issue detail view',        3, 65535, 'medium', '<p>Detail sidebar</p>',       'Detail sidebar',             '00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', datetime('now'), datetime('now')),
 ('00000000-0000-4000-8000-000000000017', 'Write README',                 4, 65535, 'low',    '<p>Project docs</p>',         'Project docs',               '00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', datetime('now'), datetime('now'));

-- ---- Sample module + cycle ----
INSERT OR IGNORE INTO modules (id, name, description, status, project_id, workspace_id, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000018', 'MVP', 'Minimum viable scope', 'in-progress', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO module_issues (id, module_id, issue_id, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000019', '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000014', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO cycles (id, name, description, start_date, end_date, project_id, workspace_id, owned_by_id, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000020', 'Sprint 1', 'First sprint', date('now','-6 days'), date('now','+1 day'), '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO cycle_issues (id, cycle_id, issue_id, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000015', datetime('now'), datetime('now'));

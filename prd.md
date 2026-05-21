# Plane Rust Rewrite - PRD & Roadmap

## 1. Overview

Rewrite the [Plane](https://github.com/makeplane/plane) self-hosted project management tool backend in Rust. The goal is a single-binary server that runs on a $4/month VPS (1 core / 1 GB RAM) with full feature parity to Plane's Community Edition (Free tier).

### Why Rust

- **10-20x less memory** than Django/Python per process
- **No runtime overhead** - no GC, no interpreter, no Erlang VM
- **Single binary** - collapse 12 containers into 1 process
- **Built-in async** - tokio handles HTTP + background tasks + scheduling in one runtime
- **SQLite/PostgreSQL** - choose based on scale (SQLite for small teams, PG for larger)

### Target Hardware

| Tier | Specs | Expected Users |
|---|---|---|
| Nano | 1 core / 1 GB RAM / 10 GB disk | 1-5 users |
| Small | 2 core / 2 GB RAM / 20 GB disk | 5-20 users |
| Medium | 2 core / 4 GB RAM / 50 GB disk | 20-100 users |

### What We Build (CE parity)

Community Edition features only. No license key system, no paywall code. All Business/Pro features are open:

- Unlimited users (CE has 12-user limit - we remove this)
- Work item types & custom properties
- Dashboards
- Time tracking
- Project templates
- Recurring work items
- Everything else from the CE codebase

### What We Don't Build

- **Plane Cloud sync** - fully standalone
- **License/telemetry** - no phone-home
- **Commercial Edition features** that require separate closed-source services
- **MinIO** - use local filesystem or S3 directly
- **RabbitMQ** - use Redis streams or in-process queue
- **Separate live server** - embed WebSocket handling in the binary

---

## 2. Architecture

### Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| HTTP framework | **Axum** | Tower ecosystem, best async story, macro-free |
| ORM | **SeaORM** (PostgreSQL) / **rusqlite** (SQLite) | SeaORM is the most mature Rust ORM; SQLite for nano deployments |
| Background tasks | **tokio::spawn** + **apalis** (with Redis/SQLite backend) | In-process task queue, no external broker needed |
| Template engine | **askama** | Compile-time typed templates for emails |
| Auth | **tower-sessions** + custom OAuth | Session-based, same as Plane |
| WebSocket | **axum::extract::ws** + **yrs** (Rust Y.js) | Embedded real-time collaboration |
| Search | **tantivy** | Full-text search, no ElasticSearch needed |
| Migrations | **sea-orm-cli** | Versioned schema migrations |
| Object storage | **rust-s3** crate | S3-compatible, or local filesystem |
| Frontend | **Static files** (React SPA served by Axum) | Reuse Plane's frontend with API compatibility |

### Single Binary Architecture

```
plane-pmo (single binary)
├── HTTP server (Axum)
│   ├── /api/*           → REST API endpoints
│   ├── /auth/*          → Authentication (OAuth, email, magic link)
│   ├── /live/*          → WebSocket collaboration (yrs/Y.js)
│   ├── /assets/*        → Static files (uploads)
│   └── /*               → SPA frontend (static HTML/JS/CSS)
├── Task worker (tokio + apalis)
│   ├── Email sending
│   ├── Webhook delivery
│   ├── Data export (CSV/JSON/XLSX)
│   ├── Cleanup / hard delete
│   ├── Issue automation (archive, close stale)
│   └── Version snapshots
├── Scheduler (cron-like, built-in)
│   ├── Every 5 min: stack email notifications
│   ├── Daily: hard delete, cleanup, automation
│   └── Configurable via TOML
└── Search indexer (tantivy)
    └── Indexes issues, pages, comments on change
```

### External Dependencies

| Required | Optional |
|---|---|
| **SQLite** (embedded) or **PostgreSQL** | **Redis** (for multi-instance coordination) |
| **Filesystem** (uploads) or **S3** | **SMTP** (email notifications) |
| | **OAuth providers** (GitHub, Google, GitLab) |

For nano deployment: just the binary + SQLite file. Nothing else.

---

## 3. Data Model

Based on Plane's 30+ Django models. Simplified where possible.

### Core Entities

```
Workspace 1──N Project 1──N Issue
    │                │         │
    ├── N Member     ├── N Member    ├── N Assignee (User)
    ├── N Invite     ├── N State     ├── N Label
    ├── N Team       ├── N Label     ├── N Comment
    ├── N Label      ├── N Cycle     ├── N Attachment
    └── N Webhook    ├── N Module    ├── N Subscriber
                     ├── N Page      ├── N Relation
                     └── N Intake    └── N Activity
```

### Tables (30 tables)

#### Workspace tier
| Table | Key Fields | Notes |
|---|---|---|
| `users` | email, display_name, password_hash, avatar, timezone | UUID pk, soft delete |
| `accounts` | provider, provider_account_id, access_token | OAuth accounts |
| `profiles` | theme, onboarding_state, preferences | One-to-one with user |
| `workspaces` | name, slug, logo, timezone | Slug unique, renamed on soft-delete |
| `workspace_members` | workspace_id, user_id, role (admin/member/guest) | Role as u8 (20/15/5) |
| `workspace_invites` | email, token, role, accepted | |
| `teams` | name, description, workspace_id | |
| `workspace_labels` | name, color, parent_id | Hierarchical labels |

#### Project tier
| Table | Key Fields | Notes |
|---|---|---|
| `projects` | name, identifier, description_json, network (secret/public), feature_flags | Identifier unique per workspace |
| `project_members` | project_id, user_id, role | |
| `project_invites` | project_id, email, role | |
| `states` | name, color, group (backlog/unstarted/started/completed/cancelled/triage), sequence | Ordered by sequence float |
| `estimates` | name, project_id | |
| `estimate_points` | estimate_id, value, key (S/M/L/XL etc) | |

#### Issue tier
| Table | Key Fields | Notes |
|---|---|---|
| `issues` | name, sequence_id, priority, state_id, description_json/binary/html, start_date, target_date, sort_order | Advisory lock on sequence generation |
| `issue_assignees` | issue_id, user_id | Through table |
| `issue_labels` | issue_id, label_id | Through table |
| `issue_comments` | issue_id, actor_id, comment_json/html, access (internal/external) | Threaded (parent_id) |
| `issue_activities` | issue_id, actor_id, verb, field, old_value, new_value | Change log |
| `issue_relations` | issue_id, related_issue_id, relation_type (duplicate/blocked_by/relates_to/etc) | Bidirectional |
| `issue_subscribers` | issue_id, user_id | |
| `issue_attachments` | issue_id, asset_url, attributes | |
| `issue_links` | issue_id, url, title | |
| `issue_reactions` | issue_id, actor_id, reaction | |
| `issue_sequences` | project_id, sequence | Gapless per-project numbering |

#### Container entities
| Table | Key Fields | Notes |
|---|---|---|
| `cycles` | project_id, name, start_date, end_date, sort_order | |
| `cycle_issues` | cycle_id, issue_id | Issue can be in one active cycle |
| `modules` | project_id, name, status, start_date, target_date, lead_id | |
| `module_issues` | module_id, issue_id | Issue can be in multiple modules |
| `module_members` | module_id, user_id | |

#### Content
| Table | Key Fields | Notes |
|---|---|---|
| `pages` | workspace_id, name, description_json/binary/html, access (public/private), parent_id | Nested pages |
| `page_versions` | page_id, description_binary, owned_by | Max 20 per page |

#### System
| Table | Key Fields | Notes |
|---|---|---|
| `notifications` | receiver_id, entity_id, entity_type, title, data, read_at | |
| `notification_preferences` | user_id, property_change, state_change, comment, mention | Per workspace/project |
| `webhooks` | workspace_id, url, secret, events, is_active | HMAC-SHA256 signed |
| `webhook_deliveries` | webhook_id, event, payload, status, response | |
| `file_assets` | entity_id, entity_type, asset_url, size, is_uploaded | |
| `imports` | workspace_id, service (jira/linear/asana/clickup/csv), status, data | |

### Cross-cutting patterns (preserve from Plane)

- **Soft delete**: Every table has `deleted_at`. Unique constraints conditional on `deleted_at IS NULL`.
- **UUID primary keys**: All tables use UUID v4.
- **Sort order as float**: Enables drag-and-drop reordering without rebasing. New items get `existing_min - 10000`.
- **Multi-format descriptions**: `description_json` (TipTap JSON), `description_html` (rendered HTML), `description_stripped` (plaintext), `description_binary` (Y.js binary).
- **Audit fields**: `created_by`, `updated_by`, `created_at`, `updated_at` on every table.

---

## 4. API Surface

API-compatible with Plane's frontend. Same URL patterns so the existing React SPA works unmodified.

### URL Structure

```
# Authentication
POST   /auth/login/
POST   /auth/register/
POST   /auth/magic-link/
GET    /auth/github/ | /auth/google/ | /auth/gitlab/
POST   /auth/logout/

# User
GET    /api/users/me/
PATCH  /api/users/me/
GET    /api/users/me/activities/
GET    /api/users/me/notification-preferences/

# Workspaces
GET    /api/workspaces/
POST   /api/workspaces/
GET    /api/workspaces/<slug>/
PATCH  /api/workspaces/<slug>/
DELETE /api/workspaces/<slug>/

GET    /api/workspaces/<slug>/members/
POST   /api/workspaces/<slug>/members/
PATCH  /api/workspaces/<slug>/members/<id>/
DELETE /api/workspaces/<slug>/members/<id>/

GET    /api/workspaces/<slug>/invitations/
POST   /api/workspaces/<slug>/invitations/
DELETE /api/workspaces/<slug>/invitations/<id>/

GET    /api/workspaces/<slug>/labels/
POST   /api/workspaces/<slug>/labels/

# Projects
GET    /api/workspaces/<slug>/projects/
POST   /api/workspaces/<slug>/projects/
GET    /api/workspaces/<slug>/projects/<uuid>/
PATCH  /api/workspaces/<slug>/projects/<uuid>/
DELETE /api/workspaces/<slug>/projects/<uuid>/

GET    /api/workspaces/<slug>/projects/<uuid>/members/
GET    /api/workspaces/<slug>/projects/<uuid>/states/
GET    /api/workspaces/<slug>/projects/<uuid>/labels/

# Issues (the big one - ~40 sub-endpoints)
GET    /api/workspaces/<slug>/projects/<uuid>/issues/
POST   /api/workspaces/<slug>/projects/<uuid>/issues/
GET    /api/workspaces/<slug>/projects/<uuid>/issues/<seq_id>/
PATCH  /api/workspaces/<slug>/projects/<uuid>/issues/<seq_id>/
DELETE /api/workspaces/<slug>/projects/<uuid>/issues/<seq_id>/

  # Sub-resources (nested under issue)
  /.../issues/<seq_id>/comments/
  /.../issues/<seq_id>/activities/
  /.../issues/<seq_id>/assignees/
  /.../issues/<seq_id>/labels/
  /.../issues/<seq_id>/links/
  /.../issues/<seq_id>/attachments/
  /.../issues/<seq_id>/reactions/
  /.../issues/<seq_id>/sub-issues/
  /.../issues/<seq_id>/relations/
  /.../issues/<seq_id>/subscribers/
  /.../issues/<seq_id>/votes/

# Cycles
GET/POST   /api/workspaces/<slug>/projects/<uuid>/cycles/
GET/PATCH  /api/workspaces/<slug>/projects/<uuid>/cycles/<uuid>/
POST       /api/workspaces/<slug>/projects/<uuid>/cycles/<uuid>/issues/

# Modules
GET/POST   /api/workspaces/<slug>/projects/<uuid>/modules/
GET/PATCH  /api/workspaces/<slug>/projects/<uuid>/modules/<uuid>/
POST       /api/workspaces/<slug>/projects/<uuid>/modules/<uuid>/issues/

# Pages
GET/POST   /api/workspaces/<slug>/projects/<uuid>/pages/   (or workspace-level)
GET/PATCH  /api/workspaces/<slug>/pages/<uuid>/

# Notifications
GET    /api/notifications/
PATCH  /api/notifications/<uuid>/

# Webhooks
GET/POST   /api/workspaces/<slug>/webhooks/

# Search
GET    /api/workspaces/<slug>/search/?q=<query>

# Importers
POST   /api/workspaces/<slug>/projects/<uuid>/importers/jira/
POST   /api/workspaces/<slug>/projects/<uuid>/importers/linear/
POST   /api/workspaces/<slug>/projects/<uuid>/importers/csv/

# Exporters
GET    /api/workspaces/<slug>/projects/<uuid>/export/?format=csv|json|xlsx

# Real-time
WS     /live/collaboration/
```

### Authentication

- **Session-based** (cookies) - primary method for SPA
- **API Key** (`X-API-Key` header) - for integrations
- **OAuth 2.0** - GitHub, Google, GitLab via standard redirect flow

### Permission Model

```
Role levels (same as Plane):
  ADMIN   = 20  (manage members, delete workspace/project, manage webhooks)
  MEMBER  = 15  (create/edit issues, cycles, modules, pages)
  GUEST   =  5  (view only, comment on assigned issues)

Scope:
  Workspace role  →  applies to all projects in workspace
  Project role    →  overrides workspace role for that project
```

---

## 5. Background Tasks

All run in-process via tokio + apalis. No external broker required.

### Task Inventory

| Task | Trigger | Schedule | Priority |
|---|---|---|---|
| **Issue activity recording** | On issue change | Immediate | High |
| **Notification creation** | After activity record | Immediate | High |
| **Email batch send** | Notification created | Every 5 min | Medium |
| **Webhook delivery** | On entity change | Immediate + retry | High |
| **Search index update** | On entity create/update/delete | Immediate | Medium |
| **Issue automation** | - | Daily 01:00 UTC | Low |
| **Hard delete** | - | Daily 00:00 UTC | Low |
| **File cleanup** | - | Daily 02:00 UTC | Low |
| **Export generation** | User request | Immediate | Medium |
| **Page version snapshot** | On page save | Debounced 10s | Low |
| **Import processing** | User upload | Immediate | Medium |
| **Password reset email** | User request | Immediate | High |
| **Invitation email** | Admin invites | Immediate | High |
| **Welcome email** | User registers | Immediate | Medium |

### Webhook Delivery

- HMAC-SHA256 payload signing
- Exponential backoff (5 retries, 600s base)
- Auto-deactivate on persistent failure
- SSRF protection (IP allowlist, redirect limit)

---

## 6. Real-Time Collaboration

Embedded in the binary via Axum WebSocket + `yrs` (Rust Y.js implementation).

### Protocol

- Standard Y.js sync protocol over WebSocket
- Document identified by page ID
- Binary updates stored in `description_binary` column
- Debounced persistence (10 seconds)
- Title sync extracted from Y.js XmlFragment

### Authentication

- Session cookie validated on WebSocket upgrade
- Same cookie as HTTP API

### Advantages over Plane's approach

- No separate Node.js process (saves 200-400 MB RAM)
- `yrs` is faster than JavaScript Y.js (native CRDT operations)
- Single deployment, no CORS issues

---

## 7. Configuration

TOML-based config file (no 200 env vars):

```toml
[server]
host = "0.0.0.0"
port = 8080
base_url = "http://localhost:8080"

[database]
# SQLite for nano deployments
url = "sqlite://./data/plane.db?mode=rwc"
# Or PostgreSQL for larger deployments:
# url = "postgres://user:pass@localhost/plane"

[storage]
# "local" or "s3"
backend = "local"
path = "./data/uploads"
# For S3:
# backend = "s3"
# bucket = "plane-uploads"
# region = "us-east-1"

[auth]
session_secret = "change-me-in-production"
session_ttl_hours = 720

[auth.oauth.github]
client_id = ""
client_secret = ""

[auth.oauth.google]
client_id = ""
client_secret = ""

[auth.oauth.gitlab]
client_id = ""
client_secret = ""
server_url = "https://gitlab.com"

[email]
smtp_host = ""
smtp_port = 587
smtp_user = ""
smtp_pass = ""
from_address = "plane@example.com"

[search]
backend = "tantivy"  # embedded, no external service
index_path = "./data/search"

[tasks]
max_retries = 5
retry_base_delay_secs = 600
hard_delete_after_days = 30

[cleanup]
archive_api_logs_days = 30
max_page_versions = 20
max_issue_description_versions = 20
```

---

## 8. Roadmap

### Phase 0: Foundation (Weeks 1-2)

**Goal**: Bootable binary with health check.

- [ ] Cargo project scaffolding (workspace with crates)
- [ ] Config loading (TOML + env overrides)
- [ ] Database setup (SeaORM entities + SQLite support)
- [ ] Migration system (initial schema)
- [ ] Axum server with CORS, compression, static file serving
- [ ] Error handling framework
- [ ] Logging (tracing + JSON output)
- [ ] Dockerfile (multi-stage, <20MB image)
- [ ] CI (test, clippy, fmt)

**Deliverable**: `plane-pmo serve` boots, responds to `GET /health`, connects to SQLite.

### Phase 1: Auth & Users (Weeks 3-4)

**Goal**: Register, login, session management.

- [ ] User model + migrations
- [ ] Password hashing (argon2)
- [ ] Email/password registration + login
- [ ] Session management (tower-sessions)
- [ ] Magic link authentication
- [ ] OAuth: GitHub, Google, GitLab
- [ ] User profile CRUD
- [ ] API key authentication
- [ ] Email sending infrastructure (SMTP)
- [ ] Password reset flow

**Deliverable**: Can register, login, manage profile via API.

### Phase 2: Workspaces & Projects (Weeks 5-6)

**Goal**: Multi-tenant workspace and project management.

- [ ] Workspace CRUD
- [ ] Workspace membership + roles (admin/member/guest)
- [ ] Workspace invitations (email)
- [ ] Project CRUD
- [ ] Project membership + roles
- [ ] Project feature flags (cycles, modules, pages, intake)
- [ ] States CRUD (default states on project create)
- [ ] Labels CRUD (workspace + project level)
- [ ] Estimates CRUD
- [ ] Permission middleware (role-based, workspace/project scoped)

**Deliverable**: Can create workspaces, invite members, create projects with states/labels.

### Phase 3: Issues Core (Weeks 7-10)

**Goal**: Full issue tracking with all sub-resources.

- [ ] Issue CRUD with sequence ID generation (advisory locks for PG, mutex for SQLite)
- [ ] Issue description (multi-format: JSON/HTML/stripped/binary)
- [ ] Issue assignees, labels
- [ ] Issue states and state transitions
- [ ] Issue priorities and sort ordering
- [ ] Sub-issues (parent/child)
- [ ] Issue comments (threaded)
- [ ] Issue attachments (file upload)
- [ ] Issue links
- [ ] Issue relations (duplicate, blocked_by, relates_to, etc.)
- [ ] Issue subscribers
- [ ] Issue reactions
- [ ] Issue activity logging
- [ ] Issue search (tantivy)
- [ ] Bulk operations (bulk update state, priority, assignee, delete)
- [ ] Issue archiving
- [ ] Background: issue automation (archive old, close stale)

**Deliverable**: Full issue tracking. This is the largest phase.

### Phase 4: Cycles & Modules (Weeks 11-12)

**Goal**: Sprint planning and module grouping.

- [ ] Cycle CRUD with date ranges
- [ ] Cycle issue assignment (one active cycle per issue)
- [ ] Cycle progress tracking
- [ ] Module CRUD with status workflow
- [ ] Module issue assignment (many-to-many)
- [ ] Module members
- [ ] Module links
- [ ] Cycle/module user properties (filters, display prefs)

**Deliverable**: Can manage sprints (cycles) and feature groupings (modules).

### Phase 5: Pages & Collaboration (Weeks 13-15)

**Goal**: Wiki-like pages with real-time editing.

- [ ] Page CRUD (nested, with parent_id)
- [ ] Page descriptions (multi-format)
- [ ] Page labels, page-project linking
- [ ] Page versioning (max 20 per page)
- [ ] Page locking
- [ ] WebSocket endpoint for collaboration
- [ ] Y.js (yrs) document sync protocol
- [ ] Debounced persistence (10s)
- [ ] Title sync from Y.js document
- [ ] Force-close handler (admin)
- [ ] HTML-to-binary conversion endpoint

**Deliverable**: Real-time collaborative page editing in the same binary.

### Phase 6: Notifications & Webhooks (Weeks 16-17)

**Goal**: Notification system and outbound webhooks.

- [ ] Notification creation pipeline
- [ ] Notification CRUD (list, mark read, archive, snooze)
- [ ] Notification preferences per user
- [ ] Email notification batching (every 5 min)
- [ ] Email templates (issue updates, mentions, invitations)
- [ ] Webhook CRUD
- [ ] Webhook delivery with HMAC-SHA256 signing
- [ ] Webhook retry with exponential backoff
- [ ] Webhook delivery logs
- [ ] Mention extraction from HTML content

**Deliverable**: Full notification and webhook system.

### Phase 7: Import/Export & Integrations (Weeks 18-19)

**Goal**: Data migration and external service connections.

- [ ] CSV importer
- [ ] Jira importer (JSON upload)
- [ ] Linear importer
- [ ] Asana importer
- [ ] ClickUp importer
- [ ] Issue export (CSV, JSON, XLSX)
- [ ] GitHub integration (OAuth + webhook sync)
- [ ] Slack integration (notifications to channels)

**Deliverable**: Can migrate from other tools and connect GitHub/Slack.

### Phase 8: Polish & Deploy (Weeks 20-22)

**Goal**: Production-ready release.

- [ ] API compatibility testing against Plane frontend
- [ ] Performance benchmarking (target: <50ms p99 for issue list)
- [ ] Database connection pooling tuning
- [ ] Rate limiting middleware
- [ ] Admin CLI commands (user management, DB maintenance)
- [ ] Health check + readiness endpoints
- [ ] Prometheus metrics endpoint
- [ ] Documentation (deployment guide, config reference)
- [ ] One-line install script (like Plane's `curl | sh`)
- [ ] Release binaries for linux/amd64, linux/arm64, macOS

**Deliverable**: v0.1.0 release. Single binary, production-ready.

---

## 9. Project Structure

```
plane-pmo/
├── Cargo.toml                  # Workspace root
├── crates/
│   ├── server/                 # Axum HTTP server, routes, middleware
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── config.rs
│   │   │   ├── routes/
│   │   │   │   ├── auth.rs
│   │   │   │   ├── users.rs
│   │   │   │   ├── workspaces.rs
│   │   │   │   ├── projects.rs
│   │   │   │   ├── issues.rs
│   │   │   │   ├── cycles.rs
│   │   │   │   ├── modules.rs
│   │   │   │   ├── pages.rs
│   │   │   │   ├── notifications.rs
│   │   │   │   ├── webhooks.rs
│   │   │   │   ├── search.rs
│   │   │   │   ├── imports.rs
│   │   │   │   └── exports.rs
│   │   │   ├── middleware/
│   │   │   │   ├── auth.rs
│   │   │   │   ├── permission.rs
│   │   │   │   └── rate_limit.rs
│   │   │   └── ws/
│   │   │       └── collaboration.rs
│   │   └── Cargo.toml
│   ├── domain/                 # Business logic (pure, no HTTP)
│   │   ├── src/
│   │   │   ├── workspace.rs
│   │   │   ├── project.rs
│   │   │   ├── issue.rs
│   │   │   ├── cycle.rs
│   │   │   ├── module.rs
│   │   │   ├── page.rs
│   │   │   ├── notification.rs
│   │   │   ├── auth.rs
│   │   │   └── permission.rs
│   │   └── Cargo.toml
│   ├── db/                     # Database layer (SeaORM entities + repos)
│   │   ├── src/
│   │   │   ├── entities/       # SeaORM generated entities
│   │   │   ├── migration/      # Schema migrations
│   │   │   └── repositories/   # Query helpers
│   │   └── Cargo.toml
│   ├── tasks/                  # Background task definitions
│   │   ├── src/
│   │   │   ├── email.rs
│   │   │   ├── webhook.rs
│   │   │   ├── notification.rs
│   │   │   ├── export.rs
│   │   │   ├── cleanup.rs
│   │   │   ├── automation.rs
│   │   │   └── search_index.rs
│   │   └── Cargo.toml
│   └── collab/                 # Real-time collaboration (yrs)
│       ├── src/
│       │   ├── protocol.rs
│       │   ├── document.rs
│       │   └── persistence.rs
│       └── Cargo.toml
├── static/                     # Frontend (Plane's React SPA, unmodified)
│   ├── index.html
│   ├── assets/
│   └── ...
├── templates/                  # Email templates (askama)
│   ├── invitation.html
│   ├── notification.html
│   └── password_reset.html
├── migrations/                 # SQL migrations
│   ├── 001_initial.sql
│   └── ...
├── config.example.toml
├── Dockerfile
├── docker-compose.yml          # Optional: binary + postgres + redis
└── install.sh                  # One-line installer
```

---

## 10. Key Technical Decisions

### SQLite vs PostgreSQL

Ship with SQLite by default. PostgreSQL as opt-in for teams >50 users or multi-instance deployments.

| Concern | SQLite | PostgreSQL |
|---|---|---|
| Advisory locks (sequence IDs) | Mutex (in-process) | `pg_advisory_xact_lock` |
| Concurrent writes | WAL mode, single writer | Full concurrent writes |
| Full-text search | FTS5 (built-in) | GIN indexes + tantivy |
| Migrations | rusqlite | SeaORM + sqlx |
| Deployment | Zero config | Requires PG server |

**Strategy**: Abstract behind a repository trait. Default to SQLite. Users can switch via config.

### Frontend Strategy

Reuse Plane's open-source React SPA (AGPL-3.0). Build from source and serve as static files from the Rust binary. API endpoints match Plane's URL structure so the frontend works unmodified.

If Plane's frontend drifts from the Community Edition (they may close-source more), maintain a fork.

### Testing Strategy

- **Unit tests**: Domain logic (no DB, pure functions)
- **Integration tests**: API endpoints against SQLite in-memory
- **Compatibility tests**: JSON response fixtures compared to Plane API responses
- **Load tests**: k6 or wrk against key endpoints

---

## 11. Success Metrics

| Metric | Target |
|---|---|
| Binary size | <15 MB (compressed) |
| Memory (idle, 1 user) | <50 MB |
| Memory (20 users active) | <300 MB |
| Cold start | <100ms |
| Issue list API (p50) | <10ms |
| Issue list API (p99) | <50ms |
| WebSocket connections (1 GB RAM) | 100+ concurrent |
| Docker image size | <20 MB |
| Lines of Rust code | <40K (vs 70K+ Python) |

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| SeaORM lacks Django ORM features | Medium | Raw SQL for complex queries, SeaORM for CRUD |
| yrs API differs from Y.js | Medium | Protocol-compatible, test with JS client |
| Plane frontend breaks API compat | High | Pin frontend version, maintain fork if needed |
| SQLite write contention at scale | Low | WAL mode handles most cases; PG opt-in for heavy use |
| Scope creep | High | Strict phase discipline, no feature work ahead of phase |
| Solo developer burnout | High | Phase-by-phase, ship usable product after Phase 3 |

---

## 13. Timeline Summary

```
Phase 0: Foundation        ████                    Weeks 1-2
Phase 1: Auth & Users      ████                    Weeks 3-4
Phase 2: Workspaces        ████                    Weeks 5-6
Phase 3: Issues Core       ████████                Weeks 7-10
Phase 4: Cycles/Modules    ████                    Weeks 11-12
Phase 5: Pages & Collab    ██████                  Weeks 13-15
Phase 6: Notifications     ████                    Weeks 16-17
Phase 7: Import/Export     ████                    Weeks 18-19
Phase 8: Polish            ██████                  Weeks 20-22
                                                    ~5-6 months
```

Usable product (issues + cycles + modules) ships after **Phase 4 (Week 12)**.
Full feature parity ships after **Phase 8 (Week 22)**.

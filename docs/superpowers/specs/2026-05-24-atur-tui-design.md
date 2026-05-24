# Atur TUI — Terminal User Interface Design

## Overview

A terminal UI (`atur-tui`) for browsing Atur workspaces, projects, issues, and sprints. Connects to a running Atur server via the MCP HTTP endpoint, reusing the 35 existing MCP tools as the data layer.

## Architecture

**New crate:** `crates/tui` — builds as `atur-tui` binary. Added to the Cargo workspace.

**Data source:** MCP client over HTTP. The TUI connects to `http://localhost:8080/mcp` (configurable) using the `rmcp` crate's streamable HTTP client transport. All data comes from MCP tool calls — no direct database access.

**Dependencies:**
- `rmcp` (client mode) — MCP protocol client
- `ratatui` + `crossterm` — TUI rendering
- `tokio` — async runtime
- `clap` — CLI arguments
- `serde` / `serde_json` — JSON deserialization

**App state:** A single `App` struct holds:
- Current view stack (WorkspaceList, ProjectBoard, IssueList, SprintView, IssueDetail)
- Cached data from MCP responses
- UI state (selection index, scroll offset, filter state)
- MCP client handle

**Navigation:** Stack-based. Selecting an item pushes a new view. Escape pops back to the previous view.

## Views & Navigation

```
[Workspaces] → [Projects] → [Issues] / [Sprints]
                                 ↓           ↓
                            [Issue Detail] [Sprint Detail]
                                              ↓
                                         [Issue Detail]
```

### 1. Workspace List (landing view)
- Table: Name, Slug, Created date
- Arrow keys navigate, Enter selects
- Header shows workspace count

### 2. Project Board
- Table: Name, Identifier, Description, Issue Count
- Enter opens sub-menu: "Issues" or "Sprints"

### 3. Issue List + Detail
- Table: Sequence ID, Name, State, Priority, Assignee
- Filter bar: filter by state, priority (Tab/Shift+Tab to cycle)
- Enter opens Issue Detail:
  - Description, comments count, labels, dates
  - Relations, sprint/module membership

### 4. Sprint View
- Sprint selector at top (cycle through sprints)
- Progress bar: completed vs total
- Issues grouped by state (Todo, In Progress, Done)
- Enter on issue opens Issue Detail

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `q` | Quit |
| `Escape` | Go back / close detail |
| `Enter` | Select / open |
| `Tab` / `Shift+Tab` | Cycle filters |
| `j`/`k` or arrows | Navigate |
| `r` | Refresh current view |
| `?` | Help overlay |

## Async Flow & Error Handling

**Event loop (250ms tick):**
1. Poll crossterm key events
2. Check for pending MCP responses
3. Render frame

**Non-blocking MCP calls:** When entering a view, fire the MCP tool call and show "Loading..." until the response arrives.

**Errors:** MCP errors shown as status bar messages (red). Auto-retry on transient failures. Startup connection failure exits with a helpful message.

## MCP Client Wrapper

`AturClient` wraps MCP tool calls into typed Rust methods:

```rust
struct AturClient;

impl AturClient {
    async fn list_workspaces(&self) -> Result<Vec<Workspace>>;
    async fn list_projects(&self, workspace: &str) -> Result<Vec<Project>>;
    async fn list_issues(&self, project_id: &str, filters: IssueFilters) -> Result<Vec<Issue>>;
    async fn get_issue(&self, project_id: &str, issue_id: &str) -> Result<IssueDetail>;
    async fn list_sprints(&self, project_id: &str) -> Result<Vec<Sprint>>;
    async fn get_sprint_progress(&self, project_id: &str, sprint_id: &str) -> Result<SprintProgress>;
}
```

Each method calls the corresponding MCP tool and deserializes the JSON response into a typed struct.

## File Structure

```
crates/tui/
  Cargo.toml
  src/
    main.rs          — CLI entry, clap args, startup
    app.rs           — App state, view stack, navigation
    client.rs        — AturClient MCP wrapper
    views/
      mod.rs
      workspaces.rs  — Workspace list view
      projects.rs    — Project board view
      issues.rs      — Issue list + detail view
      sprints.rs     — Sprint view with progress
    components/
      mod.rs
      table.rs       — Reusable table component
      status_bar.rs  — Bottom status bar
      help.rs        — Help overlay
    theme.rs         — Colors, styles
```

## CLI Interface

```
atur-tui                                          # defaults to localhost:8080/mcp
atur-tui --url http://host:8080/mcp --api-key pk_live_xxx
atur-tui -c config.toml                           # read URL + key from config
```

## Status Bar

Always-visible bottom bar showing:
- Current workspace/project context
- Loading indicator (spinner while MCP calls are in-flight)
- Last error (red, cleared on next successful call)
- Connection status

## Out of Scope (v1)

- Editing/creating issues (read-only browsing)
- Real-time updates (no WebSocket subscriptions)
- Page/module views
- Custom fields display
- Authentication flow (API key only)

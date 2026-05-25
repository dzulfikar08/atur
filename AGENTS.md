# Agent Instructions

## Atur MCP Server

This project includes an MCP (Model Context Protocol) server for project management. Connect your coding agent to it for issue tracking, sprint management, and project operations.

### Server

Binary: `target/release/atur`
Start: `PLANE_DB_URL="sqlite:./data/plane.db" PLANE_MCP_AUTH=true ./target/release/atur serve`

The server runs on `http://localhost:8080` with MCP endpoint at `/mcp`.

### Connection Config

Add this to your agent's MCP configuration:

**Transport:** HTTP Streamable
**URL:** `http://localhost:8080/mcp`
**Header:** `X-API-Key: pk_live_REDACTED`

#### Claude Code (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "atur": {
      "url": "http://localhost:8080/mcp",
      "transport": "http",
      "headers": { "X-API-Key": "pk_live_REDACTED" }
    }
  }
}
```

Or via CLI: `claude mcp add atur --transport http http://localhost:8080/mcp -s user -H "X-API-Key: pk_live_REDACTED"`

#### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "atur": {
      "url": "http://localhost:8080/mcp",
      "transport": "http",
      "headers": { "X-API-Key": "pk_live_REDACTED" }
    }
  }
}
```

#### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "atur": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

#### GitHub Copilot / VS Code (`settings.json`)

```json
{
  "mcp": {
    "servers": {
      "atur": {
        "url": "http://localhost:8080/mcp",
        "headers": { "X-API-Key": "pk_live_REDACTED" }
      }
    }
  }
}
```

#### Windsurf / Other HTTP MCP Clients

```json
{
  "mcpServers": {
    "atur": {
      "url": "http://localhost:8080/mcp",
      "transport": "http",
      "headers": { "X-API-Key": "pk_live_REDACTED" }
    }
  }
}
```

### Usage Rules

1. ALWAYS pass `workspace` (slug) AND `project_id` (UUID) where accepted.
2. Discover workspace/project first: `list_workspaces` → `list_projects(workspace="<slug>")`
3. Get states/labels before creating/updating issues: `list_states` / `list_labels`
4. `description_html` accepts HTML only — no markdown.
5. IDs are UUIDs except workspace slugs (e.g. `plane-pmo`, `rustred`).

### 36 Available Tools

| Category | Tools |
|----------|-------|
| Workspace | `list_workspaces`, `list_workspace_members` |
| Projects | `list_projects`, `get_project`, `create_project` |
| Issues | `list_issues`, `create_issue`, `get_issue`, `update_issue`, `delete_issue`, `search_issues`, `add_comment`, `list_comments` |
| Issue Relations | `list_issue_relations`, `add_issue_relation`, `remove_issue_relation` |
| Sprints | `list_sprints`, `create_sprint`, `get_sprint`, `update_sprint`, `add_issue_to_sprint`, `remove_issue_from_sprint`, `get_sprint_progress` |
| Modules | `list_modules`, `get_module`, `add_issue_to_module`, `remove_issue_from_module` |
| Pages | `list_pages`, `get_page`, `create_page`, `update_page` |
| States | `list_states` |
| Labels/Members | `list_labels`, `list_members`, `set_assignee` |
| Assets | `upload_image` |

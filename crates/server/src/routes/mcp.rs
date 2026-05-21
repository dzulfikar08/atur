//! MCP (Model Context Protocol) server exposing Plane PMO tools to AI agents.
//!
//! Mounted at `/mcp` as a Tower service using rmcp's `StreamableHttpService`.

use chrono::Utc;
use db::entities::{
    cycle_issues, cycles, issue_activities, issue_assignees, issue_comments, issue_labels,
    issue_sequences, issue_subscribers, issues, labels, project_members, projects, states,
    users, workspaces,
};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{Implementation, ServerInfo};
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::tower::StreamableHttpService;
use rmcp::{tool, tool_router, ServerHandler};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect};
use serde::Deserialize;
use schemars::JsonSchema;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Parameter structs
//
// NOTE: All UUID fields use `String` because `uuid::Uuid` does not implement
// `schemars::JsonSchema` for schemars v1.x (which rmcp depends on).
// We parse strings to Uuid inside each tool function.
// ---------------------------------------------------------------------------

// --- Workspace ---

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListWorkspacesParams {}

// --- Projects ---

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListProjectsParams {
    #[schemars(description = "Workspace slug (uses default if not specified)")]
    pub workspace: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetProjectParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateProjectParams {
    #[schemars(description = "Workspace slug (uses default if not specified)")]
    pub workspace: Option<String>,
    #[schemars(description = "Project name (required)")]
    pub name: String,
    #[schemars(description = "Short identifier (1-12 chars, uppercase recommended, e.g. MKTG)")]
    pub identifier: String,
    #[schemars(description = "Project description")]
    pub description: Option<String>,
    #[schemars(description = "Project emoji icon")]
    pub emoji: Option<String>,
    #[schemars(description = "Cover image URL")]
    pub cover_image: Option<String>,
}

// --- Issues ---

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListIssuesParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Filter by state UUID")]
    pub state: Option<String>,
    #[schemars(description = "Filter by priority: urgent, high, medium, low, none")]
    pub priority: Option<String>,
    #[schemars(description = "Filter by assignee UUID")]
    pub assignee: Option<String>,
    #[schemars(description = "Filter by sprint/cycle UUID")]
    pub sprint: Option<String>,
    #[schemars(description = "Text search in name and description")]
    pub search: Option<String>,
    #[schemars(description = "Max results (default 20, max 100)")]
    pub limit: Option<u64>,
    #[schemars(description = "Offset for pagination")]
    pub offset: Option<u64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateIssueParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Issue title")]
    pub name: String,
    #[schemars(description = "HTML description")]
    pub description_html: Option<String>,
    #[schemars(description = "Priority: urgent, high, medium, low, none")]
    pub priority: Option<String>,
    #[schemars(description = "State UUID")]
    pub state_id: Option<String>,
    #[schemars(description = "List of assignee UUIDs")]
    pub assignee_ids: Option<Vec<String>>,
    #[schemars(description = "List of label UUIDs")]
    pub label_ids: Option<Vec<String>>,
    #[schemars(description = "Start date (ISO format)")]
    pub start_date: Option<String>,
    #[schemars(description = "Target date (ISO format)")]
    pub target_date: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetIssueParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Issue UUID")]
    pub issue_id: Option<String>,
    #[schemars(description = "Issue sequence ID (e.g. 42)")]
    pub sequence_id: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateIssueParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Issue UUID")]
    pub issue_id: String,
    #[schemars(description = "New title")]
    pub name: Option<String>,
    #[schemars(description = "New HTML description")]
    pub description_html: Option<String>,
    #[schemars(description = "Priority: urgent, high, medium, low, none")]
    pub priority: Option<String>,
    #[schemars(description = "State UUID")]
    pub state_id: Option<String>,
    #[schemars(description = "Start date")]
    pub start_date: Option<String>,
    #[schemars(description = "Target date")]
    pub target_date: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeleteIssueParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub issue_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchIssuesParams {
    pub workspace: Option<String>,
    pub project_id: Option<String>,
    #[schemars(description = "Search query")]
    pub query: String,
    pub limit: Option<u64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AddCommentParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub issue_id: String,
    #[schemars(description = "Comment HTML content")]
    pub comment_html: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListCommentsParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub issue_id: String,
}

// --- Sprints (Cycles) ---

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListSprintsParams {
    pub workspace: Option<String>,
    pub project_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateSprintParams {
    pub workspace: Option<String>,
    pub project_id: String,
    #[schemars(description = "Sprint name")]
    pub name: String,
    pub description: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetSprintParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub sprint_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct UpdateSprintParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub sprint_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AddIssueToSprintParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub sprint_id: String,
    pub issue_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct RemoveIssueFromSprintParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub sprint_id: String,
    pub issue_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetSprintProgressParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub sprint_id: String,
}

// --- Labels & Members ---

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListLabelsParams {
    pub workspace: Option<String>,
    pub project_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListMembersParams {
    pub workspace: Option<String>,
    pub project_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetAssigneeParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub issue_id: String,
    pub user_id: String,
    #[schemars(description = "\"add\" (default) or \"remove\"")]
    pub action: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse a UUID string, returning an error string on failure.
fn parse_uuid(s: &str, field: &str) -> Result<Uuid, String> {
    Uuid::parse_str(s).map_err(|e| format!("Invalid UUID for {}: {} ({})", field, s, e))
}

/// Simple HTML-to-plaintext stripper (removes tags).
fn strip_html(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    result
}

fn ok_json(val: serde_json::Value) -> String {
    serde_json::to_string_pretty(&val).unwrap_or_else(|e| format!("Error: {}", e))
}

fn err_str(msg: impl std::fmt::Display) -> String {
    format!("Error: {}", msg)
}

async fn resolve_workspace(
    db: &sea_orm::DatabaseConnection,
    slug: Option<&String>,
) -> Result<workspaces::Model, String> {
    let slug = slug
        .as_deref()
        .ok_or("No workspace specified and no default configured")?;
    workspaces::Entity::find()
        .filter(workspaces::Column::Slug.eq(slug))
        .filter(workspaces::Column::DeletedAt.is_null())
        .one(db)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Workspace '{}' not found", slug))
}

/// Build a JSON representation of an issue model.
fn issue_to_json(i: &issues::Model) -> serde_json::Value {
    serde_json::json!({
        "id": i.id,
        "name": i.name,
        "sequence_id": i.sequence_id,
        "priority": i.priority,
        "start_date": i.start_date,
        "target_date": i.target_date,
        "completed_at": i.completed_at.map(|dt| dt.to_rfc3339()),
        "is_draft": i.is_draft,
        "description_html": i.description_html,
        "state_id": i.state_id,
        "project_id": i.project_id,
        "workspace_id": i.workspace_id,
        "created_by_id": i.created_by_id,
        "parent_id": i.parent_id,
        "created_at": i.created_at.map(|dt| dt.to_rfc3339()),
        "updated_at": i.updated_at.map(|dt| dt.to_rfc3339()),
    })
}

/// Build a JSON representation of a cycle model.
fn cycle_to_json(c: &cycles::Model) -> serde_json::Value {
    serde_json::json!({
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "start_date": c.start_date,
        "end_date": c.end_date,
        "project_id": c.project_id,
        "workspace_id": c.workspace_id,
        "created_at": c.created_at.map(|dt| dt.to_rfc3339()),
        "updated_at": c.updated_at.map(|dt| dt.to_rfc3339()),
    })
}

/// A fake bot user ID for MCP operations that don't go through auth.
/// In production this could be configurable.
const MCP_BOT_USER_ID: &str = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// Server struct
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct PlaneMcpServer {
    db: sea_orm::DatabaseConnection,
    bot_user_id: Uuid,
}

impl PlaneMcpServer {
    pub fn new(db: sea_orm::DatabaseConnection) -> Self {
        let bot_user_id = Uuid::parse_str(MCP_BOT_USER_ID).unwrap_or_else(|_| Uuid::new_v4());
        Self { db, bot_user_id }
    }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

#[tool_router]
impl PlaneMcpServer {
    // =======================================================================
    // Workspace tools
    // =======================================================================

    #[tool(description = "List all workspaces")]
    async fn list_workspaces(
        &self,
        _params: Parameters<ListWorkspacesParams>,
    ) -> String {
        match workspaces::Entity::find()
            .filter(workspaces::Column::DeletedAt.is_null())
            .all(&self.db)
            .await
        {
            Ok(ws) => {
                let result: Vec<serde_json::Value> = ws
                    .iter()
                    .map(|w| {
                        serde_json::json!({
                            "id": w.id,
                            "name": w.name,
                            "slug": w.slug,
                            "created_at": w.created_at.map(|d| d.to_rfc3339()),
                        })
                    })
                    .collect();
                ok_json(serde_json::json!(result))
            }
            Err(e) => err_str(e),
        }
    }

    // =======================================================================
    // Project tools
    // =======================================================================

    #[tool(description = "List projects in a workspace")]
    async fn list_projects(
        &self,
        Parameters(params): Parameters<ListProjectsParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };

        match projects::Entity::find()
            .filter(projects::Column::WorkspaceId.eq(ws.id))
            .filter(projects::Column::DeletedAt.is_null())
            .all(&self.db)
            .await
        {
            Ok(list) => {
                let result: Vec<serde_json::Value> = list
                    .iter()
                    .map(|p| {
                        serde_json::json!({
                            "id": p.id,
                            "name": p.name,
                            "identifier": p.identifier,
                            "description": p.description,
                            "emoji": p.emoji,
                            "workspace_id": p.workspace_id,
                            "created_at": p.created_at.map(|d| d.to_rfc3339()),
                        })
                    })
                    .collect();
                ok_json(serde_json::json!(result))
            }
            Err(e) => err_str(e),
        }
    }

    #[tool(description = "Get project details")]
    async fn get_project(
        &self,
        Parameters(params): Parameters<GetProjectParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        match projects::Entity::find()
            .filter(projects::Column::Id.eq(project_id))
            .filter(projects::Column::WorkspaceId.eq(ws.id))
            .filter(projects::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(p)) => ok_json(serde_json::json!({
                "id": p.id,
                "name": p.name,
                "identifier": p.identifier,
                "description": p.description,
                "emoji": p.emoji,
                "cover_image": p.cover_image,
                "default_assignee_id": p.default_assignee_id,
                "project_lead_id": p.project_lead_id,
                "module_view": p.module_view,
                "cycle_view": p.cycle_view,
                "workspace_id": p.workspace_id,
                "created_at": p.created_at.map(|d| d.to_rfc3339()),
            })),
            Ok(None) => err_str("Project not found"),
            Err(e) => err_str(e),
        }
    }

    #[tool(description = "Create a new project in a workspace with default states (Backlog, Todo, In Progress, Done, Cancelled, Triage)")]
    async fn create_project(
        &self,
        Parameters(params): Parameters<CreateProjectParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };

        // Validate identifier
        if params.identifier.is_empty() || params.identifier.len() > 12 {
            return err_str("Identifier must be 1-12 characters");
        }

        // Check uniqueness
        match projects::Entity::find()
            .filter(projects::Column::Identifier.eq(&params.identifier))
            .filter(projects::Column::WorkspaceId.eq(ws.id))
            .filter(projects::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(_)) => return err_str(format!("Identifier '{}' already taken in this workspace", params.identifier)),
            Ok(None) => {}
            Err(e) => return err_str(e),
        }

        let now = Utc::now().fixed_offset();
        let project_id = Uuid::new_v4();

        // Insert project
        let project = match (projects::ActiveModel {
            id: Set(project_id),
            name: Set(params.name),
            identifier: Set(params.identifier),
            description: Set(params.description),
            description_html: Set(None),
            description_json: Set(None),
            workspace_id: Set(ws.id),
            network: Set(0),
            emoji: Set(params.emoji),
            icon_prop: Set(None),
            cover_image: Set(params.cover_image),
            default_assignee_id: Set(None),
            project_lead_id: Set(None),
            default_state_id: Set(None),
            module_view: Set(true),
            cycle_view: Set(true),
            page_view: Set(true),
            intake_view: Set(true),
            is_time_tracking_enabled: Set(false),
            archive_in: Set(None),
            close_in: Set(None),
            timezone: Set(Some("UTC".into())),
            archived_at: Set(None),
            external_source: Set(None),
            external_id: Set(None),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        })
        .insert(&self.db)
        .await
        {
            Ok(p) => p,
            Err(e) => return err_str(format!("Project insert error: {}", e)),
        };

        // Create default states
        let default_states = [
            ("Backlog", "backlog", "backlog", "#A3A3A3", 10000.0, false, false),
            ("Todo", "unstarted", "todo", "#3B82F6", 20000.0, true, false),
            ("In Progress", "started", "in-progress", "#F59E0B", 30000.0, false, false),
            ("Done", "completed", "done", "#16A34A", 40000.0, false, false),
            ("Cancelled", "cancelled", "cancelled", "#EF4444", 50000.0, false, false),
            ("Triage", "triage", "triage", "#8B5CF6", 60000.0, false, true),
        ];

        let mut default_state_id: Option<Uuid> = None;
        for (name, group, slug, color, sequence, is_default, is_triage) in &default_states {
            let state_id = Uuid::new_v4();
            if *is_default {
                default_state_id = Some(state_id);
            }
            if let Err(e) = (states::ActiveModel {
                id: Set(state_id),
                name: Set(name.to_string()),
                description: Set(None),
                color: Set(Some(color.to_string())),
                slug: Set(Some(slug.to_string())),
                sequence: Set(*sequence),
                group: Set(group.to_string()),
                is_triage: Set(*is_triage),
                is_default: Set(*is_default),
                project_id: Set(project_id),
                workspace_id: Set(ws.id),
                created_at: Set(Some(now)),
                updated_at: Set(Some(now)),
                deleted_at: Set(None),
            })
            .insert(&self.db)
            .await
            {
                return err_str(format!("State insert error: {}", e));
            }
        }

        // Update default_state_id on project
        if let Some(sid) = default_state_id {
            let mut active: projects::ActiveModel = project.clone().into();
            active.default_state_id = Set(Some(sid));
            if let Err(e) = active.update(&self.db).await {
                return err_str(format!("Project update error: {}", e));
            }
        }

        ok_json(serde_json::json!({
            "id": project_id,
            "name": project.name,
            "identifier": project.identifier,
            "description": project.description,
            "emoji": project.emoji,
            "workspace_id": ws.id,
            "default_state_id": default_state_id,
            "created_at": now.to_rfc3339(),
        }))
    }

    // =======================================================================
    // Issue tools
    // =======================================================================

    #[tool(description = "List issues in a project with optional filters")]
    async fn list_issues(
        &self,
        Parameters(params): Parameters<ListIssuesParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        // Verify project exists in workspace
        match projects::Entity::find()
            .filter(projects::Column::Id.eq(project_id))
            .filter(projects::Column::WorkspaceId.eq(ws.id))
            .filter(projects::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(_)) => {}
            Ok(None) => return err_str("Project not found"),
            Err(e) => return err_str(e),
        };

        let mut condition = sea_orm::Condition::all()
            .add(issues::Column::ProjectId.eq(project_id))
            .add(issues::Column::DeletedAt.is_null())
            .add(issues::Column::ArchivedAt.is_null());

        if let Some(state_str) = &params.state {
            match parse_uuid(state_str, "state") {
                Ok(sid) => condition = condition.add(issues::Column::StateId.eq(sid)),
                Err(e) => return err_str(e),
            }
        }
        if let Some(ref priority) = params.priority {
            condition = condition.add(issues::Column::Priority.eq(priority.as_str()));
        }
        if let Some(search) = params.search {
            condition = condition.add(
                sea_orm::Condition::any()
                    .add(issues::Column::Name.contains(&search))
                    .add(issues::Column::DescriptionStripped.contains(&search)),
            );
        }

        // Handle assignee filter
        if let Some(assignee_str) = &params.assignee {
            let assignee_id = match parse_uuid(assignee_str, "assignee") {
                Ok(id) => id,
                Err(e) => return err_str(e),
            };
            match issue_assignees::Entity::find()
                .filter(issue_assignees::Column::AssigneeId.eq(assignee_id))
                .filter(issue_assignees::Column::DeletedAt.is_null())
                .all(&self.db)
                .await
            {
                Ok(assigned) => {
                    let ids: Vec<Uuid> = assigned.into_iter().map(|a| a.issue_id).collect();
                    condition = condition.add(issues::Column::Id.is_in(ids));
                }
                Err(e) => return err_str(e),
            }
        }

        // Handle sprint/cycle filter
        if let Some(sprint_str) = &params.sprint {
            let sprint_id = match parse_uuid(sprint_str, "sprint") {
                Ok(id) => id,
                Err(e) => return err_str(e),
            };
            match cycle_issues::Entity::find()
                .filter(cycle_issues::Column::CycleId.eq(sprint_id))
                .filter(cycle_issues::Column::DeletedAt.is_null())
                .all(&self.db)
                .await
            {
                Ok(ci) => {
                    let ids: Vec<Uuid> = ci.into_iter().map(|c| c.issue_id).collect();
                    condition = condition.add(issues::Column::Id.is_in(ids));
                }
                Err(e) => return err_str(e),
            }
        }

        let limit = params.limit.unwrap_or(20).min(100);
        let offset = params.offset.unwrap_or(0);

        let query_builder = issues::Entity::find()
            .filter(condition)
            .order_by_asc(issues::Column::SortOrder);

        let paginator = query_builder.paginate(&self.db, limit);

        let total = match paginator.num_items().await {
            Ok(t) => t,
            Err(e) => return err_str(e),
        };

        match paginator.fetch_page(offset / limit).await {
            Ok(issue_list) => {
                let results: Vec<serde_json::Value> =
                    issue_list.iter().map(issue_to_json).collect();
                ok_json(serde_json::json!({
                    "results": results,
                    "total": total,
                    "limit": limit,
                    "offset": offset,
                }))
            }
            Err(e) => err_str(e),
        }
    }

    #[tool(description = "Create a new issue in a project")]
    async fn create_issue(
        &self,
        Parameters(params): Parameters<CreateIssueParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        // Generate sequence_id
        let max_seq = match issue_sequences::Entity::find()
            .filter(issue_sequences::Column::ProjectId.eq(project_id))
            .filter(issue_sequences::Column::IsDeleted.eq(false))
            .order_by_desc(issue_sequences::Column::Sequence)
            .one(&self.db)
            .await
        {
            Ok(m) => m,
            Err(e) => return err_str(e),
        };
        let next_seq = max_seq.map(|s| s.sequence + 1).unwrap_or(1);

        let description_stripped = params.description_html.as_deref().map(strip_html);

        // Find default state if none provided
        let state_id = match params.state_id {
            Some(ref sid_str) => match parse_uuid(sid_str, "state_id") {
                Ok(id) => Some(id),
                Err(e) => return err_str(e),
            },
            None => match states::Entity::find()
                .filter(states::Column::ProjectId.eq(project_id))
                .filter(states::Column::IsDefault.eq(true))
                .filter(states::Column::DeletedAt.is_null())
                .one(&self.db)
                .await
            {
                Ok(s) => s.map(|s| s.id),
                Err(e) => return err_str(e),
            },
        };

        let now = Utc::now().fixed_offset();
        let issue_id = Uuid::new_v4();

        let issue = match (issues::ActiveModel {
            id: Set(issue_id),
            name: Set(params.name),
            sequence_id: Set(next_seq),
            sort_order: Set(65535.0),
            priority: Set(params.priority.or(Some("none".to_string()))),
            start_date: Set(params.start_date),
            target_date: Set(params.target_date),
            completed_at: Set(None),
            archived_at: Set(None),
            is_draft: Set(false),
            description_json: Set(None),
            description_html: Set(params.description_html),
            description_stripped: Set(description_stripped),
            description_binary: Set(None),
            parent_id: Set(None),
            state_id: Set(state_id),
            estimate_point_id: Set(None),
            type_id: Set(None),
            project_id: Set(project_id),
            workspace_id: Set(ws.id),
            created_by_id: Set(Some(self.bot_user_id)),
            external_source: Set(None),
            external_id: Set(None),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        })
        .insert(&self.db)
        .await
        {
            Ok(i) => i,
            Err(e) => return err_str(format!("Issue insert error: {}", e)),
        };

        // Create sequence record
        if let Err(e) = (issue_sequences::ActiveModel {
            id: Set(Uuid::new_v4()),
            sequence: Set(next_seq),
            issue_id: Set(Some(issue_id)),
            project_id: Set(project_id),
            is_deleted: Set(false),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        })
        .insert(&self.db)
        .await
        {
            return err_str(format!("Sequence insert error: {}", e));
        }

        // Auto-subscribe bot
        let _ = (issue_subscribers::ActiveModel {
            id: Set(Uuid::new_v4()),
            issue_id: Set(issue_id),
            subscriber_id: Set(self.bot_user_id),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        })
        .insert(&self.db)
        .await;

        // Create activity
        let _ = (issue_activities::ActiveModel {
            id: Set(Uuid::new_v4()),
            verb: Set(Some("created".to_string())),
            field: Set(None),
            old_value: Set(None),
            new_value: Set(None),
            issue_id: Set(Some(issue_id)),
            issue_comment_id: Set(None),
            actor_id: Set(Some(self.bot_user_id)),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        })
        .insert(&self.db)
        .await;

        // Add assignees
        if let Some(assignee_strs) = params.assignee_ids {
            for assignee_str in assignee_strs {
                if let Ok(assignee_id) = parse_uuid(&assignee_str, "assignee_id") {
                    let _ = (issue_assignees::ActiveModel {
                        id: Set(Uuid::new_v4()),
                        issue_id: Set(issue_id),
                        assignee_id: Set(assignee_id),
                        created_at: Set(Some(now)),
                        updated_at: Set(Some(now)),
                        deleted_at: Set(None),
                    })
                    .insert(&self.db)
                    .await;
                }
            }
        }

        // Add labels
        if let Some(label_strs) = params.label_ids {
            for label_str in label_strs {
                if let Ok(label_id) = parse_uuid(&label_str, "label_id") {
                    let _ = (issue_labels::ActiveModel {
                        id: Set(Uuid::new_v4()),
                        issue_id: Set(issue_id),
                        label_id: Set(label_id),
                        created_at: Set(Some(now)),
                        updated_at: Set(Some(now)),
                        deleted_at: Set(None),
                    })
                    .insert(&self.db)
                    .await;
                }
            }
        }

        ok_json(issue_to_json(&issue))
    }

    #[tool(description = "Get a single issue by UUID or sequence ID")]
    async fn get_issue(
        &self,
        Parameters(params): Parameters<GetIssueParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        let issue = if let Some(ref issue_id_str) = params.issue_id {
            let iid = match parse_uuid(issue_id_str, "issue_id") {
                Ok(id) => id,
                Err(e) => return err_str(e),
            };
            match issues::Entity::find()
                .filter(issues::Column::Id.eq(iid))
                .filter(issues::Column::ProjectId.eq(project_id))
                .filter(issues::Column::DeletedAt.is_null())
                .one(&self.db)
                .await
            {
                Ok(Some(i)) => i,
                Ok(None) => return err_str("Issue not found"),
                Err(e) => return err_str(e),
            }
        } else if let Some(seq_id) = params.sequence_id {
            match issues::Entity::find()
                .filter(issues::Column::ProjectId.eq(project_id))
                .filter(issues::Column::SequenceId.eq(seq_id))
                .filter(issues::Column::DeletedAt.is_null())
                .one(&self.db)
                .await
            {
                Ok(Some(i)) => i,
                Ok(None) => return err_str("Issue not found"),
                Err(e) => return err_str(e),
            }
        } else {
            return err_str("Must provide either issue_id or sequence_id");
        };

        let _ = ws;

        // Fetch assignees
        let assignees = match issue_assignees::Entity::find()
            .filter(issue_assignees::Column::IssueId.eq(issue.id))
            .filter(issue_assignees::Column::DeletedAt.is_null())
            .all(&self.db)
            .await
        {
            Ok(a) => a.into_iter().map(|a| a.assignee_id.to_string()).collect::<Vec<_>>(),
            Err(_) => vec![],
        };

        // Fetch labels
        let issue_labels_list = match issue_labels::Entity::find()
            .filter(issue_labels::Column::IssueId.eq(issue.id))
            .filter(issue_labels::Column::DeletedAt.is_null())
            .all(&self.db)
            .await
        {
            Ok(l) => l.into_iter().map(|l| l.label_id.to_string()).collect::<Vec<_>>(),
            Err(_) => vec![],
        };

        let mut val = issue_to_json(&issue);
        val["assignees"] = serde_json::json!(assignees);
        val["labels"] = serde_json::json!(issue_labels_list);
        ok_json(val)
    }

    #[tool(description = "Update an existing issue")]
    async fn update_issue(
        &self,
        Parameters(params): Parameters<UpdateIssueParams>,
    ) -> String {
        let _ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        let issue = match issues::Entity::find()
            .filter(issues::Column::Id.eq(issue_id))
            .filter(issues::Column::ProjectId.eq(project_id))
            .filter(issues::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(i)) => i,
            Ok(None) => return err_str("Issue not found"),
            Err(e) => return err_str(e),
        };

        let now = Utc::now().fixed_offset();
        let mut active: issues::ActiveModel = issue.into();

        if let Some(name) = params.name {
            active.name = Set(name);
        }
        if let Some(priority) = params.priority {
            active.priority = Set(Some(priority));
        }
        if let Some(ref state_id_str) = params.state_id {
            match parse_uuid(state_id_str, "state_id") {
                Ok(sid) => active.state_id = Set(Some(sid)),
                Err(e) => return err_str(e),
            }
        }
        if let Some(description_html) = params.description_html {
            active.description_html = Set(Some(description_html.clone()));
            active.description_stripped = Set(Some(strip_html(&description_html)));
        }
        if let Some(start_date) = params.start_date {
            active.start_date = Set(Some(start_date));
        }
        if let Some(target_date) = params.target_date {
            active.target_date = Set(Some(target_date));
        }

        active.updated_at = Set(Some(now));

        match active.update(&self.db).await {
            Ok(updated) => ok_json(issue_to_json(&updated)),
            Err(e) => err_str(format!("DB update error: {}", e)),
        }
    }

    #[tool(description = "Delete an issue (soft delete)")]
    async fn delete_issue(
        &self,
        Parameters(params): Parameters<DeleteIssueParams>,
    ) -> String {
        let _ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        let issue = match issues::Entity::find()
            .filter(issues::Column::Id.eq(issue_id))
            .filter(issues::Column::ProjectId.eq(project_id))
            .filter(issues::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(i)) => i,
            Ok(None) => return err_str("Issue not found"),
            Err(e) => return err_str(e),
        };

        let now = Utc::now().fixed_offset();
        let mut active: issues::ActiveModel = issue.into();
        active.deleted_at = Set(Some(now));
        active.updated_at = Set(Some(now));

        match active.update(&self.db).await {
            Ok(_) => ok_json(serde_json::json!({ "message": "Issue deleted" })),
            Err(e) => err_str(format!("DB update error: {}", e)),
        }
    }

    #[tool(description = "Search issues across a workspace or project")]
    async fn search_issues(
        &self,
        Parameters(params): Parameters<SearchIssuesParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };

        let limit = params.limit.unwrap_or(20).min(100);

        let mut condition = sea_orm::Condition::all()
            .add(issues::Column::WorkspaceId.eq(ws.id))
            .add(issues::Column::DeletedAt.is_null())
            .add(issues::Column::ArchivedAt.is_null())
            .add(
                sea_orm::Condition::any()
                    .add(issues::Column::Name.contains(&params.query))
                    .add(issues::Column::DescriptionStripped.contains(&params.query)),
            );

        if let Some(ref pid_str) = params.project_id {
            match parse_uuid(pid_str, "project_id") {
                Ok(pid) => condition = condition.add(issues::Column::ProjectId.eq(pid)),
                Err(e) => return err_str(e),
            }
        }

        match issues::Entity::find()
            .filter(condition)
            .order_by_asc(issues::Column::SortOrder)
            .limit(limit)
            .all(&self.db)
            .await
        {
            Ok(list) => {
                let results: Vec<serde_json::Value> = list.into_iter().map(|i| issue_to_json(&i)).collect();
                ok_json(serde_json::json!({
                    "results": results,
                    "total": results.len(),
                }))
            }
            Err(e) => err_str(e),
        }
    }

    #[tool(description = "Add a comment to an issue")]
    async fn add_comment(
        &self,
        Parameters(params): Parameters<AddCommentParams>,
    ) -> String {
        let _ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        // Verify issue exists
        let issue = match issues::Entity::find()
            .filter(issues::Column::Id.eq(issue_id))
            .filter(issues::Column::ProjectId.eq(project_id))
            .filter(issues::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(i)) => i,
            Ok(None) => return err_str("Issue not found"),
            Err(e) => return err_str(e),
        };

        let now = Utc::now().fixed_offset();
        let comment_stripped = strip_html(&params.comment_html);

        let comment = match (issue_comments::ActiveModel {
            id: Set(Uuid::new_v4()),
            comment_stripped: Set(Some(comment_stripped)),
            comment_json: Set(None),
            comment_html: Set(Some(params.comment_html)),
            access: Set(Some("internal".to_string())),
            parent_id: Set(None),
            issue_id: Set(issue.id),
            actor_id: Set(self.bot_user_id),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        })
        .insert(&self.db)
        .await
        {
            Ok(c) => c,
            Err(e) => return err_str(format!("Comment insert error: {}", e)),
        };

        // Create activity
        let _ = (issue_activities::ActiveModel {
            id: Set(Uuid::new_v4()),
            verb: Set(Some("commented".to_string())),
            field: Set(None),
            old_value: Set(None),
            new_value: Set(None),
            issue_id: Set(Some(issue.id)),
            issue_comment_id: Set(Some(comment.id)),
            actor_id: Set(Some(self.bot_user_id)),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        })
        .insert(&self.db)
        .await;

        ok_json(serde_json::json!({
            "id": comment.id,
            "issue_id": comment.issue_id,
            "actor_id": comment.actor_id,
            "comment_html": comment.comment_html,
            "created_at": comment.created_at.map(|d| d.to_rfc3339()),
        }))
    }

    #[tool(description = "List comments on an issue")]
    async fn list_comments(
        &self,
        Parameters(params): Parameters<ListCommentsParams>,
    ) -> String {
        let _ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        let comments = match issue_comments::Entity::find()
            .filter(issue_comments::Column::IssueId.eq(issue_id))
            .filter(issue_comments::Column::DeletedAt.is_null())
            .order_by_asc(issue_comments::Column::CreatedAt)
            .all(&self.db)
            .await
        {
            Ok(c) => c,
            Err(e) => return err_str(e),
        };

        let result: Vec<serde_json::Value> = comments
            .iter()
            .map(|c| {
                serde_json::json!({
                    "id": c.id,
                    "comment_html": c.comment_html,
                    "comment_stripped": c.comment_stripped,
                    "actor_id": c.actor_id,
                    "issue_id": c.issue_id,
                    "created_at": c.created_at.map(|d| d.to_rfc3339()),
                })
            })
            .collect();
        ok_json(serde_json::json!(result))
    }

    // =======================================================================
    // Sprint (Cycle) tools
    // =======================================================================

    #[tool(description = "List sprints (cycles) in a project")]
    async fn list_sprints(
        &self,
        Parameters(params): Parameters<ListSprintsParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        match cycles::Entity::find()
            .filter(cycles::Column::ProjectId.eq(project_id))
            .filter(cycles::Column::WorkspaceId.eq(ws.id))
            .filter(cycles::Column::DeletedAt.is_null())
            .order_by_asc(cycles::Column::SortOrder)
            .all(&self.db)
            .await
        {
            Ok(list) => {
                let result: Vec<serde_json::Value> =
                    list.iter().map(cycle_to_json).collect();
                ok_json(serde_json::json!(result))
            }
            Err(e) => err_str(e),
        }
    }

    #[tool(description = "Create a new sprint (cycle)")]
    async fn create_sprint(
        &self,
        Parameters(params): Parameters<CreateSprintParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        // Compute sort_order: min existing - 10000
        let min_sort = match cycles::Entity::find()
            .filter(cycles::Column::ProjectId.eq(project_id))
            .filter(cycles::Column::DeletedAt.is_null())
            .order_by_asc(cycles::Column::SortOrder)
            .one(&self.db)
            .await
        {
            Ok(m) => m.map(|c| c.sort_order).unwrap_or(0.0),
            Err(e) => return err_str(e),
        };

        let now = Utc::now().fixed_offset();

        match (cycles::ActiveModel {
            id: Set(Uuid::new_v4()),
            name: Set(params.name),
            description: Set(params.description),
            start_date: Set(params.start_date),
            end_date: Set(params.end_date),
            sort_order: Set(min_sort - 10000.0),
            progress_snapshot: Set(None),
            archived_at: Set(None),
            project_id: Set(project_id),
            workspace_id: Set(ws.id),
            owned_by_id: Set(Some(self.bot_user_id)),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        })
        .insert(&self.db)
        .await
        {
            Ok(cycle) => ok_json(cycle_to_json(&cycle)),
            Err(e) => err_str(format!("Cycle insert error: {}", e)),
        }
    }

    #[tool(description = "Get sprint details")]
    async fn get_sprint(
        &self,
        Parameters(params): Parameters<GetSprintParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        let sprint_id = match parse_uuid(&params.sprint_id, "sprint_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        match cycles::Entity::find()
            .filter(cycles::Column::Id.eq(sprint_id))
            .filter(cycles::Column::ProjectId.eq(project_id))
            .filter(cycles::Column::WorkspaceId.eq(ws.id))
            .filter(cycles::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(c)) => ok_json(cycle_to_json(&c)),
            Ok(None) => err_str("Sprint not found"),
            Err(e) => err_str(e),
        }
    }

    #[tool(description = "Update a sprint")]
    async fn update_sprint(
        &self,
        Parameters(params): Parameters<UpdateSprintParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        let sprint_id = match parse_uuid(&params.sprint_id, "sprint_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        let cycle = match cycles::Entity::find()
            .filter(cycles::Column::Id.eq(sprint_id))
            .filter(cycles::Column::ProjectId.eq(project_id))
            .filter(cycles::Column::WorkspaceId.eq(ws.id))
            .filter(cycles::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(c)) => c,
            Ok(None) => return err_str("Sprint not found"),
            Err(e) => return err_str(e),
        };

        let now = Utc::now().fixed_offset();
        let mut active: cycles::ActiveModel = cycle.into();

        if let Some(name) = params.name {
            active.name = Set(name);
        }
        if let Some(description) = params.description {
            active.description = Set(Some(description));
        }
        if let Some(start_date) = params.start_date {
            active.start_date = Set(Some(start_date));
        }
        if let Some(end_date) = params.end_date {
            active.end_date = Set(Some(end_date));
        }
        active.updated_at = Set(Some(now));

        match active.update(&self.db).await {
            Ok(updated) => ok_json(cycle_to_json(&updated)),
            Err(e) => err_str(format!("DB update error: {}", e)),
        }
    }

    #[tool(description = "Add an issue to a sprint (cycle)")]
    async fn add_issue_to_sprint(
        &self,
        Parameters(params): Parameters<AddIssueToSprintParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        let sprint_id = match parse_uuid(&params.sprint_id, "sprint_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        // Verify cycle exists
        match cycles::Entity::find()
            .filter(cycles::Column::Id.eq(sprint_id))
            .filter(cycles::Column::ProjectId.eq(project_id))
            .filter(cycles::Column::WorkspaceId.eq(ws.id))
            .filter(cycles::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(_)) => {}
            Ok(None) => return err_str("Sprint not found"),
            Err(e) => return err_str(e),
        }

        // Verify issue exists
        match issues::Entity::find()
            .filter(issues::Column::Id.eq(issue_id))
            .filter(issues::Column::ProjectId.eq(project_id))
            .filter(issues::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(_)) => {}
            Ok(None) => return err_str("Issue not found"),
            Err(e) => return err_str(e),
        }

        // Check if already in this cycle
        match cycle_issues::Entity::find()
            .filter(cycle_issues::Column::CycleId.eq(sprint_id))
            .filter(cycle_issues::Column::IssueId.eq(issue_id))
            .filter(cycle_issues::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(_)) => return err_str("Issue is already in this sprint"),
            Ok(None) => {}
            Err(e) => return err_str(e),
        }

        let now = Utc::now().fixed_offset();

        match (cycle_issues::ActiveModel {
            id: Set(Uuid::new_v4()),
            cycle_id: Set(sprint_id),
            issue_id: Set(issue_id),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        })
        .insert(&self.db)
        .await
        {
            Ok(ci) => ok_json(serde_json::json!({
                "id": ci.id,
                "cycle_id": ci.cycle_id,
                "issue_id": ci.issue_id,
            })),
            Err(e) => err_str(format!("Cycle issue insert error: {}", e)),
        }
    }

    #[tool(description = "Remove an issue from a sprint (cycle)")]
    async fn remove_issue_from_sprint(
        &self,
        Parameters(params): Parameters<RemoveIssueFromSprintParams>,
    ) -> String {
        let _ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let sprint_id = match parse_uuid(&params.sprint_id, "sprint_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        let ci = match cycle_issues::Entity::find()
            .filter(cycle_issues::Column::CycleId.eq(sprint_id))
            .filter(cycle_issues::Column::IssueId.eq(issue_id))
            .filter(cycle_issues::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(ci)) => ci,
            Ok(None) => return err_str("Issue not found in this sprint"),
            Err(e) => return err_str(e),
        };

        let now = Utc::now().fixed_offset();
        let mut active: cycle_issues::ActiveModel = ci.into();
        active.deleted_at = Set(Some(now));
        active.updated_at = Set(Some(now));

        match active.update(&self.db).await {
            Ok(_) => ok_json(serde_json::json!({ "message": "Issue removed from sprint" })),
            Err(e) => err_str(format!("DB update error: {}", e)),
        }
    }

    #[tool(description = "Get sprint progress (issue counts by state group)")]
    async fn get_sprint_progress(
        &self,
        Parameters(params): Parameters<GetSprintProgressParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        let sprint_id = match parse_uuid(&params.sprint_id, "sprint_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        // Verify cycle
        match cycles::Entity::find()
            .filter(cycles::Column::Id.eq(sprint_id))
            .filter(cycles::Column::ProjectId.eq(project_id))
            .filter(cycles::Column::WorkspaceId.eq(ws.id))
            .filter(cycles::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(_)) => {}
            Ok(None) => return err_str("Sprint not found"),
            Err(e) => return err_str(e),
        }

        // Get issue IDs in this cycle
        let cycle_issue_list = match cycle_issues::Entity::find()
            .filter(cycle_issues::Column::CycleId.eq(sprint_id))
            .filter(cycle_issues::Column::DeletedAt.is_null())
            .all(&self.db)
            .await
        {
            Ok(l) => l,
            Err(e) => return err_str(e),
        };

        let issue_ids: Vec<Uuid> = cycle_issue_list.iter().map(|ci| ci.issue_id).collect();
        let total = issue_ids.len() as u64;

        if issue_ids.is_empty() {
            return ok_json(serde_json::json!({
                "total": 0,
                "backlog": 0,
                "unstarted": 0,
                "started": 0,
                "completed": 0,
                "cancelled": 0,
            }));
        }

        // Fetch issues
        let cycle_issues_models = match issues::Entity::find()
            .filter(issues::Column::Id.is_in(issue_ids))
            .filter(issues::Column::DeletedAt.is_null())
            .all(&self.db)
            .await
        {
            Ok(m) => m,
            Err(e) => return err_str(e),
        };

        let state_ids: Vec<Uuid> = cycle_issues_models
            .iter()
            .filter_map(|i| i.state_id)
            .collect();

        let mut state_groups: std::collections::HashMap<Uuid, String> =
            std::collections::HashMap::new();
        if !state_ids.is_empty() {
            match states::Entity::find()
                .filter(states::Column::Id.is_in(state_ids))
                .all(&self.db)
                .await
            {
                Ok(sm) => {
                    for s in sm {
                        state_groups.insert(s.id, s.group);
                    }
                }
                Err(e) => return err_str(e),
            }
        }

        let mut backlog = 0u64;
        let mut unstarted = 0u64;
        let mut started = 0u64;
        let mut completed = 0u64;
        let mut cancelled = 0u64;

        for issue in &cycle_issues_models {
            let group = issue
                .state_id
                .as_ref()
                .and_then(|sid| state_groups.get(sid))
                .map(|g| g.as_str())
                .unwrap_or("backlog");

            match group {
                "backlog" => backlog += 1,
                "unstarted" => unstarted += 1,
                "started" => started += 1,
                "completed" => completed += 1,
                "cancelled" => cancelled += 1,
                _ => backlog += 1,
            }
        }

        ok_json(serde_json::json!({
            "total": total,
            "backlog": backlog,
            "unstarted": unstarted,
            "started": started,
            "completed": completed,
            "cancelled": cancelled,
        }))
    }

    // =======================================================================
    // Label & Member tools
    // =======================================================================

    #[tool(description = "List labels for a project")]
    async fn list_labels(
        &self,
        Parameters(params): Parameters<ListLabelsParams>,
    ) -> String {
        let ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        match labels::Entity::find()
            .filter(labels::Column::WorkspaceId.eq(ws.id))
            .filter(
                labels::Column::ProjectId
                    .eq(Some(project_id))
                    .or(labels::Column::ProjectId.is_null()),
            )
            .filter(labels::Column::DeletedAt.is_null())
            .all(&self.db)
            .await
        {
            Ok(list) => {
                let result: Vec<serde_json::Value> = list
                    .iter()
                    .map(|l| {
                        serde_json::json!({
                            "id": l.id,
                            "name": l.name,
                            "description": l.description,
                            "color": l.color,
                            "project_id": l.project_id,
                        })
                    })
                    .collect();
                ok_json(serde_json::json!(result))
            }
            Err(e) => err_str(e),
        }
    }

    #[tool(description = "List members of a project")]
    async fn list_members(
        &self,
        Parameters(params): Parameters<ListMembersParams>,
    ) -> String {
        let _ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        match project_members::Entity::find()
            .filter(project_members::Column::ProjectId.eq(project_id))
            .filter(project_members::Column::DeletedAt.is_null())
            .filter(project_members::Column::IsActive.eq(true))
            .all(&self.db)
            .await
        {
            Ok(members) => {
                let mut result = Vec::new();
                for m in &members {
                    let user_display = match users::Entity::find_by_id(m.member_id)
                        .one(&self.db)
                        .await
                    {
                        Ok(Some(u)) => serde_json::json!({
                            "id": u.id,
                            "email": u.email,
                            "username": u.username,
                            "display_name": u.display_name,
                        }),
                        _ => serde_json::json!({
                            "id": m.member_id,
                        }),
                    };
                    result.push(serde_json::json!({
                        "member_id": m.member_id,
                        "role": m.role,
                        "user": user_display,
                    }));
                }
                ok_json(serde_json::json!(result))
            }
            Err(e) => err_str(e),
        }
    }

    #[tool(description = "Add or remove an assignee from an issue")]
    async fn set_assignee(
        &self,
        Parameters(params): Parameters<SetAssigneeParams>,
    ) -> String {
        let _ws = match resolve_workspace(&self.db, params.workspace.as_ref()).await {
            Ok(ws) => ws,
            Err(e) => return err_str(e),
        };
        let project_id = match parse_uuid(&params.project_id, "project_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        let user_id = match parse_uuid(&params.user_id, "user_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };

        // Verify issue exists
        match issues::Entity::find()
            .filter(issues::Column::Id.eq(issue_id))
            .filter(issues::Column::ProjectId.eq(project_id))
            .filter(issues::Column::DeletedAt.is_null())
            .one(&self.db)
            .await
        {
            Ok(Some(_)) => {}
            Ok(None) => return err_str("Issue not found"),
            Err(e) => return err_str(e),
        }

        let action = params.action.unwrap_or_else(|| "add".to_string());
        let now = Utc::now().fixed_offset();

        match action.as_str() {
            "add" => {
                // Check if already assigned
                match issue_assignees::Entity::find()
                    .filter(issue_assignees::Column::IssueId.eq(issue_id))
                    .filter(issue_assignees::Column::AssigneeId.eq(user_id))
                    .filter(issue_assignees::Column::DeletedAt.is_null())
                    .one(&self.db)
                    .await
                {
                    Ok(Some(_)) => return ok_json(serde_json::json!({ "message": "Already assigned" })),
                    Ok(None) => {}
                    Err(e) => return err_str(e),
                }

                match (issue_assignees::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    issue_id: Set(issue_id),
                    assignee_id: Set(user_id),
                    created_at: Set(Some(now)),
                    updated_at: Set(Some(now)),
                    deleted_at: Set(None),
                })
                .insert(&self.db)
                .await
                {
                    Ok(_) => ok_json(serde_json::json!({ "message": "Assignee added" })),
                    Err(e) => err_str(format!("Assignee insert error: {}", e)),
                }
            }
            "remove" => {
                let assignee = match issue_assignees::Entity::find()
                    .filter(issue_assignees::Column::IssueId.eq(issue_id))
                    .filter(issue_assignees::Column::AssigneeId.eq(user_id))
                    .filter(issue_assignees::Column::DeletedAt.is_null())
                    .one(&self.db)
                    .await
                {
                    Ok(Some(a)) => a,
                    Ok(None) => return ok_json(serde_json::json!({ "message": "Not assigned" })),
                    Err(e) => return err_str(e),
                };

                let mut active: issue_assignees::ActiveModel = assignee.into();
                active.deleted_at = Set(Some(now));
                active.updated_at = Set(Some(now));

                match active.update(&self.db).await {
                    Ok(_) => ok_json(serde_json::json!({ "message": "Assignee removed" })),
                    Err(e) => err_str(format!("DB update error: {}", e)),
                }
            }
            _ => err_str("Invalid action. Use 'add' or 'remove'"),
        }
    }
}

// ---------------------------------------------------------------------------
// ServerHandler impl
// ---------------------------------------------------------------------------

#[rmcp::tool_handler]
impl ServerHandler for PlaneMcpServer {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::default();
        info.server_info = Implementation::new("plane-pmo", env!("CARGO_PKG_VERSION"));
        info
    }
}

// ---------------------------------------------------------------------------
// Axum route integration
// ---------------------------------------------------------------------------

/// Create the StreamableHttpService for mounting in the Axum router.
pub fn create_mcp_service(
    db: sea_orm::DatabaseConnection,
) -> StreamableHttpService<PlaneMcpServer, LocalSessionManager> {
    let db_clone = db.clone();
    StreamableHttpService::new(
        move || Ok(PlaneMcpServer::new(db_clone.clone())),
        LocalSessionManager::default().into(),
        Default::default(),
    )
}

//! MCP (Model Context Protocol) server exposing Plane PMO tools to AI agents.
//!
//! Mounted at `/mcp` as a Tower service using rmcp's `StreamableHttpService`.

mod labels;
mod modules;
mod pages;
mod projects;
mod issues;
mod relations;
mod sprints;
mod states;
mod workspace;

use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

use db::entities::{self as db_entities, api_keys, users, workspaces};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{Implementation, ServerInfo};
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::tower::StreamableHttpService;
use rmcp::{tool, tool_router, ServerHandler};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tower::{Layer, Service};
use uuid::Uuid;

// Re-export param types from sub-modules so the #[tool_router] macro can find them
pub use issues::{
    AddCommentParams, CreateIssueParams, DeleteIssueParams, GetIssueParams, ListCommentsParams,
    ListIssuesParams, SearchIssuesParams, UpdateIssueParams,
};
pub use labels::{ListLabelsParams, ListMembersParams, SetAssigneeParams};
pub use modules::{
    AddIssueToModuleParams, ListModulesParams, RemoveIssueFromModuleParams, GetModuleParams,
};
pub use pages::{CreatePageParams, GetPageParams, ListPagesParams, UpdatePageParams};
pub use projects::{CreateProjectParams, GetProjectParams, ListProjectsParams};
pub use relations::{
    AddIssueRelationParams, ListIssueRelationsParams, RemoveIssueRelationParams,
};
pub use sprints::{
    AddIssueToSprintParams, CreateSprintParams, GetSprintParams, GetSprintProgressParams,
    ListSprintsParams, RemoveIssueFromSprintParams, UpdateSprintParams,
};
pub use states::ListStatesParams;
pub use workspace::ListWorkspaceMembersParams;

// ---------------------------------------------------------------------------
// Parameter structs for tools kept in mod.rs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListWorkspacesParams {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse a UUID string, returning an error string on failure.
pub(crate) fn parse_uuid(s: &str, field: &str) -> Result<Uuid, String> {
    Uuid::parse_str(s).map_err(|e| format!("Invalid UUID for {}: {} ({})", field, s, e))
}

/// Simple HTML-to-plaintext stripper (removes tags).
pub(crate) fn strip_html(html: &str) -> String {
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

pub(crate) fn ok_json(val: serde_json::Value) -> String {
    serde_json::to_string_pretty(&val).unwrap_or_else(|e| format!("Error: {}", e))
}

pub(crate) fn err_str(msg: impl std::fmt::Display) -> String {
    format!("Error: {}", msg)
}

pub(crate) async fn resolve_workspace(
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
pub(crate) fn issue_to_json(i: &db::entities::issues::Model) -> serde_json::Value {
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
pub(crate) fn cycle_to_json(c: &db::entities::cycles::Model) -> serde_json::Value {
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
        projects::list_projects_impl(&self.db, params).await
    }

    #[tool(description = "Get project details")]
    async fn get_project(
        &self,
        Parameters(params): Parameters<GetProjectParams>,
    ) -> String {
        projects::get_project_impl(&self.db, params).await
    }

    #[tool(description = "Create a new project in a workspace with default states (Backlog, Todo, In Progress, Done, Cancelled, Triage)")]
    async fn create_project(
        &self,
        Parameters(params): Parameters<CreateProjectParams>,
    ) -> String {
        projects::create_project_impl(&self.db, params, self.bot_user_id).await
    }

    // =======================================================================
    // Issue tools
    // =======================================================================

    #[tool(description = "List issues in a project with optional filters")]
    async fn list_issues(
        &self,
        Parameters(params): Parameters<ListIssuesParams>,
    ) -> String {
        issues::list_issues_impl(&self.db, params).await
    }

    #[tool(description = "Create a new issue in a project")]
    async fn create_issue(
        &self,
        Parameters(params): Parameters<CreateIssueParams>,
    ) -> String {
        issues::create_issue_impl(&self.db, params, self.bot_user_id).await
    }

    #[tool(description = "Get a single issue by UUID or sequence ID")]
    async fn get_issue(
        &self,
        Parameters(params): Parameters<GetIssueParams>,
    ) -> String {
        issues::get_issue_impl(&self.db, params).await
    }

    #[tool(description = "Update an existing issue")]
    async fn update_issue(
        &self,
        Parameters(params): Parameters<UpdateIssueParams>,
    ) -> String {
        issues::update_issue_impl(&self.db, params).await
    }

    #[tool(description = "Delete an issue (soft delete)")]
    async fn delete_issue(
        &self,
        Parameters(params): Parameters<DeleteIssueParams>,
    ) -> String {
        issues::delete_issue_impl(&self.db, params).await
    }

    #[tool(description = "Search issues across a workspace or project")]
    async fn search_issues(
        &self,
        Parameters(params): Parameters<SearchIssuesParams>,
    ) -> String {
        issues::search_issues_impl(&self.db, params).await
    }

    #[tool(description = "Add a comment to an issue")]
    async fn add_comment(
        &self,
        Parameters(params): Parameters<AddCommentParams>,
    ) -> String {
        issues::add_comment_impl(&self.db, params, self.bot_user_id).await
    }

    #[tool(description = "List comments on an issue")]
    async fn list_comments(
        &self,
        Parameters(params): Parameters<ListCommentsParams>,
    ) -> String {
        issues::list_comments_impl(&self.db, params).await
    }

    // =======================================================================
    // Sprint (Cycle) tools
    // =======================================================================

    #[tool(description = "List sprints (cycles) in a project")]
    async fn list_sprints(
        &self,
        Parameters(params): Parameters<ListSprintsParams>,
    ) -> String {
        sprints::list_sprints_impl(&self.db, params).await
    }

    #[tool(description = "Create a new sprint (cycle)")]
    async fn create_sprint(
        &self,
        Parameters(params): Parameters<CreateSprintParams>,
    ) -> String {
        sprints::create_sprint_impl(&self.db, params, self.bot_user_id).await
    }

    #[tool(description = "Get sprint details")]
    async fn get_sprint(
        &self,
        Parameters(params): Parameters<GetSprintParams>,
    ) -> String {
        sprints::get_sprint_impl(&self.db, params).await
    }

    #[tool(description = "Update a sprint")]
    async fn update_sprint(
        &self,
        Parameters(params): Parameters<UpdateSprintParams>,
    ) -> String {
        sprints::update_sprint_impl(&self.db, params).await
    }

    #[tool(description = "Add an issue to a sprint (cycle)")]
    async fn add_issue_to_sprint(
        &self,
        Parameters(params): Parameters<AddIssueToSprintParams>,
    ) -> String {
        sprints::add_issue_to_sprint_impl(&self.db, params).await
    }

    #[tool(description = "Remove an issue from a sprint (cycle)")]
    async fn remove_issue_from_sprint(
        &self,
        Parameters(params): Parameters<RemoveIssueFromSprintParams>,
    ) -> String {
        sprints::remove_issue_from_sprint_impl(&self.db, params).await
    }

    #[tool(description = "Get sprint progress (issue counts by state group)")]
    async fn get_sprint_progress(
        &self,
        Parameters(params): Parameters<GetSprintProgressParams>,
    ) -> String {
        sprints::get_sprint_progress_impl(&self.db, params).await
    }

    // =======================================================================
    // Label & Member tools
    // =======================================================================

    #[tool(description = "List labels for a project")]
    async fn list_labels(
        &self,
        Parameters(params): Parameters<ListLabelsParams>,
    ) -> String {
        labels::list_labels_impl(&self.db, params).await
    }

    #[tool(description = "List members of a project")]
    async fn list_members(
        &self,
        Parameters(params): Parameters<ListMembersParams>,
    ) -> String {
        labels::list_members_impl(&self.db, params).await
    }

    #[tool(description = "Add or remove an assignee from an issue")]
    async fn set_assignee(
        &self,
        Parameters(params): Parameters<SetAssigneeParams>,
    ) -> String {
        labels::set_assignee_impl(&self.db, params).await
    }

    // =======================================================================
    // State tools
    // =======================================================================

    #[tool(description = "List states for a project")]
    async fn list_states(
        &self,
        Parameters(params): Parameters<ListStatesParams>,
    ) -> String {
        states::list_states_impl(&self.db, params).await
    }

    // =======================================================================
    // Relation tools
    // =======================================================================

    #[tool(description = "List relations for an issue")]
    async fn list_issue_relations(
        &self,
        Parameters(params): Parameters<ListIssueRelationsParams>,
    ) -> String {
        relations::list_issue_relations_impl(&self.db, params).await
    }

    #[tool(description = "Add a relation between two issues")]
    async fn add_issue_relation(
        &self,
        Parameters(params): Parameters<AddIssueRelationParams>,
    ) -> String {
        relations::add_issue_relation_impl(&self.db, params, self.bot_user_id).await
    }

    #[tool(description = "Remove an issue relation")]
    async fn remove_issue_relation(
        &self,
        Parameters(params): Parameters<RemoveIssueRelationParams>,
    ) -> String {
        relations::remove_issue_relation_impl(&self.db, params).await
    }

    // =======================================================================
    // Page tools
    // =======================================================================

    #[tool(description = "List pages in a workspace")]
    async fn list_pages(
        &self,
        Parameters(params): Parameters<ListPagesParams>,
    ) -> String {
        pages::list_pages_impl(&self.db, params).await
    }

    #[tool(description = "Get page details")]
    async fn get_page(
        &self,
        Parameters(params): Parameters<GetPageParams>,
    ) -> String {
        pages::get_page_impl(&self.db, params).await
    }

    #[tool(description = "Create a new page in a workspace")]
    async fn create_page(
        &self,
        Parameters(params): Parameters<CreatePageParams>,
    ) -> String {
        pages::create_page_impl(&self.db, params, self.bot_user_id).await
    }

    #[tool(description = "Update a page")]
    async fn update_page(
        &self,
        Parameters(params): Parameters<UpdatePageParams>,
    ) -> String {
        pages::update_page_impl(&self.db, params).await
    }

    // =======================================================================
    // Workspace member tools
    // =======================================================================

    #[tool(description = "List workspace members")]
    async fn list_workspace_members(
        &self,
        Parameters(params): Parameters<ListWorkspaceMembersParams>,
    ) -> String {
        workspace::list_workspace_members_impl(&self.db, params).await
    }

    // =======================================================================
    // Module tools
    // =======================================================================

    #[tool(description = "List modules in a project")]
    async fn list_modules(
        &self,
        Parameters(params): Parameters<ListModulesParams>,
    ) -> String {
        modules::list_modules_impl(&self.db, params).await
    }

    #[tool(description = "Get module details")]
    async fn get_module(
        &self,
        Parameters(params): Parameters<GetModuleParams>,
    ) -> String {
        modules::get_module_impl(&self.db, params).await
    }

    #[tool(description = "Add an issue to a module")]
    async fn add_issue_to_module(
        &self,
        Parameters(params): Parameters<AddIssueToModuleParams>,
    ) -> String {
        modules::add_issue_to_module_impl(&self.db, params).await
    }

    #[tool(description = "Remove an issue from a module")]
    async fn remove_issue_from_module(
        &self,
        Parameters(params): Parameters<RemoveIssueFromModuleParams>,
    ) -> String {
        modules::remove_issue_from_module_impl(&self.db, params).await
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
// MCP Auth Layer
// ---------------------------------------------------------------------------

pub struct McpAuthLayer {
    db: sea_orm::DatabaseConnection,
}

impl McpAuthLayer {
    pub fn new(db: sea_orm::DatabaseConnection) -> Self {
        Self { db }
    }

    pub fn is_enabled() -> bool {
        std::env::var("PLANE_MCP_AUTH")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false)
    }
}

impl<S> Layer<S> for McpAuthLayer {
    type Service = McpAuthService<S>;
    fn layer(&self, inner: S) -> Self::Service {
        McpAuthService {
            inner,
            db: self.db.clone(),
        }
    }
}

#[derive(Clone)]
pub struct McpAuthService<S> {
    inner: S,
    db: sea_orm::DatabaseConnection,
}

type BoxResponse = axum::http::Response<http_body_util::combinators::BoxBody<axum::body::Bytes, std::convert::Infallible>>;

use std::convert::Infallible;

fn unauthorized_response() -> BoxResponse {
    use std::convert::Infallible;
    use http_body_util::BodyExt;
    let body = serde_json::to_string(&serde_json::json!({"jsonrpc":"2.0","error":{"code":-32600,"message":"Authentication required"},"id":null}))
        .unwrap_or_default();
    let full: http_body_util::Full<axum::body::Bytes> = http_body_util::Full::new(axum::body::Bytes::from(body));
    let boxed: http_body_util::combinators::BoxBody<axum::body::Bytes, Infallible> = full.boxed();
    axum::http::Response::builder()
        .status(axum::http::StatusCode::UNAUTHORIZED)
        .header("content-type", "application/json")
        .body(boxed)
        .unwrap()
}

impl<S, B> Service<axum::http::Request<B>> for McpAuthService<S>
where
    S: Service<axum::http::Request<B>, Response = BoxResponse, Error = std::convert::Infallible> + Send + Clone + 'static,
    S::Future: Send + 'static,
    B: Send + 'static,
{
    type Response = BoxResponse;
    type Error = std::convert::Infallible;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: axum::http::Request<B>) -> Self::Future {
        // If auth is not enabled, passthrough
        if !McpAuthLayer::is_enabled() {
            let mut inner = self.inner.clone();
            return Box::pin(async move { inner.call(req).await });
        }

        let db = self.db.clone();
        let mut inner = self.inner.clone();

        Box::pin(async move {
            // Try X-API-Key header
            if let Some(api_key) = req
                .headers()
                .get("X-API-Key")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
            {
                if validate_api_key(&db, &api_key).await.is_some() {
                    return inner.call(req).await;
                }
            }

            // Try Authorization: Bearer
            if let Some(bearer) = req
                .headers()
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(|s| s.trim().to_string())
            {
                if validate_bearer(&db, &bearer).await.is_some() {
                    return inner.call(req).await;
                }
            }

            Ok(unauthorized_response())
        })
    }
}

async fn validate_api_key(db: &sea_orm::DatabaseConnection, raw_key: &str) -> Option<()> {
    let mut hasher = Sha256::new();
    hasher.update(raw_key.as_bytes());
    let key_hash = format!("{:x}", hasher.finalize());

    let api_key = api_keys::Entity::find()
        .filter(api_keys::Column::KeyHash.eq(&key_hash))
        .filter(api_keys::Column::IsActive.eq(true))
        .filter(api_keys::Column::DeletedAt.is_null())
        .one(db)
        .await
        .ok()??;

    if let Some(expires) = api_key.expires_at {
        if expires < chrono::Utc::now().fixed_offset() {
            return None;
        }
    }

    // Update last_used_at (best effort)
    let key_id = api_key.id;
    let _ = api_keys::Entity::update_many()
        .col_expr(api_keys::Column::LastUsedAt, sea_orm::sea_query::Expr::value(chrono::Utc::now().fixed_offset()))
        .filter(api_keys::Column::Id.eq(key_id))
        .exec(db)
        .await;

    Some(())
}

async fn validate_bearer(db: &sea_orm::DatabaseConnection, token: &str) -> Option<()> {
    users::Entity::find()
        .filter(users::Column::Token.eq(token))
        .filter(users::Column::IsActive.eq(true))
        .filter(users::Column::DeletedAt.is_null())
        .one(db)
        .await
        .ok()??;
    Some(())
}

// ---------------------------------------------------------------------------
// Axum route integration
// ---------------------------------------------------------------------------

/// Create the MCP service for mounting in the Axum router.
/// When PLANE_MCP_AUTH=true, wraps with API key / Bearer token auth.
pub fn create_mcp_service(
    db: sea_orm::DatabaseConnection,
) -> McpAuthService<StreamableHttpService<PlaneMcpServer, LocalSessionManager>> {
    let db_clone = db.clone();
    let service = StreamableHttpService::new(
        move || Ok(PlaneMcpServer::new(db_clone.clone())),
        LocalSessionManager::default().into(),
        Default::default(),
    );
    McpAuthLayer::new(db).layer(service)
}

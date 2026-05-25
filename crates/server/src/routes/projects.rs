use axum::extract::{Extension, Path, State};
use axum::response::IntoResponse;
use axum::Json;
use axum::routing::{delete, get, patch, post};
use chrono::Utc;
use db::entities::{estimates, labels, project_members, projects, states, work_item_types, views};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::middleware::permission::{load_workspace_by_slug, require_project_role, require_workspace_role};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Role constants
// ---------------------------------------------------------------------------

const ROLE_ADMIN: i16 = 20;
const ROLE_MEMBER: i16 = 15;
const ROLE_GUEST: i16 = 5;

// ---------------------------------------------------------------------------
// Default states for new projects
// ---------------------------------------------------------------------------

struct DefaultState {
    name: &'static str,
    group: &'static str,
    slug: &'static str,
    color: &'static str,
    sequence: f32,
    is_default: bool,
    is_triage: bool,
}

const DEFAULT_STATES: [DefaultState; 6] = [
    DefaultState { name: "Backlog", group: "backlog", slug: "backlog", color: "#A3A3A3", sequence: 10000.0, is_default: false, is_triage: false },
    DefaultState { name: "Todo", group: "unstarted", slug: "todo", color: "#3B82F6", sequence: 20000.0, is_default: true, is_triage: false },
    DefaultState { name: "In Progress", group: "started", slug: "in-progress", color: "#F59E0B", sequence: 30000.0, is_default: false, is_triage: false },
    DefaultState { name: "Done", group: "completed", slug: "done", color: "#16A34A", sequence: 40000.0, is_default: false, is_triage: false },
    DefaultState { name: "Cancelled", group: "cancelled", slug: "cancelled", color: "#EF4444", sequence: 50000.0, is_default: false, is_triage: false },
    DefaultState { name: "Triage", group: "triage", slug: "triage", color: "#8B5CF6", sequence: 60000.0, is_default: false, is_triage: true },
];

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ProjectResponse {
    pub id: Uuid,
    pub name: String,
    pub identifier: String,
    pub description: Option<String>,
    pub description_html: Option<serde_json::Value>,
    pub description_json: Option<serde_json::Value>,
    pub workspace_id: Uuid,
    pub network: i16,
    pub emoji: Option<String>,
    pub icon_prop: Option<serde_json::Value>,
    pub cover_image: Option<String>,
    pub default_assignee_id: Option<Uuid>,
    pub project_lead_id: Option<Uuid>,
    pub default_state_id: Option<Uuid>,
    pub module_view: bool,
    pub cycle_view: bool,
    pub page_view: bool,
    pub intake_view: bool,
    pub is_time_tracking_enabled: bool,
    pub timezone: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<projects::Model> for ProjectResponse {
    fn from(m: projects::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            identifier: m.identifier,
            description: m.description,
            description_html: m.description_html,
            description_json: m.description_json,
            workspace_id: m.workspace_id,
            network: m.network,
            emoji: m.emoji,
            icon_prop: m.icon_prop,
            cover_image: m.cover_image,
            default_assignee_id: m.default_assignee_id,
            project_lead_id: m.project_lead_id,
            default_state_id: m.default_state_id,
            module_view: m.module_view,
            cycle_view: m.cycle_view,
            page_view: m.page_view,
            intake_view: m.intake_view,
            is_time_tracking_enabled: m.is_time_tracking_enabled,
            timezone: m.timezone,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
            updated_at: m.updated_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ProjectMemberResponse {
    pub id: Uuid,
    pub project_id: Uuid,
    pub workspace_id: Uuid,
    pub member_id: Uuid,
    pub role: i16,
    pub is_active: bool,
    pub sort_order: f32,
    pub created_at: Option<String>,
}

impl From<project_members::Model> for ProjectMemberResponse {
    fn from(m: project_members::Model) -> Self {
        Self {
            id: m.id,
            project_id: m.project_id,
            workspace_id: m.workspace_id,
            member_id: m.member_id,
            role: m.role,
            is_active: m.is_active,
            sort_order: m.sort_order,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StateResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub slug: Option<String>,
    pub sequence: f32,
    pub group: String,
    pub is_triage: bool,
    pub is_default: bool,
    pub project_id: Uuid,
    pub workspace_id: Uuid,
    pub created_at: Option<String>,
}

impl From<states::Model> for StateResponse {
    fn from(m: states::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            description: m.description,
            color: m.color,
            slug: m.slug,
            sequence: m.sequence,
            group: m.group,
            is_triage: m.is_triage,
            is_default: m.is_default,
            project_id: m.project_id,
            workspace_id: m.workspace_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct LabelResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub sort_order: f32,
    pub parent_id: Option<Uuid>,
    pub workspace_id: Uuid,
    pub project_id: Option<Uuid>,
    pub created_at: Option<String>,
}

impl From<labels::Model> for LabelResponse {
    fn from(m: labels::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            description: m.description,
            color: m.color,
            sort_order: m.sort_order,
            parent_id: m.parent_id,
            workspace_id: m.workspace_id,
            project_id: m.project_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct EstimateResponse {
    pub id: Uuid,
    pub name: String,
    pub project_id: Uuid,
    pub workspace_id: Uuid,
    pub created_at: Option<String>,
}

impl From<estimates::Model> for EstimateResponse {
    fn from(m: estimates::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            project_id: m.project_id,
            workspace_id: m.workspace_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub identifier: String,
    pub description: Option<String>,
    pub emoji: Option<String>,
    pub cover_image: Option<String>,
    pub network: Option<i16>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub emoji: Option<String>,
    pub cover_image: Option<String>,
    pub network: Option<i16>,
    pub default_assignee_id: Option<Uuid>,
    pub project_lead_id: Option<Uuid>,
    pub module_view: Option<bool>,
    pub cycle_view: Option<bool>,
    pub page_view: Option<bool>,
    pub intake_view: Option<bool>,
    pub is_time_tracking_enabled: Option<bool>,
    pub timezone: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddProjectMemberRequest {
    pub user_id: Uuid,
    pub role: Option<i16>,
}

#[derive(Debug, Deserialize)]
pub struct CreateStateRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub slug: Option<String>,
    pub sequence: Option<f32>,
    pub group: String,
    pub is_default: Option<bool>,
    pub is_triage: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateStateRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
    pub slug: Option<String>,
    pub sequence: Option<f32>,
    pub group: Option<String>,
    pub is_default: Option<bool>,
    pub is_triage: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CreateLabelRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub parent_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct CreateEstimateRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateWorkItemTypeRequest {
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_active: Option<bool>,
    pub sort_order: Option<f32>,
}

#[derive(Debug, Deserialize)]
pub struct CreateViewRequest {
    pub name: String,
    pub description: Option<String>,
    pub query: Option<serde_json::Value>,
    pub is_locked: Option<bool>,
    pub access: Option<String>,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/", get(list_projects).post(create_project))
        // Must be before /{project_id}/ to avoid being parsed as UUID
        .route("/details/", get(get_project_details))
        .route("/details", get(get_project_details))
        .route("/project_roles/", get(get_project_roles))
        .route("/project_roles", get(get_project_roles))
        .route("/project_roles/cycles/", get(get_project_roles))
        .route("/project_roles/cycles", get(get_project_roles))
        .route("/project_roles/issues/", post(create_issue_project_roles))
        .route("/project_roles/issues", post(create_issue_project_roles))
        .route(
            "/{project_id}/",
            get(get_project).patch(update_project).delete(delete_project),
        )
        .route(
            "/{project_id}/members/",
            get(list_members).post(add_member),
        )
        .route(
            "/{project_id}/members/{member_id}/",
            delete(remove_member),
        )
        .route(
            "/{project_id}/states/",
            get(list_states).post(create_state),
        )
        .route(
            "/{project_id}/states/{state_id}/",
            patch(update_state).delete(delete_state),
        )
        .route(
            "/{project_id}/labels/",
            get(list_labels).post(create_label),
        )
        .route(
            "/{project_id}/estimates/",
            get(list_estimates).post(create_estimate),
        )
        // Issue routes nested under each project
        .nest(
            "/{project_id}/issues",
            super::issues::router(),
        )
        // Archived issues route
        .nest(
            "/{project_id}/archived-issues",
            super::issues::archived_router(),
        )
        // Bulk delete issues
        .route(
            "/{project_id}/bulk-delete-issues/",
            post(super::issues::bulk_delete_issues),
        )
        // Cycle routes nested under each project
        .nest(
            "/{project_id}/cycles",
            super::cycles::router(),
        )
        // Custom field definitions
        .nest(
            "/{project_id}/custom-fields",
            super::custom_fields::router(),
        )
        // Module routes nested under each project
        .nest(
            "/{project_id}/modules",
            super::modules::router(),
        )
        // Import routes nested under each project
        .nest(
            "/{project_id}/importers",
            super::imports::router(),
        )
        // Import v2 route (unified multipart endpoint)
        .nest(
            "/{project_id}/import",
            super::imports::router(),
        )
        // Export route nested under each project
        .nest(
            "/{project_id}/export",
            super::exports::router(),
        )
        // Project members (current user)
        .route("/{project_id}/members/me/", get(get_my_project_membership))
        .route("/{project_id}/members/me", get(get_my_project_membership))
        // Project members list (alias)
        .route("/{project_id}/project-members/", get(list_project_members_alias))
        .route("/{project_id}/project-members", get(list_project_members_alias))
        // Work item types
        .route("/{project_id}/work-item-types/", get(list_work_item_types).post(create_work_item_type))
        .route("/{project_id}/work-item-types", get(list_work_item_types).post(create_work_item_type))
        // Issue relation stub
        .route("/{project_id}/issue-relation/", get(list_issue_relations))
        .route("/{project_id}/issue-relation", get(list_issue_relations))
        // Project member "me" under project-members path
        .route("/{project_id}/project-members/me/", get(get_my_project_membership))
        .route("/{project_id}/project-members/me", get(get_my_project_membership))
        // Project user properties stub
        .route("/{project_id}/user-properties/", get(get_project_user_properties))
        .route("/{project_id}/user-properties", get(get_project_user_properties))
        // Issue labels (alias for labels)
        .route("/{project_id}/issue-labels/", get(list_issue_labels))
        .route("/{project_id}/issue-labels", get(list_issue_labels))
        // Intake state stub
        .route("/{project_id}/intake-state/", get(get_intake_state))
        .route("/{project_id}/intake-state", get(get_intake_state))
        // Views
        .route("/{project_id}/views/", get(list_views).post(create_view))
        .route("/{project_id}/views", get(list_views).post(create_view))
        // Cycles with trailing slash (standalone, alongside nested router)
        .route("/{project_id}/cycles/", get(list_project_cycles_alias).post(create_project_cycle_alias))
        .route("/{project_id}/modules/", get(list_project_modules_alias))
        // Issues with trailing slash (alongside nested router)
        .route("/{project_id}/issues/", get(list_project_issues_alias))
}

// ---------------------------------------------------------------------------
// Handlers - Projects
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/ - List projects in workspace
pub async fn list_projects(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let project_list = projects::Entity::find()
        .filter(projects::Column::WorkspaceId.eq(workspace.id))
        .filter(projects::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<ProjectResponse> = project_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/projects/ - Create project
pub async fn create_project(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<CreateProjectRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_MEMBER).await?;

    // Validate identifier format (uppercase letters + digits, short)
    if body.identifier.len() > 12 || body.identifier.is_empty() {
        return Err(AppError::BadRequest(
            "Project identifier must be 1-12 characters".into(),
        ));
    }

    // Check identifier uniqueness within workspace
    if projects::Entity::find()
        .filter(projects::Column::Identifier.eq(&body.identifier))
        .filter(projects::Column::WorkspaceId.eq(workspace.id))
        .filter(projects::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .is_some()
    {
        return Err(AppError::Conflict(
            "Project identifier already taken in this workspace".into(),
        ));
    }

    let now = Utc::now().fixed_offset();
    let project_id = Uuid::new_v4();

    let project = projects::ActiveModel {
        id: Set(project_id),
        name: Set(body.name),
        identifier: Set(body.identifier),
        description: Set(body.description),
        description_html: Set(None),
        description_json: Set(None),
        workspace_id: Set(workspace.id),
        network: Set(body.network.unwrap_or(0)),
        emoji: Set(body.emoji),
        icon_prop: Set(None),
        cover_image: Set(body.cover_image),
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
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    // Auto-create default states
    let mut default_state_id: Option<Uuid> = None;
    for ds in &DEFAULT_STATES {
        let state_id = Uuid::new_v4();
        if ds.is_default {
            default_state_id = Some(state_id);
        }
        states::ActiveModel {
            id: Set(state_id),
            name: Set(ds.name.to_string()),
            description: Set(None),
            color: Set(Some(ds.color.to_string())),
            slug: Set(Some(ds.slug.to_string())),
            sequence: Set(ds.sequence),
            group: Set(ds.group.to_string()),
            is_triage: Set(ds.is_triage),
            is_default: Set(ds.is_default),
            project_id: Set(project_id),
            workspace_id: Set(workspace.id),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        }
        .insert(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("State insert error: {}", e)))?;
    }

    // Update default_state_id on the project
    if let Some(sid) = default_state_id {
        let mut active: projects::ActiveModel = project.clone().into();
        active.default_state_id = Set(Some(sid));
        active
            .update(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;
    }

    // Auto-add creator as project admin
    project_members::ActiveModel {
        id: Set(Uuid::new_v4()),
        project_id: Set(project_id),
        workspace_id: Set(workspace.id),
        member_id: Set(current_user.0.id),
        role: Set(ROLE_ADMIN),
        is_active: Set(true),
        sort_order: Set(65535.0),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Member insert error: {}", e)))?;

    // Reload to get the updated default_state_id
    let project = projects::Entity::find_by_id(project_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("Project not found after insert")))?;

    // Index the project in Tantivy if available
    // TODO: index_project(&state, &project);

    Ok((
        axum::http::StatusCode::CREATED,
        Json(ProjectResponse::from(project)),
    ))
}

/// GET /api/workspaces/<slug>/projects/<uuid>/ - Get project
pub async fn get_project(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let project = projects::Entity::find()
        .filter(projects::Column::Id.eq(project_id))
        .filter(projects::Column::WorkspaceId.eq(workspace.id))
        .filter(projects::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    Ok(Json(ProjectResponse::from(project)))
}

/// PATCH /api/workspaces/<slug>/projects/<uuid>/ - Update project
pub async fn update_project(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<UpdateProjectRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let project = projects::Entity::find()
        .filter(projects::Column::Id.eq(project_id))
        .filter(projects::Column::WorkspaceId.eq(workspace.id))
        .filter(projects::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: projects::ActiveModel = project.into();
    if let Some(name) = body.name {
        active.name = Set(name);
    }
    if let Some(description) = body.description {
        active.description = Set(Some(description));
    }
    if let Some(emoji) = body.emoji {
        active.emoji = Set(Some(emoji));
    }
    if let Some(cover_image) = body.cover_image {
        active.cover_image = Set(Some(cover_image));
    }
    if let Some(network) = body.network {
        active.network = Set(network);
    }
    if let Some(default_assignee_id) = body.default_assignee_id {
        active.default_assignee_id = Set(Some(default_assignee_id));
    }
    if let Some(project_lead_id) = body.project_lead_id {
        active.project_lead_id = Set(Some(project_lead_id));
    }
    if let Some(module_view) = body.module_view {
        active.module_view = Set(module_view);
    }
    if let Some(cycle_view) = body.cycle_view {
        active.cycle_view = Set(cycle_view);
    }
    if let Some(page_view) = body.page_view {
        active.page_view = Set(page_view);
    }
    if let Some(intake_view) = body.intake_view {
        active.intake_view = Set(intake_view);
    }
    if let Some(is_time_tracking_enabled) = body.is_time_tracking_enabled {
        active.is_time_tracking_enabled = Set(is_time_tracking_enabled);
    }
    if let Some(timezone) = body.timezone {
        active.timezone = Set(Some(timezone));
    }
    active.updated_at = Set(Some(now));

    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    // Re-index the project in Tantivy if available
    index_project(&state, &updated);

    Ok(Json(ProjectResponse::from(updated)))
}

/// DELETE /api/workspaces/<slug>/projects/<uuid>/ - Soft-delete project
pub async fn delete_project(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_ADMIN).await?;

    let project = projects::Entity::find()
        .filter(projects::Column::Id.eq(project_id))
        .filter(projects::Column::WorkspaceId.eq(workspace.id))
        .filter(projects::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: projects::ActiveModel = project.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    // Remove from Tantivy index if available
    if let Some(ref index) = state.search_index {
        let _ = crate::search_index::remove_entity(index, &project_id.to_string());
    }

    Ok(Json(serde_json::json!({ "message": "Project deleted" })))
}

// ---------------------------------------------------------------------------
// Handlers - Project Members
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/<uuid>/members/ - List project members
pub async fn list_members(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let members = project_members::Entity::find()
        .filter(project_members::Column::ProjectId.eq(project_id))
        .filter(project_members::Column::DeletedAt.is_null())
        .filter(project_members::Column::IsActive.eq(true))
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<ProjectMemberResponse> = members.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/projects/<uuid>/members/ - Add member
pub async fn add_member(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<AddProjectMemberRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_ADMIN).await?;

    let role = body.role.unwrap_or(ROLE_MEMBER);

    // Check if already a member
    let existing = project_members::Entity::find()
        .filter(project_members::Column::ProjectId.eq(project_id))
        .filter(project_members::Column::MemberId.eq(body.user_id))
        .filter(project_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    if existing.is_some() {
        return Err(AppError::Conflict("User is already a project member".into()));
    }

    let now = Utc::now().fixed_offset();
    let member = project_members::ActiveModel {
        id: Set(Uuid::new_v4()),
        project_id: Set(project_id),
        workspace_id: Set(workspace.id),
        member_id: Set(body.user_id),
        role: Set(role),
        is_active: Set(true),
        sort_order: Set(65535.0),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(ProjectMemberResponse::from(member)),
    ))
}

/// DELETE /api/workspaces/<slug>/projects/<uuid>/members/<member_id>/ - Remove member
pub async fn remove_member(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, member_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_ADMIN).await?;

    let membership = project_members::Entity::find()
        .filter(project_members::Column::Id.eq(member_id))
        .filter(project_members::Column::ProjectId.eq(project_id))
        .filter(project_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Member not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: project_members::ActiveModel = membership.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Member removed" })))
}

// ---------------------------------------------------------------------------
// Handlers - States
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/<uuid>/states/ - List states
pub async fn list_states(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let state_list = states::Entity::find()
        .filter(states::Column::ProjectId.eq(project_id))
        .filter(states::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<StateResponse> = state_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/projects/<uuid>/states/ - Create state
pub async fn create_state(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<CreateStateRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let now = Utc::now().fixed_offset();
    let state = states::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(body.name),
        description: Set(body.description),
        color: Set(body.color),
        slug: Set(body.slug),
        sequence: Set(body.sequence.unwrap_or(65535.0)),
        group: Set(body.group),
        is_triage: Set(body.is_triage.unwrap_or(false)),
        is_default: Set(body.is_default.unwrap_or(false)),
        project_id: Set(project_id),
        workspace_id: Set(workspace.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(StateResponse::from(state)),
    ))
}

/// PATCH /api/workspaces/<slug>/projects/<uuid>/states/<uuid>/ - Update state
pub async fn update_state(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, state_id)): Path<(String, Uuid, Uuid)>,
    Json(body): Json<UpdateStateRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let state_model = states::Entity::find()
        .filter(states::Column::Id.eq(state_id))
        .filter(states::Column::ProjectId.eq(project_id))
        .filter(states::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("State not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: states::ActiveModel = state_model.into();
    if let Some(name) = body.name {
        active.name = Set(name);
    }
    if let Some(description) = body.description {
        active.description = Set(Some(description));
    }
    if let Some(color) = body.color {
        active.color = Set(Some(color));
    }
    if let Some(slug) = body.slug {
        active.slug = Set(Some(slug));
    }
    if let Some(sequence) = body.sequence {
        active.sequence = Set(sequence);
    }
    if let Some(group) = body.group {
        active.group = Set(group);
    }
    if let Some(is_default) = body.is_default {
        active.is_default = Set(is_default);
    }
    if let Some(is_triage) = body.is_triage {
        active.is_triage = Set(is_triage);
    }
    active.updated_at = Set(Some(now));

    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(StateResponse::from(updated)))
}

/// DELETE /api/workspaces/<slug>/projects/<uuid>/states/<uuid>/ - Delete state
pub async fn delete_state(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, state_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_ADMIN).await?;

    let state_model = states::Entity::find()
        .filter(states::Column::Id.eq(state_id))
        .filter(states::Column::ProjectId.eq(project_id))
        .filter(states::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("State not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: states::ActiveModel = state_model.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "State deleted" })))
}

// ---------------------------------------------------------------------------
// Handlers - Labels
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/<uuid>/labels/ - List labels
pub async fn list_labels(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let label_list = labels::Entity::find()
        .filter(labels::Column::ProjectId.eq(Some(project_id)))
        .filter(labels::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<LabelResponse> = label_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/projects/<uuid>/labels/ - Create label
pub async fn create_label(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<CreateLabelRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let now = Utc::now().fixed_offset();
    let label = labels::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(body.name),
        description: Set(body.description),
        color: Set(body.color),
        sort_order: Set(65535.0),
        parent_id: Set(body.parent_id),
        workspace_id: Set(workspace.id),
        project_id: Set(Some(project_id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(LabelResponse::from(label)),
    ))
}

// ---------------------------------------------------------------------------
// Handlers - Estimates
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/<uuid>/estimates/ - List estimates
pub async fn list_estimates(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let estimate_list = estimates::Entity::find()
        .filter(estimates::Column::ProjectId.eq(project_id))
        .filter(estimates::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<EstimateResponse> = estimate_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/projects/<uuid>/estimates/ - Create estimate
pub async fn create_estimate(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<CreateEstimateRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let now = Utc::now().fixed_offset();
    let estimate = estimates::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(body.name),
        project_id: Set(project_id),
        workspace_id: Set(workspace.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(EstimateResponse::from(estimate)),
    ))
}

/// GET /api/workspaces/{slug}/projects/{pid}/members/me/ - Get current user's project membership.
pub async fn get_my_project_membership(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let membership = project_members::Entity::find()
        .filter(project_members::Column::ProjectId.eq(project_id))
        .filter(project_members::Column::MemberId.eq(current_user.0.id))
        .filter(project_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    match membership {
        Some(m) => Ok(Json(serde_json::json!({
            "id": m.id,
            "project_id": m.project_id,
            "member_id": m.member_id,
            "role": m.role,
        }))),
        None => Err(AppError::NotFound("Not a project member".into())),
    }
}

/// GET /api/workspaces/{slug}/projects/{pid}/project-members/ - Alias for members list.
pub async fn list_project_members_alias(
    State(state): State<AppState>,
    Extension(_current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let members: Vec<project_members::Model> = project_members::Entity::find()
        .filter(project_members::Column::ProjectId.eq(project_id))
        .filter(project_members::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let result: Vec<serde_json::Value> = members.into_iter().map(|m| serde_json::json!({
        "id": m.id,
        "project_id": m.project_id,
        "member_id": m.member_id,
        "role": m.role,
    })).collect();

    Ok(Json(serde_json::json!(result)))
}

/// GET /api/workspaces/{slug}/projects/{pid}/work-item-types/ - List work item types.
pub async fn list_work_item_types(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let types = work_item_types::Entity::find()
        .filter(work_item_types::Column::ProjectId.eq(project_id))
        .filter(work_item_types::Column::IsActive.eq(true))
        .filter(work_item_types::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let result: Vec<serde_json::Value> = types.into_iter().map(|t| serde_json::json!({
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "icon": t.icon,
        "color": t.color,
        "is_active": t.is_active,
        "sort_order": t.sort_order,
        "project_id": t.project_id,
        "workspace_id": t.workspace_id,
        "created_at": t.created_at.map(|dt| dt.to_rfc3339()),
        "updated_at": t.updated_at.map(|dt| dt.to_rfc3339()),
    })).collect();

    Ok(Json(serde_json::json!(result)))
}

/// POST /api/workspaces/{slug}/projects/{pid}/work-item-types/ - Create a work item type.
pub async fn create_work_item_type(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<CreateWorkItemTypeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let now = Utc::now().fixed_offset();

    let item_type = work_item_types::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(body.name),
        description: Set(body.description),
        icon: Set(body.icon),
        color: Set(body.color),
        is_active: Set(body.is_active.unwrap_or(true)),
        sort_order: Set(body.sort_order.unwrap_or(65535.0)),
        project_id: Set(project_id),
        workspace_id: Set(workspace.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({
            "id": item_type.id,
            "name": item_type.name,
            "description": item_type.description,
            "icon": item_type.icon,
            "color": item_type.color,
            "is_active": item_type.is_active,
            "sort_order": item_type.sort_order,
            "project_id": item_type.project_id,
            "workspace_id": item_type.workspace_id,
            "created_at": item_type.created_at.map(|dt| dt.to_rfc3339()),
            "updated_at": item_type.updated_at.map(|dt| dt.to_rfc3339()),
        })),
    ))
}

/// GET /api/workspaces/{slug}/projects/{pid}/issue-relation/ - List issue relations for a project.
pub async fn list_issue_relations(
    State(state): State<AppState>,
    Extension(_current_user): Extension<CurrentUser>,
    Path((_slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    use db::entities::{issue_relations, issues};

    // Get all issue IDs in this project
    let project_issues: Vec<issues::Model> = issues::Entity::find()
        .filter(issues::Column::ProjectId.eq(project_id))
        .filter(issues::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let issue_ids: Vec<Uuid> = project_issues.iter().map(|i| i.id).collect();

    if issue_ids.is_empty() {
        return Ok(Json(serde_json::json!([])));
    }

    let relations: Vec<issue_relations::Model> = issue_relations::Entity::find()
        .filter(issue_relations::Column::IssueId.is_in(issue_ids))
        .filter(issue_relations::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let result: Vec<serde_json::Value> = relations.into_iter().map(|r| serde_json::json!({
        "id": r.id,
        "issue_id": r.issue_id,
        "related_issue_id": r.related_issue_id,
        "relation_type": r.relation_type,
        "created_at": r.created_at.map(|dt| dt.to_rfc3339()),
        "updated_at": r.updated_at.map(|dt| dt.to_rfc3339()),
    })).collect();

    Ok(Json(serde_json::json!(result)))
}

/// GET /api/workspaces/{slug}/projects/details/ - List all project details.
/// Returns the same data as list_projects but at a different URL path.
pub async fn get_project_details(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    // Delegate to the existing list_projects handler
    list_projects(State(state), Extension(current_user), Path(slug)).await
}

/// GET /api/workspaces/{slug}/projects/{pid}/user-properties/ - Project-level user view properties.
pub async fn get_project_user_properties(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    use db::entities::{workspace_members, workspaces};

    let ws = workspaces::Entity::find()
        .filter(workspaces::Column::Slug.eq(&slug))
        .filter(workspaces::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Workspace not found".into()))?;

    let membership = workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(ws.id))
        .filter(workspace_members::Column::MemberId.eq(current_user.0.id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let project_props = membership
        .and_then(|m| m.view_props)
        .and_then(|vp| vp.get("projects").cloned())
        .and_then(|p| p.get(&project_id.to_string()).cloned())
        .unwrap_or(serde_json::json!({}));

    Ok(Json(project_props))
}

/// GET /api/workspaces/{slug}/projects/project_roles/ - Stub: returns empty project roles.
pub async fn get_project_roles(
    Extension(_current_user): Extension<CurrentUser>,
    Path(_slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(serde_json::json!({})))
}

/// POST /api/workspaces/{slug}/projects/project_roles/issues/ - Stub: reject gracefully.
pub async fn create_issue_project_roles(
    Extension(_current_user): Extension<CurrentUser>,
    Path(_slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    Ok((
        axum::http::StatusCode::BAD_REQUEST,
        Json(serde_json::json!({"error": "Invalid project: project_roles"})),
    ))
}

/// GET /api/workspaces/{slug}/projects/{pid}/issue-labels/ - Alias for labels.
pub async fn list_issue_labels(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    // Reuse the existing labels handler
    list_labels(State(state), Extension(current_user), Path((slug, project_id))).await
}

/// GET /api/workspaces/{slug}/projects/{pid}/intake-state/ - Return project intake view setting.
pub async fn get_intake_state(
    State(state): State<AppState>,
    Extension(_current_user): Extension<CurrentUser>,
    Path((_slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let project = projects::Entity::find_by_id(project_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    Ok(Json(serde_json::json!({
        "is_intake_enabled": project.intake_view,
        "project": project.id,
    })))
}

/// GET /api/workspaces/{slug}/projects/{pid}/views/ - List views.
pub async fn list_views(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let views_list = views::Entity::find()
        .filter(views::Column::ProjectId.eq(project_id))
        .filter(views::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let result: Vec<serde_json::Value> = views_list.into_iter().map(|v| serde_json::json!({
        "id": v.id,
        "name": v.name,
        "description": v.description,
        "query": v.query,
        "is_locked": v.is_locked,
        "access": v.access,
        "project_id": v.project_id,
        "workspace_id": v.workspace_id,
        "created_by_id": v.created_by_id,
        "is_favorite": v.is_favorite,
        "created_at": v.created_at.map(|dt| dt.to_rfc3339()),
        "updated_at": v.updated_at.map(|dt| dt.to_rfc3339()),
    })).collect();

    Ok(Json(serde_json::json!(result)))
}

/// POST /api/workspaces/{slug}/projects/{pid}/views/ - Create a view.
pub async fn create_view(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<CreateViewRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let now = Utc::now().fixed_offset();

    let view = views::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(body.name),
        description: Set(body.description),
        query: Set(body.query),
        is_locked: Set(body.is_locked.unwrap_or(false)),
        access: Set(body.access.unwrap_or_else(|| "private".to_string())),
        project_id: Set(project_id),
        workspace_id: Set(workspace.id),
        created_by_id: Set(Some(current_user.0.id)),
        is_favorite: Set(false),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({
            "id": view.id,
            "name": view.name,
            "description": view.description,
            "query": view.query,
            "is_locked": view.is_locked,
            "access": view.access,
            "project_id": view.project_id,
            "workspace_id": view.workspace_id,
            "created_by_id": view.created_by_id,
            "is_favorite": view.is_favorite,
            "created_at": view.created_at.map(|dt| dt.to_rfc3339()),
            "updated_at": view.updated_at.map(|dt| dt.to_rfc3339()),
        })),
    ))
}

/// GET cycles with trailing slash - alias that delegates to the nested router's list handler.
pub async fn list_project_cycles_alias(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    super::cycles::list_cycles(State(state), Extension(current_user), Path((slug, project_id))).await
}

/// POST cycles with trailing slash - alias that delegates to the nested router's create handler.
pub async fn create_project_cycle_alias(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<super::cycles::CreateCycleRequest>,
) -> Result<impl IntoResponse, AppError> {
    super::cycles::create_cycle(State(state), Extension(current_user), Path((slug, project_id)), Json(body)).await
}

/// GET modules with trailing slash - alias that delegates to the nested router's list handler.
pub async fn list_project_modules_alias(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    super::modules::list_modules(State(state), Extension(current_user), Path((slug, project_id))).await
}

/// GET issues with trailing slash - alias that delegates to the nested router's list handler.
pub async fn list_project_issues_alias(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    query: axum::extract::Query<super::issues::IssueListQuery>,
) -> Result<impl IntoResponse, AppError> {
    super::issues::list_issues(State(state), Extension(current_user), Path((slug, project_id)), query).await
}

// ---------------------------------------------------------------------------
// Tantivy index helpers
// ---------------------------------------------------------------------------

/// Index a project entity in the Tantivy search index (if available).
fn index_project(state: &AppState, project: &projects::Model) {
    if let Some(ref index) = state.search_index {
        let description = project.description.as_deref().unwrap_or("");
        if let Err(e) = crate::search_index::index_entity(
            index,
            "project",
            &project.id.to_string(),
            &project.workspace_id.to_string(),
            None, // projects don't have a parent project_id
            &project.name,
            description,
            &format!("{} {}", project.identifier, description),
        ) {
            tracing::warn!(error = %e, project_id = %project.id, "Failed to index project in Tantivy");
        }
    }
}

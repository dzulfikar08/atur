use axum::extract::{Extension, Path, State};
use axum::response::IntoResponse;
use axum::Json;
use axum::routing::{delete, get};
use chrono::Utc;
use db::entities::{module_issues, module_members, modules};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::middleware::permission::{load_workspace_by_slug, require_project_role};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Role constants
// ---------------------------------------------------------------------------

const ROLE_ADMIN: i16 = 20;
const ROLE_MEMBER: i16 = 15;
const ROLE_GUEST: i16 = 5;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ModuleResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub sort_order: f64,
    pub archived_at: Option<String>,
    pub lead_id: Option<Uuid>,
    pub project_id: Uuid,
    pub workspace_id: Uuid,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<modules::Model> for ModuleResponse {
    fn from(m: modules::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            description: m.description,
            status: m.status,
            start_date: m.start_date,
            target_date: m.target_date,
            sort_order: m.sort_order,
            archived_at: m.archived_at.map(|dt| dt.to_rfc3339()),
            lead_id: m.lead_id,
            project_id: m.project_id,
            workspace_id: m.workspace_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
            updated_at: m.updated_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ModuleIssueResponse {
    pub id: Uuid,
    pub module_id: Uuid,
    pub issue_id: Uuid,
    pub created_at: Option<String>,
}

impl From<module_issues::Model> for ModuleIssueResponse {
    fn from(m: module_issues::Model) -> Self {
        Self {
            id: m.id,
            module_id: m.module_id,
            issue_id: m.issue_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ModuleMemberResponse {
    pub id: Uuid,
    pub module_id: Uuid,
    pub member_id: Uuid,
    pub created_at: Option<String>,
}

impl From<module_members::Model> for ModuleMemberResponse {
    fn from(m: module_members::Model) -> Self {
        Self {
            id: m.id,
            module_id: m.module_id,
            member_id: m.member_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateModuleRequest {
    pub name: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub lead_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateModuleRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub sort_order: Option<f64>,
    pub lead_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct AddModuleIssueRequest {
    pub issue_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct AddModuleMemberRequest {
    pub member_id: Uuid,
}

// ---------------------------------------------------------------------------
// Valid module statuses
// ---------------------------------------------------------------------------

const VALID_STATUSES: &[&str] = &[
    "backlog",
    "planned",
    "in-progress",
    "paused",
    "completed",
    "cancelled",
];

fn validate_status(status: &str) -> Result<(), AppError> {
    if VALID_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!(
            "Invalid module status '{}'. Must be one of: {}",
            status,
            VALID_STATUSES.join(", ")
        )))
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/", get(list_modules).post(create_module))
        .route(
            "/{module_id}/",
            get(get_module).patch(update_module).delete(delete_module),
        )
        .route(
            "/{module_id}/issues/",
            get(list_module_issues).post(add_issue_to_module),
        )
        .route(
            "/{module_id}/issues/{issue_id}/",
            delete(remove_issue_from_module),
        )
        .route(
            "/{module_id}/members/",
            get(list_module_members).post(add_member_to_module),
        )
        .route(
            "/{module_id}/members/{member_id}/",
            delete(remove_member_from_module),
        )
}

// ---------------------------------------------------------------------------
// Handlers - Module CRUD
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/<uuid>/modules/ - List modules
pub async fn list_modules(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let module_list = modules::Entity::find()
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::DeletedAt.is_null())
        .order_by_asc(modules::Column::SortOrder)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<ModuleResponse> = module_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/projects/<uuid>/modules/ - Create module
pub async fn create_module(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<CreateModuleRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    // Validate status if provided
    let status = body.status.unwrap_or_else(|| "backlog".to_string());
    validate_status(&status)?;

    // Compute sort_order: min existing - 10000 so newest float to top
    let min_sort = modules::Entity::find()
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::DeletedAt.is_null())
        .order_by_asc(modules::Column::SortOrder)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .map(|m| m.sort_order)
        .unwrap_or(0.0);

    let now = Utc::now().fixed_offset();

    let module = modules::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(body.name),
        description: Set(body.description),
        status: Set(Some(status)),
        start_date: Set(body.start_date),
        target_date: Set(body.target_date),
        sort_order: Set(min_sort - 10000.0),
        archived_at: Set(None),
        lead_id: Set(body.lead_id),
        project_id: Set(project_id),
        workspace_id: Set(workspace.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Module insert error: {}", e)))?;

    Ok((axum::http::StatusCode::CREATED, Json(ModuleResponse::from(module))))
}

/// GET /api/workspaces/<slug>/projects/<uuid>/modules/<uuid>/ - Get module
pub async fn get_module(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, module_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let module = modules::Entity::find()
        .filter(modules::Column::Id.eq(module_id))
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Module not found".into()))?;

    Ok(Json(ModuleResponse::from(module)))
}

/// PATCH /api/workspaces/<slug>/projects/<uuid>/modules/<uuid>/ - Update module
pub async fn update_module(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, module_id)): Path<(String, Uuid, Uuid)>,
    Json(body): Json<UpdateModuleRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let module = modules::Entity::find()
        .filter(modules::Column::Id.eq(module_id))
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Module not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: modules::ActiveModel = module.into();

    if let Some(name) = body.name {
        active.name = Set(name);
    }
    if let Some(description) = body.description {
        active.description = Set(Some(description));
    }
    if let Some(status) = body.status {
        validate_status(&status)?;
        active.status = Set(Some(status));
    }
    if let Some(start_date) = body.start_date {
        active.start_date = Set(Some(start_date));
    }
    if let Some(target_date) = body.target_date {
        active.target_date = Set(Some(target_date));
    }
    if let Some(sort_order) = body.sort_order {
        active.sort_order = Set(sort_order);
    }
    if let Some(lead_id) = body.lead_id {
        active.lead_id = Set(Some(lead_id));
    }
    active.updated_at = Set(Some(now));

    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(ModuleResponse::from(updated)))
}

/// DELETE /api/workspaces/<slug>/projects/<uuid>/modules/<uuid>/ - Soft-delete module
pub async fn delete_module(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, module_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_ADMIN).await?;

    let module = modules::Entity::find()
        .filter(modules::Column::Id.eq(module_id))
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Module not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: modules::ActiveModel = module.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Module deleted" })))
}

// ---------------------------------------------------------------------------
// Handlers - Module Issues
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/<uuid>/modules/<uuid>/issues/ - List module issues
pub async fn list_module_issues(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, module_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let _module = modules::Entity::find()
        .filter(modules::Column::Id.eq(module_id))
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Module not found".into()))?;

    let module_issue_list = module_issues::Entity::find()
        .filter(module_issues::Column::ModuleId.eq(module_id))
        .filter(module_issues::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<ModuleIssueResponse> = module_issue_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/projects/<uuid>/modules/<uuid>/issues/ - Add issue to module
pub async fn add_issue_to_module(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, module_id)): Path<(String, Uuid, Uuid)>,
    Json(body): Json<AddModuleIssueRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let module = modules::Entity::find()
        .filter(modules::Column::Id.eq(module_id))
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Module not found".into()))?;

    // Verify issue exists in this project
    let _issue = db::entities::issues::Entity::find()
        .filter(db::entities::issues::Column::Id.eq(body.issue_id))
        .filter(db::entities::issues::Column::ProjectId.eq(project_id))
        .filter(db::entities::issues::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Issue not found".into()))?;

    // Check if already in this module
    let existing = module_issues::Entity::find()
        .filter(module_issues::Column::ModuleId.eq(module_id))
        .filter(module_issues::Column::IssueId.eq(body.issue_id))
        .filter(module_issues::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    if existing.is_some() {
        return Err(AppError::Conflict(
            "Issue is already in this module".into(),
        ));
    }

    let now = Utc::now().fixed_offset();
    let module_issue = module_issues::ActiveModel {
        id: Set(Uuid::new_v4()),
        module_id: Set(module.id),
        issue_id: Set(body.issue_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Module issue insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(ModuleIssueResponse::from(module_issue)),
    ))
}

/// DELETE /api/workspaces/<slug>/projects/<uuid>/modules/<uuid>/issues/<uuid>/ - Remove issue from module
pub async fn remove_issue_from_module(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, module_id, issue_id)): Path<(String, Uuid, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let module_issue = module_issues::Entity::find()
        .filter(module_issues::Column::ModuleId.eq(module_id))
        .filter(module_issues::Column::IssueId.eq(issue_id))
        .filter(module_issues::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Issue not found in this module".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: module_issues::ActiveModel = module_issue.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Issue removed from module" })))
}

// ---------------------------------------------------------------------------
// Handlers - Module Members
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/<uuid>/modules/<uuid>/members/ - List module members
pub async fn list_module_members(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, module_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let _module = modules::Entity::find()
        .filter(modules::Column::Id.eq(module_id))
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Module not found".into()))?;

    let members = module_members::Entity::find()
        .filter(module_members::Column::ModuleId.eq(module_id))
        .filter(module_members::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<ModuleMemberResponse> = members.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/projects/<uuid>/modules/<uuid>/members/ - Add member to module
pub async fn add_member_to_module(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, module_id)): Path<(String, Uuid, Uuid)>,
    Json(body): Json<AddModuleMemberRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let module = modules::Entity::find()
        .filter(modules::Column::Id.eq(module_id))
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Module not found".into()))?;

    // Check if already a member
    let existing = module_members::Entity::find()
        .filter(module_members::Column::ModuleId.eq(module_id))
        .filter(module_members::Column::MemberId.eq(body.member_id))
        .filter(module_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    if existing.is_some() {
        return Err(AppError::Conflict(
            "User is already a member of this module".into(),
        ));
    }

    let now = Utc::now().fixed_offset();
    let member = module_members::ActiveModel {
        id: Set(Uuid::new_v4()),
        module_id: Set(module.id),
        member_id: Set(body.member_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Module member insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(ModuleMemberResponse::from(member)),
    ))
}

/// DELETE /api/workspaces/<slug>/projects/<uuid>/modules/<uuid>/members/<uuid>/ - Remove member from module
pub async fn remove_member_from_module(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, module_id, member_id)): Path<(String, Uuid, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let member = module_members::Entity::find()
        .filter(module_members::Column::ModuleId.eq(module_id))
        .filter(module_members::Column::MemberId.eq(member_id))
        .filter(module_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Member not found in this module".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: module_members::ActiveModel = member.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Member removed from module" })))
}

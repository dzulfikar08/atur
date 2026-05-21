use axum::extract::{Extension, Path, State};
use axum::response::IntoResponse;
use axum::Json;
use axum::routing::{delete, get};
use chrono::Utc;
use db::entities::{cycle_issues, cycles, issues, states};
use sea_orm::ActiveValue::Set;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder,
};
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
pub struct CycleResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub sort_order: f64,
    pub progress_snapshot: Option<serde_json::Value>,
    pub archived_at: Option<String>,
    pub project_id: Uuid,
    pub workspace_id: Uuid,
    pub owned_by_id: Option<Uuid>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<cycles::Model> for CycleResponse {
    fn from(m: cycles::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            description: m.description,
            start_date: m.start_date,
            end_date: m.end_date,
            sort_order: m.sort_order,
            progress_snapshot: m.progress_snapshot,
            archived_at: m.archived_at.map(|dt| dt.to_rfc3339()),
            project_id: m.project_id,
            workspace_id: m.workspace_id,
            owned_by_id: m.owned_by_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
            updated_at: m.updated_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CycleIssueResponse {
    pub id: Uuid,
    pub cycle_id: Uuid,
    pub issue_id: Uuid,
    pub created_at: Option<String>,
}

impl From<cycle_issues::Model> for CycleIssueResponse {
    fn from(m: cycle_issues::Model) -> Self {
        Self {
            id: m.id,
            cycle_id: m.cycle_id,
            issue_id: m.issue_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CycleProgressResponse {
    pub total: u64,
    pub backlog: u64,
    pub unstarted: u64,
    pub started: u64,
    pub completed: u64,
    pub cancelled: u64,
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateCycleRequest {
    pub name: String,
    pub description: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCycleRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub sort_order: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct AddCycleIssueRequest {
    pub issue_id: Uuid,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/", get(list_cycles).post(create_cycle))
        .route(
            "/{cycle_id}/",
            get(get_cycle).patch(update_cycle).delete(delete_cycle),
        )
        .route(
            "/{cycle_id}/issues/",
            get(list_cycle_issues).post(add_issue_to_cycle),
        )
        .route(
            "/{cycle_id}/issues/{issue_id}/",
            delete(remove_issue_from_cycle),
        )
        .route(
            "/{cycle_id}/progress/",
            get(get_cycle_progress),
        )
}

// ---------------------------------------------------------------------------
// Handlers - Cycle CRUD
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/<uuid>/cycles/ - List cycles
pub async fn list_cycles(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let cycle_list = cycles::Entity::find()
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::DeletedAt.is_null())
        .order_by_asc(cycles::Column::SortOrder)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<CycleResponse> = cycle_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/projects/<uuid>/cycles/ - Create cycle
pub async fn create_cycle(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<CreateCycleRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    // Compute sort_order: min existing - 10000 so newest float to top
    let min_sort = cycles::Entity::find()
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::DeletedAt.is_null())
        .order_by_asc(cycles::Column::SortOrder)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .map(|c| c.sort_order)
        .unwrap_or(0.0);

    let now = Utc::now().fixed_offset();

    let cycle = cycles::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(body.name),
        description: Set(body.description),
        start_date: Set(body.start_date),
        end_date: Set(body.end_date),
        sort_order: Set(min_sort - 10000.0),
        progress_snapshot: Set(None),
        archived_at: Set(None),
        project_id: Set(project_id),
        workspace_id: Set(workspace.id),
        owned_by_id: Set(Some(current_user.0.id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Cycle insert error: {}", e)))?;

    Ok((axum::http::StatusCode::CREATED, Json(CycleResponse::from(cycle))))
}

/// GET /api/workspaces/<slug>/projects/<uuid>/cycles/<uuid>/ - Get cycle
pub async fn get_cycle(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, cycle_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let cycle = cycles::Entity::find()
        .filter(cycles::Column::Id.eq(cycle_id))
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Cycle not found".into()))?;

    Ok(Json(CycleResponse::from(cycle)))
}

/// PATCH /api/workspaces/<slug>/projects/<uuid>/cycles/<uuid>/ - Update cycle
pub async fn update_cycle(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, cycle_id)): Path<(String, Uuid, Uuid)>,
    Json(body): Json<UpdateCycleRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let cycle = cycles::Entity::find()
        .filter(cycles::Column::Id.eq(cycle_id))
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Cycle not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: cycles::ActiveModel = cycle.into();

    if let Some(name) = body.name {
        active.name = Set(name);
    }
    if let Some(description) = body.description {
        active.description = Set(Some(description));
    }
    if let Some(start_date) = body.start_date {
        active.start_date = Set(Some(start_date));
    }
    if let Some(end_date) = body.end_date {
        active.end_date = Set(Some(end_date));
    }
    if let Some(sort_order) = body.sort_order {
        active.sort_order = Set(sort_order);
    }
    active.updated_at = Set(Some(now));

    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(CycleResponse::from(updated)))
}

/// DELETE /api/workspaces/<slug>/projects/<uuid>/cycles/<uuid>/ - Soft-delete cycle
pub async fn delete_cycle(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, cycle_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_ADMIN).await?;

    let cycle = cycles::Entity::find()
        .filter(cycles::Column::Id.eq(cycle_id))
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Cycle not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: cycles::ActiveModel = cycle.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Cycle deleted" })))
}

// ---------------------------------------------------------------------------
// Handlers - Cycle Issues
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/<uuid>/cycles/<uuid>/issues/ - List cycle issues
pub async fn list_cycle_issues(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, cycle_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let _cycle = cycles::Entity::find()
        .filter(cycles::Column::Id.eq(cycle_id))
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Cycle not found".into()))?;

    let cycle_issue_list = cycle_issues::Entity::find()
        .filter(cycle_issues::Column::CycleId.eq(cycle_id))
        .filter(cycle_issues::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<CycleIssueResponse> = cycle_issue_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/projects/<uuid>/cycles/<uuid>/issues/ - Add issue to cycle
pub async fn add_issue_to_cycle(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, cycle_id)): Path<(String, Uuid, Uuid)>,
    Json(body): Json<AddCycleIssueRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    // Verify cycle exists and is not deleted
    let cycle = cycles::Entity::find()
        .filter(cycles::Column::Id.eq(cycle_id))
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Cycle not found".into()))?;

    // Verify issue exists in this project
    let _issue = issues::Entity::find()
        .filter(issues::Column::Id.eq(body.issue_id))
        .filter(issues::Column::ProjectId.eq(project_id))
        .filter(issues::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Issue not found".into()))?;

    // Check if issue is already in an active (non-archived, non-deleted) cycle in this project
    let active_cycle_issues = cycle_issues::Entity::find()
        .filter(cycle_issues::Column::IssueId.eq(body.issue_id))
        .filter(cycle_issues::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    for ci in &active_cycle_issues {
        // Check if the cycle this belongs to is active (not archived, not deleted)
        if let Some(c) = cycles::Entity::find_by_id(ci.cycle_id)
            .one(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        {
            if c.archived_at.is_none() && c.deleted_at.is_none() && c.project_id == project_id {
                return Err(AppError::Conflict(
                    "Issue is already in an active cycle".into(),
                ));
            }
        }
    }

    // Check if already in this specific cycle
    let existing = cycle_issues::Entity::find()
        .filter(cycle_issues::Column::CycleId.eq(cycle_id))
        .filter(cycle_issues::Column::IssueId.eq(body.issue_id))
        .filter(cycle_issues::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    if existing.is_some() {
        return Err(AppError::Conflict(
            "Issue is already in this cycle".into(),
        ));
    }

    let now = Utc::now().fixed_offset();
    let cycle_issue = cycle_issues::ActiveModel {
        id: Set(Uuid::new_v4()),
        cycle_id: Set(cycle.id),
        issue_id: Set(body.issue_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Cycle issue insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(CycleIssueResponse::from(cycle_issue)),
    ))
}

/// DELETE /api/workspaces/<slug>/projects/<uuid>/cycles/<uuid>/issues/<uuid>/ - Remove issue from cycle
pub async fn remove_issue_from_cycle(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, cycle_id, issue_id)): Path<(String, Uuid, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let cycle_issue = cycle_issues::Entity::find()
        .filter(cycle_issues::Column::CycleId.eq(cycle_id))
        .filter(cycle_issues::Column::IssueId.eq(issue_id))
        .filter(cycle_issues::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Issue not found in this cycle".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: cycle_issues::ActiveModel = cycle_issue.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Issue removed from cycle" })))
}

// ---------------------------------------------------------------------------
// Handlers - Cycle Progress
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/<uuid>/cycles/<uuid>/progress/ - Get cycle progress
pub async fn get_cycle_progress(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, cycle_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let _cycle = cycles::Entity::find()
        .filter(cycles::Column::Id.eq(cycle_id))
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Cycle not found".into()))?;

    // Get all issue IDs in this cycle
    let cycle_issue_list = cycle_issues::Entity::find()
        .filter(cycle_issues::Column::CycleId.eq(cycle_id))
        .filter(cycle_issues::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let issue_ids: Vec<Uuid> = cycle_issue_list.iter().map(|ci| ci.issue_id).collect();

    let total = issue_ids.len() as u64;

    if issue_ids.is_empty() {
        return Ok(Json(CycleProgressResponse {
            total: 0,
            backlog: 0,
            unstarted: 0,
            started: 0,
            completed: 0,
            cancelled: 0,
        }));
    }

    // Fetch all issues in the cycle
    let cycle_issues_models = issues::Entity::find()
        .filter(issues::Column::Id.is_in(issue_ids))
        .filter(issues::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    // Collect state IDs
    let state_ids: Vec<Uuid> = cycle_issues_models
        .iter()
        .filter_map(|i| i.state_id)
        .collect();

    // Build a map of state_id -> group
    let mut state_groups: std::collections::HashMap<Uuid, String> = std::collections::HashMap::new();
    if !state_ids.is_empty() {
        let state_models = states::Entity::find()
            .filter(states::Column::Id.is_in(state_ids))
            .all(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

        for s in state_models {
            state_groups.insert(s.id, s.group);
        }
    }

    // Count by group
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
            _ => backlog += 1, // default unknown groups to backlog
        }
    }

    Ok(Json(CycleProgressResponse {
        total,
        backlog,
        unstarted,
        started,
        completed,
        cancelled,
    }))
}

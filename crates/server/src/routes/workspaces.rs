use axum::extract::{Extension, Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use axum::routing::{delete, get, patch, post};
use chrono::{Utc, Duration};
use db::entities::{workspace_invites, workspace_members, workspaces, labels, states, user_favorites};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, ConnectionTrait, Statement, DatabaseBackend, FromQueryResult};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::middleware::permission::{load_workspace_by_slug, require_workspace_role};
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
pub struct WorkspaceResponse {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub logo: Option<String>,
    pub organization_size: Option<String>,
    pub timezone: Option<String>,
    pub background_color: Option<String>,
    pub owner_id: Uuid,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<workspaces::Model> for WorkspaceResponse {
    fn from(m: workspaces::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            slug: m.slug,
            logo: m.logo,
            organization_size: m.organization_size,
            timezone: m.timezone,
            background_color: m.background_color,
            owner_id: m.owner_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
            updated_at: m.updated_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct WorkspaceMemberResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub member_id: Uuid,
    pub role: i16,
    pub is_active: bool,
    pub created_at: Option<String>,
}

impl From<workspace_members::Model> for WorkspaceMemberResponse {
    fn from(m: workspace_members::Model) -> Self {
        Self {
            id: m.id,
            workspace_id: m.workspace_id,
            member_id: m.member_id,
            role: m.role,
            is_active: m.is_active,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct WorkspaceInviteResponse {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub email: String,
    pub role: i16,
    pub accepted: bool,
    pub created_at: Option<String>,
}

impl From<workspace_invites::Model> for WorkspaceInviteResponse {
    fn from(m: workspace_invites::Model) -> Self {
        Self {
            id: m.id,
            workspace_id: m.workspace_id,
            email: m.email,
            role: m.role,
            accepted: m.accepted,
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

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateWorkspaceRequest {
    pub name: String,
    pub slug: String,
    pub organization_size: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateWorkspaceRequest {
    pub name: Option<String>,
    pub logo: Option<String>,
    pub organization_size: Option<String>,
    pub timezone: Option<String>,
    pub background_color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddMemberRequest {
    pub user_id: Uuid,
    pub role: Option<i16>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMemberRoleRequest {
    pub role: i16,
}

#[derive(Debug, Deserialize)]
pub struct InviteRequest {
    pub email: String,
    pub role: Option<i16>,
}

#[derive(Debug, Deserialize)]
pub struct CreateLabelRequest {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub parent_id: Option<Uuid>,
    pub project_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSidebarPreferences {
    pub sidebar_collapsed: Option<bool>,
    pub sidebar_collapsed_at: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateHomePreferences {
    pub widgets: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserFavoriteRequest {
    pub entity_type: String,
    pub entity_id: Uuid,
    pub is_favored: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UserFavoritesQuery {
    pub entity_type: Option<String>,
}

// ---------------------------------------------------------------------------
// Analytics response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct AnalyticsOverviewResponse {
    pub total_issues: u64,
    pub open_issues: u64,
    pub closed_issues: u64,
    pub issues_by_state: Vec<StateCount>,
    pub issues_by_priority: Vec<PriorityCount>,
    pub overdue_issues: u64,
    pub recently_created: u64,
    pub recently_completed: u64,
}

#[derive(Debug, Serialize)]
pub struct StateCount {
    pub state: String,
    pub count: u64,
}

#[derive(Debug, Serialize)]
pub struct PriorityCount {
    pub priority: String,
    pub count: u64,
}

#[derive(Debug, Serialize, FromQueryResult)]
pub struct GroupCount {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct SprintAnalyticsResponse {
    pub active_sprints: Vec<SprintInfo>,
}

#[derive(Debug, Serialize)]
pub struct SprintInfo {
    pub id: Uuid,
    pub name: String,
    pub project_id: Uuid,
    pub project_name: String,
    pub total_issues: u64,
    pub completed: u64,
    pub progress_pct: f64,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CompletionTrendResponse {
    pub trend: Vec<DayCount>,
}

#[derive(Debug, Serialize)]
pub struct DayCount {
    pub date: String,
    pub created: u64,
    pub completed: u64,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/", get(list_workspaces).post(create_workspace))
        .route(
            "/{slug}/",
            get(get_workspace).patch(update_workspace).delete(delete_workspace),
        )
        .route(
            "/{slug}/members/",
            get(list_members).post(add_member),
        )
        .route(
            "/{slug}/members/{member_id}/",
            patch(update_member_role).delete(remove_member),
        )
        .route(
            "/{slug}/workspace-members/me/",
            get(get_my_membership),
        )
        .route(
            "/{slug}/workspace-members/me",
            get(get_my_membership),
        )
        .route(
            "/{slug}/invitations/",
            get(list_invitations).post(create_invitation),
        )
        .route(
            "/{slug}/invitations/{invite_id}/",
            delete(cancel_invitation),
        )
        .route(
            "/{slug}/labels/",
            get(list_labels).post(create_label),
        )
        .route(
            "/{slug}/states/",
            get(list_workspace_states),
        )
        .route(
            "/{slug}/states",
            get(list_workspace_states),
        )
        .route(
            "/{slug}/sidebar-preferences/",
            get(get_sidebar_preferences).patch(update_sidebar_preferences),
        )
        .route(
            "/{slug}/sidebar-preferences",
            get(get_sidebar_preferences).patch(update_sidebar_preferences),
        )
        .route(
            "/{slug}/user-properties/",
            get(get_user_properties),
        )
        .route(
            "/{slug}/user-properties",
            get(get_user_properties),
        )
        .nest("/{slug}/projects", super::projects::router())
        .route("/{slug}/projects/", get(super::projects::list_projects).post(super::projects::create_project))
        .route("/{slug}/home-preferences/", get(get_home_preferences).patch(update_home_preferences))
        .route("/{slug}/home-preferences", get(get_home_preferences).patch(update_home_preferences))
        .route("/{slug}/users/notifications/unread/", get(get_unread_notifications))
        .route("/{slug}/users/notifications/unread", get(get_unread_notifications))
        .nest("/{slug}/pages", super::pages::router())
        .nest("/{slug}/integrations", super::integrations::router())
        // Workspace-level cycles and modules (aggregate across projects)
        .route("/{slug}/cycles/", get(list_workspace_cycles))
        .route("/{slug}/cycles", get(list_workspace_cycles))
        .route("/{slug}/modules/", get(list_workspace_modules))
        .route("/{slug}/modules", get(list_workspace_modules))
        // User favorites
        .route("/{slug}/user-favorites/", get(get_user_favorites).post(create_user_favorite))
        .route("/{slug}/user-favorites", get(get_user_favorites).post(create_user_favorite))
        .route("/{slug}/user-favorites/{favorite_id}/", delete(delete_user_favorite))
        .route("/{slug}/user-favorites/{favorite_id}", delete(delete_user_favorite))
        // AI assistant stub
        .route("/{slug}/ai-assistant/", post(ai_assistant_stub))
        .route("/{slug}/ai-assistant", post(ai_assistant_stub))
        // Analytics endpoints
        .route("/{slug}/analytics/overview", get(analytics_overview))
        .route("/{slug}/analytics/overview/", get(analytics_overview))
        .route("/{slug}/projects/{project_id}/analytics", get(project_analytics))
        .route("/{slug}/projects/{project_id}/analytics/", get(project_analytics))
        .route("/{slug}/analytics/sprints", get(sprint_analytics))
        .route("/{slug}/analytics/sprints/", get(sprint_analytics))
        .route("/{slug}/analytics/completion-trend", get(completion_trend))
        .route("/{slug}/analytics/completion-trend/", get(completion_trend))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/workspaces/ - List current user's workspaces
pub async fn list_workspaces(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<impl IntoResponse, AppError> {
    let user_id = current_user.0.id;

    // Find all workspace memberships for the user
    let memberships = workspace_members::Entity::find()
        .filter(workspace_members::Column::MemberId.eq(user_id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .filter(workspace_members::Column::IsActive.eq(true))
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let workspace_ids: Vec<Uuid> = memberships.iter().map(|m| m.workspace_id).collect();

    let workspace_list = if workspace_ids.is_empty() {
        vec![]
    } else {
        workspaces::Entity::find()
            .filter(workspaces::Column::Id.is_in(workspace_ids))
            .filter(workspaces::Column::DeletedAt.is_null())
            .all(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
    };

    let resp: Vec<WorkspaceResponse> = workspace_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/ - Create a new workspace
pub async fn create_workspace(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Json(body): Json<CreateWorkspaceRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Validate slug format (lowercase alphanumeric + hyphens)
    if !body.slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(AppError::BadRequest(
            "Slug must contain only lowercase letters, digits, and hyphens".into(),
        ));
    }

    // Check slug uniqueness
    if workspaces::Entity::find()
        .filter(workspaces::Column::Slug.eq(&body.slug))
        .filter(workspaces::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .is_some()
    {
        return Err(AppError::Conflict("Workspace slug already taken".into()));
    }

    let now = Utc::now().fixed_offset();
    let workspace_id = Uuid::new_v4();
    let user_id = current_user.0.id;

    // Create workspace
    let workspace = workspaces::ActiveModel {
        id: Set(workspace_id),
        name: Set(body.name),
        slug: Set(body.slug),
        logo: Set(None),
        organization_size: Set(body.organization_size),
        timezone: Set(Some("UTC".into())),
        background_color: Set(None),
        owner_id: Set(user_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    // Auto-add creator as admin
    workspace_members::ActiveModel {
        id: Set(Uuid::new_v4()),
        workspace_id: Set(workspace_id),
        member_id: Set(user_id),
        role: Set(ROLE_ADMIN),
        is_active: Set(true),
        view_props: Set(None),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Member insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(WorkspaceResponse::from(workspace)),
    ))
}

/// GET /api/workspaces/<slug>/ - Get workspace detail
pub async fn get_workspace(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;

    // Check membership (at least guest)
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    Ok(Json(WorkspaceResponse::from(workspace)))
}

/// PATCH /api/workspaces/<slug>/ - Update workspace (admin only)
pub async fn update_workspace(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<UpdateWorkspaceRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let now = Utc::now().fixed_offset();
    let mut active: workspaces::ActiveModel = workspace.into();
    if let Some(name) = body.name {
        active.name = Set(name);
    }
    if let Some(logo) = body.logo {
        active.logo = Set(Some(logo));
    }
    if let Some(organization_size) = body.organization_size {
        active.organization_size = Set(Some(organization_size));
    }
    if let Some(timezone) = body.timezone {
        active.timezone = Set(Some(timezone));
    }
    if let Some(background_color) = body.background_color {
        active.background_color = Set(Some(background_color));
    }
    active.updated_at = Set(Some(now));

    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(WorkspaceResponse::from(updated)))
}

/// DELETE /api/workspaces/<slug>/ - Soft-delete workspace (owner only)
pub async fn delete_workspace(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;

    // Only the owner can delete
    if workspace.owner_id != current_user.0.id && !current_user.0.is_superuser {
        return Err(AppError::Forbidden(
            "Only the workspace owner can delete this workspace".into(),
        ));
    }

    let now = Utc::now().fixed_offset();
    let mut active: workspaces::ActiveModel = workspace.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Workspace deleted" })))
}

/// GET /api/workspaces/<slug>/members/ - List members
pub async fn list_members(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let members = workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(workspace.id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .filter(workspace_members::Column::IsActive.eq(true))
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<WorkspaceMemberResponse> = members.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/members/ - Add member (admin only)
pub async fn add_member(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<AddMemberRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let role = body.role.unwrap_or(ROLE_MEMBER);

    // Check if already a member
    let existing = workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(workspace.id))
        .filter(workspace_members::Column::MemberId.eq(body.user_id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    if existing.is_some() {
        return Err(AppError::Conflict("User is already a member".into()));
    }

    let now = Utc::now().fixed_offset();
    let member = workspace_members::ActiveModel {
        id: Set(Uuid::new_v4()),
        workspace_id: Set(workspace.id),
        member_id: Set(body.user_id),
        role: Set(role),
        is_active: Set(true),
        view_props: Set(None),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(WorkspaceMemberResponse::from(member)),
    ))
}

/// PATCH /api/workspaces/<slug>/members/<member_id>/ - Update member role
pub async fn update_member_role(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, member_id)): Path<(String, Uuid)>,
    Json(body): Json<UpdateMemberRoleRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let membership = workspace_members::Entity::find()
        .filter(workspace_members::Column::Id.eq(member_id))
        .filter(workspace_members::Column::WorkspaceId.eq(workspace.id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Member not found".into()))?;

    // Cannot change the owner's role
    if membership.member_id == workspace.owner_id {
        return Err(AppError::Forbidden(
            "Cannot change the workspace owner's role".into(),
        ));
    }

    let now = Utc::now().fixed_offset();
    let mut active: workspace_members::ActiveModel = membership.into();
    active.role = Set(body.role);
    active.updated_at = Set(Some(now));
    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(WorkspaceMemberResponse::from(updated)))
}

/// DELETE /api/workspaces/<slug>/members/<member_id>/ - Remove member
pub async fn remove_member(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, member_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let membership = workspace_members::Entity::find()
        .filter(workspace_members::Column::Id.eq(member_id))
        .filter(workspace_members::Column::WorkspaceId.eq(workspace.id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Member not found".into()))?;

    // Cannot remove the owner
    if membership.member_id == workspace.owner_id {
        return Err(AppError::Forbidden(
            "Cannot remove the workspace owner".into(),
        ));
    }

    let now = Utc::now().fixed_offset();
    let mut active: workspace_members::ActiveModel = membership.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Member removed" })))
}

/// POST /api/workspaces/<slug>/invitations/ - Invite by email
pub async fn create_invitation(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<InviteRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let role = body.role.unwrap_or(ROLE_MEMBER);
    let token = generate_invite_token();
    let now = Utc::now().fixed_offset();

    let invite = workspace_invites::ActiveModel {
        id: Set(Uuid::new_v4()),
        workspace_id: Set(workspace.id),
        email: Set(body.email),
        role: Set(role),
        token: Set(Some(token)),
        accepted: Set(false),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(WorkspaceInviteResponse::from(invite)),
    ))
}

/// GET /api/workspaces/<slug>/invitations/ - List invitations
pub async fn list_invitations(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let invitations = workspace_invites::Entity::find()
        .filter(workspace_invites::Column::WorkspaceId.eq(workspace.id))
        .filter(workspace_invites::Column::DeletedAt.is_null())
        .filter(workspace_invites::Column::Accepted.eq(false))
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<WorkspaceInviteResponse> = invitations.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// DELETE /api/workspaces/<slug>/invitations/<invite_id>/ - Cancel invitation
pub async fn cancel_invitation(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, invite_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let invite = workspace_invites::Entity::find()
        .filter(workspace_invites::Column::Id.eq(invite_id))
        .filter(workspace_invites::Column::WorkspaceId.eq(workspace.id))
        .filter(workspace_invites::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Invitation not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: workspace_invites::ActiveModel = invite.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Invitation cancelled" })))
}

/// GET /api/workspaces/<slug>/labels/ - List workspace labels
pub async fn list_labels(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let label_list = labels::Entity::find()
        .filter(labels::Column::WorkspaceId.eq(workspace.id))
        .filter(labels::Column::ProjectId.is_null())
        .filter(labels::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<LabelResponse> = label_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/labels/ - Create workspace label
pub async fn create_label(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<CreateLabelRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_MEMBER).await?;

    let now = Utc::now().fixed_offset();
    let label = labels::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(body.name),
        description: Set(body.description),
        color: Set(body.color),
        sort_order: Set(65535.0),
        parent_id: Set(body.parent_id),
        workspace_id: Set(workspace.id),
        project_id: Set(body.project_id),
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

/// GET /api/workspaces/{slug}/workspace-members/me/
/// Returns the current user's membership in the workspace.
/// The frontend uses this to verify workspace access.
pub async fn get_my_membership(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;

    let membership = workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(workspace.id))
        .filter(workspace_members::Column::MemberId.eq(current_user.0.id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .filter(workspace_members::Column::IsActive.eq(true))
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    match membership {
        Some(m) => Ok(Json(serde_json::json!({
            "id": m.id,
            "workspace": workspace.id,
            "workspace_slug": workspace.slug,
            "member_id": m.member_id,
            "role": m.role,
            "is_active": m.is_active,
            "created_at": m.created_at.map(|dt| dt.to_rfc3339()),
        }))),
        None => Err(AppError::NotFound("Not a member of this workspace".into())),
    }
}

/// GET /api/workspaces/{slug}/states/
/// Returns all states across all projects in the workspace.
pub async fn list_workspace_states(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let state_list = states::Entity::find()
        .filter(states::Column::WorkspaceId.eq(workspace.id))
        .filter(states::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<serde_json::Value> = state_list.iter().map(|s| serde_json::json!({
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "color": s.color,
        "slug": s.slug,
        "sequence": s.sequence,
        "group": s.group,
        "is_triage": s.is_triage,
        "is_default": s.is_default,
        "project_id": s.project_id,
        "workspace_id": s.workspace_id,
        "created_at": s.created_at.map(|dt| dt.to_rfc3339()),
    })).collect();

    Ok(Json(serde_json::json!(resp)))
}

/// GET /api/workspaces/{slug}/sidebar-preferences/
/// Returns sidebar preferences for the current user in this workspace.
pub async fn get_sidebar_preferences(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let user_id = current_user.0.id;
    let workspace = load_workspace_by_slug(&state, &slug).await?;

    let membership = workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(workspace.id))
        .filter(workspace_members::Column::MemberId.eq(user_id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let sidebar = membership
        .and_then(|m| m.view_props)
        .and_then(|vp| vp.get("sidebar").cloned())
        .unwrap_or(serde_json::json!({
            "sidebar_collapsed": false,
            "sidebar_collapsed_at": [],
        }));

    Ok(Json(sidebar))
}

/// PATCH /api/workspaces/{slug}/sidebar-preferences/
/// Updates sidebar preferences for the current user in this workspace.
pub async fn update_sidebar_preferences(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<UpdateSidebarPreferences>,
) -> Result<impl IntoResponse, AppError> {
    let user_id = current_user.0.id;
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    let now = Utc::now().fixed_offset();

    let membership = workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(workspace.id))
        .filter(workspace_members::Column::MemberId.eq(user_id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Workspace membership not found".into()))?;

    let mut view_props = membership.view_props.clone().unwrap_or(serde_json::json!({}));

    let mut sidebar = view_props
        .get("sidebar")
        .cloned()
        .unwrap_or(serde_json::json!({
            "sidebar_collapsed": false,
            "sidebar_collapsed_at": [],
        }));

    if let Some(collapsed) = body.sidebar_collapsed {
        sidebar["sidebar_collapsed"] = serde_json::json!(collapsed);
    }
    if let Some(collapsed_at) = body.sidebar_collapsed_at {
        sidebar["sidebar_collapsed_at"] = collapsed_at;
    }

    let sidebar_response = sidebar.clone();
    view_props["sidebar"] = sidebar;

    let mut active: workspace_members::ActiveModel = membership.into();
    active.view_props = Set(Some(view_props));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(sidebar_response))
}

/// GET /api/workspaces/{slug}/user-properties/
/// Returns user properties (theme, timezone preferences) for the current user in this workspace.
pub async fn get_user_properties(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    use db::entities::profiles;

    let _workspace = load_workspace_by_slug(&state, &slug).await?;
    let user = current_user.0;

    let profile = profiles::Entity::find()
        .filter(profiles::Column::UserId.eq(user.id))
        .filter(profiles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    Ok(Json(serde_json::json!({
        "workspace": slug,
        "user": user.id,
        "theme": profile.as_ref().and_then(|p| p.theme.clone()),
        "timezone": user.user_timezone,
    })))
}

/// GET /api/workspaces/{slug}/home-preferences/
/// Returns home dashboard widget preferences for the current user.
pub async fn get_home_preferences(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let user_id = current_user.0.id;
    let workspace = load_workspace_by_slug(&state, &slug).await?;

    let membership = workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(workspace.id))
        .filter(workspace_members::Column::MemberId.eq(user_id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let home = membership
        .and_then(|m| m.view_props)
        .and_then(|vp| vp.get("home").cloned())
        .unwrap_or(serde_json::json!({
            "widgets": [],
        }));

    Ok(Json(home))
}

/// PATCH /api/workspaces/{slug}/home-preferences/
/// Updates home dashboard widget preferences for the current user.
pub async fn update_home_preferences(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<UpdateHomePreferences>,
) -> Result<impl IntoResponse, AppError> {
    let user_id = current_user.0.id;
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    let now = Utc::now().fixed_offset();

    let membership = workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(workspace.id))
        .filter(workspace_members::Column::MemberId.eq(user_id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Workspace membership not found".into()))?;

    let mut view_props = membership.view_props.clone().unwrap_or(serde_json::json!({}));

    let mut home = view_props
        .get("home")
        .cloned()
        .unwrap_or(serde_json::json!({
            "widgets": [],
        }));

    if let Some(widgets) = body.widgets {
        home["widgets"] = widgets;
    }

    let home_response = home.clone();
    view_props["home"] = home;

    let mut active: workspace_members::ActiveModel = membership.into();
    active.view_props = Set(Some(view_props));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(home_response))
}

/// GET /api/workspaces/{slug}/users/notifications/unread/
/// Returns unread notification count for the current user in this workspace.
pub async fn get_unread_notifications(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    use db::entities::notifications;

    let workspace = load_workspace_by_slug(&state, &slug).await?;

    let count = notifications::Entity::find()
        .filter(notifications::Column::ReceiverId.eq(current_user.0.id))
        .filter(notifications::Column::WorkspaceId.eq(workspace.id))
        .filter(notifications::Column::ReadAt.is_null())
        .filter(notifications::Column::DeletedAt.is_null())
        .count(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    Ok(Json(serde_json::json!({
        "count": count,
    })))
}

/// GET /api/workspaces/{slug}/user-favorites/ - List user favorites for workspace.
pub async fn get_user_favorites(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Query(query): Query<UserFavoritesQuery>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    let user_id = current_user.0.id;

    let mut find_query = user_favorites::Entity::find()
        .filter(user_favorites::Column::UserId.eq(user_id))
        .filter(user_favorites::Column::WorkspaceId.eq(workspace.id))
        .filter(user_favorites::Column::DeletedAt.is_null());

    if let Some(entity_type) = &query.entity_type {
        find_query = find_query.filter(user_favorites::Column::EntityType.eq(entity_type.as_str()));
    }

    let favorites = find_query
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let result: Vec<serde_json::Value> = favorites.into_iter().map(|f| serde_json::json!({
        "id": f.id,
        "user_id": f.user_id,
        "workspace_id": f.workspace_id,
        "entity_type": f.entity_type,
        "entity_id": f.entity_id,
        "is_favored": f.is_favored,
        "sort_order": f.sort_order,
        "created_at": f.created_at.map(|dt| dt.to_rfc3339()),
        "updated_at": f.updated_at.map(|dt| dt.to_rfc3339()),
    })).collect();

    Ok(Json(serde_json::json!(result)))
}

/// POST /api/workspaces/{slug}/user-favorites/ - Create a user favorite.
pub async fn create_user_favorite(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<CreateUserFavoriteRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    let now = Utc::now().fixed_offset();

    let favorite = user_favorites::ActiveModel {
        id: Set(Uuid::new_v4()),
        user_id: Set(current_user.0.id),
        workspace_id: Set(workspace.id),
        entity_type: Set(body.entity_type),
        entity_id: Set(body.entity_id),
        is_favored: Set(body.is_favored.unwrap_or(true)),
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
        Json(serde_json::json!({
            "id": favorite.id,
            "user_id": favorite.user_id,
            "workspace_id": favorite.workspace_id,
            "entity_type": favorite.entity_type,
            "entity_id": favorite.entity_id,
            "is_favored": favorite.is_favored,
            "sort_order": favorite.sort_order,
            "created_at": favorite.created_at.map(|dt| dt.to_rfc3339()),
            "updated_at": favorite.updated_at.map(|dt| dt.to_rfc3339()),
        })),
    ))
}

/// DELETE /api/workspaces/{slug}/user-favorites/{favorite_id}/ - Soft-delete a user favorite.
pub async fn delete_user_favorite(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, favorite_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;

    let favorite = user_favorites::Entity::find()
        .filter(user_favorites::Column::Id.eq(favorite_id))
        .filter(user_favorites::Column::UserId.eq(current_user.0.id))
        .filter(user_favorites::Column::WorkspaceId.eq(workspace.id))
        .filter(user_favorites::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Favorite not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: user_favorites::ActiveModel = favorite.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /api/workspaces/{slug}/cycles/ - List cycles across all projects in workspace.
pub async fn list_workspace_cycles(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    use db::entities::cycles;
    let all_cycles: Vec<cycles::Model> = cycles::Entity::find()
        .filter(cycles::Column::WorkspaceId.eq(workspace.id))
        .filter(cycles::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let result: Vec<serde_json::Value> = all_cycles.into_iter().map(|c| serde_json::json!({
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "project_id": c.project_id,
        "workspace_id": c.workspace_id,
        "start_date": c.start_date,
        "end_date": c.end_date,
        "created_at": c.created_at.map(|dt| dt.to_rfc3339()),
        "updated_at": c.updated_at.map(|dt| dt.to_rfc3339()),
    })).collect();

    Ok(Json(serde_json::json!(result)))
}

/// GET /api/workspaces/{slug}/modules/ - List modules across all projects in workspace.
pub async fn list_workspace_modules(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    use db::entities::modules;
    let all_modules: Vec<modules::Model> = modules::Entity::find()
        .filter(modules::Column::WorkspaceId.eq(workspace.id))
        .filter(modules::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let result: Vec<serde_json::Value> = all_modules.into_iter().map(|m| serde_json::json!({
        "id": m.id,
        "name": m.name,
        "description": m.description,
        "project_id": m.project_id,
        "workspace_id": m.workspace_id,
        "created_at": m.created_at.map(|dt| dt.to_rfc3339()),
        "updated_at": m.updated_at.map(|dt| dt.to_rfc3339()),
    })).collect();

    Ok(Json(serde_json::json!(result)))
}

/// POST /api/workspaces/{slug}/ai-assistant/ - Stub: AI assistant not available.
pub async fn ai_assistant_stub(
    Extension(_current_user): Extension<CurrentUser>,
    Path(_slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(serde_json::json!({
        "error": "AI assistant is not available in self-hosted mode"
    })))
}

// ---------------------------------------------------------------------------
// Analytics handlers
// ---------------------------------------------------------------------------

/// Builds the overview analytics for a workspace (optionally scoped to a project).
async fn build_overview(
    db: &sea_orm::DatabaseConnection,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
) -> Result<AnalyticsOverviewResponse, AppError> {
    let now = Utc::now();
    let thirty_days_ago = now - Duration::days(30);
    let thirty_days_ago_str = thirty_days_ago.format("%Y-%m-%d").to_string();
    let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();

    // Base filter conditions
    let project_filter = match project_id {
        Some(pid) => format!(" AND project_id = '{}'", pid),
        None => String::new(),
    };

    // Total issues
    let total_sql = format!(
        "SELECT COUNT(*) as count FROM issues WHERE workspace_id = '{}' AND deleted_at IS NULL{}",
        workspace_id, project_filter
    );
    let total: i64 = query_count(db, &total_sql).await?;

    // Get completed state groups for this workspace
    let completed_groups = get_completed_state_groups(db, workspace_id).await?;

    // Closed issues (state group is 'completed')
    let closed_sql = if !completed_groups.is_empty() {
        let state_filter = build_state_join_filter(&completed_groups);
        let groups_csv = completed_groups
            .iter()
            .map(|g| format!("'{}'", g))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "SELECT COUNT(*) as count FROM issues i {} WHERE i.workspace_id = '{}' AND i.deleted_at IS NULL{} AND s.group IN ({})",
            state_filter, workspace_id, project_filter, groups_csv
        )
    } else {
        format!(
            "SELECT COUNT(*) as count FROM issues WHERE workspace_id = '{}' AND deleted_at IS NULL{}",
            workspace_id, project_filter
        )
    };
    let closed: i64 = if completed_groups.is_empty() {
        0
    } else {
        query_count(db, &closed_sql).await?
    };

    let open = total - closed;

    // Issues by state
    let issues_by_state_sql = format!(
        "SELECT COALESCE(s.name, 'Unset') as name, COUNT(i.id) as count \
         FROM issues i \
         LEFT JOIN states s ON i.state_id = s.id \
         WHERE i.workspace_id = '{}' AND i.deleted_at IS NULL{} \
         GROUP BY s.name \
         ORDER BY count DESC",
        workspace_id, project_filter
    );
    let issues_by_state = query_group_counts(db, &issues_by_state_sql).await?;

    // Issues by priority
    let issues_by_priority_sql = format!(
        "SELECT COALESCE(priority, 'None') as name, COUNT(*) as count \
         FROM issues \
         WHERE workspace_id = '{}' AND deleted_at IS NULL{} \
         GROUP BY priority \
         ORDER BY count DESC",
        workspace_id, project_filter
    );
    let issues_by_priority = query_group_counts(db, &issues_by_priority_sql).await?;

    // Overdue issues: target_date < today AND not in completed state
    let overdue_sql = if !completed_groups.is_empty() {
        let state_filter = build_state_join_filter(&completed_groups);
        format!(
            "SELECT COUNT(*) as count FROM issues i {} \
             WHERE i.workspace_id = '{}' AND i.deleted_at IS NULL{} \
             AND i.target_date IS NOT NULL AND i.target_date < '{}' \
             AND (s.group IS NULL OR s.group != 'completed')",
            state_filter, workspace_id, project_filter, now_str
        )
    } else {
        format!(
            "SELECT COUNT(*) as count FROM issues \
             WHERE workspace_id = '{}' AND deleted_at IS NULL{} \
             AND target_date IS NOT NULL AND target_date < '{}'",
            workspace_id, project_filter, now_str
        )
    };
    let overdue: i64 = query_count(db, &overdue_sql).await?;

    // Recently created (last 30 days)
    let recently_created_sql = format!(
        "SELECT COUNT(*) as count FROM issues \
         WHERE workspace_id = '{}' AND deleted_at IS NULL{} \
         AND created_at >= '{}'",
        workspace_id, project_filter, thirty_days_ago_str
    );
    let recently_created: i64 = query_count(db, &recently_created_sql).await?;

    // Recently completed (last 30 days)
    let recently_completed: i64 = if !completed_groups.is_empty() {
        let state_filter = build_state_join_filter(&completed_groups);
        let groups_csv = completed_groups
            .iter()
            .map(|g| format!("'{}'", g))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT COUNT(*) as count FROM issues i {} \
             WHERE i.workspace_id = '{}' AND i.deleted_at IS NULL{} \
             AND i.updated_at >= '{}' AND s.group IN ({})",
            state_filter, workspace_id, project_filter, thirty_days_ago_str, groups_csv
        );
        query_count(db, &sql).await?
    } else {
        0
    };

    Ok(AnalyticsOverviewResponse {
        total_issues: total as u64,
        open_issues: open.max(0) as u64,
        closed_issues: closed as u64,
        issues_by_state: issues_by_state
            .into_iter()
            .map(|g| StateCount { state: g.name, count: g.count as u64 })
            .collect(),
        issues_by_priority: issues_by_priority
            .into_iter()
            .map(|g| PriorityCount { priority: g.name, count: g.count as u64 })
            .collect(),
        overdue_issues: overdue as u64,
        recently_created: recently_created as u64,
        recently_completed: recently_completed as u64,
    })
}

/// GET /api/workspaces/{slug}/analytics/overview
pub async fn analytics_overview(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let overview = build_overview(&state.db, workspace.id, None).await?;
    Ok(Json(serde_json::to_value(&overview).unwrap_or_default()))
}

/// GET /api/workspaces/{slug}/projects/{project_id}/analytics
pub async fn project_analytics(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    // Verify project belongs to workspace
    use db::entities::projects;
    let project = projects::Entity::find_by_id(project_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    if project.workspace_id != workspace.id {
        return Err(AppError::NotFound("Project not found in this workspace".into()));
    }

    let overview = build_overview(&state.db, workspace.id, Some(project_id)).await?;
    Ok(Json(serde_json::to_value(&overview).unwrap_or_default()))
}

/// GET /api/workspaces/{slug}/analytics/sprints
pub async fn sprint_analytics(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    use db::entities::{cycles, projects};

    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let now_str = Utc::now().format("%Y-%m-%d").to_string();

    // Find active sprints (end_date >= today or end_date IS NULL, and not archived)
    let active_cycles: Vec<cycles::Model> = cycles::Entity::find()
        .filter(cycles::Column::WorkspaceId.eq(workspace.id))
        .filter(cycles::Column::DeletedAt.is_null())
        .filter(cycles::Column::ArchivedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    // Get completed state groups
    let completed_groups = get_completed_state_groups(&state.db, workspace.id).await?;

    let mut active_sprints = Vec::new();

    for cycle in &active_cycles {
        // Count total issues in this cycle
        let total_sql = format!(
            "SELECT COUNT(*) as count FROM cycle_issues ci \
             JOIN issues i ON ci.issue_id = i.id \
             WHERE ci.cycle_id = '{}' AND ci.deleted_at IS NULL AND i.deleted_at IS NULL",
            cycle.id
        );
        let total: i64 = query_count(&state.db, &total_sql).await?;

        // Count completed issues in this cycle
        let completed: i64 = if !completed_groups.is_empty() && total > 0 {
            let groups_csv = completed_groups
                .iter()
                .map(|g| format!("'{}'", g))
                .collect::<Vec<_>>()
                .join(",");
            let completed_sql = format!(
                "SELECT COUNT(*) as count FROM cycle_issues ci \
                 JOIN issues i ON ci.issue_id = i.id \
                 LEFT JOIN states s ON i.state_id = s.id \
                 WHERE ci.cycle_id = '{}' AND ci.deleted_at IS NULL AND i.deleted_at IS NULL \
                 AND s.group IN ({})",
                cycle.id, groups_csv
            );
            query_count(&state.db, &completed_sql).await?
        } else {
            0
        };

        let progress_pct = if total > 0 {
            (completed as f64 / total as f64) * 100.0
        } else {
            0.0
        };

        // Get project name
        let project = projects::Entity::find_by_id(cycle.project_id)
            .one(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

        // Only include sprints with start_date <= today and (end_date >= today or end_date is null)
        let is_active = match (&cycle.start_date, &cycle.end_date) {
            (Some(sd), Some(ed)) => sd.as_str() <= now_str.as_str() && ed.as_str() >= now_str.as_str(),
            (Some(sd), None) => sd.as_str() <= now_str.as_str(),
            (None, Some(ed)) => ed.as_str() >= now_str.as_str(),
            (None, None) => true,
        };

        if is_active {
            active_sprints.push(SprintInfo {
                id: cycle.id,
                name: cycle.name.clone(),
                project_id: cycle.project_id,
                project_name: project.map(|p| p.name).unwrap_or_default(),
                total_issues: total as u64,
                completed: completed as u64,
                progress_pct: (progress_pct * 100.0).round() / 100.0,
                start_date: cycle.start_date.clone(),
                end_date: cycle.end_date.clone(),
            });
        }
    }

    Ok(Json(serde_json::to_value(&SprintAnalyticsResponse { active_sprints }).unwrap_or_default()))
}

/// GET /api/workspaces/{slug}/analytics/completion-trend
pub async fn completion_trend(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let now = Utc::now();
    let thirty_days_ago = now - Duration::days(29);
    let start_date_str = thirty_days_ago.format("%Y-%m-%d").to_string();

    // Get completed state groups
    let completed_groups = get_completed_state_groups(&state.db, workspace.id).await?;

    // Build trend data for last 30 days
    // We use raw SQL for date grouping which is SQLite-compatible
    let created_sql = format!(
        "SELECT DATE(created_at) as name, COUNT(*) as count \
         FROM issues \
         WHERE workspace_id = '{}' AND deleted_at IS NULL \
         AND DATE(created_at) >= '{}' \
         GROUP BY DATE(created_at)",
        workspace.id, start_date_str
    );
    let created_counts = query_group_counts(&state.db, &created_sql).await?;
    let created_map: std::collections::HashMap<String, i64> = created_counts
        .into_iter()
        .map(|g| (g.name, g.count))
        .collect();

    // Completed issues: those with state in completed group and updated_at in range
    let completed_map: std::collections::HashMap<String, i64> = if !completed_groups.is_empty() {
        let groups_csv = completed_groups
            .iter()
            .map(|g| format!("'{}'", g))
            .collect::<Vec<_>>()
            .join(",");
        let completed_sql = format!(
            "SELECT DATE(i.updated_at) as name, COUNT(*) as count \
             FROM issues i \
             LEFT JOIN states s ON i.state_id = s.id \
             WHERE i.workspace_id = '{}' AND i.deleted_at IS NULL \
             AND s.group IN ({}) \
             AND DATE(i.updated_at) >= '{}' \
             GROUP BY DATE(i.updated_at)",
            workspace.id, groups_csv, start_date_str
        );
        let completed_counts = query_group_counts(&state.db, &completed_sql).await?;
        completed_counts
            .into_iter()
            .map(|g| (g.name, g.count))
            .collect()
    } else {
        std::collections::HashMap::new()
    };

    // Build the full 30-day trend
    let mut trend = Vec::with_capacity(30);
    for i in 0..30 {
        let date = (thirty_days_ago + Duration::days(i)).format("%Y-%m-%d").to_string();
        trend.push(DayCount {
            date: date.clone(),
            created: *created_map.get(&date).unwrap_or(&0) as u64,
            completed: *completed_map.get(&date).unwrap_or(&0) as u64,
        });
    }

    Ok(Json(serde_json::to_value(&CompletionTrendResponse { trend }).unwrap_or_default()))
}

// ---------------------------------------------------------------------------
// Analytics helpers
// ---------------------------------------------------------------------------

async fn query_count(
    db: &sea_orm::DatabaseConnection,
    sql: &str,
) -> Result<i64, AppError> {
    let result = match db.get_database_backend() {
        DatabaseBackend::Sqlite => {
            db.query_one(Statement::from_string(DatabaseBackend::Sqlite, sql.to_string()))
                .await
        }
        DatabaseBackend::Postgres => {
            db.query_one(Statement::from_string(DatabaseBackend::Postgres, sql.to_string()))
                .await
        }
        DatabaseBackend::MySql => {
            db.query_one(Statement::from_string(DatabaseBackend::MySql, sql.to_string()))
                .await
        }
    }
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB query error: {}", e)))?;

    match result {
        Some(row) => {
            let count: i64 = row.try_get_by_index(0)
                .unwrap_or(0);
            Ok(count)
        }
        None => Ok(0),
    }
}

async fn query_group_counts(
    db: &sea_orm::DatabaseConnection,
    sql: &str,
) -> Result<Vec<GroupCount>, AppError> {
    let result = match db.get_database_backend() {
        DatabaseBackend::Sqlite => {
            db.query_all(Statement::from_string(DatabaseBackend::Sqlite, sql.to_string()))
                .await
        }
        DatabaseBackend::Postgres => {
            db.query_all(Statement::from_string(DatabaseBackend::Postgres, sql.to_string()))
                .await
        }
        DatabaseBackend::MySql => {
            db.query_all(Statement::from_string(DatabaseBackend::MySql, sql.to_string()))
                .await
        }
    }
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB query error: {}", e)))?;

    let mut groups = Vec::new();
    for row in result {
        let name: String = row.try_get_by_index(0).unwrap_or_else(|_| "Unknown".to_string());
        let count: i64 = row.try_get_by_index(1).unwrap_or(0);
        groups.push(GroupCount { name, count });
    }
    Ok(groups)
}

/// Returns state groups that represent "completed" status (typically "completed").
async fn get_completed_state_groups(
    db: &sea_orm::DatabaseConnection,
    workspace_id: Uuid,
) -> Result<Vec<String>, AppError> {
    // For simplicity, we consider the "completed" group as completed.
    // The DEFAULT_STATES define "Done" as group "completed" and "Cancelled" as group "cancelled".
    // We'll check for both "completed" and "cancelled" groups.
    let sql = format!(
        "SELECT DISTINCT \"group\" FROM states WHERE workspace_id = '{}' AND deleted_at IS NULL",
        workspace_id
    );
    let all_groups = query_group_counts_with_first_col(db, &sql).await?;

    let completed: Vec<String> = all_groups
        .into_iter()
        .filter(|g| g == "completed" || g == "cancelled")
        .collect();

    Ok(completed)
}

async fn query_group_counts_with_first_col(
    db: &sea_orm::DatabaseConnection,
    sql: &str,
) -> Result<Vec<String>, AppError> {
    let result = match db.get_database_backend() {
        DatabaseBackend::Sqlite => {
            db.query_all(Statement::from_string(DatabaseBackend::Sqlite, sql.to_string()))
                .await
        }
        DatabaseBackend::Postgres => {
            db.query_all(Statement::from_string(DatabaseBackend::Postgres, sql.to_string()))
                .await
        }
        DatabaseBackend::MySql => {
            db.query_all(Statement::from_string(DatabaseBackend::MySql, sql.to_string()))
                .await
        }
    }
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB query error: {}", e)))?;

    let mut groups = Vec::new();
    for row in result {
        let name: String = row.try_get_by_index(0).unwrap_or_default();
        groups.push(name);
    }
    Ok(groups)
}

fn build_state_join_filter(_completed_groups: &[String]) -> String {
    "LEFT JOIN states s ON i.state_id = s.id".to_string()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn role_to_string(role: i16) -> &'static str {
    match role {
        20 => "ADMIN",
        15 => "MEMBER",
        5 => "GUEST",
        _ => "VIEWER",
    }
}

fn generate_invite_token() -> String {
    let bytes: Vec<u8> = (0..32).map(|_| rand::random::<u8>()).collect();
    bytes.iter().map(|b| (*b % 62) as char).collect()
}

/// GET /api/workspace-slug-check/?slug=xxx
/// Checks if a workspace slug is available. Returns { "status": true } if available.
pub async fn slug_check(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, AppError> {
    let slug = params.get("slug")
        .ok_or(AppError::BadRequest("slug parameter required".into()))?;

    let exists = workspaces::Entity::find()
        .filter(workspaces::Column::Slug.eq(slug))
        .filter(workspaces::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .is_some();

    Ok(Json(serde_json::json!({ "status": !exists })))
}

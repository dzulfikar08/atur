use axum::extract::{Extension, Path, State};
use axum::response::IntoResponse;
use axum::Json;
use axum::routing::{delete, get, patch, post};
use chrono::Utc;
use db::entities::{api_keys, profiles, users};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct UserProfileResponse {
    pub id: Uuid,
    pub email: String,
    pub username: String,
    pub first_name: String,
    pub last_name: String,
    pub display_name: Option<String>,
    pub avatar: Option<String>,
    pub user_timezone: Option<String>,
    pub is_active: bool,
    pub is_email_verified: bool,
    pub is_password_autoset: bool,
    pub created_at: Option<String>,
    // Profile fields
    pub theme: Option<serde_json::Value>,
    pub is_onboarded: bool,
    pub is_tour_completed: bool,
    pub onboarding_step: Option<serde_json::Value>,
    pub use_case: Option<String>,
    pub role: Option<String>,
    pub language: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserSettingsResponse {
    pub id: Uuid,
    pub theme: Option<serde_json::Value>,
    pub is_onboarded: bool,
    pub onboarding_step: Option<serde_json::Value>,
    pub use_case: Option<String>,
    pub role: Option<String>,
    pub language: Option<String>,
    pub user_timezone: Option<String>,
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub avatar: Option<String>,
    pub user_timezone: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/me/", get(get_me))
        .route("/me", get(get_me))
        .route("/me/", patch(update_me))
        .route("/me", patch(update_me))
        .route("/me/profile/", get(get_profile).patch(update_profile))
        .route("/me/profile", get(get_profile).patch(update_profile))
        .route("/me/settings/", get(get_settings))
        .route("/me/settings", get(get_settings))
        .route("/me/change-password/", post(change_password))
        .route("/me/change-password", post(change_password))
        .route("/me/tour-completed/", patch(tour_completed))
        .route("/me/tour-completed", patch(tour_completed))
        .route(
            "/me/notification-preferences/",
            get(super::notifications::get_notification_preferences)
                .patch(super::notifications::update_notification_preferences),
        )
        .route(
            "/me/notification-preferences",
            get(super::notifications::get_notification_preferences)
                .patch(super::notifications::update_notification_preferences),
        )
        .route("/me/workspaces/", get(get_my_workspaces))
        .route("/me/workspaces", get(get_my_workspaces))
        .route("/me/workspaces/{slug}/project-roles/", get(get_project_roles))
        .route("/me/workspaces/{slug}/project-roles", get(get_project_roles))
        .route("/me/workspaces/invitations/", get(get_workspace_invitations))
        .route("/me/workspaces/invitations", get(get_workspace_invitations))
        .route("/me/api-keys/", get(list_api_keys).post(create_api_key))
        .route("/me/api-keys", get(list_api_keys).post(create_api_key))
        .route("/me/api-keys/{key_id}/", delete(revoke_api_key))
        .route("/me/api-keys/{key_id}", delete(revoke_api_key))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/users/me/
pub async fn get_me(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<impl IntoResponse, AppError> {
    let user = current_user.0;

    // Load profile
    let profile = profiles::Entity::find()
        .filter(profiles::Column::UserId.eq(user.id))
        .filter(profiles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp = UserProfileResponse {
        id: user.id,
        email: user.email.clone(),
        username: user.username.clone(),
        first_name: user.display_name.clone().unwrap_or_else(|| user.username.clone()),
        last_name: String::new(),
        display_name: user.display_name,
        avatar: user.avatar,
        user_timezone: user.user_timezone,
        is_active: user.is_active,
        is_email_verified: user.is_email_verified,
        is_password_autoset: false,
        created_at: user.created_at.map(|dt| dt.to_rfc3339()),
        theme: profile.as_ref().and_then(|p| p.theme.clone()),
        is_onboarded: profile.as_ref().map(|p| p.is_onboarded).unwrap_or(false),
        is_tour_completed: get_is_tour_completed(&profile.as_ref().and_then(|p| p.onboarding_step.clone())),
        onboarding_step: profile.as_ref().and_then(|p| p.onboarding_step.clone()),
        use_case: profile.as_ref().and_then(|p| p.use_case.clone()),
        role: profile.as_ref().and_then(|p| p.role.clone()),
        language: profile.as_ref().and_then(|p| p.language.clone()),
    };

    Ok(Json(resp))
}

/// Extract is_tour_completed from the onboarding_step JSON field.
fn get_is_tour_completed(onboarding_step: &Option<serde_json::Value>) -> bool {
    onboarding_step.as_ref()
        .and_then(|s| s.get("is_tour_completed"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// PATCH /api/users/me/
pub async fn update_me(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<impl IntoResponse, AppError> {
    let user = current_user.0;
    let now = Utc::now().fixed_offset();

    let mut active: users::ActiveModel = user.into();
    if let Some(display_name) = body.display_name {
        active.display_name = Set(Some(display_name));
    }
    if let Some(avatar) = body.avatar {
        active.avatar = Set(Some(avatar));
    }
    if let Some(user_timezone) = body.user_timezone {
        active.user_timezone = Set(Some(user_timezone));
    }
    active.updated_at = Set(Some(now));

    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({
        "id": updated.id,
        "email": updated.email,
        "username": updated.username,
        "first_name": updated.display_name.clone().unwrap_or_else(|| updated.username.clone()),
        "last_name": "",
        "display_name": updated.display_name,
        "avatar": updated.avatar,
        "user_timezone": updated.user_timezone,
        "is_password_autoset": false,
    })))
}

/// GET /api/users/me/settings/
/// GET /api/users/me/profile/
pub async fn get_profile(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<impl IntoResponse, AppError> {
    let user = current_user.0;

    let profile = profiles::Entity::find()
        .filter(profiles::Column::UserId.eq(user.id))
        .filter(profiles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    Ok(Json(serde_json::json!({
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "first_name": user.display_name.clone().unwrap_or_else(|| user.username.clone()),
        "last_name": "",
        "display_name": user.display_name,
        "avatar": user.avatar,
        "is_active": user.is_active,
        "is_email_verified": user.is_email_verified,
        "is_password_autoset": false,
        "theme": profile.as_ref().and_then(|p| p.theme.clone()),
        "is_onboarded": profile.as_ref().map(|p| p.is_onboarded).unwrap_or(false),
        "is_tour_completed": get_is_tour_completed(&profile.as_ref().and_then(|p| p.onboarding_step.clone())),
        "onboarding_step": profile.as_ref().and_then(|p| p.onboarding_step.clone()),
        "use_case": profile.as_ref().and_then(|p| p.use_case.clone()),
        "role": profile.as_ref().and_then(|p| p.role.clone()),
        "language": profile.as_ref().and_then(|p| p.language.clone()),
    })))
}

/// PATCH /api/users/me/profile/
#[derive(serde::Deserialize)]
pub struct UpdateProfileBody {
    pub display_name: Option<String>,
    pub avatar: Option<String>,
    pub user_timezone: Option<String>,
}

pub async fn update_profile(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Json(body): Json<UpdateProfileBody>,
) -> Result<impl IntoResponse, AppError> {
    let user = current_user.0;
    let now = chrono::Utc::now().fixed_offset();

    let mut active: users::ActiveModel = user.clone().into();
    if let Some(display_name) = body.display_name {
        active.display_name = Set(Some(display_name));
    }
    if let Some(avatar) = body.avatar {
        active.avatar = Set(Some(avatar));
    }
    if let Some(user_timezone) = body.user_timezone {
        active.user_timezone = Set(Some(user_timezone));
    }
    active.updated_at = Set(Some(now));
    let updated = active.update(&state.db).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    let profile = profiles::Entity::find()
        .filter(profiles::Column::UserId.eq(updated.id))
        .filter(profiles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    Ok(Json(serde_json::json!({
        "id": updated.id,
        "email": updated.email,
        "username": updated.username,
        "first_name": updated.display_name.clone().unwrap_or_else(|| updated.username.clone()),
        "last_name": "",
        "display_name": updated.display_name,
        "avatar": updated.avatar,
        "user_timezone": updated.user_timezone,
        "is_active": updated.is_active,
        "is_email_verified": updated.is_email_verified,
        "is_password_autoset": false,
        "theme": profile.as_ref().and_then(|p| p.theme.clone()),
        "is_onboarded": profile.as_ref().map(|p| p.is_onboarded).unwrap_or(false),
        "is_tour_completed": get_is_tour_completed(&profile.as_ref().and_then(|p| p.onboarding_step.clone())),
        "onboarding_step": profile.as_ref().and_then(|p| p.onboarding_step.clone()),
        "use_case": profile.as_ref().and_then(|p| p.use_case.clone()),
        "role": profile.as_ref().and_then(|p| p.role.clone()),
        "language": profile.as_ref().and_then(|p| p.language.clone()),
    })))
}

/// GET /api/users/me/settings/
pub async fn get_settings(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<impl IntoResponse, AppError> {
    use db::entities::{workspace_members, workspaces};

    let user = current_user.0;

    let profile = profiles::Entity::find()
        .filter(profiles::Column::UserId.eq(user.id))
        .filter(profiles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    // Find the user's most recent workspace for last_workspace_slug
    let last_ws = workspace_members::Entity::find()
        .filter(workspace_members::Column::MemberId.eq(user.id))
        .filter(workspace_members::Column::IsActive.eq(true))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let last_workspace_slug = if let Some(membership) = last_ws {
        workspaces::Entity::find_by_id(membership.workspace_id)
            .one(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
            .map(|ws| ws.slug)
    } else {
        None
    };

    Ok(Json(serde_json::json!({
        "id": user.id,
        "theme": profile.as_ref().and_then(|p| p.theme.clone()),
        "is_onboarded": profile.as_ref().map(|p| p.is_onboarded).unwrap_or(false),
        "is_tour_completed": get_is_tour_completed(&profile.as_ref().and_then(|p| p.onboarding_step.clone())),
        "onboarding_step": profile.as_ref().and_then(|p| p.onboarding_step.clone()),
        "use_case": profile.as_ref().and_then(|p| p.use_case.clone()),
        "role": profile.as_ref().and_then(|p| p.role.clone()),
        "language": profile.as_ref().and_then(|p| p.language.clone()),
        "user_timezone": user.user_timezone,
        "workspace": {
            "last_workspace_slug": last_workspace_slug,
            "fallback_workspace_slug": last_workspace_slug,
        },
    })))
}

/// POST /api/users/me/change-password/
pub async fn change_password(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Json(body): Json<ChangePasswordRequest>,
) -> Result<impl IntoResponse, AppError> {
    let user = current_user.0;

    // Validate new password strength
    domain::auth::validate_password_strength(&body.new_password)
        .map_err(|e| AppError::BadRequest(e))?;

    // Verify old password
    let old_hash = user
        .password_hash
        .as_deref()
        .ok_or(AppError::BadRequest("No password set for this account".into()))?;

    if !domain::auth::verify_password(&body.old_password, old_hash)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Verify error: {}", e)))?
    {
        return Err(AppError::BadRequest("Incorrect current password".into()));
    }

    let new_hash = domain::auth::hash_password(&body.new_password)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Hash error: {}", e)))?;

    let mut active: users::ActiveModel = user.into();
    active.password_hash = Set(Some(new_hash));
    active.updated_at = Set(Some(Utc::now().fixed_offset()));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Password changed successfully" })))
}

/// GET /api/users/me/workspaces/
/// Returns workspaces the current user belongs to.
pub async fn get_my_workspaces(
    Extension(current_user): Extension<CurrentUser>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    use db::entities::{workspace_members, workspaces};

    // Find all workspace memberships for this user
    let memberships = workspace_members::Entity::find()
        .filter(workspace_members::Column::MemberId.eq(current_user.0.id))
        .filter(workspace_members::Column::IsActive.eq(true))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let mut result = Vec::new();
    for membership in memberships {
        if let Some(ws) = workspaces::Entity::find_by_id(membership.workspace_id)
            .one(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        {
            result.push(serde_json::json!({
                "id": ws.id,
                "name": ws.name,
                "slug": ws.slug,
                "logo": ws.logo,
                "organization_size": ws.organization_size,
                "timezone": ws.timezone,
                "background_color": ws.background_color,
                "owner_id": ws.owner_id,
                "role": membership.role,
                "created_at": ws.created_at.map(|dt| dt.to_rfc3339()),
                "updated_at": ws.updated_at.map(|dt| dt.to_rfc3339()),
            }));
        }
    }

    Ok(Json(serde_json::json!(result)))
}

/// GET /api/users/me/workspaces/{slug}/project-roles/
/// Returns the user's project roles within a specific workspace.
pub async fn get_project_roles(
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    // Return empty project roles — the frontend uses this for permission checks
    Ok(Json(serde_json::json!({
        "workspace_slug": slug,
        "project_roles": {},
    })))
}

/// PATCH /api/users/me/tour-completed/
pub async fn tour_completed(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<impl IntoResponse, AppError> {
    let profile = profiles::Entity::find()
        .filter(profiles::Column::UserId.eq(current_user.0.id))
        .filter(profiles::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Profile not found".into()))?;

    // Merge is_tour_completed into onboarding_step JSON
    let mut step: serde_json::Value = profile.onboarding_step.clone()
        .unwrap_or(serde_json::json!({}));
    step["is_tour_completed"] = serde_json::json!(true);

    let mut active: profiles::ActiveModel = profile.into();
    active.is_onboarded = Set(true);
    active.onboarding_step = Set(Some(step));
    active.updated_at = Set(Some(chrono::Utc::now().fixed_offset()));
    active.update(&state.db).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
    Ok(Json(serde_json::json!({ "is_tour_completed": true })))
}

/// GET /api/users/me/workspaces/invitations/ - Stub: return empty invitations.
pub async fn get_workspace_invitations(
    Extension(_current_user): Extension<CurrentUser>,
) -> Result<impl IntoResponse, AppError> {
    Ok(Json(serde_json::json!([])))
}

// ---------------------------------------------------------------------------
// API Key Management
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    pub scopes: Option<Vec<String>>,
    pub workspace_id: Option<Uuid>,
    pub expires_at: Option<String>,
}

/// GET /api/users/me/api-keys
pub async fn list_api_keys(
    Extension(current_user): Extension<CurrentUser>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let keys = api_keys::Entity::find()
        .filter(api_keys::Column::UserId.eq(current_user.0.id))
        .filter(api_keys::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let result: Vec<serde_json::Value> = keys.into_iter().map(|k| {
        serde_json::json!({
            "id": k.id,
            "name": k.name,
            "key_prefix": k.key_prefix,
            "scopes": serde_json::from_str::<serde_json::Value>(&k.scopes).unwrap_or(serde_json::json!([])),
            "workspace_id": k.workspace_id,
            "last_used_at": k.last_used_at.map(|dt| dt.to_rfc3339()),
            "expires_at": k.expires_at.map(|dt| dt.to_rfc3339()),
            "created_at": k.created_at.map(|dt| dt.to_rfc3339()),
        })
    }).collect();

    Ok(Json(serde_json::json!(result)))
}

/// POST /api/users/me/api-keys
pub async fn create_api_key(
    Extension(current_user): Extension<CurrentUser>,
    State(state): State<AppState>,
    Json(body): Json<CreateApiKeyRequest>,
) -> Result<impl IntoResponse, AppError> {
    if body.name.trim().is_empty() {
        return Err(AppError::BadRequest("Name is required".into()));
    }

    let random_hex = Uuid::new_v4().simple().to_string();
    let raw_key = format!("pk_live_{}", random_hex);
    let key_prefix = raw_key[..12].to_string();

    let mut hasher = Sha256::new();
    hasher.update(raw_key.as_bytes());
    let key_hash = format!("{:x}", hasher.finalize());

    let scopes = body.scopes.unwrap_or_default();
    let scopes_json = serde_json::to_string(&scopes)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("JSON error: {}", e)))?;

    let expires_at = body.expires_at.as_ref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok());

    let now = chrono::Utc::now().fixed_offset();
    let id = Uuid::new_v4();

    let name = body.name.clone();
    let api_key = api_keys::ActiveModel {
        id: Set(id),
        name: Set(body.name),
        key_hash: Set(key_hash),
        key_prefix: Set(key_prefix),
        user_id: Set(current_user.0.id),
        workspace_id: Set(body.workspace_id),
        scopes: Set(scopes_json),
        last_used_at: Set(None),
        expires_at: Set(expires_at),
        is_active: Set(true),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    };

    api_key.insert(&state.db).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    Ok(Json(serde_json::json!({
        "id": id,
        "name": name,
        "key": raw_key,
        "scopes": scopes,
        "workspace_id": body.workspace_id,
        "expires_at": expires_at.map(|dt| dt.to_rfc3339()),
    })))
}

/// DELETE /api/users/me/api-keys/{key_id}
pub async fn revoke_api_key(
    Extension(current_user): Extension<CurrentUser>,
    State(state): State<AppState>,
    Path(key_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let api_key = api_keys::Entity::find_by_id(key_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("API key not found".into()))?;

    if api_key.user_id != current_user.0.id {
        return Err(AppError::NotFound("API key not found".into()));
    }

    let now = chrono::Utc::now().fixed_offset();
    let mut active: api_keys::ActiveModel = api_key.into();
    active.is_active = Set(false);
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active.update(&state.db).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "API key revoked" })))
}

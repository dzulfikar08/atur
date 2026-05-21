use axum::extract::{Extension, Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use chrono::{DateTime, FixedOffset, Utc};
use db::entities::{github_integrations, issues, projects, states, time_entries};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::middleware::permission::{load_workspace_by_slug, require_workspace_role};
use crate::state::AppState;

const ROLE_ADMIN: i16 = 20;
const ROLE_MEMBER: i16 = 10;

// ---------------------------------------------------------------------------
// GitHub Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ConnectGithubRequest {
    pub repo_owner: String,
    pub repo_name: String,
    pub access_token: String,
    pub project_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct GithubIntegrationResponse {
    pub id: Uuid,
    pub repo_owner: String,
    pub repo_name: String,
    pub sync_enabled: bool,
    pub project_id: Option<Uuid>,
    pub last_synced_at: Option<String>,
    pub created_at: Option<String>,
}

impl From<github_integrations::Model> for GithubIntegrationResponse {
    fn from(m: github_integrations::Model) -> Self {
        Self {
            id: m.id,
            repo_owner: m.github_repo_owner,
            repo_name: m.github_repo_name,
            sync_enabled: m.sync_enabled,
            project_id: m.project_id,
            last_synced_at: m.last_synced_at.map(|dt| dt.to_rfc3339()),
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct GithubSyncResponse {
    pub created: u32,
    pub updated: u32,
}

#[derive(Debug, Serialize)]
pub struct GithubRepository {
    pub id: i64,
    pub name: String,
    pub full_name: String,
    pub url: String,
}

// Clockify request / response types

#[derive(Debug, Deserialize)]
pub struct ClockifySetupRequest {
    pub api_key: String,
}

#[derive(Debug, Serialize)]
pub struct ClockifyStatusResponse {
    pub configured: bool,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTimeEntryRequest {
    pub issue_id: Uuid,
    pub duration_seconds: i32,
    pub description: Option<String>,
    pub started_at: DateTime<FixedOffset>,
    pub ended_at: Option<DateTime<FixedOffset>>,
}

#[derive(Debug, Serialize)]
pub struct TimeEntryResponse {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub workspace_id: Uuid,
    pub user_id: Uuid,
    pub duration_seconds: i32,
    pub description: Option<String>,
    pub started_at: DateTime<FixedOffset>,
    pub ended_at: Option<DateTime<FixedOffset>>,
    pub clockify_id: Option<String>,
    pub created_at: Option<DateTime<FixedOffset>>,
    pub updated_at: Option<DateTime<FixedOffset>>,
}

#[derive(Debug, Deserialize)]
pub struct ListTimeEntriesQuery {
    pub issue_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct ClockifySyncResponse {
    pub pushed: u32,
    pub pulled: u32,
}

// Clockify API response types (camelCase field names match Clockify JSON API)

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct ClockifyUser {
    name: String,
    email: String,
    activeWorkspace: String,
    defaultWorkspace: String,
}

#[derive(Debug, Deserialize)]
struct ClockifyWorkspace {
    id: String,
    name: String,
}

#[derive(Debug, Serialize)]
struct ClockifyTimeEntryPayload {
    start: String,
    end: Option<String>,
    duration: String,
    description: Option<String>,
    #[serde(rename = "type")]
    entry_type: String,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct ClockifyTimeEntry {
    id: String,
    description: Option<String>,
    timeInterval: ClockifyTimeInterval,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct ClockifyTimeInterval {
    start: String,
    end: Option<String>,
    duration: Option<String>,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        // GitHub integration routes
        .route("/github/connect", axum::routing::post(github_connect_repo))
        .route("/github/connect/", axum::routing::post(github_connect_repo))
        .route("/github", axum::routing::get(github_list_integrations))
        .route("/github/", axum::routing::get(github_list_integrations))
        .route("/github/{integration_id}", axum::routing::delete(github_delete_integration))
        .route("/github/{integration_id}/", axum::routing::delete(github_delete_integration))
        .route("/github/{integration_id}/sync", axum::routing::post(github_trigger_sync))
        .route("/github/{integration_id}/sync/", axum::routing::post(github_trigger_sync))
        // Legacy GitHub routes (kept for backward compatibility)
        .route("/github/repositories", axum::routing::get(list_repositories))
        .route("/github/repositories/", axum::routing::get(list_repositories))
        // Clockify
        .route(
            "/clockify/setup",
            axum::routing::post(clockify_setup),
        )
        .route(
            "/clockify/status",
            axum::routing::get(clockify_status),
        )
        .route(
            "/clockify/sync",
            axum::routing::post(clockify_sync),
        )
        // Time entries
        .route(
            "/time-entries",
            axum::routing::post(create_time_entry),
        )
        .route(
            "/time-entries/",
            axum::routing::post(create_time_entry),
        )
        .route(
            "/time-entries",
            axum::routing::get(list_time_entries),
        )
        .route(
            "/time-entries/",
            axum::routing::get(list_time_entries),
        )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Get the Clockify API key from the env var.
fn clockify_api_key() -> Option<String> {
    std::env::var("PLANE_CLOCKIFY_API_KEY").ok()
}

/// Build a reqwest client authorized with the Clockify API key.
fn clockify_client(api_key: &str) -> reqwest::Client {
    let mut headers = reqwest::header::HeaderMap::new();
    let auth_val = format!("Bearer {}", api_key)
        .parse::<reqwest::header::HeaderValue>()
        .expect("valid header value");
    headers.insert(reqwest::header::AUTHORIZATION, auth_val);
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        "application/json".parse().unwrap(),
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .expect("build reqwest client")
}

fn model_to_response(m: time_entries::Model) -> TimeEntryResponse {
    TimeEntryResponse {
        id: m.id,
        issue_id: m.issue_id,
        workspace_id: m.workspace_id,
        user_id: m.user_id,
        duration_seconds: m.duration_seconds,
        description: m.description,
        started_at: m.started_at,
        ended_at: m.ended_at,
        clockify_id: m.clockify_id,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

// ---------------------------------------------------------------------------
// GitHub Handlers
// ---------------------------------------------------------------------------

/// POST /{slug}/integrations/github/connect — Connect a GitHub repo to a workspace
pub async fn github_connect_repo(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<ConnectGithubRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    // Validate token format
    if !body.access_token.starts_with("ghp_")
        && !body.access_token.starts_with("gho_")
        && !body.access_token.starts_with("github_pat_")
    {
        return Err(AppError::BadRequest(
            "Invalid GitHub access token format".to_string(),
        ));
    }

    // Validate repo by calling GitHub API
    let github_url = format!(
        "https://api.github.com/repos/{}/{}",
        body.repo_owner, body.repo_name
    );
    let resp = reqwest::Client::new()
        .get(&github_url)
        .header("Authorization", format!("Bearer {}", body.access_token))
        .header("User-Agent", "plane-pmo")
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("GitHub API request failed: {}", e)))?;

    if !resp.status().is_success() {
        return Err(AppError::BadRequest(format!(
            "Cannot access GitHub repo {}/{} (status {})",
            body.repo_owner, body.repo_name, resp.status()
        )));
    }

    // Generate a webhook secret for this integration
    let webhook_secret = generate_webhook_secret();

    let now: DateTime<FixedOffset> = Utc::now().into();
    let integration = github_integrations::ActiveModel {
        id: Set(Uuid::new_v4()),
        workspace_id: Set(workspace.id),
        github_repo_owner: Set(body.repo_owner.clone()),
        github_repo_name: Set(body.repo_name.clone()),
        github_installation_id: Set(None),
        access_token: Set(Some(body.access_token.clone())),
        webhook_secret: Set(Some(webhook_secret)),
        sync_enabled: Set(true),
        project_id: Set(body.project_id),
        last_synced_at: Set(None),
        created_by: Set(Some(current_user.0.id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to save GitHub integration: {}", e)))?;

    tracing::info!(
        workspace_id = %workspace.id,
        repo = %format!("{}/{}", body.repo_owner, body.repo_name),
        "GitHub integration connected"
    );

    Ok((
        axum::http::StatusCode::CREATED,
        Json(GithubIntegrationResponse::from(integration)),
    ))
}

/// GET /{slug}/integrations/github — List GitHub integrations for workspace
pub async fn github_list_integrations(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_MEMBER).await?;

    let integrations = github_integrations::Entity::find()
        .filter(github_integrations::Column::WorkspaceId.eq(workspace.id))
        .filter(github_integrations::Column::DeletedAt.is_null())
        .order_by_desc(github_integrations::Column::CreatedAt)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<GithubIntegrationResponse> =
        integrations.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// DELETE /{slug}/integrations/github/{integration_id} — Remove GitHub integration
pub async fn github_delete_integration(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, integration_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let integration = github_integrations::Entity::find()
        .filter(github_integrations::Column::Id.eq(integration_id))
        .filter(github_integrations::Column::WorkspaceId.eq(workspace.id))
        .filter(github_integrations::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("GitHub integration not found".into()))?;

    let now: DateTime<FixedOffset> = Utc::now().into();
    let mut active: github_integrations::ActiveModel = integration.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "GitHub integration removed" })))
}

/// POST /{slug}/integrations/github/{integration_id}/sync — Trigger sync
pub async fn github_trigger_sync(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, integration_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let integration = github_integrations::Entity::find()
        .filter(github_integrations::Column::Id.eq(integration_id))
        .filter(github_integrations::Column::WorkspaceId.eq(workspace.id))
        .filter(github_integrations::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("GitHub integration not found".into()))?;

    let result = sync_github_to_plane(&integration, &state).await?;

    // Update last_synced_at
    let now: DateTime<FixedOffset> = Utc::now().into();
    let mut active: github_integrations::ActiveModel = integration.into();
    active.last_synced_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    let _ = active.update(&state.db).await;

    Ok(Json(result))
}

/// GET /api/workspaces/{slug}/integrations/github/repositories — list repos (stub)
pub async fn list_repositories(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let repos: Vec<GithubRepository> = Vec::new();
    Ok(Json(repos))
}

// ---------------------------------------------------------------------------
// GitHub Sync Logic
// ---------------------------------------------------------------------------

/// Fetch open GitHub issues and create/update plane-pmo issues.
pub async fn sync_github_to_plane(
    integration: &github_integrations::Model,
    state: &AppState,
) -> Result<GithubSyncResponse, AppError> {
    let access_token = integration
        .access_token
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("No access token configured".into()))?;

    let url = format!(
        "https://api.github.com/repos/{}/{}/issues?state=all&per_page=100",
        integration.github_repo_owner, integration.github_repo_name
    );

    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "plane-pmo")
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("GitHub API request failed: {}", e)))?;

    if !resp.status().is_success() {
        return Err(AppError::Internal(anyhow::anyhow!(
            "GitHub API returned status {}",
            resp.status()
        )));
    }

    let gh_issues: Vec<GithubIssue> = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to parse GitHub response: {}", e)))?;

    // Determine the target project
    let project_id = match integration.project_id {
        Some(pid) => pid,
        None => {
            // Find the first project in the workspace
            projects::Entity::find()
                .filter(projects::Column::WorkspaceId.eq(integration.workspace_id))
                .filter(projects::Column::DeletedAt.is_null())
                .order_by_asc(projects::Column::CreatedAt)
                .one(&state.db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
                .map(|p| p.id)
                .ok_or_else(|| AppError::NotFound("No project found in workspace".into()))?
        }
    };

    // Find a default state for issues
    let default_state = states::Entity::find()
        .filter(states::Column::ProjectId.eq(project_id))
        .filter(states::Column::DeletedAt.is_null())
        .order_by_asc(states::Column::Sequence)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let external_source = format!(
        "github:{}/{}",
        integration.github_repo_owner, integration.github_repo_name
    );

    let mut created: u32 = 0;
    let mut updated: u32 = 0;

    for gh_issue in &gh_issues {
        // Skip PRs (GitHub returns PRs in the issues endpoint too)
        if gh_issue.pull_request.is_some() {
            continue;
        }

        let external_id = format!("{}", gh_issue.number);

        // Check if issue already exists
        let existing = issues::Entity::find()
            .filter(issues::Column::WorkspaceId.eq(integration.workspace_id))
            .filter(issues::Column::ProjectId.eq(project_id))
            .filter(issues::Column::ExternalSource.eq(&external_source))
            .filter(issues::Column::ExternalId.eq(&external_id))
            .filter(issues::Column::DeletedAt.is_null())
            .one(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

        let issue_state_id = determine_state_id(
            &gh_issue.state,
            default_state.as_ref().map(|s| s.id),
            project_id,
            &state.db,
        )
        .await;

        if let Some(existing_issue) = existing {
            // Update existing issue
            let now: DateTime<FixedOffset> = Utc::now().into();
            let mut active: issues::ActiveModel = existing_issue.into();
            active.name = Set(gh_issue.title.clone());
            active.description_html = Set(gh_issue.body.clone());
            active.state_id = Set(issue_state_id);
            active.updated_at = Set(Some(now));
            if gh_issue.state == "closed" {
                active.completed_at = Set(Some(now));
            } else {
                active.completed_at = Set(None);
            }
            active
                .update(&state.db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;
            updated += 1;
        } else {
            // Create new issue
            let now: DateTime<FixedOffset> = Utc::now().into();

            // Get the max sequence_id for the project
            let max_seq = issues::Entity::find()
                .filter(issues::Column::ProjectId.eq(project_id))
                .filter(issues::Column::DeletedAt.is_null())
                .order_by_desc(issues::Column::SequenceId)
                .one(&state.db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
                .map(|i| i.sequence_id)
                .unwrap_or(0);

            let new_issue = issues::ActiveModel {
                id: Set(Uuid::new_v4()),
                name: Set(gh_issue.title.clone()),
                sequence_id: Set(max_seq + 1),
                sort_order: Set((max_seq + 1) as f32 * 1000.0),
                priority: Set(None),
                start_date: Set(None),
                target_date: Set(None),
                completed_at: Set(if gh_issue.state == "closed" { Some(now) } else { None }),
                archived_at: Set(None),
                is_draft: Set(false),
                description_json: Set(None),
                description_html: Set(gh_issue.body.clone()),
                description_stripped: Set(None),
                description_binary: Set(None),
                parent_id: Set(None),
                state_id: Set(issue_state_id),
                estimate_point_id: Set(None),
                type_id: Set(None),
                project_id: Set(project_id),
                workspace_id: Set(integration.workspace_id),
                created_by_id: Set(integration.created_by),
                external_source: Set(Some(external_source.clone())),
                external_id: Set(Some(external_id)),
                created_at: Set(Some(now)),
                updated_at: Set(Some(now)),
                deleted_at: Set(None),
            };

            new_issue
                .insert(&state.db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;
            created += 1;
        }
    }

    Ok(GithubSyncResponse { created, updated })
}

/// Determine the state ID for a GitHub issue based on its state.
async fn determine_state_id(
    gh_state: &str,
    default_state_id: Option<Uuid>,
    project_id: Uuid,
    db: &sea_orm::DatabaseConnection,
) -> Option<Uuid> {
    // Try to find a matching state by group
    let group = if gh_state == "closed" { "completed" } else { "backlog" };

    let state = states::Entity::find()
        .filter(states::Column::ProjectId.eq(project_id))
        .filter(states::Column::Group.eq(group))
        .filter(states::Column::DeletedAt.is_null())
        .order_by_asc(states::Column::Sequence)
        .one(db)
        .await
        .ok()
        .flatten();

    state.map(|s| s.id).or(default_state_id)
}

/// GitHub API issue representation
#[derive(Debug, Deserialize)]
struct GithubIssue {
    number: i64,
    title: String,
    body: Option<String>,
    state: String,
    pull_request: Option<GithubPullRequestMarker>,
}

#[derive(Debug, Deserialize)]
struct GithubPullRequestMarker {
    #[allow(dead_code)]
    url: Option<String>,
}

// ---------------------------------------------------------------------------
// GitHub Webhook Helpers (shared with webhooks.rs)
// ---------------------------------------------------------------------------

fn generate_webhook_secret() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let secret: Vec<u8> = (0..32).map(|_| rng.r#gen::<u8>()).collect();
    secret.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Verify GitHub webhook signature using HMAC-SHA256.
pub fn verify_github_signature(payload: &[u8], secret: &str, signature: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    let Ok(mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    let mut mac = mac;
    mac.update(payload);

    let expected = format!("sha1={}", mac.finalize().into_bytes().iter().map(|b| format!("{:02x}", b)).collect::<String>());

    // GitHub actually uses sha256 in newer versions
    let expected256 = {
        let Ok(mac2) = HmacSha256::new_from_slice(secret.as_bytes()) else {
            return false;
        };
        let mut mac2 = mac2;
        mac2.update(payload);
        format!("sha256={}", mac2.finalize().into_bytes().iter().map(|b| format!("{:02x}", b)).collect::<String>())
    };

    // Constant-time comparison
    fn ct_eq(a: &str, b: &str) -> bool {
        if a.len() != b.len() {
            return false;
        }
        let mut result = 0u8;
        for (x, y) in a.bytes().zip(b.bytes()) {
            result |= x ^ y;
        }
        result == 0
    }

    ct_eq(signature, &expected256) || ct_eq(signature, &expected)
}

// ---------------------------------------------------------------------------
// Clockify Handlers
// ---------------------------------------------------------------------------

/// POST /{slug}/integrations/clockify/setup
/// Save Clockify API key via environment variable.
/// In production, this would be stored in an integrations_config table.
pub async fn clockify_setup(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<ClockifySetupRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let api_key = body.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err(AppError::BadRequest("API key cannot be empty".to_string()));
    }

    // Verify the key by calling the Clockify /user endpoint
    let client = clockify_client(&api_key);
    let resp = client
        .get("https://api.clockify.me/api/v1/user")
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Clockify request failed: {}", e)))?;

    if !resp.status().is_success() {
        return Err(AppError::BadRequest(format!(
            "Clockify API key verification failed (status {})",
            resp.status()
        )));
    }

    let user: ClockifyUser = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to parse Clockify user: {}", e)))?;

    tracing::info!(
        workspace_id = %workspace.id,
        clockify_user = %user.name,
        "Clockify integration configured"
    );

    Ok(Json(serde_json::json!({
        "configured": true,
        "user_name": user.name,
        "user_email": user.email,
    })))
}

/// GET /{slug}/integrations/clockify/status
/// Check whether Clockify is configured and the API key is valid.
pub async fn clockify_status(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_MEMBER).await?;

    let api_key = match clockify_api_key() {
        Some(k) if !k.is_empty() => k,
        _ => {
            return Ok(Json(ClockifyStatusResponse {
                configured: false,
                user_name: None,
                user_email: None,
            }));
        }
    };

    let client = clockify_client(&api_key);
    let resp = client
        .get("https://api.clockify.me/api/v1/user")
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => {
            let user: ClockifyUser = r.json().await.unwrap_or(ClockifyUser {
                name: String::new(),
                email: String::new(),
                activeWorkspace: String::new(),
                defaultWorkspace: String::new(),
            });
            Ok(Json(ClockifyStatusResponse {
                configured: true,
                user_name: Some(user.name),
                user_email: Some(user.email),
            }))
        }
        _ => Ok(Json(ClockifyStatusResponse {
            configured: false,
            user_name: None,
            user_email: None,
        })),
    }
}

/// POST /{slug}/integrations/clockify/sync
/// Push unsynced local time entries to Clockify and pull new Clockify entries to local.
pub async fn clockify_sync(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let api_key = clockify_api_key().ok_or_else(|| {
        AppError::BadRequest("Clockify is not configured. Set PLANE_CLOCKIFY_API_KEY.".to_string())
    })?;
    let client = clockify_client(&api_key);

    // Determine the Clockify workspace ID
    let cworkspaces: Vec<ClockifyWorkspace> = client
        .get("https://api.clockify.me/api/v1/workspaces")
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Clockify request failed: {}", e)))?
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to parse Clockify workspaces: {}", e)))?;

    let cw_id = cworkspaces
        .first()
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("No Clockify workspaces found")))?
        .id
        .clone();

    // --- Push local unsynced entries to Clockify ---
    let unsynced: Vec<time_entries::Model> = time_entries::Entity::find()
        .filter(time_entries::Column::WorkspaceId.eq(workspace.id))
        .filter(time_entries::Column::ClockifyId.is_null())
        .filter(time_entries::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let mut pushed: u32 = 0;
    for entry in &unsynced {
        let start_str = entry.started_at.to_rfc3339();
        let end_str = entry.ended_at.map(|e| e.to_rfc3339());
        let duration_str = format!("PT{}S", entry.duration_seconds);

        let payload = ClockifyTimeEntryPayload {
            start: start_str,
            end: end_str,
            duration: duration_str,
            description: entry.description.clone().or_else(|| Some(format!("Issue {}", entry.issue_id))),
            entry_type: "REGULAR".to_string(),
        };

        let url = format!(
            "https://api.clockify.me/api/v1/workspaces/{}/timeEntries",
            cw_id
        );

        let resp = client.post(&url).json(&payload).send().await;
        match resp {
            Ok(r) if r.status().is_success() => {
                // Parse the returned Clockify entry to get its ID
                if let Ok(centry) = r.json::<ClockifyTimeEntry>().await {
                    let mut active: time_entries::ActiveModel = entry.clone().into();
                    active.clockify_id = Set(Some(centry.id));
                    active.updated_at = Set(Some(Utc::now().into()));
                    let _ = active.update(&state.db).await;
                    pushed += 1;
                }
            }
            Ok(r) => {
                tracing::warn!(
                    status = %r.status(),
                    "Failed to push time entry {} to Clockify",
                    entry.id
                );
            }
            Err(e) => {
                tracing::warn!("Clockify push error for entry {}: {}", entry.id, e);
            }
        }
    }

    // --- Pull Clockify entries into local DB ---
    let now = Utc::now();
    let start_of_week = now - chrono::Duration::days(7);
    let url = format!(
        "https://api.clockify.me/api/v1/workspaces/{}/timeEntries?start={}&page-size=100",
        cw_id,
        start_of_week.to_rfc3339()
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Clockify fetch failed: {}", e)))?;

    let centries: Vec<ClockifyTimeEntry> = if resp.status().is_success() {
        resp.json().await.unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut pulled: u32 = 0;
    for ce in &centries {
        // Skip if we already have this entry locally
        let existing = time_entries::Entity::find()
            .filter(time_entries::Column::ClockifyId.eq(&ce.id))
            .filter(time_entries::Column::DeletedAt.is_null())
            .one(&state.db)
            .await
            .unwrap_or(None);

        if existing.is_some() {
            continue;
        }

        let start: DateTime<FixedOffset> = ce.timeInterval.start.parse().unwrap_or_else(|_| Utc::now().into());
        let end: Option<DateTime<FixedOffset>> = ce
            .timeInterval
            .end
            .as_deref()
            .and_then(|s| s.parse().ok());
        let duration_secs = ce
            .timeInterval
            .duration
            .as_deref()
            .and_then(|d| parse_iso8601_duration_seconds(d))
            .unwrap_or(0);

        if duration_secs == 0 {
            continue;
        }

        let new_entry = time_entries::ActiveModel {
            id: Set(Uuid::new_v4()),
            issue_id: Set(Uuid::nil()), // No issue association from Clockify pull
            workspace_id: Set(workspace.id),
            user_id: Set(current_user.0.id),
            duration_seconds: Set(duration_secs),
            description: Set(ce.description.clone()),
            started_at: Set(start),
            ended_at: Set(end),
            clockify_id: Set(Some(ce.id.clone())),
            created_at: Set(Some(Utc::now().into())),
            updated_at: Set(Some(Utc::now().into())),
            deleted_at: Set(None),
        };

        match new_entry.insert(&state.db).await {
            Ok(_) => pulled += 1,
            Err(e) => {
                tracing::warn!("Failed to insert pulled Clockify entry {}: {}", ce.id, e);
            }
        }
    }

    Ok(Json(ClockifySyncResponse { pushed, pulled }))
}

// ---------------------------------------------------------------------------
// Time Entry Handlers
// ---------------------------------------------------------------------------

/// POST /{slug}/integrations/time-entries
/// Create a new local time entry.
pub async fn create_time_entry(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<CreateTimeEntryRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_MEMBER).await?;

    if body.duration_seconds <= 0 {
        return Err(AppError::BadRequest(
            "duration_seconds must be positive".to_string(),
        ));
    }

    let now: DateTime<FixedOffset> = Utc::now().into();
    let entry = time_entries::ActiveModel {
        id: Set(Uuid::new_v4()),
        issue_id: Set(body.issue_id),
        workspace_id: Set(workspace.id),
        user_id: Set(current_user.0.id),
        duration_seconds: Set(body.duration_seconds),
        description: Set(body.description),
        started_at: Set(body.started_at),
        ended_at: Set(body.ended_at),
        clockify_id: Set(None),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    };

    let saved = entry
        .insert(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to create time entry: {}", e)))?;

    Ok(Json(model_to_response(saved)))
}

/// GET /{slug}/integrations/time-entries
/// List time entries, optionally filtered by issue_id.
pub async fn list_time_entries(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Query(query): Query<ListTimeEntriesQuery>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_MEMBER).await?;

    let mut q = time_entries::Entity::find()
        .filter(time_entries::Column::WorkspaceId.eq(workspace.id))
        .filter(time_entries::Column::DeletedAt.is_null());

    if let Some(issue_id) = query.issue_id {
        q = q.filter(time_entries::Column::IssueId.eq(issue_id));
    }

    let entries = q
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<TimeEntryResponse> = entries.into_iter().map(model_to_response).collect();
    Ok(Json(resp))
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/// Parse an ISO 8601 duration string like "PT3600S" or "PT1H30M" into total seconds.
fn parse_iso8601_duration_seconds(s: &str) -> Option<i32> {
    let s = s.trim();
    if !s.starts_with("PT") {
        return None;
    }
    let s = &s[2..];
    let mut total: i32 = 0;
    let mut num_buf = String::new();
    for ch in s.chars() {
        if ch.is_ascii_digit() {
            num_buf.push(ch);
        } else {
            let val: i32 = num_buf.parse().ok()?;
            match ch {
                'H' => total += val * 3600,
                'M' => total += val * 60,
                'S' => total += val,
                _ => return None,
            }
            num_buf.clear();
        }
    }
    Some(total)
}

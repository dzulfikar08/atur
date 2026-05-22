use axum::extract::{Extension, Path, State};
use axum::response::IntoResponse;
use axum::Json;
use chrono::{DateTime, FixedOffset, Utc};
use db::entities::{webhook_deliveries, webhooks};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::middleware::permission::{load_workspace_by_slug, require_workspace_role};
use crate::state::AppState;
use crate::webhook_dispatcher;

// ---------------------------------------------------------------------------
// Role constants
// ---------------------------------------------------------------------------

const ROLE_ADMIN: i16 = 20;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct WebhookResponse {
    pub id: Uuid,
    pub url: String,
    pub secret: Option<String>,
    pub events: Option<serde_json::Value>,
    pub is_active: bool,
    pub workspace_id: Uuid,
    pub project_id: Option<Uuid>,
    pub created_by: Option<Uuid>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<webhooks::Model> for WebhookResponse {
    fn from(m: webhooks::Model) -> Self {
        Self {
            id: m.id,
            url: m.url,
            secret: m.secret,
            events: m.events,
            is_active: m.is_active,
            workspace_id: m.workspace_id,
            project_id: m.project_id,
            created_by: m.created_by,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
            updated_at: m.updated_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct WebhookDeliveryResponse {
    pub id: Uuid,
    pub webhook_id: Uuid,
    pub event: String,
    pub payload: serde_json::Value,
    pub response_status: Option<i32>,
    pub response_body: Option<String>,
    pub delivered_at: Option<String>,
    pub created_at: Option<String>,
}

impl From<webhook_deliveries::Model> for WebhookDeliveryResponse {
    fn from(m: webhook_deliveries::Model) -> Self {
        Self {
            id: m.id,
            webhook_id: m.webhook_id,
            event: m.event,
            payload: m.payload,
            response_status: m.response_status,
            response_body: m.response_body,
            delivered_at: m.delivered_at.map(|dt| dt.to_rfc3339()),
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateWebhookRequest {
    pub url: String,
    pub secret: Option<String>,
    pub events: Vec<String>,
    pub project_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateWebhookRequest {
    pub url: Option<String>,
    pub secret: Option<String>,
    pub events: Option<Vec<String>>,
    pub is_active: Option<bool>,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/workspaces/{slug}/webhooks - List webhooks for workspace
pub async fn list_webhooks(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let webhook_list = webhooks::Entity::find()
        .filter(webhooks::Column::WorkspaceId.eq(workspace.id))
        .filter(webhooks::Column::DeletedAt.is_null())
        .order_by_desc(webhooks::Column::CreatedAt)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<WebhookResponse> = webhook_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/{slug}/webhooks - Create webhook
pub async fn create_webhook(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<CreateWebhookRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    // Validate URL
    validate_webhook_url(&body.url)?;

    // Validate events
    validate_webhook_events(&body.events)?;

    // Use provided secret or generate one
    let secret = body.secret.unwrap_or_else(generate_webhook_secret);
    let events_json = serde_json::json!(body.events);
    let now = Utc::now().fixed_offset();

    let webhook = webhooks::ActiveModel {
        id: Set(Uuid::new_v4()),
        url: Set(body.url),
        secret: Set(Some(secret)),
        events: Set(Some(events_json)),
        is_active: Set(true),
        workspace_id: Set(workspace.id),
        project_id: Set(body.project_id),
        created_by: Set(Some(current_user.0.id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(WebhookResponse::from(webhook)),
    ))
}

/// GET /api/workspaces/{slug}/webhooks/{webhook_id} - Get webhook
pub async fn get_webhook(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, webhook_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let webhook = webhooks::Entity::find()
        .filter(webhooks::Column::Id.eq(webhook_id))
        .filter(webhooks::Column::WorkspaceId.eq(workspace.id))
        .filter(webhooks::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Webhook not found".into()))?;

    Ok(Json(WebhookResponse::from(webhook)))
}

/// PATCH /api/workspaces/{slug}/webhooks/{webhook_id} - Update webhook
pub async fn update_webhook(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, webhook_id)): Path<(String, Uuid)>,
    Json(body): Json<UpdateWebhookRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let webhook = webhooks::Entity::find()
        .filter(webhooks::Column::Id.eq(webhook_id))
        .filter(webhooks::Column::WorkspaceId.eq(workspace.id))
        .filter(webhooks::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Webhook not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: webhooks::ActiveModel = webhook.into();

    if let Some(url) = body.url {
        validate_webhook_url(&url)?;
        active.url = Set(url);
    }

    if let Some(secret) = body.secret {
        active.secret = Set(Some(secret));
    }

    if let Some(events) = body.events {
        validate_webhook_events(&events)?;
        active.events = Set(Some(serde_json::json!(events)));
    }

    if let Some(is_active) = body.is_active {
        active.is_active = Set(is_active);
    }

    active.updated_at = Set(Some(now));

    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(WebhookResponse::from(updated)))
}

/// DELETE /api/workspaces/{slug}/webhooks/{webhook_id} - Soft-delete webhook
pub async fn delete_webhook(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, webhook_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let webhook = webhooks::Entity::find()
        .filter(webhooks::Column::Id.eq(webhook_id))
        .filter(webhooks::Column::WorkspaceId.eq(workspace.id))
        .filter(webhooks::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Webhook not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: webhooks::ActiveModel = webhook.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Webhook deleted" })))
}

/// GET /api/workspaces/{slug}/webhooks/{webhook_id}/deliveries - List delivery history
pub async fn list_deliveries(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, webhook_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    // Verify webhook exists and belongs to this workspace
    let webhook = webhooks::Entity::find()
        .filter(webhooks::Column::Id.eq(webhook_id))
        .filter(webhooks::Column::WorkspaceId.eq(workspace.id))
        .filter(webhooks::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Webhook not found".into()))?;

    let deliveries = webhook_deliveries::Entity::find()
        .filter(webhook_deliveries::Column::WebhookId.eq(webhook.id))
        .order_by_desc(webhook_deliveries::Column::CreatedAt)
        .paginate(&state.db, 50)
        .fetch()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<WebhookDeliveryResponse> =
        deliveries.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

// ---------------------------------------------------------------------------
// GitHub Webhook Handler
// ---------------------------------------------------------------------------

/// POST /api/webhooks/github — Receive GitHub webhooks (no auth, validates webhook secret)
pub async fn github_webhook_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> Result<impl IntoResponse, AppError> {
    // Get the event type
    let event = headers
        .get("X-GitHub-Event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // Get the signature
    let signature = headers
        .get("X-Hub-Signature-256")
        .or_else(|| headers.get("X-Hub-Signature"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // Parse the payload to extract repo info
    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON payload: {}", e)))?;

    let repo_owner = payload
        .get("repository")
        .and_then(|r| r.get("owner"))
        .and_then(|o| o.get("login"))
        .and_then(|l| l.as_str())
        .unwrap_or("")
        .to_string();

    let repo_name = payload
        .get("repository")
        .and_then(|r| r.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();

    if repo_owner.is_empty() || repo_name.is_empty() {
        return Err(AppError::BadRequest("Missing repository information".into()));
    }

    // Find the matching integration
    let integration = db::entities::github_integrations::Entity::find()
        .filter(db::entities::github_integrations::Column::GithubRepoOwner.eq(&repo_owner))
        .filter(db::entities::github_integrations::Column::GithubRepoName.eq(&repo_name))
        .filter(db::entities::github_integrations::Column::SyncEnabled.eq(true))
        .filter(db::entities::github_integrations::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| {
            tracing::warn!(
                repo = %format!("{}/{}", repo_owner, repo_name),
                "No GitHub integration found for webhook"
            );
            AppError::NotFound("No matching GitHub integration".into())
        })?;

    // Verify webhook signature
    if let Some(ref secret) = integration.webhook_secret {
        if !signature.is_empty() && !super::integrations::verify_github_signature(&body, secret, &signature) {
            return Err(AppError::Unauthorized);
        }
    }

    tracing::info!(
        event = %event,
        repo = %format!("{}/{}", repo_owner, repo_name),
        "Received GitHub webhook"
    );

    // Handle events
    match event.as_str() {
        "issues" => {
            handle_github_issue_event(&state, &integration, &payload).await?;
        }
        "pull_request" => {
            handle_github_pr_event(&state, &integration, &payload).await?;
        }
        "ping" => {
            tracing::info!("GitHub ping received for {}/{}", repo_owner, repo_name);
        }
        _ => {
            tracing::debug!(event = %event, "Unhandled GitHub event type");
        }
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

/// Handle GitHub 'issues' webhook events
async fn handle_github_issue_event(
    state: &AppState,
    integration: &db::entities::github_integrations::Model,
    payload: &serde_json::Value,
) -> Result<(), AppError> {
    let action = payload
        .get("action")
        .and_then(|a| a.as_str())
        .unwrap_or("");

    let gh_issue = match payload.get("issue") {
        Some(i) => i,
        None => return Err(AppError::BadRequest("Missing issue in payload".into())),
    };

    let issue_number = gh_issue
        .get("number")
        .and_then(|n| n.as_i64())
        .ok_or_else(|| AppError::BadRequest("Missing issue number".into()))?;

    let title = gh_issue
        .get("title")
        .and_then(|t| t.as_str())
        .unwrap_or("Untitled")
        .to_string();

    let body_text = gh_issue
        .get("body")
        .and_then(|b| b.as_str())
        .map(|s| s.to_string());

    let gh_state = gh_issue
        .get("state")
        .and_then(|s| s.as_str())
        .unwrap_or("open")
        .to_string();

    match action {
        "opened" | "reopened" => {
            // Will be handled by upsert below
        }
        "closed" => {
            // Will be handled by upsert below
        }
        "edited" => {
            // Will be handled by upsert below
        }
        _ => {
            tracing::debug!(action = %action, "Unhandled issues action");
            return Ok(());
        }
    }

    upsert_github_issue(state, integration, issue_number, &title, body_text.as_deref(), &gh_state).await
}

/// Handle GitHub 'pull_request' webhook events
async fn handle_github_pr_event(
    state: &AppState,
    integration: &db::entities::github_integrations::Model,
    payload: &serde_json::Value,
) -> Result<(), AppError> {
    let action = payload
        .get("action")
        .and_then(|a| a.as_str())
        .unwrap_or("");

    let pr = match payload.get("pull_request") {
        Some(p) => p,
        None => return Err(AppError::BadRequest("Missing pull_request in payload".into())),
    };

    let pr_number = pr
        .get("number")
        .and_then(|n| n.as_i64())
        .ok_or_else(|| AppError::BadRequest("Missing PR number".into()))?;

    let title = format!(
        "PR #{}: {}",
        pr_number,
        pr.get("title").and_then(|t| t.as_str()).unwrap_or("Untitled")
    );
    let body_text = pr.get("body").and_then(|b| b.as_str()).map(|s| s.to_string());
    let gh_state = if action == "closed" {
        let merged = pr.get("merged").and_then(|m| m.as_bool()).unwrap_or(false);
        if merged { "closed" } else { "open" }.to_string()
    } else {
        pr.get("state").and_then(|s| s.as_str()).unwrap_or("open").to_string()
    };

    match action {
        "opened" | "synchronize" | "reopened" | "closed" => {
            let external_id = format!("pr-{}", pr_number);
            upsert_github_issue_by_id(state, integration, &external_id, &title, body_text.as_deref(), &gh_state).await?;
        }
        _ => {
            tracing::debug!(action = %action, "Unhandled pull_request action");
        }
    }

    Ok(())
}

/// Upsert a Atur issue from a GitHub issue number.
async fn upsert_github_issue(
    state: &AppState,
    integration: &db::entities::github_integrations::Model,
    issue_number: i64,
    title: &str,
    body: Option<&str>,
    gh_state: &str,
) -> Result<(), AppError> {
    let external_id = format!("{}", issue_number);
    upsert_github_issue_by_id(state, integration, &external_id, title, body, gh_state).await
}

/// Upsert a Atur issue from a GitHub external ID.
async fn upsert_github_issue_by_id(
    state: &AppState,
    integration: &db::entities::github_integrations::Model,
    external_id: &str,
    title: &str,
    body: Option<&str>,
    gh_state: &str,
) -> Result<(), AppError> {
    let external_source = format!(
        "github:{}/{}",
        integration.github_repo_owner, integration.github_repo_name
    );

    // Determine the target project
    let project_id = match integration.project_id {
        Some(pid) => pid,
        None => {
            db::entities::projects::Entity::find()
                .filter(db::entities::projects::Column::WorkspaceId.eq(integration.workspace_id))
                .filter(db::entities::projects::Column::DeletedAt.is_null())
                .order_by_asc(db::entities::projects::Column::CreatedAt)
                .one(&state.db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
                .map(|p| p.id)
                .ok_or_else(|| AppError::NotFound("No project found in workspace".into()))?
        }
    };

    // Find state
    let default_state = db::entities::states::Entity::find()
        .filter(db::entities::states::Column::ProjectId.eq(project_id))
        .filter(db::entities::states::Column::DeletedAt.is_null())
        .order_by_asc(db::entities::states::Column::Sequence)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let state_group = if gh_state == "closed" { "completed" } else { "backlog" };
    let state_id = db::entities::states::Entity::find()
        .filter(db::entities::states::Column::ProjectId.eq(project_id))
        .filter(db::entities::states::Column::Group.eq(state_group))
        .filter(db::entities::states::Column::DeletedAt.is_null())
        .order_by_asc(db::entities::states::Column::Sequence)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .map(|s| s.id)
        .or(default_state.map(|s| s.id));

    // Check if issue exists
    let existing = db::entities::issues::Entity::find()
        .filter(db::entities::issues::Column::WorkspaceId.eq(integration.workspace_id))
        .filter(db::entities::issues::Column::ProjectId.eq(project_id))
        .filter(db::entities::issues::Column::ExternalSource.eq(&external_source))
        .filter(db::entities::issues::Column::ExternalId.eq(external_id))
        .filter(db::entities::issues::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let now: DateTime<FixedOffset> = Utc::now().into();

    if let Some(existing_issue) = existing {
        let mut active: db::entities::issues::ActiveModel = existing_issue.into();
        active.name = Set(title.to_string());
        active.description_html = Set(body.map(|s| s.to_string()));
        active.state_id = Set(state_id);
        active.updated_at = Set(Some(now));
        active.completed_at = Set(if gh_state == "closed" { Some(now) } else { None });
        active
            .update(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;
    } else {
        let max_seq = db::entities::issues::Entity::find()
            .filter(db::entities::issues::Column::ProjectId.eq(project_id))
            .filter(db::entities::issues::Column::DeletedAt.is_null())
            .order_by_desc(db::entities::issues::Column::SequenceId)
            .one(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
            .map(|i| i.sequence_id)
            .unwrap_or(0);

        let new_issue = db::entities::issues::ActiveModel {
            id: Set(Uuid::new_v4()),
            name: Set(title.to_string()),
            sequence_id: Set(max_seq + 1),
            sort_order: Set((max_seq + 1) as f32 * 1000.0),
            priority: Set(None),
            start_date: Set(None),
            target_date: Set(None),
            completed_at: Set(if gh_state == "closed" { Some(now) } else { None }),
            archived_at: Set(None),
            is_draft: Set(false),
            description_json: Set(None),
            description_html: Set(body.map(|s| s.to_string())),
            description_stripped: Set(None),
            description_binary: Set(None),
            parent_id: Set(None),
            state_id: Set(state_id),
            estimate_point_id: Set(None),
            type_id: Set(None),
            project_id: Set(project_id),
            workspace_id: Set(integration.workspace_id),
            created_by_id: Set(integration.created_by),
            external_source: Set(Some(external_source)),
            external_id: Set(Some(external_id.to_string())),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        };

        new_issue
            .insert(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn validate_webhook_url(url: &str) -> Result<(), AppError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::BadRequest(
            "Webhook URL must use http or https scheme".into(),
        ));
    }
    // Basic sanity check: must have something after the scheme
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or("");
    if rest.is_empty() || (!rest.contains('.') && !rest.contains(':') && rest != "localhost") {
        return Err(AppError::BadRequest("Invalid webhook URL".into()));
    }
    Ok(())
}

fn validate_webhook_events(events: &[String]) -> Result<(), AppError> {
    if events.is_empty() {
        return Err(AppError::BadRequest(
            "At least one event must be specified".into(),
        ));
    }
    for event in events {
        if !webhook_dispatcher::VALID_EVENTS.contains(&event.as_str()) {
            return Err(AppError::BadRequest(format!(
                "Invalid event: '{}'. Valid events: {:?}",
                event, webhook_dispatcher::VALID_EVENTS
            )));
        }
    }
    Ok(())
}

fn generate_webhook_secret() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let secret: Vec<u8> = (0..32).map(|_| rng.r#gen::<u8>()).collect();
    secret.iter().map(|b| format!("{:02x}", b)).collect()
}

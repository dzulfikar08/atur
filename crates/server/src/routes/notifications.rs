use axum::extract::{Extension, Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use axum::routing::{get, patch, post};
use chrono::Utc;
use db::entities::{notifications, notification_preferences, users};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct NotificationResponse {
    pub id: Uuid,
    pub data: Option<serde_json::Value>,
    pub entity_identifier: Option<Uuid>,
    pub entity_name: Option<String>,
    pub title: Option<String>,
    pub message: Option<serde_json::Value>,
    pub read_at: Option<String>,
    pub archived_at: Option<String>,
    pub workspace_id: Uuid,
    pub project_id: Option<Uuid>,
    pub triggered_by_id: Option<Uuid>,
    pub receiver_id: Uuid,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<notifications::Model> for NotificationResponse {
    fn from(m: notifications::Model) -> Self {
        Self {
            id: m.id,
            data: m.data,
            entity_identifier: m.entity_identifier,
            entity_name: m.entity_name,
            title: m.title,
            message: m.message,
            read_at: m.read_at.map(|dt| dt.to_rfc3339()),
            archived_at: m.archived_at.map(|dt| dt.to_rfc3339()),
            workspace_id: m.workspace_id,
            project_id: m.project_id,
            triggered_by_id: m.triggered_by_id,
            receiver_id: m.receiver_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
            updated_at: m.updated_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct UnreadCountResponse {
    pub count: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationPreferences {
    pub property_change: bool,
    pub state_change: bool,
    pub comment: bool,
    pub mention: bool,
    pub issue_completed: bool,
}

impl Default for NotificationPreferences {
    fn default() -> Self {
        Self {
            property_change: true,
            state_change: true,
            comment: true,
            mention: true,
            issue_completed: true,
        }
    }
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ListNotificationsQuery {
    pub read: Option<bool>,
    pub page: Option<u64>,
    pub per_page: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNotificationRequest {
    pub read: Option<bool>,
    pub archived: Option<bool>,
    pub snooze_until: Option<String>,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/", get(list_notifications))
        .route("/unread-count/", get(get_unread_count))
        .route("/mark-all-read/", post(mark_all_read))
        .route("/{notification_id}/", patch(update_notification))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/notifications/ - List current user's notifications (paginated)
pub async fn list_notifications(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Query(query): Query<ListNotificationsQuery>,
) -> Result<impl IntoResponse, AppError> {
    let user_id = current_user.0.id;
    let page = query.page.unwrap_or(1);
    let per_page = query.per_page.unwrap_or(20).min(100);

    let mut find_query = notifications::Entity::find()
        .filter(notifications::Column::ReceiverId.eq(user_id))
        .filter(notifications::Column::ArchivedAt.is_null())
        .filter(notifications::Column::DeletedAt.is_null());

    if let Some(read) = query.read {
        if read {
            find_query = find_query.filter(notifications::Column::ReadAt.is_not_null());
        } else {
            find_query = find_query.filter(notifications::Column::ReadAt.is_null());
        }
    }

    let paginator = find_query
        .order_by_desc(notifications::Column::CreatedAt)
        .paginate(&state.db, per_page);

    let total_pages = paginator
        .num_pages()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let items = paginator
        .fetch_page(page.saturating_sub(1))
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let results: Vec<NotificationResponse> = items.into_iter().map(Into::into).collect();

    Ok(Json(serde_json::json!({
        "results": results,
        "total_pages": total_pages,
        "page": page,
        "per_page": per_page,
    })))
}

/// GET /api/notifications/unread-count/ - Count unread notifications
pub async fn get_unread_count(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<impl IntoResponse, AppError> {
    let user_id = current_user.0.id;

    let count = notifications::Entity::find()
        .filter(notifications::Column::ReceiverId.eq(user_id))
        .filter(notifications::Column::ReadAt.is_null())
        .filter(notifications::Column::ArchivedAt.is_null())
        .filter(notifications::Column::DeletedAt.is_null())
        .count(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    Ok(Json(UnreadCountResponse { count }))
}

/// PATCH /api/notifications/{uuid}/ - Mark as read / archive / snooze
pub async fn update_notification(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(notification_id): Path<Uuid>,
    Json(body): Json<UpdateNotificationRequest>,
) -> Result<impl IntoResponse, AppError> {
    let user_id = current_user.0.id;

    let notification = notifications::Entity::find()
        .filter(notifications::Column::Id.eq(notification_id))
        .filter(notifications::Column::ReceiverId.eq(user_id))
        .filter(notifications::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Notification not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: notifications::ActiveModel = notification.into();

    if let Some(read) = body.read {
        if read {
            active.read_at = Set(Some(now));
        } else {
            active.read_at = Set(None);
        }
    }

    if let Some(archived) = body.archived {
        if archived {
            active.archived_at = Set(Some(now));
        } else {
            active.archived_at = Set(None);
        }
    }

    active.updated_at = Set(Some(now));

    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(NotificationResponse::from(updated)))
}

/// POST /api/notifications/mark-all-read/ - Mark all notifications as read
pub async fn mark_all_read(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<impl IntoResponse, AppError> {
    let user_id = current_user.0.id;
    let now = Utc::now().fixed_offset();

    // Find all unread, non-archived notifications for the user
    let unread = notifications::Entity::find()
        .filter(notifications::Column::ReceiverId.eq(user_id))
        .filter(notifications::Column::ReadAt.is_null())
        .filter(notifications::Column::ArchivedAt.is_null())
        .filter(notifications::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let count = unread.len();
    for notification in unread {
        let mut active: notifications::ActiveModel = notification.into();
        active.read_at = Set(Some(now));
        active.updated_at = Set(Some(now));
        active
            .update(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;
    }

    Ok(Json(serde_json::json!({ "marked_count": count })))
}

/// GET /api/users/me/notification-preferences/ - Get notification preferences
pub async fn get_notification_preferences(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
) -> Result<impl IntoResponse, AppError> {
    let user_id = current_user.0.id;

    let existing = notification_preferences::Entity::find()
        .filter(notification_preferences::Column::UserId.eq(user_id))
        .filter(notification_preferences::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    match existing {
        Some(p) => Ok(Json(NotificationPreferences {
            property_change: p.property_change,
            state_change: p.state_change,
            comment: p.comment,
            mention: p.mention,
            issue_completed: p.issue_completed,
        })),
        None => Ok(Json(NotificationPreferences::default())),
    }
}

/// PATCH /api/users/me/notification-preferences/ - Update notification preferences
pub async fn update_notification_preferences(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Json(body): Json<NotificationPreferences>,
) -> Result<impl IntoResponse, AppError> {
    let user_id = current_user.0.id;
    let now = Utc::now().fixed_offset();

    let existing = notification_preferences::Entity::find()
        .filter(notification_preferences::Column::UserId.eq(user_id))
        .filter(notification_preferences::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    if let Some(model) = existing {
        let mut active: notification_preferences::ActiveModel = model.into();
        active.property_change = Set(body.property_change);
        active.state_change = Set(body.state_change);
        active.comment = Set(body.comment);
        active.mention = Set(body.mention);
        active.issue_completed = Set(body.issue_completed);
        active.updated_at = Set(Some(now));
        active
            .update(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;
    } else {
        notification_preferences::ActiveModel {
            id: Set(Uuid::new_v4()),
            user_id: Set(user_id),
            workspace_id: Set(None),
            project_id: Set(None),
            property_change: Set(body.property_change),
            state_change: Set(body.state_change),
            comment: Set(body.comment),
            mention: Set(body.mention),
            issue_completed: Set(body.issue_completed),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        }
        .insert(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;
    }

    Ok(Json(body))
}

// ---------------------------------------------------------------------------
// Email notification dispatch
// ---------------------------------------------------------------------------

/// Attempt to send an email notification for a given in-app notification.
///
/// This function is non-blocking: it spawns a tokio task for the SMTP delivery.
/// It looks up the user's email address and their notification preferences.
/// If email service is not configured or the user has not enabled the relevant
/// preference, the email is silently skipped.
pub fn dispatch_notification_email(
    state: AppState,
    notification: notifications::Model,
    notification_type: NotificationType,
) {
    // Only proceed if email service is configured
    let email_service = match &state.email {
        Some(svc) => svc.clone(),
        None => return,
    };

    tokio::spawn(async move {
        // Look up receiver's email
        let receiver = match users::Entity::find_by_id(notification.receiver_id)
            .one(&state.db)
            .await
        {
            Ok(Some(u)) => u,
            _ => {
                tracing::warn!(
                    user_id = %notification.receiver_id,
                    "Could not find notification receiver for email dispatch"
                );
                return;
            }
        };

        // Skip if user email is not verified or user is inactive
        if !receiver.is_email_verified || !receiver.is_active {
            return;
        }

        // Check user notification preferences
        let prefs = notification_preferences::Entity::find()
            .filter(notification_preferences::Column::UserId.eq(receiver.id))
            .filter(notification_preferences::Column::DeletedAt.is_null())
            .one(&state.db)
            .await
            .ok()
            .flatten();

        let should_email = match prefs {
            Some(ref p) => match notification_type {
                NotificationType::PropertyChange => p.property_change,
                NotificationType::StateChange => p.state_change,
                NotificationType::Comment => p.comment,
                NotificationType::Mention => p.mention,
                NotificationType::IssueCompleted => p.issue_completed,
            },
            None => true, // Default: send if no preferences set
        };

        if !should_email {
            return;
        }

        let display_name = receiver
            .display_name
            .as_deref()
            .unwrap_or(&receiver.username);

        let issue_name = notification
            .entity_name
            .as_deref()
            .unwrap_or("an issue");

        let title = notification
            .title
            .as_deref()
            .unwrap_or("Notification");

        let (subject, body_html, body_text) = match notification_type {
            NotificationType::Mention => crate::email::template_issue_mentioned(
                display_name,
                issue_name,
                "a team member",
                &state.config.server.base_url,
                "workspace",
                "project",
                "0",
            ),
            NotificationType::IssueCompleted | NotificationType::StateChange => {
                crate::email::template_issue_assigned(
                    display_name,
                    &format!("Update: {}", issue_name),
                    None,
                    &state.config.server.base_url,
                    "workspace",
                    "project",
                    "0",
                )
            }
            _ => {
                // Generic notification for property_change and comment
                let body_html = crate::email::html_wrapper(
                    title,
                    &format!(
                        r#"<p>Hello {display_name},</p>
<p>{title}</p>"#,
                        display_name = display_name,
                        title = title,
                    ),
                );
                let body_text = format!(
                    "Hello {},\n\n{}\n",
                    display_name, title
                );
                (title.to_string(), body_html, body_text)
            }
        };

        match email_service
            .send_email(&receiver.email, &subject, &body_html, &body_text)
            .await
        {
            Ok(()) => {
                tracing::info!(
                    user_id = %receiver.id,
                    subject = %subject,
                    "Notification email sent"
                );
            }
            Err(e) => {
                tracing::warn!(
                    user_id = %receiver.id,
                    error = %e,
                    "Failed to send notification email"
                );
            }
        }
    });
}

/// Types of notifications that can trigger an email.
#[derive(Debug, Clone, Copy)]
pub enum NotificationType {
    PropertyChange,
    StateChange,
    Comment,
    Mention,
    IssueCompleted,
}

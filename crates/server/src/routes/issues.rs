use axum::extract::{Extension, Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use axum::routing::{delete, get, patch, post};
use chrono::Utc;
use db::entities::{
    custom_fields, issue_activities, issue_assignees, issue_attachments, issue_comments,
    issue_custom_values, issue_labels, issue_links, issue_reactions, issue_relations,
    issue_sequences, issue_subscribers, issues, states, time_entries,
};
use sea_orm::ActiveValue::Set;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
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
pub struct IssueResponse {
    pub id: Uuid,
    pub name: String,
    pub sequence_id: i64,
    pub sort_order: f32,
    pub priority: Option<String>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub completed_at: Option<String>,
    pub archived_at: Option<String>,
    pub is_draft: bool,
    pub description_json: Option<serde_json::Value>,
    pub description_html: Option<String>,
    pub description_stripped: Option<String>,
    pub parent_id: Option<Uuid>,
    pub state_id: Option<Uuid>,
    pub estimate_point_id: Option<Uuid>,
    pub type_id: Option<Uuid>,
    pub project_id: Uuid,
    pub workspace_id: Uuid,
    pub created_by_id: Option<Uuid>,
    pub external_source: Option<String>,
    pub external_id: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<issues::Model> for IssueResponse {
    fn from(m: issues::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            sequence_id: m.sequence_id,
            sort_order: m.sort_order,
            priority: m.priority,
            start_date: m.start_date,
            target_date: m.target_date,
            completed_at: m.completed_at.map(|dt| dt.to_rfc3339()),
            archived_at: m.archived_at.map(|dt| dt.to_rfc3339()),
            is_draft: m.is_draft,
            description_json: m.description_json,
            description_html: m.description_html,
            description_stripped: m.description_stripped,
            parent_id: m.parent_id,
            state_id: m.state_id,
            estimate_point_id: m.estimate_point_id,
            type_id: m.type_id,
            project_id: m.project_id,
            workspace_id: m.workspace_id,
            created_by_id: m.created_by_id,
            external_source: m.external_source,
            external_id: m.external_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
            updated_at: m.updated_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct IssueAssigneeResponse {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub assignee_id: Uuid,
    pub created_at: Option<String>,
}

impl From<issue_assignees::Model> for IssueAssigneeResponse {
    fn from(m: issue_assignees::Model) -> Self {
        Self {
            id: m.id,
            issue_id: m.issue_id,
            assignee_id: m.assignee_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct IssueLabelResponse {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub label_id: Uuid,
    pub created_at: Option<String>,
}

impl From<issue_labels::Model> for IssueLabelResponse {
    fn from(m: issue_labels::Model) -> Self {
        Self {
            id: m.id,
            issue_id: m.issue_id,
            label_id: m.label_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct IssueCommentResponse {
    pub id: Uuid,
    pub comment_stripped: Option<String>,
    pub comment_json: Option<serde_json::Value>,
    pub comment_html: Option<String>,
    pub access: Option<String>,
    pub parent_id: Option<Uuid>,
    pub issue_id: Uuid,
    pub actor_id: Uuid,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<issue_comments::Model> for IssueCommentResponse {
    fn from(m: issue_comments::Model) -> Self {
        Self {
            id: m.id,
            comment_stripped: m.comment_stripped,
            comment_json: m.comment_json,
            comment_html: m.comment_html,
            access: m.access,
            parent_id: m.parent_id,
            issue_id: m.issue_id,
            actor_id: m.actor_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
            updated_at: m.updated_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct IssueActivityResponse {
    pub id: Uuid,
    pub verb: Option<String>,
    pub field: Option<String>,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub issue_id: Option<Uuid>,
    pub issue_comment_id: Option<Uuid>,
    pub actor_id: Option<Uuid>,
    pub created_at: Option<String>,
}

impl From<issue_activities::Model> for IssueActivityResponse {
    fn from(m: issue_activities::Model) -> Self {
        Self {
            id: m.id,
            verb: m.verb,
            field: m.field,
            old_value: m.old_value,
            new_value: m.new_value,
            issue_id: m.issue_id,
            issue_comment_id: m.issue_comment_id,
            actor_id: m.actor_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct IssueRelationResponse {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub related_issue_id: Uuid,
    pub relation_type: String,
    pub created_at: Option<String>,
}

impl From<issue_relations::Model> for IssueRelationResponse {
    fn from(m: issue_relations::Model) -> Self {
        Self {
            id: m.id,
            issue_id: m.issue_id,
            related_issue_id: m.related_issue_id,
            relation_type: m.relation_type,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct IssueSubscriberResponse {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub subscriber_id: Uuid,
    pub created_at: Option<String>,
}

impl From<issue_subscribers::Model> for IssueSubscriberResponse {
    fn from(m: issue_subscribers::Model) -> Self {
        Self {
            id: m.id,
            issue_id: m.issue_id,
            subscriber_id: m.subscriber_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct IssueLinkResponse {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub title: Option<String>,
    pub url: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: Option<String>,
}

impl From<issue_links::Model> for IssueLinkResponse {
    fn from(m: issue_links::Model) -> Self {
        Self {
            id: m.id,
            issue_id: m.issue_id,
            title: m.title,
            url: m.url,
            metadata: m.metadata,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct IssueAttachmentResponse {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub asset: Option<String>,
    pub attributes: Option<serde_json::Value>,
    pub created_at: Option<String>,
}

impl From<issue_attachments::Model> for IssueAttachmentResponse {
    fn from(m: issue_attachments::Model) -> Self {
        Self {
            id: m.id,
            issue_id: m.issue_id,
            asset: m.asset,
            attributes: m.attributes,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct IssueReactionResponse {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub actor_id: Uuid,
    pub reaction: String,
    pub created_at: Option<String>,
}

impl From<issue_reactions::Model> for IssueReactionResponse {
    fn from(m: issue_reactions::Model) -> Self {
        Self {
            id: m.id,
            issue_id: m.issue_id,
            actor_id: m.actor_id,
            reaction: m.reaction,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateIssueRequest {
    pub name: String,
    pub description_html: Option<String>,
    pub description_json: Option<serde_json::Value>,
    pub priority: Option<String>,
    pub state_id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub assignee_ids: Option<Vec<Uuid>>,
    pub label_ids: Option<Vec<Uuid>>,
    pub estimate_point_id: Option<Uuid>,
    pub sort_order: Option<f32>,
    pub is_draft: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateIssueRequest {
    pub name: Option<String>,
    pub description_html: Option<String>,
    pub description_json: Option<serde_json::Value>,
    pub priority: Option<String>,
    pub state_id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub estimate_point_id: Option<Uuid>,
    pub sort_order: Option<f32>,
    pub is_draft: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AddAssigneesRequest {
    pub user_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct AddLabelsRequest {
    pub label_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCommentRequest {
    pub comment_html: Option<String>,
    pub comment_json: Option<serde_json::Value>,
    pub access: Option<String>,
    pub parent_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCommentRequest {
    pub comment_html: Option<String>,
    pub comment_json: Option<serde_json::Value>,
    pub access: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRelationRequest {
    pub related_issue_id: Uuid,
    pub relation_type: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateLinkRequest {
    pub title: Option<String>,
    pub url: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAttachmentRequest {
    pub asset: Option<String>,
    pub attributes: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct AddReactionRequest {
    pub reaction: String,
}

#[derive(Debug, Deserialize)]
pub struct BulkDeleteIssuesRequest {
    pub issue_ids: Vec<Uuid>,
}

#[derive(Debug, Default, Deserialize)]
pub struct IssueListQuery {
    pub state: Option<Uuid>,
    pub priority: Option<String>,
    pub assignee: Option<Uuid>,
    pub search: Option<String>,
    pub parent: Option<Uuid>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/// Load an issue by project_id + sequence_id (non-deleted).
async fn load_issue_by_seq(
    state: &AppState,
    project_id: Uuid,
    seq_id: i64,
) -> Result<issues::Model, AppError> {
    issues::Entity::find()
        .filter(issues::Column::ProjectId.eq(project_id))
        .filter(issues::Column::SequenceId.eq(seq_id))
        .filter(issues::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Issue not found".into()))
}

/// Create an activity record for a field change.
async fn create_activity(
    db: &sea_orm::DatabaseConnection,
    issue_id: Uuid,
    actor_id: Uuid,
    field: &str,
    old_value: Option<String>,
    new_value: Option<String>,
) -> Result<(), AppError> {
    let now = Utc::now().fixed_offset();
    issue_activities::ActiveModel {
        id: Set(Uuid::new_v4()),
        verb: Set(Some("updated".to_string())),
        field: Set(Some(field.to_string())),
        old_value: Set(old_value),
        new_value: Set(new_value),
        issue_id: Set(Some(issue_id)),
        issue_comment_id: Set(None),
        actor_id: Set(Some(actor_id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Activity insert error: {}", e)))?;
    Ok(())
}

/// Check if a state group is "completed".
async fn is_completed_state(
    db: &sea_orm::DatabaseConnection,
    state_id: Option<Uuid>,
) -> Result<bool, AppError> {
    if let Some(sid) = state_id {
        let state = states::Entity::find_by_id(sid)
            .one(db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
        return Ok(state.is_some_and(|s| s.group == "completed"));
    }
    Ok(false)
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        // Core issue CRUD
        .route("/", get(list_issues).post(create_issue))
        .route(
            "/{seq_id}/",
            get(get_issue).patch(update_issue).delete(delete_issue),
        )
        // Assignees
        .route(
            "/{seq_id}/assignees/",
            get(list_assignees).post(add_assignees),
        )
        .route(
            "/{seq_id}/assignees/{user_id}/",
            delete(remove_assignee),
        )
        // Labels
        .route(
            "/{seq_id}/labels/",
            get(list_issue_labels).post(add_labels),
        )
        .route(
            "/{seq_id}/labels/{label_id}/",
            delete(remove_label),
        )
        // Comments
        .route(
            "/{seq_id}/comments/",
            get(list_comments).post(create_comment),
        )
        .route(
            "/{seq_id}/comments/{comment_id}/",
            patch(update_comment).delete(delete_comment),
        )
        // Activities
        .route(
            "/{seq_id}/activities/",
            get(list_activities),
        )
        // Relations
        .route(
            "/{seq_id}/relations/",
            get(list_relations).post(create_relation),
        )
        .route(
            "/{seq_id}/relations/{relation_id}/",
            delete(delete_relation),
        )
        // Subscribers
        .route(
            "/{seq_id}/subscribers/",
            get(list_subscribers).post(subscribe).delete(unsubscribe),
        )
        // Links
        .route(
            "/{seq_id}/links/",
            get(list_links).post(create_link),
        )
        .route(
            "/{seq_id}/links/{link_id}/",
            delete(delete_link),
        )
        // Attachments
        .route(
            "/{seq_id}/attachments/",
            get(list_attachments).post(create_attachment),
        )
        .route(
            "/{seq_id}/attachments/{attachment_id}/",
            delete(delete_attachment),
        )
        // Reactions
        .route(
            "/{seq_id}/reactions/",
            post(add_reaction),
        )
        .route(
            "/{seq_id}/reactions/{reaction}/",
            delete(remove_reaction),
        )
        // Sub-issues
        .route(
            "/{seq_id}/sub-issues/",
            get(list_sub_issues),
        )
        // Custom field values
        .route(
            "/{seq_id}/custom-values/",
            get(list_custom_values).post(set_custom_values),
        )
        // Time entries
        .route(
            "/{seq_id}/time-entries/",
            get(list_time_entries).post(create_time_entry),
        )
        .route(
            "/{seq_id}/time-entries/{entry_id}/",
            delete(delete_time_entry),
        )
        // Archive
        .route(
            "/{seq_id}/archive/",
            post(archive_issue),
        )
        // Bulk delete
        .route(
            "/../bulk-delete-issues/",
            post(bulk_delete_issues),
        )
}

// Archived issues route (separate since it has a different base path)
pub fn archived_router() -> axum::Router<AppState> {
    axum::Router::new().route("/", get(list_archived_issues))
}

// ---------------------------------------------------------------------------
// Handlers - Core Issue CRUD
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/projects/<uuid>/issues/ - List issues
pub async fn list_issues(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Query(query): Query<IssueListQuery>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let mut condition = sea_orm::Condition::all()
        .add(issues::Column::ProjectId.eq(project_id))
        .add(issues::Column::DeletedAt.is_null())
        .add(issues::Column::ArchivedAt.is_null());

    if let Some(state_filter) = query.state {
        condition = condition.add(issues::Column::StateId.eq(state_filter));
    }
    if let Some(ref priority) = query.priority {
        condition = condition.add(issues::Column::Priority.eq(priority.as_str()));
    }
    if let Some(search) = query.search {
        condition = condition.add(
            sea_orm::Condition::any()
                .add(issues::Column::Name.contains(&search))
                .add(issues::Column::DescriptionStripped.contains(&search)),
        );
    }
    if let Some(parent) = query.parent {
        condition = condition.add(issues::Column::ParentId.eq(parent));
    }

    // Handle assignee filter (requires subquery via join table)
    if let Some(assignee_id) = query.assignee {
        let assigned_issue_ids: Vec<Uuid> = issue_assignees::Entity::find()
            .filter(issue_assignees::Column::AssigneeId.eq(assignee_id))
            .filter(issue_assignees::Column::DeletedAt.is_null())
            .all(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
            .into_iter()
            .map(|a| a.issue_id)
            .collect();

        condition = condition.add(issues::Column::Id.is_in(assigned_issue_ids));
    }

    let query_builder = issues::Entity::find()
        .filter(condition)
        .order_by_asc(issues::Column::SortOrder);

    let limit = query.limit.unwrap_or(20).min(100);
    let offset = query.offset.unwrap_or(0);

    let paginator = query_builder
        .paginate(&state.db, limit);

    let total = paginator
        .num_items()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let issue_list = paginator
        .fetch_page(offset / limit)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<IssueResponse> = issue_list.into_iter().map(Into::into).collect();

    Ok(Json(serde_json::json!({
        "results": resp,
        "total": total,
        "limit": limit,
        "offset": offset,
    })))
}

/// POST /api/workspaces/<slug>/projects/<uuid>/issues/ - Create issue
pub async fn create_issue(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<CreateIssueRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    // Generate sequence_id
    let max_seq = issue_sequences::Entity::find()
        .filter(issue_sequences::Column::ProjectId.eq(project_id))
        .filter(issue_sequences::Column::IsDeleted.eq(false))
        .order_by_desc(issue_sequences::Column::Sequence)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
    let next_seq = max_seq.map(|s| s.sequence + 1).unwrap_or(1);

    // Strip HTML for description_stripped
    let description_stripped = body
        .description_html
        .as_deref()
        .map(strip_html);

    // Find the default state if none provided
    let state_id = match body.state_id {
        Some(sid) => Some(sid),
        None => {
            // Try project's default state
            let default_state = states::Entity::find()
                .filter(states::Column::ProjectId.eq(project_id))
                .filter(states::Column::IsDefault.eq(true))
                .filter(states::Column::DeletedAt.is_null())
                .one(&state.db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
            default_state.map(|s| s.id)
        }
    };

    let now = Utc::now().fixed_offset();
    let issue_id = Uuid::new_v4();

    let issue = issues::ActiveModel {
        id: Set(issue_id),
        name: Set(body.name),
        sequence_id: Set(next_seq),
        sort_order: Set(body.sort_order.unwrap_or(65535.0)),
        priority: Set(body.priority.or(Some("none".to_string()))),
        start_date: Set(body.start_date),
        target_date: Set(body.target_date),
        completed_at: Set(None),
        archived_at: Set(None),
        is_draft: Set(body.is_draft.unwrap_or(false)),
        description_json: Set(body.description_json),
        description_html: Set(body.description_html),
        description_stripped: Set(description_stripped),
        description_binary: Set(None),
        parent_id: Set(body.parent_id),
        state_id: Set(state_id),
        estimate_point_id: Set(body.estimate_point_id),
        type_id: Set(None),
        project_id: Set(project_id),
        workspace_id: Set(workspace.id),
        created_by_id: Set(Some(current_user.0.id)),
        external_source: Set(None),
        external_id: Set(None),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Issue insert error: {}", e)))?;

    // Create sequence record
    issue_sequences::ActiveModel {
        id: Set(Uuid::new_v4()),
        sequence: Set(next_seq),
        issue_id: Set(Some(issue_id)),
        project_id: Set(project_id),
        is_deleted: Set(false),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Sequence insert error: {}", e)))?;

    // Auto-subscribe creator
    issue_subscribers::ActiveModel {
        id: Set(Uuid::new_v4()),
        issue_id: Set(issue_id),
        subscriber_id: Set(current_user.0.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Subscriber insert error: {}", e)))?;

    // Create activity: issue created
    issue_activities::ActiveModel {
        id: Set(Uuid::new_v4()),
        verb: Set(Some("created".to_string())),
        field: Set(None),
        old_value: Set(None),
        new_value: Set(None),
        issue_id: Set(Some(issue_id)),
        issue_comment_id: Set(None),
        actor_id: Set(Some(current_user.0.id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Activity insert error: {}", e)))?;

    // Add assignees
    if let Some(assignee_ids) = body.assignee_ids {
        for assignee_id in assignee_ids {
            issue_assignees::ActiveModel {
                id: Set(Uuid::new_v4()),
                issue_id: Set(issue_id),
                assignee_id: Set(assignee_id),
                created_at: Set(Some(now)),
                updated_at: Set(Some(now)),
                deleted_at: Set(None),
            }
            .insert(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Assignee insert error: {}", e)))?;
        }
    }

    // Add labels
    if let Some(label_ids) = body.label_ids {
        for label_id in label_ids {
            issue_labels::ActiveModel {
                id: Set(Uuid::new_v4()),
                issue_id: Set(issue_id),
                label_id: Set(label_id),
                created_at: Set(Some(now)),
                updated_at: Set(Some(now)),
                deleted_at: Set(None),
            }
            .insert(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Label insert error: {}", e)))?;
        }
    }

    // Index the issue in Tantivy if available
    index_issue(&state, &issue);

    Ok((axum::http::StatusCode::CREATED, Json(IssueResponse::from(issue))))
}

/// GET /api/workspaces/<slug>/projects/<uuid>/issues/<seq_id>/ - Get issue
pub async fn get_issue(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    Ok(Json(IssueResponse::from(issue)))
}

/// PATCH /api/workspaces/<slug>/projects/<uuid>/issues/<seq_id>/ - Update issue
pub async fn update_issue(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Json(body): Json<UpdateIssueRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let now = Utc::now().fixed_offset();
    let mut active: issues::ActiveModel = issue.clone().into();

    // Track state changes
    if let Some(new_state_id) = body.state_id {
        if issue.state_id != Some(new_state_id) {
            let old_state_str = issue
                .state_id
                .map(|id| id.to_string())
                .unwrap_or_default();
            let new_state_str = new_state_id.to_string();

            // Check completed state
            let was_completed = is_completed_state(&state.db, issue.state_id).await?;
            let is_now_completed = is_completed_state(&state.db, Some(new_state_id)).await?;

            if is_now_completed && !was_completed {
                active.completed_at = Set(Some(now));
            } else if !is_now_completed && was_completed {
                active.completed_at = Set(None);
            }

            create_activity(
                &state.db,
                issue.id,
                current_user.0.id,
                "state",
                Some(old_state_str),
                Some(new_state_str),
            )
            .await?;
        }
        active.state_id = Set(Some(new_state_id));
    }

    if let Some(name) = body.name {
        if issue.name != name {
            create_activity(
                &state.db,
                issue.id,
                current_user.0.id,
                "name",
                Some(issue.name.clone()),
                Some(name.clone()),
            )
            .await?;
        }
        active.name = Set(name);
    }

    if let Some(priority) = body.priority {
        if issue.priority.as_deref() != Some(priority.as_str()) {
            create_activity(
                &state.db,
                issue.id,
                current_user.0.id,
                "priority",
                issue.priority.clone(),
                Some(priority.clone()),
            )
            .await?;
        }
        active.priority = Set(Some(priority));
    }

    if let Some(description_html) = body.description_html {
        active.description_html = Set(Some(description_html.clone()));
        active.description_stripped = Set(Some(strip_html(&description_html)));
    }

    if let Some(description_json) = body.description_json {
        active.description_json = Set(Some(description_json));
    }

    if let Some(start_date) = body.start_date {
        active.start_date = Set(Some(start_date));
    }
    if let Some(target_date) = body.target_date {
        active.target_date = Set(Some(target_date));
    }
    if let Some(parent_id) = body.parent_id {
        active.parent_id = Set(Some(parent_id));
    }
    if let Some(estimate_point_id) = body.estimate_point_id {
        active.estimate_point_id = Set(Some(estimate_point_id));
    }
    if let Some(sort_order) = body.sort_order {
        active.sort_order = Set(sort_order);
    }
    if let Some(is_draft) = body.is_draft {
        active.is_draft = Set(is_draft);
    }

    active.updated_at = Set(Some(now));

    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    // Re-index the issue in Tantivy if available
    index_issue(&state, &updated);

    Ok(Json(IssueResponse::from(updated)))
}

/// DELETE /api/workspaces/<slug>/projects/<uuid>/issues/<seq_id>/ - Soft-delete issue
pub async fn delete_issue(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_ADMIN).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    let issue_id = issue.id;

    let now = Utc::now().fixed_offset();
    let mut active: issues::ActiveModel = issue.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    // Remove from Tantivy index if available
    if let Some(ref index) = state.search_index {
        let _ = crate::search_index::remove_entity(index, &issue_id.to_string());
    }

    Ok(Json(serde_json::json!({ "message": "Issue deleted" })))
}

// ---------------------------------------------------------------------------
// Handlers - Assignees
// ---------------------------------------------------------------------------

/// GET .../issues/<seq_id>/assignees/
pub async fn list_assignees(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let assignees = issue_assignees::Entity::find()
        .filter(issue_assignees::Column::IssueId.eq(issue.id))
        .filter(issue_assignees::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<IssueAssigneeResponse> = assignees.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST .../issues/<seq_id>/assignees/
pub async fn add_assignees(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Json(body): Json<AddAssigneesRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    let now = Utc::now().fixed_offset();
    let mut created = Vec::new();

    for user_id in body.user_ids {
        // Check if already assigned
        let existing = issue_assignees::Entity::find()
            .filter(issue_assignees::Column::IssueId.eq(issue.id))
            .filter(issue_assignees::Column::AssigneeId.eq(user_id))
            .filter(issue_assignees::Column::DeletedAt.is_null())
            .one(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

        if existing.is_none() {
            let model = issue_assignees::ActiveModel {
                id: Set(Uuid::new_v4()),
                issue_id: Set(issue.id),
                assignee_id: Set(user_id),
                created_at: Set(Some(now)),
                updated_at: Set(Some(now)),
                deleted_at: Set(None),
            }
            .insert(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Assignee insert error: {}", e)))?;

            create_activity(
                &state.db,
                issue.id,
                current_user.0.id,
                "assignees",
                None,
                Some(user_id.to_string()),
            )
            .await?;

            created.push(IssueAssigneeResponse::from(model));
        }
    }

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

/// DELETE .../issues/<seq_id>/assignees/<user_id>/
pub async fn remove_assignee(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id, user_id)): Path<(String, Uuid, i64, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let assignee = issue_assignees::Entity::find()
        .filter(issue_assignees::Column::IssueId.eq(issue.id))
        .filter(issue_assignees::Column::AssigneeId.eq(user_id))
        .filter(issue_assignees::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Assignee not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: issue_assignees::ActiveModel = assignee.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Assignee removed" })))
}

// ---------------------------------------------------------------------------
// Handlers - Labels
// ---------------------------------------------------------------------------

/// GET .../issues/<seq_id>/labels/
pub async fn list_issue_labels(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let issue_labels_list = issue_labels::Entity::find()
        .filter(issue_labels::Column::IssueId.eq(issue.id))
        .filter(issue_labels::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<IssueLabelResponse> = issue_labels_list.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST .../issues/<seq_id>/labels/
pub async fn add_labels(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Json(body): Json<AddLabelsRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    let now = Utc::now().fixed_offset();
    let mut created = Vec::new();

    for label_id in body.label_ids {
        let existing = issue_labels::Entity::find()
            .filter(issue_labels::Column::IssueId.eq(issue.id))
            .filter(issue_labels::Column::LabelId.eq(label_id))
            .filter(issue_labels::Column::DeletedAt.is_null())
            .one(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

        if existing.is_none() {
            let model = issue_labels::ActiveModel {
                id: Set(Uuid::new_v4()),
                issue_id: Set(issue.id),
                label_id: Set(label_id),
                created_at: Set(Some(now)),
                updated_at: Set(Some(now)),
                deleted_at: Set(None),
            }
            .insert(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Label insert error: {}", e)))?;

            created.push(IssueLabelResponse::from(model));
        }
    }

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

/// DELETE .../issues/<seq_id>/labels/<label_id>/
pub async fn remove_label(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id, label_id)): Path<(String, Uuid, i64, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let issue_label = issue_labels::Entity::find()
        .filter(issue_labels::Column::IssueId.eq(issue.id))
        .filter(issue_labels::Column::LabelId.eq(label_id))
        .filter(issue_labels::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Label not found on issue".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: issue_labels::ActiveModel = issue_label.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Label removed" })))
}

// ---------------------------------------------------------------------------
// Handlers - Comments
// ---------------------------------------------------------------------------

/// GET .../issues/<seq_id>/comments/
pub async fn list_comments(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Query(_pagination): Query<PaginationQuery>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let comments = issue_comments::Entity::find()
        .filter(issue_comments::Column::IssueId.eq(issue.id))
        .filter(issue_comments::Column::DeletedAt.is_null())
        .order_by_asc(issue_comments::Column::CreatedAt)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<IssueCommentResponse> = comments.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST .../issues/<seq_id>/comments/
pub async fn create_comment(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Json(body): Json<CreateCommentRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    let now = Utc::now().fixed_offset();

    let comment_stripped = body.comment_html.as_deref().map(strip_html);

    let comment = issue_comments::ActiveModel {
        id: Set(Uuid::new_v4()),
        comment_stripped: Set(comment_stripped),
        comment_json: Set(body.comment_json),
        comment_html: Set(body.comment_html),
        access: Set(body.access.or(Some("internal".to_string()))),
        parent_id: Set(body.parent_id),
        issue_id: Set(issue.id),
        actor_id: Set(current_user.0.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Comment insert error: {}", e)))?;

    // Create activity: comment created
    issue_activities::ActiveModel {
        id: Set(Uuid::new_v4()),
        verb: Set(Some("commented".to_string())),
        field: Set(None),
        old_value: Set(None),
        new_value: Set(None),
        issue_id: Set(Some(issue.id)),
        issue_comment_id: Set(Some(comment.id)),
        actor_id: Set(Some(current_user.0.id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Activity insert error: {}", e)))?;

    Ok((axum::http::StatusCode::CREATED, Json(IssueCommentResponse::from(comment))))
}

/// PATCH .../issues/<seq_id>/comments/<comment_id>/
pub async fn update_comment(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id, comment_id)): Path<(String, Uuid, i64, Uuid)>,
    Json(body): Json<UpdateCommentRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let _issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let comment = issue_comments::Entity::find()
        .filter(issue_comments::Column::Id.eq(comment_id))
        .filter(issue_comments::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Comment not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: issue_comments::ActiveModel = comment.into();

    if let Some(comment_html) = body.comment_html {
        active.comment_html = Set(Some(comment_html.clone()));
        active.comment_stripped = Set(Some(strip_html(&comment_html)));
    }
    if let Some(comment_json) = body.comment_json {
        active.comment_json = Set(Some(comment_json));
    }
    if let Some(access) = body.access {
        active.access = Set(Some(access));
    }
    active.updated_at = Set(Some(now));

    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(IssueCommentResponse::from(updated)))
}

/// DELETE .../issues/<seq_id>/comments/<comment_id>/
pub async fn delete_comment(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id, comment_id)): Path<(String, Uuid, i64, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let _issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let comment = issue_comments::Entity::find()
        .filter(issue_comments::Column::Id.eq(comment_id))
        .filter(issue_comments::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Comment not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: issue_comments::ActiveModel = comment.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Comment deleted" })))
}

// ---------------------------------------------------------------------------
// Handlers - Activities
// ---------------------------------------------------------------------------

/// GET .../issues/<seq_id>/activities/
pub async fn list_activities(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Query(pagination): Query<PaginationQuery>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let limit = pagination.limit.unwrap_or(20).min(100);
    let offset = pagination.offset.unwrap_or(0);

    let paginator = issue_activities::Entity::find()
        .filter(issue_activities::Column::IssueId.eq(issue.id))
        .filter(issue_activities::Column::DeletedAt.is_null())
        .order_by_desc(issue_activities::Column::CreatedAt)
        .paginate(&state.db, limit);

    let total = paginator
        .num_items()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let activities = paginator
        .fetch_page(offset / limit)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<IssueActivityResponse> = activities.into_iter().map(Into::into).collect();

    Ok(Json(serde_json::json!({
        "results": resp,
        "total": total,
        "limit": limit,
        "offset": offset,
    })))
}

// ---------------------------------------------------------------------------
// Handlers - Relations
// ---------------------------------------------------------------------------

/// GET .../issues/<seq_id>/relations/
pub async fn list_relations(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let relations = issue_relations::Entity::find()
        .filter(issue_relations::Column::IssueId.eq(issue.id))
        .filter(issue_relations::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<IssueRelationResponse> = relations.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST .../issues/<seq_id>/relations/
pub async fn create_relation(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Json(body): Json<CreateRelationRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    let now = Utc::now().fixed_offset();

    // Validate related issue exists
    let _related = issues::Entity::find_by_id(body.related_issue_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Related issue not found".into()))?;

    let relation = issue_relations::ActiveModel {
        id: Set(Uuid::new_v4()),
        issue_id: Set(issue.id),
        related_issue_id: Set(body.related_issue_id),
        relation_type: Set(body.relation_type),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Relation insert error: {}", e)))?;

    Ok((axum::http::StatusCode::CREATED, Json(IssueRelationResponse::from(relation))))
}

/// DELETE .../issues/<seq_id>/relations/<relation_id>/
pub async fn delete_relation(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id, relation_id)): Path<(String, Uuid, i64, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let _issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let relation = issue_relations::Entity::find()
        .filter(issue_relations::Column::Id.eq(relation_id))
        .filter(issue_relations::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Relation not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: issue_relations::ActiveModel = relation.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Relation removed" })))
}

// ---------------------------------------------------------------------------
// Handlers - Subscribers
// ---------------------------------------------------------------------------

/// GET .../issues/<seq_id>/subscribers/
pub async fn list_subscribers(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let subscribers = issue_subscribers::Entity::find()
        .filter(issue_subscribers::Column::IssueId.eq(issue.id))
        .filter(issue_subscribers::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<IssueSubscriberResponse> = subscribers.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST .../issues/<seq_id>/subscribers/
pub async fn subscribe(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    let now = Utc::now().fixed_offset();

    // Check if already subscribed
    let existing = issue_subscribers::Entity::find()
        .filter(issue_subscribers::Column::IssueId.eq(issue.id))
        .filter(issue_subscribers::Column::SubscriberId.eq(current_user.0.id))
        .filter(issue_subscribers::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    if existing.is_some() {
        return Err(AppError::Conflict("Already subscribed".into()));
    }

    let sub = issue_subscribers::ActiveModel {
        id: Set(Uuid::new_v4()),
        issue_id: Set(issue.id),
        subscriber_id: Set(current_user.0.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Subscriber insert error: {}", e)))?;

    Ok((axum::http::StatusCode::CREATED, Json(IssueSubscriberResponse::from(sub))))
}

/// DELETE .../issues/<seq_id>/subscribers/
pub async fn unsubscribe(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let sub = issue_subscribers::Entity::find()
        .filter(issue_subscribers::Column::IssueId.eq(issue.id))
        .filter(issue_subscribers::Column::SubscriberId.eq(current_user.0.id))
        .filter(issue_subscribers::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Subscription not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: issue_subscribers::ActiveModel = sub.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Unsubscribed" })))
}

// ---------------------------------------------------------------------------
// Handlers - Links
// ---------------------------------------------------------------------------

/// GET .../issues/<seq_id>/links/
pub async fn list_links(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let links = issue_links::Entity::find()
        .filter(issue_links::Column::IssueId.eq(issue.id))
        .filter(issue_links::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<IssueLinkResponse> = links.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST .../issues/<seq_id>/links/
pub async fn create_link(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Json(body): Json<CreateLinkRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    let now = Utc::now().fixed_offset();

    let link = issue_links::ActiveModel {
        id: Set(Uuid::new_v4()),
        issue_id: Set(issue.id),
        title: Set(body.title),
        url: Set(body.url),
        metadata: Set(body.metadata),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Link insert error: {}", e)))?;

    Ok((axum::http::StatusCode::CREATED, Json(IssueLinkResponse::from(link))))
}

/// DELETE .../issues/<seq_id>/links/<link_id>/
pub async fn delete_link(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id, link_id)): Path<(String, Uuid, i64, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let _issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let link = issue_links::Entity::find()
        .filter(issue_links::Column::Id.eq(link_id))
        .filter(issue_links::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Link not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: issue_links::ActiveModel = link.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Link deleted" })))
}

// ---------------------------------------------------------------------------
// Handlers - Attachments
// ---------------------------------------------------------------------------

/// GET .../issues/<seq_id>/attachments/
pub async fn list_attachments(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let attachments = issue_attachments::Entity::find()
        .filter(issue_attachments::Column::IssueId.eq(issue.id))
        .filter(issue_attachments::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<IssueAttachmentResponse> = attachments.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST .../issues/<seq_id>/attachments/
pub async fn create_attachment(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Json(body): Json<CreateAttachmentRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    let now = Utc::now().fixed_offset();

    let attachment = issue_attachments::ActiveModel {
        id: Set(Uuid::new_v4()),
        issue_id: Set(issue.id),
        asset: Set(body.asset),
        attributes: Set(body.attributes),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Attachment insert error: {}", e)))?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(IssueAttachmentResponse::from(attachment)),
    ))
}

/// DELETE .../issues/<seq_id>/attachments/<attachment_id>/
pub async fn delete_attachment(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id, attachment_id)): Path<(String, Uuid, i64, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let _issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let attachment = issue_attachments::Entity::find()
        .filter(issue_attachments::Column::Id.eq(attachment_id))
        .filter(issue_attachments::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: issue_attachments::ActiveModel = attachment.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Attachment deleted" })))
}

// ---------------------------------------------------------------------------
// Handlers - Reactions
// ---------------------------------------------------------------------------

/// POST .../issues/<seq_id>/reactions/
pub async fn add_reaction(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Json(body): Json<AddReactionRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    let now = Utc::now().fixed_offset();

    // Check if reaction already exists
    let existing = issue_reactions::Entity::find()
        .filter(issue_reactions::Column::IssueId.eq(issue.id))
        .filter(issue_reactions::Column::ActorId.eq(current_user.0.id))
        .filter(issue_reactions::Column::Reaction.eq(&body.reaction))
        .filter(issue_reactions::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    if existing.is_some() {
        return Err(AppError::Conflict("Reaction already exists".into()));
    }

    let reaction = issue_reactions::ActiveModel {
        id: Set(Uuid::new_v4()),
        issue_id: Set(issue.id),
        actor_id: Set(current_user.0.id),
        reaction: Set(body.reaction),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Reaction insert error: {}", e)))?;

    Ok((axum::http::StatusCode::CREATED, Json(IssueReactionResponse::from(reaction))))
}

/// DELETE .../issues/<seq_id>/reactions/<reaction>/
pub async fn remove_reaction(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id, reaction)): Path<(String, Uuid, i64, String)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let reaction_model = issue_reactions::Entity::find()
        .filter(issue_reactions::Column::IssueId.eq(issue.id))
        .filter(issue_reactions::Column::ActorId.eq(current_user.0.id))
        .filter(issue_reactions::Column::Reaction.eq(&reaction))
        .filter(issue_reactions::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Reaction not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: issue_reactions::ActiveModel = reaction_model.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Reaction removed" })))
}

// ---------------------------------------------------------------------------
// Handlers - Sub-issues
// ---------------------------------------------------------------------------

/// GET .../issues/<seq_id>/sub-issues/
pub async fn list_sub_issues(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let sub_issues = issues::Entity::find()
        .filter(issues::Column::ParentId.eq(issue.id))
        .filter(issues::Column::ProjectId.eq(project_id))
        .filter(issues::Column::DeletedAt.is_null())
        .order_by_asc(issues::Column::SortOrder)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<IssueResponse> = sub_issues.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

// ---------------------------------------------------------------------------
// Handlers - Archive
// ---------------------------------------------------------------------------

/// GET .../archived-issues/
pub async fn list_archived_issues(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let archived = issues::Entity::find()
        .filter(issues::Column::ProjectId.eq(project_id))
        .filter(issues::Column::DeletedAt.is_null())
        .filter(issues::Column::ArchivedAt.is_not_null())
        .order_by_desc(issues::Column::ArchivedAt)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<IssueResponse> = archived.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST .../issues/<seq_id>/archive/
pub async fn archive_issue(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    let now = Utc::now().fixed_offset();

    let mut active: issues::ActiveModel = issue.into();
    active.archived_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(IssueResponse::from(updated)))
}

// ---------------------------------------------------------------------------
// Handlers - Bulk Delete
// ---------------------------------------------------------------------------

/// POST .../bulk-delete-issues/
pub async fn bulk_delete_issues(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<BulkDeleteIssuesRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_ADMIN).await?;

    let now = Utc::now().fixed_offset();
    let mut deleted_count = 0u64;

    for issue_id in body.issue_ids {
        let issue = issues::Entity::find()
            .filter(issues::Column::Id.eq(issue_id))
            .filter(issues::Column::ProjectId.eq(project_id))
            .filter(issues::Column::DeletedAt.is_null())
            .one(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

        if let Some(issue) = issue {
            let mut active: issues::ActiveModel = issue.into();
            active.deleted_at = Set(Some(now));
            active.updated_at = Set(Some(now));
            active
                .update(&state.db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;
            deleted_count += 1;
        }
    }

    Ok(Json(serde_json::json!({
        "message": format!("{} issues deleted", deleted_count),
        "deleted_count": deleted_count,
    })))
}

// ---------------------------------------------------------------------------
// Tantivy index helpers
// ---------------------------------------------------------------------------

/// Index an issue entity in the Tantivy search index (if available).
fn index_issue(state: &AppState, issue: &issues::Model) {
    if let Some(ref index) = state.search_index {
        let description = issue.description_stripped.as_deref().unwrap_or("");
        if let Err(e) = crate::search_index::index_entity(
            index,
            "issue",
            &issue.id.to_string(),
            &issue.workspace_id.to_string(),
            Some(&issue.project_id.to_string()),
            &issue.name,
            description,
            description, // content is the same as description for issues
        ) {
            tracing::warn!(error = %e, issue_id = %issue.id, "Failed to index issue in Tantivy");
        }
    }
}

// ---------------------------------------------------------------------------
// Custom field values
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct CustomFieldValueResponse {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub custom_field_id: Uuid,
    pub value_json: Option<serde_json::Value>,
    pub field_name: String,
    pub field_type: String,
    pub field_settings: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct SetCustomValuesRequest {
    pub values: Vec<CustomValueInput>,
}

#[derive(Debug, Deserialize)]
pub struct CustomValueInput {
    pub custom_field_id: Uuid,
    pub value_json: Option<serde_json::Value>,
}

/// GET /api/workspaces/{slug}/projects/{project_id}/issues/{seq_id}/custom-values/
async fn list_custom_values(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;
    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    // Load field definitions for this project
    let field_defs = custom_fields::Entity::find()
        .filter(custom_fields::Column::ProjectId.eq(project_id))
        .filter(custom_fields::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let field_map: std::collections::HashMap<Uuid, custom_fields::Model> = field_defs
        .iter()
        .map(|f| (f.id, f.clone()))
        .collect();

    // Load values for this issue
    let values = issue_custom_values::Entity::find()
        .filter(issue_custom_values::Column::IssueId.eq(issue.id))
        .filter(issue_custom_values::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<CustomFieldValueResponse> = values
        .into_iter()
        .filter_map(|v| {
            let field = field_map.get(&v.custom_field_id)?;
            Some(CustomFieldValueResponse {
                id: v.id,
                issue_id: v.issue_id,
                custom_field_id: v.custom_field_id,
                value_json: v.value_json,
                field_name: field.name.clone(),
                field_type: field.field_type.clone(),
                field_settings: field.settings.clone(),
            })
        })
        .collect();

    Ok(Json(resp))
}

/// POST /api/workspaces/{slug}/projects/{project_id}/issues/{seq_id}/custom-values/
async fn set_custom_values(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Json(body): Json<SetCustomValuesRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;
    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    // Load field definitions for validation
    let field_defs = custom_fields::Entity::find()
        .filter(custom_fields::Column::ProjectId.eq(project_id))
        .filter(custom_fields::Column::DeletedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let field_map: std::collections::HashMap<Uuid, custom_fields::Model> = field_defs
        .iter()
        .map(|f| (f.id, f.clone()))
        .collect();

    for input in &body.values {
        let field = field_map.get(&input.custom_field_id).ok_or_else(|| {
            AppError::BadRequest(format!(
                "Custom field {} not found in this project",
                input.custom_field_id
            ))
        })?;

        validate_field_value(&field.field_type, field.settings.as_ref(), &input.value_json)?;

        if input.value_json.is_none() || input.value_json.as_ref().map_or(false, |v| v.is_null()) {
            // Clear: soft-delete existing value
            let existing = issue_custom_values::Entity::find()
                .filter(issue_custom_values::Column::IssueId.eq(issue.id))
                .filter(issue_custom_values::Column::CustomFieldId.eq(input.custom_field_id))
                .filter(issue_custom_values::Column::DeletedAt.is_null())
                .one(&state.db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

            if let Some(row) = existing {
                let now = Utc::now().fixed_offset();
                let mut active: issue_custom_values::ActiveModel = row.into();
                active.deleted_at = Set(Some(now));
                active.updated_at = Set(Some(now));
                active.update(&state.db).await.map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
            }
        } else {
            // Upsert: find existing or create new
            let existing = issue_custom_values::Entity::find()
                .filter(issue_custom_values::Column::IssueId.eq(issue.id))
                .filter(issue_custom_values::Column::CustomFieldId.eq(input.custom_field_id))
                .filter(issue_custom_values::Column::DeletedAt.is_null())
                .one(&state.db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

            let now = Utc::now().fixed_offset();
            if let Some(row) = existing {
                let mut active: issue_custom_values::ActiveModel = row.into();
                active.value_json = Set(input.value_json.clone());
                active.updated_at = Set(Some(now));
                active.update(&state.db).await.map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
            } else {
                let new_val = issue_custom_values::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    issue_id: Set(issue.id),
                    custom_field_id: Set(input.custom_field_id),
                    value_json: Set(input.value_json.clone()),
                    created_at: Set(Some(now)),
                    updated_at: Set(Some(now)),
                    deleted_at: Set(None),
                };
                new_val.insert(&state.db).await.map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
            }
        }
    }

    Ok(Json(serde_json::json!({"success": true})))
}

fn validate_field_value(
    field_type: &str,
    settings: Option<&serde_json::Value>,
    value: &Option<serde_json::Value>,
) -> Result<(), AppError> {
    let val = match value {
        None | Some(serde_json::Value::Null) => return Ok(()),
        Some(v) => v,
    };

    match field_type {
        "text" | "url" => {
            if !val.is_string() {
                return Err(AppError::BadRequest(format!("Field type '{}' requires a string value", field_type)));
            }
        }
        "number" => {
            if !val.is_number() {
                return Err(AppError::BadRequest("Field type 'number' requires a numeric value".into()));
            }
        }
        "checkbox" => {
            if !val.is_boolean() {
                return Err(AppError::BadRequest("Field type 'checkbox' requires a boolean value".into()));
            }
        }
        "date" => {
            if let Some(s) = val.as_str() {
                if s.parse::<chrono::NaiveDate>().is_err() {
                    return Err(AppError::BadRequest("Field type 'date' requires YYYY-MM-DD format".into()));
                }
            } else {
                return Err(AppError::BadRequest("Field type 'date' requires a date string".into()));
            }
        }
        "select" => {
            if let Some(s) = val.as_str() {
                if let Some(settings) = settings {
                    if let Some(opts) = settings.get("options").and_then(|o| o.as_array()) {
                        let valid_ids: Vec<&str> = opts.iter().filter_map(|o| o.get("id")?.as_str()).collect();
                        if !valid_ids.contains(&s) {
                            return Err(AppError::BadRequest(format!("Invalid option '{}' for select field", s)));
                        }
                    }
                }
            } else {
                return Err(AppError::BadRequest("Field type 'select' requires a string option id".into()));
            }
        }
        "multi_select" => {
            if let Some(arr) = val.as_array() {
                if let Some(settings) = settings {
                    if let Some(opts) = settings.get("options").and_then(|o| o.as_array()) {
                        let valid_ids: Vec<&str> = opts.iter().filter_map(|o| o.get("id")?.as_str()).collect();
                        for item in arr {
                            if let Some(s) = item.as_str() {
                                if !valid_ids.contains(&s) {
                                    return Err(AppError::BadRequest(format!("Invalid option '{}' for multi_select field", s)));
                                }
                            }
                        }
                    }
                }
            } else {
                return Err(AppError::BadRequest("Field type 'multi_select' requires an array of option ids".into()));
            }
        }
        "user" => {
            if val.is_string() {
                if val.as_str().unwrap().parse::<Uuid>().is_err() {
                    return Err(AppError::BadRequest("Field type 'user' requires a valid UUID".into()));
                }
            } else {
                return Err(AppError::BadRequest("Field type 'user' requires a user UUID string".into()));
            }
        }
        _ => {}
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Time Entries
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct TimeEntryResponse {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub user_id: Uuid,
    pub duration_seconds: i32,
    pub description: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub created_at: Option<String>,
}

impl From<time_entries::Model> for TimeEntryResponse {
    fn from(m: time_entries::Model) -> Self {
        Self {
            id: m.id,
            issue_id: m.issue_id,
            user_id: m.user_id,
            duration_seconds: m.duration_seconds,
            description: m.description,
            started_at: m.started_at.to_rfc3339(),
            ended_at: m.ended_at.map(|dt| dt.to_rfc3339()),
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateTimeEntryRequest {
    pub duration_seconds: i32,
    pub description: Option<String>,
}

/// GET .../issues/<seq_id>/time-entries/
pub async fn list_time_entries(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let entries = time_entries::Entity::find()
        .filter(time_entries::Column::IssueId.eq(issue.id))
        .filter(time_entries::Column::DeletedAt.is_null())
        .order_by_desc(time_entries::Column::CreatedAt)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<TimeEntryResponse> = entries.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST .../issues/<seq_id>/time-entries/
pub async fn create_time_entry(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id)): Path<(String, Uuid, i64)>,
    Json(body): Json<CreateTimeEntryRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let issue = load_issue_by_seq(&state, project_id, seq_id).await?;
    let now = Utc::now().fixed_offset();

    let entry = time_entries::ActiveModel {
        id: Set(Uuid::new_v4()),
        issue_id: Set(issue.id),
        workspace_id: Set(workspace.id),
        user_id: Set(current_user.0.id),
        duration_seconds: Set(body.duration_seconds),
        description: Set(body.description),
        started_at: Set(now),
        ended_at: Set(None),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
        clockify_id: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Time entry insert error: {}", e)))?;

    Ok((axum::http::StatusCode::CREATED, Json(TimeEntryResponse::from(entry))))
}

/// DELETE .../issues/<seq_id>/time-entries/<entry_id>/
pub async fn delete_time_entry(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, seq_id, entry_id)): Path<(String, Uuid, i64, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let _issue = load_issue_by_seq(&state, project_id, seq_id).await?;

    let entry = time_entries::Entity::find_by_id(entry_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Time entry not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: time_entries::ActiveModel = entry.into();
    active.deleted_at = Set(Some(now));
    active.update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Delete error: {}", e)))?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

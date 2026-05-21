use axum::body::Bytes;
use axum::extract::{Extension, Path, State};
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use db::entities::{issue_activities, issue_sequences, issues, states};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};
use sea_orm::QueryOrder;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::middleware::permission::{load_workspace_by_slug, require_project_role};
use crate::state::AppState;

const ROLE_MEMBER: i16 = 15;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ImportSummary {
    pub total: usize,
    pub created: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct JsonIssueImport {
    pub name: String,
    pub description_html: Option<String>,
    pub priority: Option<String>,
    pub state: Option<String>,
    pub assignee_email: Option<String>,
    pub labels: Option<String>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/csv/", axum::routing::post(import_csv))
        .route("/json/", axum::routing::post(import_json))
        .route("/issues", axum::routing::post(import_issues))
        .route("/issues/", axum::routing::post(import_issues))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Get next sequence ID for a project.
async fn next_sequence_id(
    db: &sea_orm::DatabaseConnection,
    project_id: Uuid,
) -> Result<i64, AppError> {
    let max_seq = issue_sequences::Entity::find()
        .filter(issue_sequences::Column::ProjectId.eq(project_id))
        .filter(issue_sequences::Column::IsDeleted.eq(false))
        .order_by_desc(issue_sequences::Column::Sequence)
        .one(db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
    Ok(max_seq.map(|s| s.sequence + 1).unwrap_or(1))
}

/// Find default state for a project.
async fn find_default_state(
    db: &sea_orm::DatabaseConnection,
    project_id: Uuid,
) -> Result<Option<Uuid>, AppError> {
    let state = states::Entity::find()
        .filter(states::Column::ProjectId.eq(project_id))
        .filter(states::Column::IsDefault.eq(true))
        .filter(states::Column::DeletedAt.is_null())
        .one(db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
    Ok(state.map(|s| s.id))
}

/// Find a state by name for a project.
async fn find_state_by_name(
    db: &sea_orm::DatabaseConnection,
    project_id: Uuid,
    name: &str,
) -> Result<Option<Uuid>, AppError> {
    let state = states::Entity::find()
        .filter(states::Column::ProjectId.eq(project_id))
        .filter(states::Column::Name.eq(name))
        .filter(states::Column::DeletedAt.is_null())
        .one(db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
    Ok(state.map(|s| s.id))
}

/// Create a single issue from imported data.
async fn create_imported_issue(
    db: &sea_orm::DatabaseConnection,
    project_id: Uuid,
    workspace_id: Uuid,
    user_id: Uuid,
    name: String,
    description_html: Option<String>,
    priority: Option<String>,
    state_id: Option<Uuid>,
    external_source: &str,
    external_id: String,
    start_date: Option<String>,
    target_date: Option<String>,
) -> Result<(Uuid, i64), AppError> {
    let now = Utc::now().fixed_offset();
    let issue_id = Uuid::new_v4();

    // Get next sequence
    let next_seq = next_sequence_id(db, project_id).await?;

    // Resolve state_id: try provided, then default
    let resolved_state_id = if state_id.is_none() {
        find_default_state(db, project_id).await?
    } else {
        state_id
    };

    // Simple HTML strip
    let description_stripped = description_html.as_deref().map(|html| {
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
    });

    let issue = issues::ActiveModel {
        id: Set(issue_id),
        name: Set(name),
        sequence_id: Set(next_seq),
        sort_order: Set(65535.0),
        priority: Set(priority.or(Some("none".to_string()))),
        start_date: Set(start_date),
        target_date: Set(target_date),
        completed_at: Set(None),
        archived_at: Set(None),
        is_draft: Set(false),
        description_json: Set(None),
        description_html: Set(description_html),
        description_stripped: Set(description_stripped),
        description_binary: Set(None),
        parent_id: Set(None),
        state_id: Set(resolved_state_id),
        estimate_point_id: Set(None),
        type_id: Set(None),
        project_id: Set(project_id),
        workspace_id: Set(workspace_id),
        created_by_id: Set(Some(user_id)),
        external_source: Set(Some(external_source.to_string())),
        external_id: Set(Some(external_id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(db)
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
    .insert(db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Sequence insert error: {}", e)))?;

    // Create activity
    issue_activities::ActiveModel {
        id: Set(Uuid::new_v4()),
        verb: Set(Some("created".to_string())),
        field: Set(None),
        old_value: Set(None),
        new_value: Set(None),
        issue_id: Set(Some(issue_id)),
        issue_comment_id: Set(None),
        actor_id: Set(Some(user_id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Activity insert error: {}", e)))?;

    Ok((issue.id, issue.sequence_id))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// POST /api/workspaces/{slug}/projects/{uuid}/importers/csv/
pub async fn import_csv(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    body: axum::body::Bytes,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let content = body.to_vec();
    let mut reader = csv::Reader::from_reader(content.as_slice());

    let headers = reader
        .headers()
        .map_err(|e| AppError::BadRequest(format!("Failed to read CSV headers: {}", e)))?
        .clone();

    // Find column indices
    let col_name = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("name"));
    let col_desc = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("description"));
    let col_state = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("state"));
    let col_priority = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("priority"));
    let col_start = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("start_date"));
    let col_target = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("target_date"));

    if col_name.is_none() {
        return Err(AppError::BadRequest(
            "CSV must have a 'name' column".to_string(),
        ));
    }
    let col_name = col_name.unwrap();

    let mut total = 0usize;
    let mut created = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for (row_idx, result) in reader.records().enumerate() {
        total += 1;
        match result {
            Ok(record) => {
                let name = record.get(col_name).unwrap_or("").trim().to_string();
                if name.is_empty() {
                    skipped += 1;
                    errors.push(format!("Row {}: empty name, skipped", row_idx + 2));
                    continue;
                }

                let description = col_desc.and_then(|i| record.get(i).map(|v| v.trim().to_string()));
                let state_name = col_state.and_then(|i| record.get(i).map(|v| v.trim().to_string()));
                let priority = col_priority.and_then(|i| record.get(i).map(|v| v.trim().to_string()));
                let start_date = col_start.and_then(|i| record.get(i).map(|v| v.trim().to_string())).filter(|v| !v.is_empty());
                let target_date = col_target.and_then(|i| record.get(i).map(|v| v.trim().to_string())).filter(|v| !v.is_empty());

                // Resolve state_id from state name
                let state_id = if let Some(ref sn) = state_name {
                    if !sn.is_empty() {
                        find_state_by_name(&state.db, project_id, sn).await?
                    } else {
                        None
                    }
                } else {
                    None
                };

                let desc_html = description.filter(|d| !d.is_empty());

                match create_imported_issue(
                    &state.db,
                    project_id,
                    workspace.id,
                    current_user.0.id,
                    name,
                    desc_html,
                    priority.filter(|p| !p.is_empty()),
                    state_id,
                    "csv",
                    format!("row-{}", row_idx + 2),
                    start_date,
                    target_date,
                )
                .await
                {
                    Ok(_) => created += 1,
                    Err(e) => {
                        errors.push(format!("Row {}: {}", row_idx + 2, e));
                        skipped += 1;
                    }
                }
            }
            Err(e) => {
                errors.push(format!("Row {}: CSV parse error: {}", row_idx + 2, e));
                skipped += 1;
            }
        }
    }

    let summary = ImportSummary {
        total,
        created,
        skipped,
        errors,
    };

    Ok(Json(serde_json::json!({
        "total": summary.total,
        "created": summary.created,
        "skipped": summary.skipped,
        "errors": summary.errors,
    })))
}

/// POST /api/workspaces/{slug}/projects/{uuid}/importers/json/
pub async fn import_json(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<Vec<JsonIssueImport>>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let total = body.len();
    let mut created = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for (idx, item) in body.into_iter().enumerate() {
        if item.name.trim().is_empty() {
            skipped += 1;
            errors.push(format!("Item {}: empty name, skipped", idx + 1));
            continue;
        }

        // Resolve state from name
        let state_id = if let Some(ref sn) = item.state {
            if !sn.is_empty() {
                find_state_by_name(&state.db, project_id, sn).await?
            } else {
                None
            }
        } else {
            None
        };

        match create_imported_issue(
            &state.db,
            project_id,
            workspace.id,
            current_user.0.id,
            item.name,
            item.description_html,
            item.priority,
            state_id,
            "json",
            format!("item-{}", idx + 1),
            item.start_date,
            item.target_date,
        )
        .await
        {
            Ok(_) => created += 1,
            Err(e) => {
                errors.push(format!("Item {}: {}", idx + 1, e));
                skipped += 1;
            }
        }
    }

    Ok(Json(serde_json::json!({
        "total": total,
        "created": created,
        "skipped": skipped,
        "errors": errors,
    })))
}

// ---------------------------------------------------------------------------
// Unified multipart import handler
// ---------------------------------------------------------------------------

/// POST /api/workspaces/{slug}/projects/{project_id}/import/issues
/// Accepts multipart upload with a single file field. Detects CSV vs JSON from
/// Content-Type or file extension.
pub async fn import_issues(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    mut multipart: axum::extract::Multipart,
) -> Result<axum::response::Response, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    // Extract the first file field from multipart
    let mut file_data: Option<(String, Bytes, String)> = None; // (filename, bytes, content_type)

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {}", e)))?
    {
        let filename = field
            .file_name()
            .unwrap_or("import")
            .to_string();
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
        let data = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("Failed to read upload: {}", e)))?;

        file_data = Some((filename, data, content_type));
        break; // Only process the first file
    }

    let (filename, data, content_type) = file_data
        .ok_or_else(|| AppError::BadRequest("No file uploaded".to_string()))?;

    // Determine format from content-type or file extension
    let is_csv = content_type.contains("text/csv")
        || content_type.contains("application/csv")
        || filename.to_lowercase().ends_with(".csv");

    if is_csv {
        import_csv_from_bytes(&state, project_id, workspace.id, &current_user, &data).await
    } else {
        import_json_from_bytes(&state, project_id, workspace.id, &current_user, &data).await
    }
}

/// Process CSV bytes and return import summary.
async fn import_csv_from_bytes(
    state: &AppState,
    project_id: Uuid,
    workspace_id: Uuid,
    current_user: &CurrentUser,
    data: &[u8],
) -> Result<axum::response::Response, AppError> {
    let mut reader = csv::Reader::from_reader(data);

    let headers = reader
        .headers()
        .map_err(|e| AppError::BadRequest(format!("Failed to read CSV headers: {}", e)))?
        .clone();

    let col_name = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("name"));
    let col_desc = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("description"));
    let col_state = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("state"));
    let col_priority = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("priority"));
    let col_start = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("start_date"));
    let col_target = headers.iter().position(|h| h.trim().eq_ignore_ascii_case("target_date"));

    if col_name.is_none() {
        return Err(AppError::BadRequest(
            "CSV must have a 'name' column".to_string(),
        ));
    }
    let col_name = col_name.unwrap();

    let mut total = 0usize;
    let mut created = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for (row_idx, result) in reader.records().enumerate() {
        total += 1;
        match result {
            Ok(record) => {
                let name = record.get(col_name).unwrap_or("").trim().to_string();
                if name.is_empty() {
                    skipped += 1;
                    errors.push(format!("Row {}: empty name, skipped", row_idx + 2));
                    continue;
                }

                let description = col_desc.and_then(|i| record.get(i).map(|v| v.trim().to_string()));
                let state_name = col_state.and_then(|i| record.get(i).map(|v| v.trim().to_string()));
                let priority = col_priority.and_then(|i| record.get(i).map(|v| v.trim().to_string()));
                let start_date = col_start.and_then(|i| record.get(i).map(|v| v.trim().to_string())).filter(|v| !v.is_empty());
                let target_date = col_target.and_then(|i| record.get(i).map(|v| v.trim().to_string())).filter(|v| !v.is_empty());

                let state_id = if let Some(ref sn) = state_name {
                    if !sn.is_empty() {
                        find_state_by_name(&state.db, project_id, sn).await?
                    } else {
                        None
                    }
                } else {
                    None
                };

                let desc_html = description.filter(|d| !d.is_empty());

                match create_imported_issue(
                    &state.db,
                    project_id,
                    workspace_id,
                    current_user.0.id,
                    name,
                    desc_html,
                    priority.filter(|p| !p.is_empty()),
                    state_id,
                    "csv",
                    format!("row-{}", row_idx + 2),
                    start_date,
                    target_date,
                )
                .await
                {
                    Ok(_) => created += 1,
                    Err(e) => {
                        errors.push(format!("Row {}: {}", row_idx + 2, e));
                        skipped += 1;
                    }
                }
            }
            Err(e) => {
                errors.push(format!("Row {}: CSV parse error: {}", row_idx + 2, e));
                skipped += 1;
            }
        }
    }

    Ok(Json(serde_json::json!({
        "total": total,
        "created": created,
        "skipped": skipped,
        "errors": errors,
    })).into_response())
}

/// Process JSON bytes and return import summary.
async fn import_json_from_bytes(
    state: &AppState,
    project_id: Uuid,
    workspace_id: Uuid,
    current_user: &CurrentUser,
    data: &[u8],
) -> Result<axum::response::Response, AppError> {
    let body: Vec<JsonIssueImport> = serde_json::from_slice(data)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;

    let total = body.len();
    let mut created = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for (idx, item) in body.into_iter().enumerate() {
        if item.name.trim().is_empty() {
            skipped += 1;
            errors.push(format!("Item {}: empty name, skipped", idx + 1));
            continue;
        }

        let state_id = if let Some(ref sn) = item.state {
            if !sn.is_empty() {
                find_state_by_name(&state.db, project_id, sn).await?
            } else {
                None
            }
        } else {
            None
        };

        match create_imported_issue(
            &state.db,
            project_id,
            workspace_id,
            current_user.0.id,
            item.name,
            item.description_html,
            item.priority,
            state_id,
            "json",
            format!("item-{}", idx + 1),
            item.start_date,
            item.target_date,
        )
        .await
        {
            Ok(_) => created += 1,
            Err(e) => {
                errors.push(format!("Item {}: {}", idx + 1, e));
                skipped += 1;
            }
        }
    }

    Ok(Json(serde_json::json!({
        "total": total,
        "created": created,
        "skipped": skipped,
        "errors": errors,
    })).into_response())
}

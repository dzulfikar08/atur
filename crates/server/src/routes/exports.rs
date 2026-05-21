use axum::extract::{Extension, Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use db::entities::{issue_assignees, issue_labels, issues, states};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::middleware::permission::{load_workspace_by_slug, require_project_role};
use crate::state::AppState;

const ROLE_GUEST: i16 = 5;

#[derive(Debug, Deserialize)]
pub struct ExportQuery {
    pub format: Option<String>,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/", axum::routing::get(export_issues))
        .route("/issues", axum::routing::get(export_issues_unified))
        .route("/issues/", axum::routing::get(export_issues_unified))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Collect assignee display names for a list of issue IDs.
async fn collect_assignee_names(
    db: &sea_orm::DatabaseConnection,
    issue_ids: &[Uuid],
) -> Result<std::collections::HashMap<Uuid, Vec<String>>, AppError> {
    use db::entities::users;
    let mut map: std::collections::HashMap<Uuid, Vec<String>> = std::collections::HashMap::new();

    for &issue_id in issue_ids {
        let assignees = issue_assignees::Entity::find()
            .filter(issue_assignees::Column::IssueId.eq(issue_id))
            .filter(issue_assignees::Column::DeletedAt.is_null())
            .all(db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

        let mut names = Vec::new();
        for a in assignees {
            if let Some(user) = users::Entity::find_by_id(a.assignee_id)
                .one(db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
            {
                names.push(
                    user.display_name
                        .unwrap_or_else(|| user.username.clone()),
                );
            }
        }
        map.insert(issue_id, names);
    }
    Ok(map)
}

/// Collect label names for a list of issue IDs.
async fn collect_label_names(
    db: &sea_orm::DatabaseConnection,
    issue_ids: &[Uuid],
) -> Result<std::collections::HashMap<Uuid, Vec<String>>, AppError> {
    use db::entities::labels;
    let mut map: std::collections::HashMap<Uuid, Vec<String>> = std::collections::HashMap::new();

    for &issue_id in issue_ids {
        let issue_labels_list = issue_labels::Entity::find()
            .filter(issue_labels::Column::IssueId.eq(issue_id))
            .filter(issue_labels::Column::DeletedAt.is_null())
            .all(db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

        let mut names = Vec::new();
        for il in issue_labels_list {
            if let Some(label) = labels::Entity::find_by_id(il.label_id)
                .one(db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
            {
                names.push(label.name);
            }
        }
        map.insert(issue_id, names);
    }
    Ok(map)
}

/// Resolve state name by state_id.
async fn resolve_state_names(
    db: &sea_orm::DatabaseConnection,
    issue_list: &[issues::Model],
) -> Result<std::collections::HashMap<Uuid, String>, AppError> {
    let mut map = std::collections::HashMap::new();
    for issue in issue_list {
        if let Some(sid) = issue.state_id {
            if !map.contains_key(&sid) {
                if let Some(state) = states::Entity::find_by_id(sid)
                    .one(db)
                    .await
                    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
                {
                    map.insert(sid, state.name);
                }
            }
        }
    }
    Ok(map)
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/// GET /api/workspaces/{slug}/projects/{uuid}/export/?format=csv|json
pub async fn export_issues(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Query(query): Query<ExportQuery>,
) -> Result<axum::response::Response, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let format = query.format.unwrap_or_else(|| "json".to_string());

    // Fetch all non-deleted, non-archived issues for the project
    let issue_list = issues::Entity::find()
        .filter(issues::Column::ProjectId.eq(project_id))
        .filter(issues::Column::DeletedAt.is_null())
        .filter(issues::Column::ArchivedAt.is_null())
        .order_by_asc(issues::Column::SequenceId)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let issue_ids: Vec<Uuid> = issue_list.iter().map(|i| i.id).collect();

    // Collect related data
    let assignee_map = collect_assignee_names(&state.db, &issue_ids).await?;
    let label_map = collect_label_names(&state.db, &issue_ids).await?;
    let state_map = resolve_state_names(&state.db, &issue_list).await?;

    match format.as_str() {
        "csv" => export_csv(issue_list, assignee_map, label_map, state_map).await,
        _ => export_json(issue_list, assignee_map, label_map, state_map).await,
    }
}

/// GET /api/workspaces/{slug}/projects/{project_id}/export/issues
/// Format determined by Accept header: text/csv -> CSV, otherwise JSON.
pub async fn export_issues_unified(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    headers: axum::http::HeaderMap,
) -> Result<axum::response::Response, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    // Determine format from Accept header
    let accept_str = headers
        .get(axum::http::header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let format = if accept_str.contains("text/csv") {
        "csv"
    } else {
        "json"
    };

    // Fetch all non-deleted, non-archived issues for the project
    let issue_list = issues::Entity::find()
        .filter(issues::Column::ProjectId.eq(project_id))
        .filter(issues::Column::DeletedAt.is_null())
        .filter(issues::Column::ArchivedAt.is_null())
        .order_by_asc(issues::Column::SequenceId)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let issue_ids: Vec<Uuid> = issue_list.iter().map(|i| i.id).collect();

    // Collect related data
    let assignee_map = collect_assignee_names(&state.db, &issue_ids).await?;
    let label_map = collect_label_names(&state.db, &issue_ids).await?;
    let state_map = resolve_state_names(&state.db, &issue_list).await?;

    match format {
        "csv" => export_csv(issue_list, assignee_map, label_map, state_map).await,
        _ => export_json(issue_list, assignee_map, label_map, state_map).await,
    }
}

async fn export_csv(
    issue_list: Vec<issues::Model>,
    assignee_map: std::collections::HashMap<Uuid, Vec<String>>,
    label_map: std::collections::HashMap<Uuid, Vec<String>>,
    state_map: std::collections::HashMap<Uuid, String>,
) -> Result<axum::response::Response, AppError> {
    let mut wtr = csv::Writer::from_writer(Vec::new());

    // Write header
    wtr.write_record(["ID", "Sequence ID", "Name", "State", "Priority", "Assignees", "Labels", "Start Date", "Target Date", "Created At"])
        .map_err(|e| AppError::Internal(anyhow::anyhow!("CSV write error: {}", e)))?;

    for issue in &issue_list {
        let state_name = issue
            .state_id
            .and_then(|sid| state_map.get(&sid))
            .cloned()
            .unwrap_or_default();

        let assignees = assignee_map
            .get(&issue.id)
            .map(|v| v.join(", "))
            .unwrap_or_default();

        let labels = label_map
            .get(&issue.id)
            .map(|v| v.join(", "))
            .unwrap_or_default();

        wtr.write_record([
            issue.id.to_string(),
            issue.sequence_id.to_string(),
            issue.name.clone(),
            state_name,
            issue.priority.clone().unwrap_or_default(),
            assignees,
            labels,
            issue.start_date.clone().unwrap_or_default(),
            issue.target_date.clone().unwrap_or_default(),
            issue.created_at.map(|dt| dt.to_rfc3339()).unwrap_or_default(),
        ])
        .map_err(|e| AppError::Internal(anyhow::anyhow!("CSV write error: {}", e)))?;
    }

    let csv_bytes = wtr
        .into_inner()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("CSV flush error: {}", e)))?;

    let filename = format!("project-export-{}.csv", chrono::Utc::now().format("%Y%m%d%H%M%S"));

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/csv".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", filename),
            ),
        ],
        csv_bytes,
    )
        .into_response())
}

#[derive(serde::Serialize)]
struct ExportIssueJson {
    id: Uuid,
    sequence_id: i64,
    name: String,
    state: String,
    priority: Option<String>,
    assignees: Vec<String>,
    labels: Vec<String>,
    start_date: Option<String>,
    target_date: Option<String>,
    description_stripped: Option<String>,
    created_at: Option<String>,
}

async fn export_json(
    issue_list: Vec<issues::Model>,
    assignee_map: std::collections::HashMap<Uuid, Vec<String>>,
    label_map: std::collections::HashMap<Uuid, Vec<String>>,
    state_map: std::collections::HashMap<Uuid, String>,
) -> Result<axum::response::Response, AppError> {
    let export: Vec<ExportIssueJson> = issue_list
        .into_iter()
        .map(|issue| {
            let state_name = issue
                .state_id
                .and_then(|sid| state_map.get(&sid))
                .cloned()
                .unwrap_or_default();

            let assignees = assignee_map
                .get(&issue.id)
                .cloned()
                .unwrap_or_default();

            let labels = label_map
                .get(&issue.id)
                .cloned()
                .unwrap_or_default();

            ExportIssueJson {
                id: issue.id,
                sequence_id: issue.sequence_id,
                name: issue.name,
                state: state_name,
                priority: issue.priority,
                assignees,
                labels,
                start_date: issue.start_date,
                target_date: issue.target_date,
                description_stripped: issue.description_stripped,
                created_at: issue.created_at.map(|dt| dt.to_rfc3339()),
            }
        })
        .collect();

    Ok(Json(export).into_response())
}

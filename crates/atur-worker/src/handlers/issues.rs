use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use worker::{send, wasm_bindgen};

use crate::auth;
use crate::error::AppError;
use crate::handlers::now_iso;
use crate::handlers::users::require_user;
use crate::state::AppState;

async fn get_db(state: &AppState) -> Result<worker::d1::D1Database, AppError> {
    state.env.d1("DB").map_err(|e| AppError::Internal(e.to_string()))
}

#[derive(Deserialize)]
pub struct CreateIssueReq {
    pub name: String,
    pub description_html: Option<String>,
    pub priority: Option<String>,
    pub state_id: Option<String>,
    pub assignee_ids: Option<Vec<String>>,
    pub label_ids: Option<Vec<String>>,
    pub parent_id: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateIssueReq {
    pub name: Option<String>,
    pub description_html: Option<String>,
    pub priority: Option<String>,
    pub state_id: Option<String>,
}

#[derive(Deserialize)]
pub struct ListIssuesQuery {
    pub state: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Deserialize)]
pub struct CreateCommentReq {
    pub comment_html: Option<String>,
    pub comment_stripped: Option<String>,
}

async fn get_next_sequence(db: &worker::d1::D1Database, project_id: &str) -> Result<i64, AppError> {
    let result = db
        .prepare("SELECT COALESCE(MAX(sequence_id), 0) + 1 AS next_seq FROM issues WHERE project_id = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(project_id)])?
        .first::<serde_json::Value>(None)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(result
        .and_then(|v| v.get("next_seq").and_then(|c| c.as_i64()))
        .unwrap_or(1))
}

#[send]
pub async fn list_issues(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
    Query(query): Query<ListIssuesQuery>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let limit = query.limit.unwrap_or(50).min(100);
    let offset = query.offset.unwrap_or(0);

    let (sql, binds) = if let Some(state_id) = &query.state {
        let sql = format!(
            "SELECT * FROM issues WHERE project_id = ?1 AND state_id = ?2 AND deleted_at IS NULL ORDER BY sort_order ASC LIMIT ?3 OFFSET ?4"
        );
        (sql, vec![
            wasm_bindgen::JsValue::from(&project_id),
            wasm_bindgen::JsValue::from(state_id),
            wasm_bindgen::JsValue::from_f64(limit as f64),
            wasm_bindgen::JsValue::from_f64(offset as f64),
        ])
    } else {
        let sql = format!(
            "SELECT * FROM issues WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
        );
        (sql, vec![
            wasm_bindgen::JsValue::from(&project_id),
            wasm_bindgen::JsValue::from_f64(limit as f64),
            wasm_bindgen::JsValue::from_f64(offset as f64),
        ])
    };

    let query = db.prepare(&sql);
    let query = query.bind(&binds)?;
    let results = query.all().await?;
    let issues: Vec<serde_json::Value> = results.results()?;

    let total: i64 = db
        .prepare("SELECT COUNT(*) AS c FROM issues WHERE project_id = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&project_id)])?
        .first::<serde_json::Value>(None)
        .await?
        .and_then(|v| v.get("c").and_then(|c| c.as_i64()))
        .unwrap_or(0);

    Ok(Json(json!({"results": issues, "total": total})).into_response())
}

#[send]
pub async fn create_issue(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
    Json(body): Json<CreateIssueReq>,
) -> Result<Response, AppError> {
    let user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let user_id = user["id"].as_str().unwrap_or("");

    let issue_id = auth::generate_uuid_v4();
    let now = now_iso();
    let sequence_id = get_next_sequence(&db, &project_id).await?;

    let state_id = body.state_id.as_deref().unwrap_or("");
    let state_id_bind: wasm_bindgen::JsValue = if state_id.is_empty() {
        wasm_bindgen::JsValue::NULL
    } else {
        wasm_bindgen::JsValue::from(state_id)
    };

    let parent_id_bind: wasm_bindgen::JsValue = match &body.parent_id {
        Some(id) if !id.is_empty() => wasm_bindgen::JsValue::from(id.as_str()),
        _ => wasm_bindgen::JsValue::NULL,
    };

    db.prepare(
        "INSERT INTO issues (id, name, description_html, priority, sequence_id, state_id, project_id, workspace_id, created_by_id, parent_id, sort_order, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT workspace_id FROM projects WHERE id = ?7), ?8, ?9, 65535.0, ?10, ?10)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&issue_id),
            wasm_bindgen::JsValue::from(&body.name),
            wasm_bindgen::JsValue::from(body.description_html.unwrap_or_default()),
            wasm_bindgen::JsValue::from(body.priority.as_deref().unwrap_or("none")),
            wasm_bindgen::JsValue::from_f64(sequence_id as f64),
            state_id_bind,
            wasm_bindgen::JsValue::from(&project_id),
            wasm_bindgen::JsValue::from(user_id),
            parent_id_bind,
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    if let Some(assignee_ids) = &body.assignee_ids {
        for assignee_id in assignee_ids {
            let rel_id = auth::generate_uuid_v4();
            let _ = db.prepare(
                "INSERT INTO issue_assignees (id, issue_id, assignee_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)"
            )
                .bind(&[
                    wasm_bindgen::JsValue::from(&rel_id),
                    wasm_bindgen::JsValue::from(&issue_id),
                    wasm_bindgen::JsValue::from(assignee_id),
                    wasm_bindgen::JsValue::from(&now),
                ])?
                .run()
                .await;
        }
    }

    if let Some(label_ids) = &body.label_ids {
        for label_id in label_ids {
            let rel_id = auth::generate_uuid_v4();
            let _ = db.prepare(
                "INSERT INTO issue_labels (id, issue_id, label_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)"
            )
                .bind(&[
                    wasm_bindgen::JsValue::from(&rel_id),
                    wasm_bindgen::JsValue::from(&issue_id),
                    wasm_bindgen::JsValue::from(label_id),
                    wasm_bindgen::JsValue::from(&now),
                ])?
                .run()
                .await;
        }
    }

    let created = db
        .prepare("SELECT * FROM issues WHERE id = ?1")
        .bind(&[wasm_bindgen::JsValue::from(&issue_id)])?
        .first::<serde_json::Value>(None)
        .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(created),
    ).into_response())
}

#[send]
pub async fn get_issue(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, issue_id)): Path<(String, String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let issue = db
        .prepare("SELECT * FROM issues WHERE id = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&issue_id)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::NotFound("Issue not found".into()))?;

    let assignees = db
        .prepare("SELECT u.id, u.email, u.username, u.display_name, u.avatar FROM issue_assignees ia INNER JOIN users u ON u.id = ia.assignee_id WHERE ia.issue_id = ?1 AND ia.deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&issue_id)])?
        .all()
        .await?;
    let assignees: Vec<serde_json::Value> = assignees.results()?;

    let labels = db
        .prepare("SELECT l.* FROM issue_labels il INNER JOIN labels l ON l.id = il.label_id WHERE il.issue_id = ?1 AND il.deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&issue_id)])?
        .all()
        .await?;
    let labels: Vec<serde_json::Value> = labels.results()?;

    let mut result = issue;
    if let Some(obj) = result.as_object_mut() {
        obj.insert("assignees".into(), json!(assignees));
        obj.insert("labels".into(), json!(labels));
    }

    Ok(Json(result).into_response())
}

#[send]
pub async fn update_issue(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, issue_id)): Path<(String, String, String)>,
    Json(body): Json<UpdateIssueReq>,
) -> Result<Response, AppError> {
    let user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let user_id = user["id"].as_str().unwrap_or("");
    let now = now_iso();

    if let Some(name) = &body.name {
        db.prepare("UPDATE issues SET name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(name),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&issue_id),
            ])?
            .run()
            .await?;
    }
    if let Some(desc) = &body.description_html {
        db.prepare("UPDATE issues SET description_html = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(desc),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&issue_id),
            ])?
            .run()
            .await?;
    }
    if let Some(priority) = &body.priority {
        db.prepare("UPDATE issues SET priority = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(priority),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&issue_id),
            ])?
            .run()
            .await?;
    }
    if let Some(state_id) = &body.state_id {
        db.prepare("UPDATE issues SET state_id = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(state_id),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&issue_id),
            ])?
            .run()
            .await?;

        let activity_id = auth::generate_uuid_v4();
        let _ = db.prepare(
            "INSERT INTO issue_activities (id, verb, field, new_value, issue_id, actor_id, created_at, updated_at) VALUES (?1, 'updated', 'state', ?2, ?3, ?4, ?5, ?5)"
        )
            .bind(&[
                wasm_bindgen::JsValue::from(&activity_id),
                wasm_bindgen::JsValue::from(state_id),
                wasm_bindgen::JsValue::from(&issue_id),
                wasm_bindgen::JsValue::from(user_id),
                wasm_bindgen::JsValue::from(&now),
            ])?
            .run()
            .await;
    }

    let updated = db
        .prepare("SELECT * FROM issues WHERE id = ?1")
        .bind(&[wasm_bindgen::JsValue::from(&issue_id)])?
        .first::<serde_json::Value>(None)
        .await?;

    Ok(Json(updated).into_response())
}

#[send]
pub async fn delete_issue(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, issue_id)): Path<(String, String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    db.prepare("UPDATE issues SET deleted_at = ?1 WHERE id = ?2")
        .bind(&[
            wasm_bindgen::JsValue::from(&now),
            wasm_bindgen::JsValue::from(&issue_id),
        ])?
        .run()
        .await?;

    Ok(Json(json!({"message": "Issue deleted"})).into_response())
}

#[send]
pub async fn list_comments(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, issue_id)): Path<(String, String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let results = db
        .prepare("SELECT * FROM issue_comments WHERE issue_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC")
        .bind(&[wasm_bindgen::JsValue::from(&issue_id)])?
        .all()
        .await?;
    let comments: Vec<serde_json::Value> = results.results()?;
    Ok(Json(json!({"results": comments})).into_response())
}

#[send]
pub async fn create_comment(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, issue_id)): Path<(String, String, String)>,
    Json(body): Json<CreateCommentReq>,
) -> Result<Response, AppError> {
    let user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let user_id = user["id"].as_str().unwrap_or("");
    let comment_id = auth::generate_uuid_v4();
    let now = now_iso();

    db.prepare(
        "INSERT INTO issue_comments (id, comment_html, comment_stripped, issue_id, actor_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&comment_id),
            wasm_bindgen::JsValue::from(body.comment_html.unwrap_or_default()),
            wasm_bindgen::JsValue::from(body.comment_stripped.unwrap_or_default()),
            wasm_bindgen::JsValue::from(&issue_id),
            wasm_bindgen::JsValue::from(user_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    let comment = db
        .prepare("SELECT * FROM issue_comments WHERE id = ?1")
        .bind(&[wasm_bindgen::JsValue::from(&comment_id)])?
        .first::<serde_json::Value>(None)
        .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(comment),
    ).into_response())
}

#[send]
pub async fn list_activities(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, issue_id)): Path<(String, String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let results = db
        .prepare("SELECT * FROM issue_activities WHERE issue_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50")
        .bind(&[wasm_bindgen::JsValue::from(&issue_id)])?
        .all()
        .await?;
    let activities: Vec<serde_json::Value> = results.results()?;
    Ok(Json(json!({"results": activities})).into_response())
}

#[send]
pub async fn search_issues(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
    Query(query): Query<serde_json::Value>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let search = query.get("query").and_then(|v| v.as_str()).unwrap_or("");
    let pattern = format!("%{}%", search);

    let results = db
        .prepare("SELECT * FROM issues WHERE project_id = ?1 AND deleted_at IS NULL AND (name LIKE ?2 OR description_html LIKE ?2) ORDER BY created_at DESC LIMIT 20")
        .bind(&[
            wasm_bindgen::JsValue::from(&project_id),
            wasm_bindgen::JsValue::from(&pattern),
        ])?
        .all()
        .await?;
    let issues: Vec<serde_json::Value> = results.results()?;
    Ok(Json(json!({"results": issues})).into_response())
}

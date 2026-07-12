use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use worker::{send, wasm_bindgen};

use crate::error::AppError;
use crate::handlers::users::require_user;
use crate::state::AppState;

async fn get_db(state: &AppState) -> Result<worker::d1::D1Database, AppError> {
    state.env.d1("DB").map_err(|e| AppError::Internal(e.to_string()))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub query: Option<String>,
}

#[send]
pub async fn search_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(slug): Path<String>,
    Query(params): Query<SearchQuery>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let ws = db
        .prepare("SELECT id FROM workspaces WHERE slug = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&slug)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::NotFound("Workspace not found".into()))?;
    let ws_id = ws["id"].as_str().unwrap_or("");

    let search = params.query.as_deref().unwrap_or("");
    let pattern = format!("%{}%", search);

    let issues = db
        .prepare("SELECT id, name, 'issue' as entity_type, sequence_id FROM issues WHERE workspace_id = ?1 AND deleted_at IS NULL AND name LIKE ?2 ORDER BY created_at DESC LIMIT 10")
        .bind(&[
            wasm_bindgen::JsValue::from_str(ws_id),
            wasm_bindgen::JsValue::from(&pattern),
        ])?
        .all()
        .await?;
    let issue_results: Vec<serde_json::Value> = issues.results()?;

    let pages = db
        .prepare("SELECT id, name, 'page' as entity_type FROM pages WHERE workspace_id = ?1 AND deleted_at IS NULL AND name LIKE ?2 ORDER BY created_at DESC LIMIT 10")
        .bind(&[
            wasm_bindgen::JsValue::from_str(ws_id),
            wasm_bindgen::JsValue::from(&pattern),
        ])?
        .all()
        .await?;
    let page_results: Vec<serde_json::Value> = pages.results()?;

    let projects = db
        .prepare("SELECT id, name, 'project' as entity_type, identifier FROM projects WHERE workspace_id = ?1 AND deleted_at IS NULL AND name LIKE ?2 ORDER BY created_at DESC LIMIT 10")
        .bind(&[
            wasm_bindgen::JsValue::from_str(ws_id),
            wasm_bindgen::JsValue::from(&pattern),
        ])?
        .all()
        .await?;
    let project_results: Vec<serde_json::Value> = projects.results()?;

    let mut all_results = Vec::new();
    all_results.extend(issue_results);
    all_results.extend(page_results);
    all_results.extend(project_results);

    Ok(Json(json!({"results": all_results})).into_response())
}

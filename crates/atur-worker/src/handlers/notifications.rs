use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use worker::{send, wasm_bindgen};

use crate::error::AppError;
use crate::handlers::now_iso;
use crate::handlers::users::require_user;
use crate::state::AppState;

async fn get_db(state: &AppState) -> Result<worker::d1::D1Database, AppError> {
    state.env.d1("DB").map_err(|e| AppError::Internal(e.to_string()))
}

#[send]
pub async fn list_notifications(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(slug): Path<String>,
) -> Result<Response, AppError> {
    let user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let user_id = user["id"].as_str().unwrap_or("");

    let ws = db
        .prepare("SELECT id FROM workspaces WHERE slug = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&slug)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::NotFound("Workspace not found".into()))?;
    let ws_id = ws["id"].as_str().unwrap_or("");

    let results = db
        .prepare("SELECT * FROM notifications WHERE receiver_id = ?1 AND workspace_id = ?2 AND deleted_at IS NULL AND archived_at IS NULL ORDER BY created_at DESC LIMIT 50")
        .bind(&[
            wasm_bindgen::JsValue::from(user_id),
            wasm_bindgen::JsValue::from_str(ws_id),
        ])?
        .all()
        .await?;
    let notifications: Vec<serde_json::Value> = results.results()?;
    Ok(Json(json!({"results": notifications})).into_response())
}

#[send]
pub async fn mark_read(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(_slug): Path<String>,
) -> Result<Response, AppError> {
    let user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let user_id = user["id"].as_str().unwrap_or("");
    let now = now_iso();

    db.prepare("UPDATE notifications SET read_at = ?1 WHERE receiver_id = ?2 AND read_at IS NULL AND deleted_at IS NULL")
        .bind(&[
            wasm_bindgen::JsValue::from(&now),
            wasm_bindgen::JsValue::from(user_id),
        ])?
        .run()
        .await?;

    Ok(Json(json!({"message": "Notifications marked as read"})).into_response())
}

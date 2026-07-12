use axum::extract::{Path, State};
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
pub struct CreateLabelReq {
    pub name: String,
    pub color: Option<String>,
}

#[send]
pub async fn list_labels(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(slug): Path<String>,
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

    let results = db
        .prepare("SELECT * FROM labels WHERE workspace_id = ?1 AND deleted_at IS NULL ORDER BY sort_order ASC")
        .bind(&[wasm_bindgen::JsValue::from_str(ws_id)])?
        .all()
        .await?;
    let labels: Vec<serde_json::Value> = results.results()?;
    Ok(Json(json!({"results": labels})).into_response())
}

#[send]
pub async fn create_label(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(slug): Path<String>,
    Json(body): Json<CreateLabelReq>,
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

    let label_id = auth::generate_uuid_v4();
    let now = now_iso();

    db.prepare(
        "INSERT INTO labels (id, name, color, sort_order, workspace_id, created_at, updated_at) VALUES (?1, ?2, ?3, 65535.0, ?4, ?5, ?5)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&label_id),
            wasm_bindgen::JsValue::from(&body.name),
            wasm_bindgen::JsValue::from(body.color.unwrap_or_else(|| "#808080".into())),
            wasm_bindgen::JsValue::from_str(ws_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({"id": label_id, "name": body.name})),
    ).into_response())
}

#[send]
pub async fn update_label(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, label_id)): Path<(String, String)>,
    Json(body): Json<CreateLabelReq>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    db.prepare("UPDATE labels SET name = ?1, color = ?2, updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL")
        .bind(&[
            wasm_bindgen::JsValue::from(&body.name),
            wasm_bindgen::JsValue::from(body.color.unwrap_or_else(|| "#808080".into())),
            wasm_bindgen::JsValue::from(&now),
            wasm_bindgen::JsValue::from(&label_id),
        ])?
        .run()
        .await?;

    Ok(Json(json!({"message": "Label updated"})).into_response())
}

#[send]
pub async fn delete_label(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, label_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    db.prepare("UPDATE labels SET deleted_at = ?1 WHERE id = ?2")
        .bind(&[
            wasm_bindgen::JsValue::from(&now),
            wasm_bindgen::JsValue::from(&label_id),
        ])?
        .run()
        .await?;

    Ok(Json(json!({"message": "Label deleted"})).into_response())
}

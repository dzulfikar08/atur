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
pub struct CreateStateReq {
    pub name: String,
    pub color: Option<String>,
    #[serde(alias = "group")]
    pub group_name: String,
}

#[derive(Deserialize)]
pub struct UpdateStateReq {
    pub name: Option<String>,
    pub color: Option<String>,
    #[serde(alias = "group")]
    pub group_name: Option<String>,
}

#[send]
pub async fn list_states(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let results = db
        .prepare("SELECT * FROM states WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY sequence ASC")
        .bind(&[wasm_bindgen::JsValue::from(&project_id)])?
        .all()
        .await?;
    let states: Vec<serde_json::Value> = results.results()?;
    Ok(Json(json!({"results": states})).into_response())
}

#[send]
pub async fn create_state(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
    Json(body): Json<CreateStateReq>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let ws = db
        .prepare("SELECT workspace_id FROM projects WHERE id = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&project_id)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::NotFound("Project not found".into()))?;
    let ws_id = ws["workspace_id"].as_str().unwrap_or("");

    let state_id = auth::generate_uuid_v4();
    let now = now_iso();
    let slug = body.name.to_lowercase().replace(' ', "-");

    db.prepare(
        "INSERT INTO states (id, name, color, slug, sequence, group_name, project_id, workspace_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 65535.0, ?5, ?6, ?7, ?8, ?8)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&state_id),
            wasm_bindgen::JsValue::from(&body.name),
            wasm_bindgen::JsValue::from(body.color.unwrap_or_else(|| "#808080".into())),
            wasm_bindgen::JsValue::from(&slug),
            wasm_bindgen::JsValue::from(&body.group_name),
            wasm_bindgen::JsValue::from(&project_id),
            wasm_bindgen::JsValue::from_str(ws_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({"id": state_id, "name": body.name, "group": body.group_name})),
    ).into_response())
}

#[send]
pub async fn update_state(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, state_id)): Path<(String, String, String)>,
    Json(body): Json<UpdateStateReq>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    if let Some(name) = &body.name {
        db.prepare("UPDATE states SET name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(name),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&state_id),
            ])?
            .run()
            .await?;
    }
    if let Some(color) = &body.color {
        db.prepare("UPDATE states SET color = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(color),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&state_id),
            ])?
            .run()
            .await?;
    }
    if let Some(group_name) = &body.group_name {
        db.prepare("UPDATE states SET group_name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(group_name),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&state_id),
            ])?
            .run()
            .await?;
    }

    Ok(Json(json!({"message": "State updated"})).into_response())
}

#[send]
pub async fn delete_state(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, state_id)): Path<(String, String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    db.prepare("UPDATE states SET deleted_at = ?1 WHERE id = ?2")
        .bind(&[
            wasm_bindgen::JsValue::from(&now),
            wasm_bindgen::JsValue::from(&state_id),
        ])?
        .run()
        .await?;

    Ok(Json(json!({"message": "State deleted"})).into_response())
}

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
pub struct CreateCycleReq {
    pub name: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateCycleReq {
    pub name: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[send]
pub async fn list_cycles(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let results = db
        .prepare("SELECT * FROM cycles WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY sort_order ASC")
        .bind(&[wasm_bindgen::JsValue::from(&project_id)])?
        .all()
        .await?;
    let cycles: Vec<serde_json::Value> = results.results()?;
    Ok(Json(json!({"results": cycles})).into_response())
}

#[send]
pub async fn create_cycle(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
    Json(body): Json<CreateCycleReq>,
) -> Result<Response, AppError> {
    let user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let user_id = user["id"].as_str().unwrap_or("");

    let ws = db
        .prepare("SELECT workspace_id FROM projects WHERE id = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&project_id)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::NotFound("Project not found".into()))?;
    let ws_id = ws["workspace_id"].as_str().unwrap_or("");

    let cycle_id = auth::generate_uuid_v4();
    let now = now_iso();

    db.prepare(
        "INSERT INTO cycles (id, name, description, start_date, end_date, sort_order, project_id, workspace_id, owned_by_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 65535.0, ?6, ?7, ?8, ?9, ?9)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&cycle_id),
            wasm_bindgen::JsValue::from(&body.name),
            wasm_bindgen::JsValue::from(body.description.unwrap_or_default()),
            wasm_bindgen::JsValue::from(body.start_date.unwrap_or_default()),
            wasm_bindgen::JsValue::from(body.end_date.unwrap_or_default()),
            wasm_bindgen::JsValue::from(&project_id),
            wasm_bindgen::JsValue::from_str(ws_id),
            wasm_bindgen::JsValue::from(user_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({"id": cycle_id, "name": body.name})),
    ).into_response())
}

#[send]
pub async fn update_cycle(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, cycle_id)): Path<(String, String, String)>,
    Json(body): Json<UpdateCycleReq>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    if let Some(name) = &body.name {
        db.prepare("UPDATE cycles SET name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(name),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&cycle_id),
            ])?
            .run()
            .await?;
    }

    Ok(Json(json!({"message": "Cycle updated"})).into_response())
}

#[send]
pub async fn delete_cycle(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, cycle_id)): Path<(String, String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    db.prepare("UPDATE cycles SET deleted_at = ?1 WHERE id = ?2")
        .bind(&[
            wasm_bindgen::JsValue::from(&now),
            wasm_bindgen::JsValue::from(&cycle_id),
        ])?
        .run()
        .await?;

    Ok(Json(json!({"message": "Cycle deleted"})).into_response())
}

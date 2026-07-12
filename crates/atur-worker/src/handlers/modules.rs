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
pub struct CreateModuleReq {
    pub name: String,
    pub description: Option<String>,
    pub status: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateModuleReq {
    pub name: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
}

#[send]
pub async fn list_modules(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let results = db
        .prepare("SELECT * FROM modules WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY sort_order ASC")
        .bind(&[wasm_bindgen::JsValue::from(&project_id)])?
        .all()
        .await?;
    let modules: Vec<serde_json::Value> = results.results()?;
    Ok(Json(json!({"results": modules})).into_response())
}

#[send]
pub async fn create_module(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
    Json(body): Json<CreateModuleReq>,
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

    let module_id = auth::generate_uuid_v4();
    let now = now_iso();

    db.prepare(
        "INSERT INTO modules (id, name, description, status, sort_order, project_id, workspace_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 65535.0, ?5, ?6, ?7, ?7)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&module_id),
            wasm_bindgen::JsValue::from(&body.name),
            wasm_bindgen::JsValue::from(body.description.unwrap_or_default()),
            wasm_bindgen::JsValue::from(body.status.as_deref().unwrap_or("planned")),
            wasm_bindgen::JsValue::from(&project_id),
            wasm_bindgen::JsValue::from_str(ws_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({"id": module_id, "name": body.name})),
    ).into_response())
}

#[send]
pub async fn update_module(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, module_id)): Path<(String, String, String)>,
    Json(body): Json<UpdateModuleReq>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    if let Some(name) = &body.name {
        db.prepare("UPDATE modules SET name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(name),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&module_id),
            ])?
            .run()
            .await?;
    }
    if let Some(status) = &body.status {
        db.prepare("UPDATE modules SET status = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(status),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&module_id),
            ])?
            .run()
            .await?;
    }

    Ok(Json(json!({"message": "Module updated"})).into_response())
}

#[send]
pub async fn delete_module(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, _project_id, module_id)): Path<(String, String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    db.prepare("UPDATE modules SET deleted_at = ?1 WHERE id = ?2")
        .bind(&[
            wasm_bindgen::JsValue::from(&now),
            wasm_bindgen::JsValue::from(&module_id),
        ])?
        .run()
        .await?;

    Ok(Json(json!({"message": "Module deleted"})).into_response())
}

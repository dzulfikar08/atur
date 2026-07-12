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
pub struct CreatePageReq {
    pub name: String,
    pub description_html: Option<String>,
    pub access: Option<i32>,
}

#[derive(Deserialize)]
pub struct UpdatePageReq {
    pub name: Option<String>,
    pub description_html: Option<String>,
}

#[send]
pub async fn list_pages(
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
        .prepare("SELECT * FROM pages WHERE workspace_id = ?1 AND deleted_at IS NULL ORDER BY sort_order ASC")
        .bind(&[wasm_bindgen::JsValue::from_str(ws_id)])?
        .all()
        .await?;
    let pages: Vec<serde_json::Value> = results.results()?;
    Ok(Json(json!({"results": pages})).into_response())
}

#[send]
pub async fn create_page(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(slug): Path<String>,
    Json(body): Json<CreatePageReq>,
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

    let page_id = auth::generate_uuid_v4();
    let now = now_iso();

    db.prepare(
        "INSERT INTO pages (id, name, description_html, access, sort_order, workspace_id, owned_by_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 65535.0, ?5, ?6, ?7, ?7)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&page_id),
            wasm_bindgen::JsValue::from(&body.name),
            wasm_bindgen::JsValue::from(body.description_html.unwrap_or_default()),
            wasm_bindgen::JsValue::from_f64(body.access.unwrap_or(0) as f64),
            wasm_bindgen::JsValue::from_str(ws_id),
            wasm_bindgen::JsValue::from(user_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({"id": page_id, "name": body.name})),
    ).into_response())
}

#[send]
pub async fn get_page(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, page_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let page = db
        .prepare("SELECT * FROM pages WHERE id = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&page_id)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::NotFound("Page not found".into()))?;

    Ok(Json(page).into_response())
}

#[send]
pub async fn update_page(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, page_id)): Path<(String, String)>,
    Json(body): Json<UpdatePageReq>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    if let Some(name) = &body.name {
        db.prepare("UPDATE pages SET name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(name),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&page_id),
            ])?
            .run()
            .await?;
    }
    if let Some(desc) = &body.description_html {
        db.prepare("UPDATE pages SET description_html = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(desc),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&page_id),
            ])?
            .run()
            .await?;
    }

    Ok(Json(json!({"message": "Page updated"})).into_response())
}

#[send]
pub async fn delete_page(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, page_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    db.prepare("UPDATE pages SET deleted_at = ?1 WHERE id = ?2")
        .bind(&[
            wasm_bindgen::JsValue::from(&now),
            wasm_bindgen::JsValue::from(&page_id),
        ])?
        .run()
        .await?;

    Ok(Json(json!({"message": "Page deleted"})).into_response())
}

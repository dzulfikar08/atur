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
pub struct CreateWorkspaceReq {
    pub name: String,
    pub slug: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateWorkspaceReq {
    pub name: Option<String>,
    pub logo: Option<String>,
    pub organization_size: Option<String>,
}

#[send]
pub async fn list_workspaces(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Response, AppError> {
    let user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let user_id = user["id"].as_str().unwrap_or("");

    let results = db
        .prepare(
            "SELECT w.* FROM workspaces w \
             INNER JOIN workspace_members wm ON w.id = wm.workspace_id \
             WHERE wm.member_id = ?1 AND wm.is_active = 1 AND w.deleted_at IS NULL \
             ORDER BY w.created_at DESC"
        )
        .bind(&[wasm_bindgen::JsValue::from(user_id)])?
        .all()
        .await?;
    let workspaces: Vec<serde_json::Value> = results.results()?;

    Ok(Json(json!({"results": workspaces})).into_response())
}

#[send]
pub async fn create_workspace(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CreateWorkspaceReq>,
) -> Result<Response, AppError> {
    let user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let user_id = user["id"].as_str().unwrap_or("");

    let slug = body.slug.unwrap_or_else(|| {
        body.name.to_lowercase().replace(' ', "-").replace(|c: char| !c.is_alphanumeric() && c != '-', "")
    });
    let workspace_id = auth::generate_uuid_v4();
    let now = now_iso();

    db.prepare(
        "INSERT INTO workspaces (id, name, slug, owner_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&workspace_id),
            wasm_bindgen::JsValue::from(&body.name),
            wasm_bindgen::JsValue::from(&slug),
            wasm_bindgen::JsValue::from(user_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    let member_id = auth::generate_uuid_v4();
    db.prepare(
        "INSERT INTO workspace_members (id, workspace_id, member_id, role, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, 20, 1, ?4, ?4)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&member_id),
            wasm_bindgen::JsValue::from(&workspace_id),
            wasm_bindgen::JsValue::from(user_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({"id": workspace_id, "name": body.name, "slug": slug})),
    ).into_response())
}

#[send]
pub async fn get_workspace(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(slug): Path<String>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let ws = db
        .prepare("SELECT * FROM workspaces WHERE slug = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&slug)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::NotFound("Workspace not found".into()))?;

    Ok(Json(ws).into_response())
}

#[send]
pub async fn update_workspace(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(slug): Path<String>,
    Json(body): Json<UpdateWorkspaceReq>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    let ws = db
        .prepare("SELECT id FROM workspaces WHERE slug = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&slug)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::NotFound("Workspace not found".into()))?;
    let ws_id = ws["id"].as_str().unwrap_or("");

    if let Some(name) = &body.name {
        db.prepare("UPDATE workspaces SET name = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(&[
                wasm_bindgen::JsValue::from(name),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(ws_id),
            ])?
            .run()
            .await?;
    }
    if let Some(logo) = &body.logo {
        db.prepare("UPDATE workspaces SET logo = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(&[
                wasm_bindgen::JsValue::from(logo),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(ws_id),
            ])?
            .run()
            .await?;
    }

    let updated = db
        .prepare("SELECT * FROM workspaces WHERE id = ?1")
        .bind(&[wasm_bindgen::JsValue::from(ws_id)])?
        .first::<serde_json::Value>(None)
        .await?;

    Ok(Json(updated).into_response())
}

#[send]
pub async fn list_members(
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
        .prepare(
            "SELECT wm.*, u.email, u.username, u.display_name, u.avatar \
             FROM workspace_members wm \
             INNER JOIN users u ON u.id = wm.member_id \
             WHERE wm.workspace_id = ?1 AND wm.is_active = 1 AND wm.deleted_at IS NULL"
        )
        .bind(&[wasm_bindgen::JsValue::from(ws_id)])?
        .all()
        .await?;
    let members: Vec<serde_json::Value> = results.results()?;

    Ok(Json(json!({"results": members})).into_response())
}

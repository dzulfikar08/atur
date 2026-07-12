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

async fn resolve_workspace_id(db: &worker::d1::D1Database, slug: &str) -> Result<String, AppError> {
    let ws = db
        .prepare("SELECT id FROM workspaces WHERE slug = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(slug)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::NotFound("Workspace not found".into()))?;
    Ok(ws["id"].as_str().unwrap_or("").to_string())
}

#[derive(Deserialize)]
pub struct CreateProjectReq {
    pub name: String,
    pub identifier: Option<String>,
    pub description: Option<String>,
    pub network: Option<i32>,
}

#[derive(Deserialize)]
pub struct UpdateProjectReq {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[send]
pub async fn list_projects(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(slug): Path<String>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let ws_id = resolve_workspace_id(&db, &slug).await?;

    let results = db
        .prepare("SELECT * FROM projects WHERE workspace_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC")
        .bind(&[wasm_bindgen::JsValue::from(&ws_id)])?
        .all()
        .await?;
    let projects: Vec<serde_json::Value> = results.results()?;
    Ok(Json(json!({"results": projects})).into_response())
}

#[send]
pub async fn create_project(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(slug): Path<String>,
    Json(body): Json<CreateProjectReq>,
) -> Result<Response, AppError> {
    let user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let ws_id = resolve_workspace_id(&db, &slug).await?;
    let user_id = user["id"].as_str().unwrap_or("");

    let identifier = body.identifier.unwrap_or_else(|| {
        body.name.chars().filter(|c| c.is_uppercase()).take(3).collect::<String>()
    });
    let project_id = auth::generate_uuid_v4();
    let now = now_iso();

    db.prepare(
        "INSERT INTO projects (id, name, identifier, description, workspace_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&project_id),
            wasm_bindgen::JsValue::from(&body.name),
            wasm_bindgen::JsValue::from(&identifier),
            wasm_bindgen::JsValue::from(body.description.unwrap_or_default()),
            wasm_bindgen::JsValue::from(&ws_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    let member_id = auth::generate_uuid_v4();
    db.prepare(
        "INSERT INTO project_members (id, project_id, workspace_id, member_id, role, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 20, 1, ?5, ?5)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&member_id),
            wasm_bindgen::JsValue::from(&project_id),
            wasm_bindgen::JsValue::from(&ws_id),
            wasm_bindgen::JsValue::from(user_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({"id": project_id, "name": body.name, "identifier": identifier})),
    ).into_response())
}

#[send]
pub async fn get_project(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;

    let project = db
        .prepare("SELECT * FROM projects WHERE id = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&project_id)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::NotFound("Project not found".into()))?;

    Ok(Json(project).into_response())
}

#[send]
pub async fn update_project(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
    Json(body): Json<UpdateProjectReq>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    if let Some(name) = &body.name {
        db.prepare("UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(name),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&project_id),
            ])?
            .run()
            .await?;
    }
    if let Some(desc) = &body.description {
        db.prepare("UPDATE projects SET description = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL")
            .bind(&[
                wasm_bindgen::JsValue::from(desc),
                wasm_bindgen::JsValue::from(&now),
                wasm_bindgen::JsValue::from(&project_id),
            ])?
            .run()
            .await?;
    }

    let updated = db
        .prepare("SELECT * FROM projects WHERE id = ?1")
        .bind(&[wasm_bindgen::JsValue::from(&project_id)])?
        .first::<serde_json::Value>(None)
        .await?;

    Ok(Json(updated).into_response())
}

#[send]
pub async fn delete_project(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((_slug, project_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let _user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let now = now_iso();

    db.prepare("UPDATE projects SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL")
        .bind(&[
            wasm_bindgen::JsValue::from(&now),
            wasm_bindgen::JsValue::from(&project_id),
        ])?
        .run()
        .await?;

    Ok(Json(json!({"message": "Project deleted"})).into_response())
}

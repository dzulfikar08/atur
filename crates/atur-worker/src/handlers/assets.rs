use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use worker::{send, wasm_bindgen, Bucket};

use crate::auth;
use crate::error::AppError;
use crate::handlers::now_iso;
use crate::handlers::users::require_user;
use crate::state::AppState;

async fn get_db(state: &AppState) -> Result<worker::d1::D1Database, AppError> {
    state.env.d1("DB").map_err(|e| AppError::Internal(e.to_string()))
}

fn get_bucket(state: &AppState) -> Result<Bucket, AppError> {
    state.env.bucket("R2").map_err(|e| AppError::Internal(e.to_string()))
}

#[derive(Deserialize)]
pub struct CreateAssetReq {
    pub asset: String,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub size: Option<i64>,
    pub content_type: Option<String>,
}

#[send]
pub async fn upload_asset_v2(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(_slug): Path<String>,
    Json(body): Json<CreateAssetReq>,
) -> Result<Response, AppError> {
    let user = require_user(&state, &headers).await?;
    let db = get_db(&state).await?;
    let user_id = user["id"].as_str().unwrap_or("");

    let asset_id = auth::generate_uuid_v4();
    let now = now_iso();

    db.prepare(
        "INSERT INTO file_assets (id, asset, entity_type, entity_id, size, content_type, is_uploaded, created_by_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?8)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&asset_id),
            wasm_bindgen::JsValue::from(&body.asset),
            wasm_bindgen::JsValue::from(body.entity_type.unwrap_or_default()),
            wasm_bindgen::JsValue::from(body.entity_id.unwrap_or_default()),
            wasm_bindgen::JsValue::from_f64(body.size.unwrap_or(0) as f64),
            wasm_bindgen::JsValue::from(body.content_type.unwrap_or_else(|| "application/octet-stream".into())),
            wasm_bindgen::JsValue::from(user_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({"id": asset_id, "asset": body.asset, "upload_url": format!("/api/assets/upload/{}", asset_id)})),
    ).into_response())
}

#[send]
pub async fn upload_asset_file(
    State(state): State<AppState>,
    Path(asset_id): Path<String>,
    body: bytes::Bytes,
) -> Result<Response, AppError> {
    let db = get_db(&state).await?;
    let bucket = get_bucket(&state)?;

    let _asset = db
        .prepare("SELECT * FROM file_assets WHERE id = ?1")
        .bind(&[wasm_bindgen::JsValue::from(&asset_id)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::NotFound("Asset not found".into()))?;

    let r2_key = format!("assets/{}", asset_id);
    bucket.put(&r2_key, body.to_vec()).execute().await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let now = now_iso();
    db.prepare("UPDATE file_assets SET is_uploaded = 1, updated_at = ?1 WHERE id = ?2")
        .bind(&[
            wasm_bindgen::JsValue::from(&now),
            wasm_bindgen::JsValue::from(&asset_id),
        ])?
        .run()
        .await?;

    Ok(Json(json!({"message": "Asset uploaded", "id": asset_id})).into_response())
}

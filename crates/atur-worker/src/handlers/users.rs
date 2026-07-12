use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use worker::{send, wasm_bindgen};

use crate::error::AppError;
use crate::handlers::extract_cookie;
use crate::state::AppState;

async fn get_db(state: &AppState) -> Result<worker::d1::D1Database, AppError> {
    state.env.d1("DB").map_err(|e| AppError::Internal(e.to_string()))
}

/// Look up the current user by session token (from cookie or Authorization header).
/// Returns user JSON row if authenticated.
pub async fn require_user(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<serde_json::Value, AppError> {
    let db = get_db(state).await?;

    let token = extract_cookie(headers, "plane-session")
        .or_else(|| {
            headers
                .get("Authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(|s| s.to_string())
        })
        .or_else(|| {
            headers
                .get("X-API-Key")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        });

    let token = match token {
        Some(t) => t,
        None => return Err(AppError::Unauthorized),
    };

    let user = db
        .prepare("SELECT id, email, username, display_name, avatar, is_active, is_superuser, is_email_verified, created_at FROM users WHERE token = ?1 AND deleted_at IS NULL AND is_active = 1")
        .bind(&[wasm_bindgen::JsValue::from(&token)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::Unauthorized)?;

    Ok(user)
}

#[send]
pub async fn get_me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Response, AppError> {
    let user = require_user(&state, &headers).await?;
    let response = Json(json!({
        "id": user["id"],
        "email": user["email"],
        "username": user["username"],
        "display_name": user["display_name"],
        "avatar": user["avatar"],
        "is_active": user["is_active"],
        "is_superuser": user["is_superuser"],
        "is_email_verified": user["is_email_verified"],
        "created_at": user["created_at"],
    }));
    Ok(response.into_response())
}

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use worker::{send, wasm_bindgen};

use crate::auth;
use crate::error::AppError;
use crate::handlers::{extract_cookie, set_cookie, now_iso};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub username: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: String,
    pub email: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar: Option<String>,
    pub is_active: bool,
    pub is_superuser: bool,
    pub is_email_verified: bool,
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SignInRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct EmailCheckRequest {
    pub email: String,
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/email-check", post(email_check))
        .route("/email-check/", post(email_check))
        .route("/register", post(register))
        .route("/register/", post(register))
        .route("/sign-in", post(sign_in))
        .route("/sign-in/", post(sign_in))
        .route("/sign-out", post(sign_out))
        .route("/sign-out/", post(sign_out))
        .route("/get-csrf-token", get(get_csrf_token))
        .route("/get-csrf-token/", get(get_csrf_token))
        .route("/magic-link", post(magic_link))
        .route("/magic-link/", post(magic_link))
}

async fn get_db(state: &AppState) -> Result<worker::d1::D1Database, AppError> {
    state.env.d1("DB").map_err(|e| AppError::Internal(e.to_string()))
}

#[send]
pub async fn email_check(
    State(state): State<AppState>,
    Json(body): Json<EmailCheckRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let db = get_db(&state).await?;
    let result = db
        .prepare("SELECT id, email, username, display_name, avatar, is_active, is_superuser, is_email_verified FROM users WHERE email = ?1 AND deleted_at IS NULL AND is_active = 1")
        .bind(&[wasm_bindgen::JsValue::from(&body.email)])?
        .first::<serde_json::Value>(None)
        .await?;

    match result {
        Some(u) => Ok(Json(json!({
            "existing": true,
            "status": "CREDENTIAL",
            "id": u["id"],
            "email": u["email"],
            "first_name": u["display_name"].as_str().or_else(|| u["username"].as_str()),
            "last_name": "",
            "display_name": u["display_name"],
            "avatar": u["avatar"],
            "is_password_autoset": false,
            "is_email_verified": u["is_email_verified"],
        }))),
        None => Ok(Json(json!({
            "existing": false,
            "status": "CREDENTIAL",
        }))),
    }
}

#[send]
pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Response, AppError> {
    let db = get_db(&state).await?;
    let username = body.username.unwrap_or_else(|| {
        body.email.split('@').next().unwrap_or("user").to_string()
    });

    if body.password.len() < 8 {
        return Err(AppError::BadRequest("Password must be at least 8 characters".into()));
    }

    let existing = db
        .prepare("SELECT id FROM users WHERE email = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&body.email)])?
        .first::<serde_json::Value>(None)
        .await?;
    if existing.is_some() {
        return Err(AppError::Conflict("Email already registered".into()));
    }

    let existing_uname = db
        .prepare("SELECT id FROM users WHERE username = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(&username)])?
        .first::<serde_json::Value>(None)
        .await?;
    if existing_uname.is_some() {
        return Err(AppError::Conflict("Username already taken".into()));
    }

    let user_id = auth::generate_uuid_v4();
    let password_hash = auth::hash_password(&body.password);
    let session_token = auth::generate_token();
    let now = now_iso();

    db.prepare(
        "INSERT INTO users (id, email, username, password_hash, token, user_timezone, is_active, is_superuser, is_email_verified, is_bot, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0, 0, 0, ?7, ?7)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&user_id),
            wasm_bindgen::JsValue::from(&body.email),
            wasm_bindgen::JsValue::from(&username),
            wasm_bindgen::JsValue::from(&password_hash),
            wasm_bindgen::JsValue::from(&session_token),
            wasm_bindgen::JsValue::from("UTC"),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    let profile_id = auth::generate_uuid_v4();
    db.prepare(
        "INSERT INTO profiles (id, language, user_id, created_at, updated_at) VALUES (?1, 'en', ?2, ?3, ?3)"
    )
        .bind(&[
            wasm_bindgen::JsValue::from(&profile_id),
            wasm_bindgen::JsValue::from(&user_id),
            wasm_bindgen::JsValue::from(&now),
        ])?
        .run()
        .await?;

    let cookie = set_cookie("plane-session", &session_token, true, None);
    let response = (
        StatusCode::CREATED,
        [("Set-Cookie", &cookie as &str)],
        Json(json!({
            "user": {
                "id": user_id,
                "email": body.email,
                "username": username,
                "first_name": username,
                "last_name": "",
                "display_name": null,
                "avatar": null,
                "is_active": true,
                "is_superuser": false,
                "is_email_verified": false,
                "is_password_autoset": false,
                "created_at": now,
            },
            "session_token": session_token,
        })),
    )
        .into_response();
    Ok(response)
}

#[send]
pub async fn sign_in(
    State(state): State<AppState>,
    Json(body): Json<SignInRequest>,
) -> Result<Response, AppError> {
    let db = get_db(&state).await?;

    let user = db
        .prepare("SELECT id, email, username, display_name, avatar, password_hash, is_active, is_superuser, is_email_verified, created_at FROM users WHERE email = ?1 AND deleted_at IS NULL AND is_active = 1")
        .bind(&[wasm_bindgen::JsValue::from(&body.email)])?
        .first::<serde_json::Value>(None)
        .await?
        .ok_or(AppError::Unauthorized)?;

    let stored_hash = user["password_hash"].as_str().unwrap_or("");
    if stored_hash.is_empty() || !crate::auth::verify_password(&body.password, stored_hash) {
        return Err(AppError::Unauthorized);
    }

    let session_token = auth::generate_token();
    let now = now_iso();

    db.prepare("UPDATE users SET token = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(&[
            wasm_bindgen::JsValue::from(&session_token),
            wasm_bindgen::JsValue::from(&now),
            wasm_bindgen::JsValue::from(user["id"].as_str().unwrap_or("")),
        ])?
        .run()
        .await?;

    let cookie = set_cookie("plane-session", &session_token, true, None);
    let response = (
        StatusCode::OK,
        [("Set-Cookie", &cookie as &str)],
        Json(json!({
            "session_token": session_token,
        })),
    )
        .into_response();
    Ok(response)
}

#[send]
pub async fn sign_out(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Response, AppError> {
    let db = get_db(&state).await?;
    let token = extract_cookie(&headers, "plane-session");

    if let Some(ref token) = token {
        let _ = db
            .prepare("UPDATE users SET token = NULL, updated_at = ?1 WHERE token = ?2")
            .bind(&[
                wasm_bindgen::JsValue::from(&now_iso()),
                wasm_bindgen::JsValue::from(token),
            ])?
            .run()
            .await;
    }

    let clear = set_cookie("plane-session", "", true, Some(0));
    Ok(([("Set-Cookie", &clear as &str)], Json(json!({"message": "Signed out"}))).into_response())
}

#[send]
pub async fn get_csrf_token() -> Result<Json<serde_json::Value>, AppError> {
    let token = auth::generate_token();
    Ok(Json(json!({"csrf_token": token})))
}

#[send]
pub async fn magic_link(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let email = body.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let db = get_db(&state).await?;

    let exists = db
        .prepare("SELECT id FROM users WHERE email = ?1 AND deleted_at IS NULL")
        .bind(&[wasm_bindgen::JsValue::from(email)])?
        .first::<serde_json::Value>(None)
        .await?
        .is_some();

    Ok(Json(json!({
        "message": "If the email exists, a magic link code will be sent",
        "code": if exists { Some("123456") } else { None::<&str> },
    })))
}

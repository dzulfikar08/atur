use axum::extract::{Request, State};
use axum::http::header::{AUTHORIZATION, COOKIE};
use axum::middleware::Next;
use axum::response::Response;
use db::entities::{api_keys, users};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};
use sha2::{Digest, Sha256};

use crate::error::AppError;
use crate::state::AppState;

#[derive(Clone, Debug)]
pub struct CurrentUser(pub users::Model);

fn extract_cookie_value<'a>(cookie_str: &'a str, name: &str) -> Option<&'a str> {
    cookie_str.split(';').find_map(|c| {
        let c = c.trim();
        c.strip_prefix(&format!("{}=", name))
    })
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    // 1. Try cookie-based auth (plane-session cookie)
    if let Some(cookie_header) = req.headers().get(COOKIE) {
        let cookie_str = cookie_header.to_str().unwrap_or("");
        if let Some(token) = extract_cookie_value(cookie_str, "plane-session") {
            if let Some(user) = find_user_by_token(&state, token).await? {
                req.extensions_mut().insert(CurrentUser(user));
                return Ok(next.run(req).await);
            }
        }
    }

    // 2. Try API key from X-API-Key header
    if let Some(api_key) = req
        .headers()
        .get("X-API-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
    {
        if let Some(user) = find_user_by_api_key(&state, &api_key).await? {
            req.extensions_mut().insert(CurrentUser(user));
            return Ok(next.run(req).await);
        }
        if let Some(user) = find_user_by_token(&state, &api_key).await? {
            req.extensions_mut().insert(CurrentUser(user));
            return Ok(next.run(req).await);
        }
    }

    // 3. Try Authorization: Bearer <token>
    if let Some(bearer) = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.trim().to_string())
    {
        if let Some(user) = find_user_by_token(&state, &bearer).await? {
            req.extensions_mut().insert(CurrentUser(user));
            return Ok(next.run(req).await);
        }
    }

    Err(AppError::Unauthorized)
}

pub async fn require_auth(
    req: &Request,
) -> Result<CurrentUser, AppError> {
    req.extensions()
        .get::<CurrentUser>()
        .cloned()
        .ok_or(AppError::Unauthorized)
}

async fn find_user_by_token(
    state: &AppState,
    token: &str,
) -> Result<Option<users::Model>, AppError> {
    let user = users::Entity::find()
        .filter(users::Column::Token.eq(token))
        .filter(users::Column::IsActive.eq(true))
        .filter(users::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
    Ok(user)
}

async fn find_user_by_api_key(
    state: &AppState,
    raw_key: &str,
) -> Result<Option<users::Model>, AppError> {
    let mut hasher = Sha256::new();
    hasher.update(raw_key.as_bytes());
    let key_hash = format!("{:x}", hasher.finalize());

    let api_key_model = api_keys::Entity::find()
        .filter(api_keys::Column::KeyHash.eq(&key_hash))
        .filter(api_keys::Column::IsActive.eq(true))
        .filter(api_keys::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let api_key_model = match api_key_model {
        Some(k) => k,
        None => return Ok(None),
    };

    // Check expiration
    if let Some(expires_at) = api_key_model.expires_at {
        let now = chrono::Utc::now().fixed_offset();
        if expires_at < now {
            return Ok(None);
        }
    }

    let user = users::Entity::find_by_id(api_key_model.user_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let user = match user {
        Some(u) if u.is_active => u,
        _ => return Ok(None),
    };

    // Update last_used_at
    let now = chrono::Utc::now().fixed_offset();
    let mut active: api_keys::ActiveModel = api_key_model.into();
    active.last_used_at = sea_orm::ActiveValue::Set(Some(now));
    let _ = active.update(&state.db).await;

    Ok(Some(user))
}

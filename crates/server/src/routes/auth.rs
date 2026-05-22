use axum::extract::{Query, State};
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use axum::routing::{get, post};
use chrono::Utc;
use db::entities::{accounts, profiles, users};
use hmac::{Hmac, Mac};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub username: String,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub username: String,
    pub first_name: String,
    pub last_name: String,
    pub display_name: Option<String>,
    pub avatar: Option<String>,
    pub is_active: bool,
    pub is_superuser: bool,
    pub is_email_verified: bool,
    pub is_password_autoset: bool,
    pub created_at: Option<String>,
}

impl From<users::Model> for UserResponse {
    fn from(m: users::Model) -> Self {
        Self {
            id: m.id,
            email: m.email,
            username: m.username.clone(),
            first_name: m.display_name.clone().unwrap_or_else(|| m.username.clone()),
            last_name: String::new(),
            display_name: m.display_name.clone(),
            avatar: m.avatar,
            is_active: m.is_active,
            is_superuser: m.is_superuser,
            is_email_verified: m.is_email_verified,
            is_password_autoset: false,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SignInRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct SignInResponse {
    pub user: UserResponse,
    pub session_token: String,
}

#[derive(Debug, Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Serialize)]
pub struct ForgotPasswordResponse {
    pub message: String,
    // In production this would be sent via email, not returned.
    // For dev/testing we return the token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct MagicLinkRequest {
    pub email: String,
}

#[derive(Debug, Serialize)]
pub struct MagicLinkResponse {
    pub message: String,
    // Dev only: return the code
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CsrfResponse {
    pub csrf_token: String,
}

// ---------------------------------------------------------------------------
// In-memory stores (replace with Redis in production)
// ---------------------------------------------------------------------------

/// Simple in-memory token store for password resets and magic links.
/// Key = token string, Value = user_id.
fn token_store() -> &'static std::sync::Mutex<Vec<(String, Uuid, chrono::DateTime<Utc>)>> {
    static STORE: std::sync::OnceLock<std::sync::Mutex<Vec<(String, Uuid, chrono::DateTime<Utc>)>>> =
        std::sync::OnceLock::new();
    STORE.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

fn generate_token() -> String {
    let bytes: Vec<u8> = (0..32).map(|_| rand::random::<u8>()).collect();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn generate_code() -> String {
    (0..6).map(|_| char::from_digit((rand::random::<u8>() % 10) as u32, 10).unwrap()).collect()
}

/// Parse `application/x-www-form-urlencoded` bytes into a simple key-value map.
fn parse_form_fields(body: &[u8]) -> std::collections::HashMap<String, String> {
    let text = String::from_utf8_lossy(body);
    let mut map = std::collections::HashMap::new();
    for pair in text.split('&') {
        if pair.is_empty() { continue; }
        if let Some((k, v)) = pair.split_once('=') {
            let key = k.replace('+', " ");
            let val = v.replace('+', " ");
            // Simple percent-decode
            let key = percent_decode(&key);
            let val = percent_decode(&val);
            map.insert(key, val);
        }
    }
    map
}

fn percent_decode(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            } else {
                result.push('%');
                result.push_str(&hex);
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// Build a Set-Cookie header value for the session cookie.
fn session_cookie_value(token: &str) -> String {
    format!(
        "plane-session={}; HttpOnly; SameSite=Lax; Path=/",
        token
    )
}

/// Build a Set-Cookie header value that clears the session cookie.
fn clear_session_cookie_value() -> String {
    "plane-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0".to_string()
}

/// Build a Set-Cookie header value for the CSRF cookie (NOT HttpOnly -- JS reads it).
fn csrf_cookie_value(token: &str) -> String {
    format!("csrftoken={}; SameSite=Lax; Path=/", token)
}

/// Extract a named cookie value from a raw Cookie header string.
fn extract_cookie_value<'a>(cookie_str: &'a str, name: &str) -> Option<&'a str> {
    cookie_str.split(';').find_map(|c| {
        let c = c.trim();
        c.strip_prefix(&format!("{}=", name))
    })
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

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
        .route("/forgot-password", post(forgot_password))
        .route("/forgot-password/", post(forgot_password))
        .route("/reset-password", post(reset_password))
        .route("/reset-password/", post(reset_password))
        .route("/magic-link", post(magic_link))
        .route("/magic-link/", post(magic_link))
        .route("/get-csrf-token", get(get_csrf_token))
        .route("/get-csrf-token/", get(get_csrf_token))
        // OAuth stubs
        .route("/github", get(oauth_github))
        .route("/github/", get(oauth_github))
        .route("/github/callback", get(oauth_github_callback))
        .route("/github/callback/", get(oauth_github_callback))
        .route("/google", get(oauth_google))
        .route("/google/", get(oauth_google))
        .route("/google/callback", get(oauth_google_callback))
        .route("/google/callback/", get(oauth_google_callback))
        .route("/gitlab", get(oauth_gitlab))
        .route("/gitlab/", get(oauth_gitlab))
        .route("/gitlab/callback", get(oauth_gitlab_callback))
        .route("/gitlab/callback/", get(oauth_gitlab_callback))
}

/// POST /auth/register
/// Accepts both JSON (API clients) and form-urlencoded (frontend native form).
pub async fn register(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> Result<impl IntoResponse, AppError> {
    let (parts, body) = req.into_parts();
    let content_type = parts.headers.get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let (email, password, username): (String, String, String) = if content_type.contains("application/json") {
        let bytes = axum::body::to_bytes(body, 4096).await
            .map_err(|_| AppError::BadRequest("Failed to read body".into()))?;
        let reg: RegisterRequest = serde_json::from_slice(&bytes)
            .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;
        (reg.email, reg.password, reg.username)
    } else {
        let bytes = axum::body::to_bytes(body, 4096).await
            .map_err(|_| AppError::BadRequest("Failed to read body".into()))?;
        let form = parse_form_fields(&bytes);
        let email = form.get("email").cloned().unwrap_or_default();
        let password = form.get("password").cloned().unwrap_or_default();
        let uname = form.get("username").cloned()
            .or_else(|| email.split('@').next().map(|s| s.to_string()))
            .unwrap_or_else(|| "user".to_string());
        (email, password, uname)
    };

    // Validate password
    domain::auth::validate_password_strength(&password)
        .map_err(|e| AppError::BadRequest(e))?;

    // Check duplicate email
    if users::Entity::find()
        .filter(users::Column::Email.eq(&email))
        .filter(users::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .is_some()
    {
        return Err(AppError::Conflict("Email already registered".into()));
    }

    // Check duplicate username
    if users::Entity::find()
        .filter(users::Column::Username.eq(&username))
        .filter(users::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .is_some()
    {
        return Err(AppError::Conflict("Username already taken".into()));
    }

    let password_hash = domain::auth::hash_password(&password)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Hash error: {}", e)))?;

    let user_id = Uuid::new_v4();
    let now = Utc::now().fixed_offset();

    // Create user
    let user = users::ActiveModel {
        id: Set(user_id),
        email: Set(email.clone()),
        username: Set(username.clone()),
        display_name: Set(None),
        password_hash: Set(Some(password_hash)),
        avatar: Set(None),
        token: Set(Some(generate_token())),
        user_timezone: Set(Some("UTC".into())),
        is_active: Set(true),
        is_superuser: Set(false),
        is_email_verified: Set(false),
        is_bot: Set(false),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("DB insert error: {}", e)))?;

    // Create profile
    let _profile = profiles::ActiveModel {
        id: Set(Uuid::new_v4()),
        theme: Set(None),
        is_onboarded: Set(false),
        onboarding_step: Set(None),
        use_case: Set(None),
        role: Set(None),
        language: Set(Some("en".into())),
        user_id: Set(user_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Profile insert error: {}", e)))?;

    // Retrieve the session token that was set on the user
    let session_token = user.token.clone().unwrap_or_default();

    if content_type.contains("application/json") {
        Ok((
            axum::http::StatusCode::CREATED,
            [(SET_COOKIE, session_cookie_value(&session_token))],
            Json(serde_json::json!({
                "user": UserResponse::from(user),
                "session_token": session_token,
            })),
        ).into_response())
    } else {
        // Form submission: redirect to home (SPA will detect auth state)
        Ok((
            StatusCode::SEE_OTHER,
            [(SET_COOKIE, session_cookie_value(&session_token))],
            [(axum::http::header::LOCATION, "/")],
            axum::body::Body::empty(),
        ).into_response())
    }
}

/// POST /auth/sign-in
/// Accepts both JSON (API clients) and form-urlencoded (frontend native form).
pub async fn sign_in(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> Result<impl IntoResponse, AppError> {
    let (parts, body) = req.into_parts();
    let content_type = parts.headers.get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let (email, password): (String, String) = if content_type.contains("application/json") {
        let bytes = axum::body::to_bytes(body, 4096).await
            .map_err(|_| AppError::BadRequest("Failed to read body".into()))?;
        let sign_in: SignInRequest = serde_json::from_slice(&bytes)
            .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {}", e)))?;
        (sign_in.email, sign_in.password)
    } else {
        let bytes = axum::body::to_bytes(body, 4096).await
            .map_err(|_| AppError::BadRequest("Failed to read body".into()))?;
        let form = parse_form_fields(&bytes);
        let email = form.get("email").cloned().unwrap_or_default();
        let password = form.get("password").cloned().unwrap_or_default();
        (email, password)
    };

    let user = users::Entity::find()
        .filter(users::Column::Email.eq(&email))
        .filter(users::Column::DeletedAt.is_null())
        .filter(users::Column::IsActive.eq(true))
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or(AppError::Unauthorized)?;

    let hash = user
        .password_hash
        .as_deref()
        .ok_or(AppError::Unauthorized)?;

    if !domain::auth::verify_password(&password, hash)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Verify error: {}", e)))?
    {
        return Err(AppError::Unauthorized);
    }

    // Generate a new session token and store it on the user
    let session_token = generate_token();
    let mut active: users::ActiveModel = user.clone().into();
    active.token = Set(Some(session_token.clone()));
    active.updated_at = Set(Some(Utc::now().fixed_offset()));
    let _updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    // Form submissions expect a redirect; JSON clients get JSON.
    if content_type.contains("application/json") {
        Ok((
            StatusCode::OK,
            [(SET_COOKIE, session_cookie_value(&session_token))],
            Json(serde_json::json!({ "session_token": session_token })),
        ).into_response())
    } else {
        // 303 See Other: redirect to home page (SPA will detect auth state)
        Ok((
            StatusCode::SEE_OTHER,
            [(SET_COOKIE, session_cookie_value(&session_token))],
            [(axum::http::header::LOCATION, "/")],
            axum::body::Body::empty(),
        ).into_response())
    }
}

/// POST /auth/sign-out
pub async fn sign_out(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> Result<impl IntoResponse, AppError> {
    // Read cookie from headers BEFORE consuming the body.
    let cookie_token = req
        .headers()
        .get(COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| extract_cookie_value(s, "plane-session"))
        .map(|s| s.to_string());

    // Read the body and try to parse an optional JSON with session_token.
    let body_bytes = axum::body::to_bytes(req.into_body(), 1024)
        .await
        .unwrap_or_default();

    let body_token = if body_bytes.is_empty() {
        None
    } else {
        serde_json::from_slice::<SignOutRequest>(&body_bytes)
            .ok()
            .map(|b| b.session_token)
    };

    // Prefer body token, fall back to cookie token.
    let token = body_token.or(cookie_token);

    // Clear the session token in the database if we have one.
    if let Some(token) = token {
        if let Some(user) = users::Entity::find()
            .filter(users::Column::Token.eq(&token))
            .filter(users::Column::DeletedAt.is_null())
            .one(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        {
            let mut active: users::ActiveModel = user.into();
            active.token = Set(None);
            active.updated_at = Set(Some(Utc::now().fixed_offset()));
            active
                .update(&state.db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;
        }
    }

    // Always clear the cookie, even if we couldn't find the token.
    Ok((
        [(SET_COOKIE, clear_session_cookie_value())],
        Json(serde_json::json!({ "message": "Signed out" })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct SignOutRequest {
    pub session_token: String,
}

/// POST /auth/forgot-password
pub async fn forgot_password(
    State(state): State<AppState>,
    Json(body): Json<ForgotPasswordRequest>,
) -> Result<impl IntoResponse, AppError> {
    let user = users::Entity::find()
        .filter(users::Column::Email.eq(&body.email))
        .filter(users::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    // Always return success to prevent email enumeration
    let message = "If the email exists, a reset link will be sent".to_string();

    if let Some(user) = user {
        let reset_token = generate_token();
        let expiry = Utc::now() + chrono::Duration::hours(1);

        token_store()
            .lock()
            .unwrap()
            .push((reset_token.clone(), user.id, expiry));

        // In production: send email with reset link
        // For dev: return the token
        return Ok(Json(ForgotPasswordResponse {
            message,
            reset_token: Some(reset_token),
        }));
    }

    Ok(Json(ForgotPasswordResponse {
        message,
        reset_token: None,
    }))
}

/// POST /auth/reset-password
pub async fn reset_password(
    State(state): State<AppState>,
    Json(body): Json<ResetPasswordRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Validate password strength
    domain::auth::validate_password_strength(&body.password)
        .map_err(|e| AppError::BadRequest(e))?;

    // Find token in store
    let user_id = {
        let store = token_store().lock().unwrap();
        store
            .iter()
            .find(|(t, _, _)| t == &body.token)
            .filter(|(_, _, exp)| *exp > Utc::now())
            .map(|(_, uid, _)| *uid)
    };

    let user_id = user_id.ok_or(AppError::BadRequest("Invalid or expired reset token".into()))?;

    // Find user
    let user = users::Entity::find_by_id(user_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or(AppError::NotFound("User not found".into()))?;

    let password_hash = domain::auth::hash_password(&body.password)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Hash error: {}", e)))?;

    let mut active: users::ActiveModel = user.into();
    active.password_hash = Set(Some(password_hash));
    active.updated_at = Set(Some(Utc::now().fixed_offset()));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    // Remove used token
    token_store()
        .lock()
        .unwrap()
        .retain(|(t, _, _)| t != &body.token);

    Ok(Json(serde_json::json!({ "message": "Password reset successfully" })))
}

/// POST /auth/magic-link
pub async fn magic_link(
    State(state): State<AppState>,
    Json(body): Json<MagicLinkRequest>,
) -> Result<impl IntoResponse, AppError> {
    let user = users::Entity::find()
        .filter(users::Column::Email.eq(&body.email))
        .filter(users::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let message = "If the email exists, a magic link code will be sent".to_string();

    if let Some(user) = user {
        let code = generate_code();
        let expiry = Utc::now() + chrono::Duration::minutes(10);

        token_store()
            .lock()
            .unwrap()
            .push((format!("magic:{}", code), user.id, expiry));

        // In production: send email with code
        // For dev: return the code
        return Ok(Json(MagicLinkResponse {
            message,
            code: Some(code),
        }));
    }

    Ok(Json(MagicLinkResponse {
        message,
        code: None,
    }))
}

/// GET /auth/get-csrf-token
pub async fn get_csrf_token() -> Result<impl IntoResponse, AppError> {
    let token = generate_token();
    Ok((
        [(SET_COOKIE, csrf_cookie_value(&token))],
        Json(CsrfResponse { csrf_token: token }),
    ))
}

/// POST /auth/email-check/
/// Checks if an email is registered. Returns user info if found.
/// The frontend uses this to decide whether to show sign-in or sign-up flow.
pub async fn email_check(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, AppError> {
    let email = body.get("email")
        .and_then(|v| v.as_str())
        .ok_or(AppError::BadRequest("email field required".into()))?;

    let user = users::Entity::find()
        .filter(users::Column::Email.eq(email))
        .filter(users::Column::DeletedAt.is_null())
        .filter(users::Column::IsActive.eq(true))
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    match user {
        Some(u) => Ok(Json(serde_json::json!({
            "existing": true,
            "status": "CREDENTIAL",
            "id": u.id,
            "email": u.email,
            "first_name": u.display_name.clone().unwrap_or_else(|| u.username.clone()),
            "last_name": "",
            "display_name": u.display_name,
            "avatar": u.avatar,
            "is_password_autoset": false,
            "is_email_verified": u.is_email_verified,
        }))),
        None => Ok(Json(serde_json::json!({
            "existing": false,
            "status": "CREDENTIAL",
        }))),
    }
}

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

/// In-memory OAuth state store for CSRF protection.
/// Key = state string, Value = creation timestamp.
fn oauth_state_store() -> &'static std::sync::Mutex<Vec<(String, chrono::DateTime<Utc>)>> {
    static STORE: std::sync::OnceLock<std::sync::Mutex<Vec<(String, chrono::DateTime<Utc>)>>> =
        std::sync::OnceLock::new();
    STORE.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// Helper: hex encode bytes
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Helper: hex decode to bytes
fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// Generate a signed OAuth state parameter.
/// The state is a random UUID concatenated with an HMAC signature.
fn generate_oauth_state(secret: &str) -> String {
    let nonce = Uuid::new_v4().to_string();
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(nonce.as_bytes());
    let result = mac.finalize();
    let code_bytes = result.into_bytes();
    let sig = hex_encode(code_bytes.as_slice());
    format!("{}:{}", nonce, sig)
}

/// Verify an OAuth state HMAC signature. Returns the nonce if valid.
fn verify_state_signature(secret: &str, state: &str) -> Option<String> {
    let (nonce, sig) = state.rsplit_once(':')?;
    let sig_bytes = hex_decode(sig)?;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(nonce.as_bytes());
    mac.verify_slice(&sig_bytes).ok()?;
    Some(nonce.to_string())
}

/// Verify an OAuth state parameter and remove it from the store (one-time use).
fn verify_and_consume_oauth_state(secret: &str, state: &str) -> bool {
    // First verify the HMAC signature
    if verify_state_signature(secret, state).is_none() {
        return false;
    }
    // Then remove from the store (one-time use)
    let mut store = oauth_state_store().lock().unwrap();
    let before = store.len();
    store.retain(|(s, _)| s != state);
    store.len() < before // true if we removed something
}

/// Build the redirect URI for a given provider.
fn oauth_redirect_uri(base_url: &str, provider: &str) -> String {
    format!("{}/auth/{}/callback", base_url.trim_end_matches('/'), provider)
}

/// The session secret used for HMAC signing of OAuth state.
fn get_session_secret(state: &AppState) -> String {
    state.config.auth.session_secret.clone().unwrap_or_else(|| "change-me-in-production".to_string())
}

/// Clean up expired OAuth states (older than 10 minutes).
fn cleanup_expired_states() {
    let cutoff = Utc::now() - chrono::Duration::minutes(10);
    oauth_state_store().lock().unwrap().retain(|(_, ts)| *ts > cutoff);
}

// ---------------------------------------------------------------------------
// OAuth callback query params
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct OAuthCallbackParams {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// GitHub OAuth provider responses
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct GitHubTokenResponse {
    access_token: String,
    token_type: Option<String>,
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubUser {
    id: i64,
    login: String,
    email: Option<String>,
    name: Option<String>,
    avatar_url: Option<String>,
}

// ---------------------------------------------------------------------------
// GitLab OAuth provider responses
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct GitLabTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    token_type: Option<String>,
    scope: Option<String>,
    created_at: Option<i64>,
    expires_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct GitLabUser {
    id: i64,
    username: String,
    email: Option<String>,
    name: Option<String>,
    avatar_url: Option<String>,
}

// ---------------------------------------------------------------------------
// OAuth authorize + callback: GitHub
// ---------------------------------------------------------------------------

/// GET /auth/github - redirect to GitHub OAuth authorize URL
pub async fn oauth_github(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let oauth = state
        .config
        .auth
        .oauth
        .as_ref()
        .and_then(|o| o.github.as_ref());

    let cfg = match oauth {
        Some(c) => c,
        None => return Err(AppError::BadRequest("GitHub OAuth not configured".into())),
    };

    let secret = get_session_secret(&state);
    let oauth_state = generate_oauth_state(&secret);

    // Store the state for one-time-use verification
    cleanup_expired_states();
    oauth_state_store().lock().unwrap().push((oauth_state.clone(), Utc::now()));

    let redirect_uri = oauth_redirect_uri(&state.config.server.base_url, "github");
    let url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope=read:user,user:email&state={}",
        cfg.client_id,
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&oauth_state),
    );
    Ok(axum::response::Redirect::to(&url).into_response())
}

/// GET /auth/github/callback
pub async fn oauth_github_callback(
    State(state): State<AppState>,
    Query(params): Query<OAuthCallbackParams>,
) -> Result<axum::response::Response, AppError> {
    // Check for OAuth error from provider
    if let Some(err) = params.error {
        return Err(AppError::BadRequest(format!("GitHub OAuth error: {}", err)));
    }

    let code = params.code.ok_or(AppError::BadRequest("Missing authorization code".into()))?;
    let state_param = params.state.unwrap_or_default();

    // Verify state (CSRF protection)
    let secret = get_session_secret(&state);
    if !verify_and_consume_oauth_state(&secret, &state_param) {
        return Err(AppError::BadRequest("Invalid or expired OAuth state".into()));
    }

    let oauth = state.config.auth.oauth.as_ref()
        .and_then(|o| o.github.as_ref())
        .ok_or(AppError::BadRequest("GitHub OAuth not configured".into()))?;

    // Exchange code for access token
    let client = reqwest::Client::new();
    let token_resp: GitHubTokenResponse = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": oauth.client_id,
            "client_secret": oauth.client_secret,
            "code": code,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("GitHub token exchange failed: {}", e)))?
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("GitHub token parse failed: {}", e)))?;

    // Fetch user profile
    let gh_user: GitHubUser = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", token_resp.access_token))
        .header("User-Agent", "atur")
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("GitHub user fetch failed: {}", e)))?
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("GitHub user parse failed: {}", e)))?;

    let provider_account_id = gh_user.id.to_string();
    let provider = "github";

    // Try to fetch primary email if not public
    let email = if gh_user.email.is_none() || gh_user.email.as_ref().map_or(true, |e| e.is_empty()) {
        fetch_github_primary_email(&client, &token_resp.access_token).await
            .unwrap_or_else(|| format!("{}@users.noreply.github.com", gh_user.login))
    } else {
        gh_user.email.unwrap()
    };

    // Find or create user + account
    let (user, session_token) = find_or_create_oauth_user(
        &state,
        provider,
        &provider_account_id,
        &token_resp.access_token,
        None,  // no refresh token from GitHub
        &email,
        &gh_user.login,
        gh_user.name.as_deref(),
        gh_user.avatar_url.as_deref(),
    ).await?;

    // Set session and redirect to frontend
    Ok((
        StatusCode::SEE_OTHER,
        [
            (SET_COOKIE, session_cookie_value(&session_token)),
            (axum::http::header::LOCATION, "/".to_string()),
        ],
        axum::body::Body::empty(),
    ).into_response())
}

/// Fetch the primary verified email from GitHub API.
async fn fetch_github_primary_email(client: &reqwest::Client, access_token: &str) -> Option<String> {
    #[derive(Debug, Deserialize)]
    struct GitHubEmail {
        email: String,
        primary: bool,
        verified: bool,
    }
    let emails: Vec<GitHubEmail> = client
        .get("https://api.github.com/user/emails")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "atur")
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    emails.into_iter()
        .find(|e| e.primary && e.verified)
        .map(|e| e.email)
}

// ---------------------------------------------------------------------------
// OAuth authorize + callback: GitLab
// ---------------------------------------------------------------------------

/// GET /auth/gitlab - redirect to GitLab OAuth authorize URL
pub async fn oauth_gitlab(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let oauth = state
        .config
        .auth
        .oauth
        .as_ref()
        .and_then(|o| o.gitlab.as_ref());

    let cfg = match oauth {
        Some(c) => c,
        None => return Err(AppError::BadRequest("GitLab OAuth not configured".into())),
    };

    let secret = get_session_secret(&state);
    let oauth_state = generate_oauth_state(&secret);

    cleanup_expired_states();
    oauth_state_store().lock().unwrap().push((oauth_state.clone(), Utc::now()));

    let redirect_uri = oauth_redirect_uri(&state.config.server.base_url, "gitlab");
    let url = format!(
        "{}/oauth/authorize?client_id={}&redirect_uri={}&scope=read_user+email&response_type=code&state={}",
        cfg.server_url.trim_end_matches('/'),
        cfg.client_id,
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&oauth_state),
    );
    Ok(axum::response::Redirect::to(&url).into_response())
}

/// GET /auth/gitlab/callback
pub async fn oauth_gitlab_callback(
    State(state): State<AppState>,
    Query(params): Query<OAuthCallbackParams>,
) -> Result<axum::response::Response, AppError> {
    if let Some(err) = params.error {
        return Err(AppError::BadRequest(format!("GitLab OAuth error: {}", err)));
    }

    let code = params.code.ok_or(AppError::BadRequest("Missing authorization code".into()))?;
    let state_param = params.state.unwrap_or_default();

    let secret = get_session_secret(&state);
    if !verify_and_consume_oauth_state(&secret, &state_param) {
        return Err(AppError::BadRequest("Invalid or expired OAuth state".into()));
    }

    let oauth = state.config.auth.oauth.as_ref()
        .and_then(|o| o.gitlab.as_ref())
        .ok_or(AppError::BadRequest("GitLab OAuth not configured".into()))?;

    let client = reqwest::Client::new();
    let redirect_uri = oauth_redirect_uri(&state.config.server.base_url, "gitlab");

    let token_resp: GitLabTokenResponse = client
        .post(format!("{}/oauth/token", oauth.server_url.trim_end_matches('/')))
        .json(&serde_json::json!({
            "client_id": oauth.client_id,
            "client_secret": oauth.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("GitLab token exchange failed: {}", e)))?
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("GitLab token parse failed: {}", e)))?;

    let gl_user: GitLabUser = client
        .get(format!("{}/api/v4/user", oauth.server_url.trim_end_matches('/')))
        .header("Authorization", format!("Bearer {}", token_resp.access_token))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("GitLab user fetch failed: {}", e)))?
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("GitLab user parse failed: {}", e)))?;

    let provider_account_id = gl_user.id.to_string();
    let email = gl_user.email.clone().unwrap_or_else(|| format!("{}@users.noreply.gitlab.com", gl_user.username));
    let provider = "gitlab";

    let (user, session_token) = find_or_create_oauth_user(
        &state,
        provider,
        &provider_account_id,
        &token_resp.access_token,
        token_resp.refresh_token.as_deref(),
        &email,
        &gl_user.username,
        gl_user.name.as_deref(),
        gl_user.avatar_url.as_deref(),
    ).await?;

    Ok((
        StatusCode::SEE_OTHER,
        [
            (SET_COOKIE, session_cookie_value(&session_token)),
            (axum::http::header::LOCATION, "/".to_string()),
        ],
        axum::body::Body::empty(),
    ).into_response())
}

// ---------------------------------------------------------------------------
// Shared OAuth user lookup / creation
// ---------------------------------------------------------------------------

/// Given an OAuth provider + provider_account_id, either:
/// 1. Find an existing `accounts` row and update the tokens, returning the linked user
/// 2. Create a new user + account, returning the new user
///
/// Returns (user_model, session_token).
async fn find_or_create_oauth_user(
    state: &AppState,
    provider: &str,
    provider_account_id: &str,
    access_token: &str,
    refresh_token: Option<&str>,
    email: &str,
    username_hint: &str,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
) -> Result<(users::Model, String), AppError> {
    let now = Utc::now().fixed_offset();

    // 1. Look for existing account
    let existing_account = accounts::Entity::find()
        .filter(accounts::Column::Provider.eq(provider))
        .filter(accounts::Column::ProviderAccountId.eq(provider_account_id))
        .filter(accounts::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    if let Some(acct) = existing_account {
        // Update tokens on the account
        let mut active: accounts::ActiveModel = acct.clone().into();
        active.access_token = Set(Some(access_token.to_string()));
        active.refresh_token = Set(refresh_token.map(|t| t.to_string()));
        active.updated_at = Set(Some(now));
        active.update(&state.db).await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Account update error: {}", e)))?;

        // Load the user
        let user = users::Entity::find_by_id(acct.user_id)
            .one(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
            .ok_or(AppError::NotFound("Linked user not found".into()))?;

        // Generate new session token
        let session_token = generate_token();
        let mut user_active: users::ActiveModel = user.clone().into();
        user_active.token = Set(Some(session_token.clone()));
        user_active.updated_at = Set(Some(now));
        user_active.update(&state.db).await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("User update error: {}", e)))?;

        return Ok((user, session_token));
    }

    // 2. No existing account. Check if a user with this email already exists.
    let existing_user = users::Entity::find()
        .filter(users::Column::Email.eq(email))
        .filter(users::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let user = if let Some(u) = existing_user {
        // Link the OAuth account to the existing user
        u
    } else {
        // Create a new user with a random password (they'll use OAuth to sign in)
        let random_password = generate_token();
        let password_hash = domain::auth::hash_password(&random_password)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Hash error: {}", e)))?;

        // Make username unique if needed
        let mut username = username_hint.to_string();
        // Sanitize: replace invalid chars
        username = username.chars()
            .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
            .collect();
        if username.is_empty() {
            username = format!("user_{}", &Uuid::new_v4().to_string()[..8]);
        }

        // Ensure uniqueness
        let mut final_username = username.clone();
        let mut suffix = 1u32;
        loop {
            let exists = users::Entity::find()
                .filter(users::Column::Username.eq(&final_username))
                .filter(users::Column::DeletedAt.is_null())
                .one(&state.db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;
            if exists.is_none() {
                break;
            }
            final_username = format!("{}{}", username, suffix);
            suffix += 1;
        }

        let user_id = Uuid::new_v4();
        let session_token = generate_token();

        let new_user = users::ActiveModel {
            id: Set(user_id),
            email: Set(email.to_string()),
            username: Set(final_username),
            display_name: Set(display_name.map(|d| d.to_string())),
            password_hash: Set(Some(password_hash)),
            avatar: Set(avatar_url.map(|a| a.to_string())),
            token: Set(Some(session_token.clone())),
            user_timezone: Set(Some("UTC".into())),
            is_active: Set(true),
            is_superuser: Set(false),
            is_email_verified: Set(true), // OAuth emails are considered verified
            is_bot: Set(false),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        }
        .insert(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("User insert error: {}", e)))?;

        // Create profile
        let _profile = profiles::ActiveModel {
            id: Set(Uuid::new_v4()),
            theme: Set(None),
            is_onboarded: Set(false),
            onboarding_step: Set(None),
            use_case: Set(None),
            role: Set(None),
            language: Set(Some("en".into())),
            user_id: Set(user_id),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        }
        .insert(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Profile insert error: {}", e)))?;

        new_user
    };

    // Create the OAuth account record
    let session_token = user.token.clone().unwrap_or_default();
    let needs_new_token = session_token.is_empty();

    let account = accounts::ActiveModel {
        id: Set(Uuid::new_v4()),
        provider: Set(provider.to_string()),
        provider_account_id: Set(provider_account_id.to_string()),
        access_token: Set(Some(access_token.to_string())),
        refresh_token: Set(refresh_token.map(|t| t.to_string())),
        id_token: Set(None),
        metadata: Set(None),
        user_id: Set(user.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Account insert error: {}", e)))?;

    // If user didn't have a session token (e.g. was an existing user from email signup),
    // generate one now
    if needs_new_token {
        let new_token = generate_token();
        let mut user_active: users::ActiveModel = user.clone().into();
        user_active.token = Set(Some(new_token.clone()));
        user_active.updated_at = Set(Some(now));
        user_active.update(&state.db).await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("User update error: {}", e)))?;
        return Ok((user, new_token));
    }

    Ok((user, session_token))
}

// ---------------------------------------------------------------------------
// OAuth authorize + callback: Google (stub retained)
// ---------------------------------------------------------------------------

/// GET /auth/google
pub async fn oauth_google(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let oauth = state
        .config
        .auth
        .oauth
        .as_ref()
        .and_then(|o| o.google.as_ref());

    match oauth {
        Some(cfg) => {
            let url = format!(
                "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&scope=openid%20email%20profile&response_type=code",
                cfg.client_id
            );
            Ok(axum::response::Redirect::to(&url).into_response())
        }
        None => Err(AppError::BadRequest("Google OAuth not configured".into())),
    }
}

/// GET /auth/google/callback
pub async fn oauth_google_callback() -> Result<axum::response::Response, AppError> {
    Err(AppError::BadRequest(
        "Google OAuth callback not implemented".into(),
    ))
}

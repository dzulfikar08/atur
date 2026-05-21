use axum::extract::Extension;
use axum::response::IntoResponse;
use axum::Json;
use axum::routing::get;
use serde_json::json;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::state::AppState;

/// GET /api/instances/
/// Returns instance info - the frontend checks this to determine if setup is needed.
/// This is a public endpoint (no auth required).
async fn get_instance_info() -> impl IntoResponse {
    Json(json!({
        "instance": {
            "id": "00000000-0000-0000-0000-000000000000",
            "instance_name": "Plane Self-Hosted",
            "is_setup_done": true,
            "is_smtp_configured": false,
        },
        "config": {
            "is_email_server_enabled": false,
            "is_email_password_enabled": true,
            "is_magic_login_enabled": false,
            "is_signup_enabled": true,
            "is_github_enabled": false,
            "is_google_enabled": false,
            "is_gitlab_enabled": false,
            "magic_login": false,
            "slug": "plane",
        }
    }))
}

/// GET /api/instances/admins/me/
/// Returns the current user if they are a superuser, otherwise 403.
async fn get_instance_admin_me(
    Extension(current_user): Extension<CurrentUser>,
) -> Result<impl IntoResponse, AppError> {
    if !current_user.0.is_superuser {
        return Err(AppError::Forbidden("Not an instance admin".into()));
    }
    Ok(Json(json!({
        "id": current_user.0.id,
        "email": current_user.0.email,
        "first_name": current_user.0.display_name,
        "is_active": true,
    })))
}

/// Public router (no auth required) - mounted directly under /api/instances
pub fn public_router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/", get(get_instance_info))
}

/// Authed router (requires auth) - mounted under the authed api_routes
pub fn authed_router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/admins/me/", get(get_instance_admin_me))
        .route("/admins/me", get(get_instance_admin_me))
}

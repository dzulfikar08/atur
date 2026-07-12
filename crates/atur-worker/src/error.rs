use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;
use worker::console_error;

#[derive(Debug)]
pub enum AppError {
    NotFound(String),
    Unauthorized,
    BadRequest(String),
    Conflict(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "Authentication required".into()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            AppError::Internal(msg) => {
                console_error!("Internal error: {}", msg);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".into())
            }
        };
        let body = json!({"error": message});
        (status, axum::Json(body)).into_response()
    }
}

impl From<worker::Error> for AppError {
    fn from(e: worker::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

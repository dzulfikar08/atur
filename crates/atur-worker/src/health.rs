use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Json;
use axum::Router;
use serde_json::{json, Value};
use worker::send;

use crate::state::AppState;

#[send]
pub async fn health() -> Json<Value> {
    Json(json!({"status": "ok", "version": "0.1.0"}))
}

#[send]
pub async fn readiness(State(state): State<AppState>) -> impl IntoResponse {
    let db = state.env.d1("DB");
    match db {
        Ok(db) => {
            let result = db.prepare("SELECT 1").first::<Value>(None).await;
            match result {
                Ok(Some(_)) => (
                    StatusCode::OK,
                    Json(json!({"status": "ok", "checks": {"database": "ok"}})),
                )
                    .into_response(),
                _ => (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({"status": "error", "checks": {"database": "error"}})),
                )
                    .into_response(),
            }
        }
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"status": "error", "checks": {"database": "not_configured"}})),
        )
            .into_response(),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/readiness", get(readiness))
}

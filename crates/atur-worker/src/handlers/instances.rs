use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use worker::send;

use crate::error::AppError;
use crate::state::AppState;

#[send]
pub async fn get_instance(State(_state): State<AppState>) -> Result<Response, AppError> {
    Ok(Json(json!({
        "instance": {
            "version": env!("CARGO_PKG_VERSION"),
            "name": "Atur",
            "description": "Organize everything",
        }
    }))
    .into_response())
}

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Json;
use axum::Router;
use serde_json::{json, Value};

use crate::state::AppState;

// ---------------------------------------------------------------------------
// Counters (Prometheus-style)
// ---------------------------------------------------------------------------

use std::sync::atomic::{AtomicU64, Ordering};

static REQUESTS_TOTAL: AtomicU64 = AtomicU64::new(0);

/// Increment the global request counter. Called once per request.
pub fn inc_requests_total() {
    REQUESTS_TOTAL.fetch_add(1, Ordering::Relaxed);
}

/// Get the current request count.
fn get_requests_total() -> u64 {
    REQUESTS_TOTAL.load(Ordering::Relaxed)
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/readiness", get(readiness))
        .route("/metrics", get(metrics))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /health - basic liveness check
async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

/// GET /readiness - checks DB connectivity
async fn readiness(State(state): State<AppState>) -> impl IntoResponse {
    // Run a trivial query to verify the DB connection is alive.
    let db_ok = is_db_alive(&state).await;

    if db_ok {
        (StatusCode::OK, Json(json!({
            "status": "ok",
            "checks": {
                "database": "ok",
            },
        })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(json!({
            "status": "error",
            "checks": {
                "database": "error",
            },
        })))
    }
}

/// GET /metrics - Prometheus-compatible metrics
async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let requests_total = get_requests_total();
    let db_ok = is_db_alive(&state).await;
    let db_gauge = if db_ok { 1 } else { 0 };

    let body = format!(
        "# HELP plane_requests_total Total number of HTTP requests processed.\n\
         # TYPE plane_requests_total counter\n\
         plane_requests_total {requests_total}\n\
         \n\
         # HELP plane_active_connections Gauge indicating database connectivity (1=up, 0=down).\n\
         # TYPE plane_active_connections gauge\n\
         plane_active_connections {db_gauge}\n"
    );

    (
        axum::http::StatusCode::OK,
        [(
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
        )],
        body,
    )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn is_db_alive(state: &AppState) -> bool {
    // Try a trivial query. For SQLite this is always fast.
    use sea_orm::{ConnectionTrait, Statement, DatabaseBackend};
    let result = match state.db.get_database_backend() {
        DatabaseBackend::Sqlite => {
            state
                .db
                .execute(Statement::from_string(
                    DatabaseBackend::Sqlite,
                    "SELECT 1".to_string(),
                ))
                .await
        }
        DatabaseBackend::Postgres => {
            state
                .db
                .execute(Statement::from_string(
                    DatabaseBackend::Postgres,
                    "SELECT 1".to_string(),
                ))
                .await
        }
        DatabaseBackend::MySql => {
            state
                .db
                .execute(Statement::from_string(
                    DatabaseBackend::MySql,
                    "SELECT 1".to_string(),
                ))
                .await
        }
    };
    result.is_ok()
}

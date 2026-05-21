pub mod auth;
pub mod health;
pub mod instances;
pub mod users;
pub mod workspaces;
pub mod projects;
pub mod issues;
pub mod cycles;
pub mod modules;
pub mod pages;
pub mod collab;
pub mod notifications;
pub mod webhooks;
pub mod imports;
pub mod exports;
pub mod assets;
pub mod integrations;
pub mod search;
pub mod mcp;

use axum::Router;
use axum::extract::Request;
use axum::http::{StatusCode, header};
use axum::middleware;
use axum::response::{Html, IntoResponse, Response};
use axum::Json;
use tower_http::cors::{Any, CorsLayer};
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

use crate::middleware::auth::auth_middleware;
use crate::middleware::rate_limit::rate_limit_middleware;
use crate::state::AppState;

static INDEX_HTML: std::sync::OnceLock<String> = std::sync::OnceLock::new();
static EDITOR_HTML: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn get_index_html() -> &'static str {
    INDEX_HTML.get_or_init(|| {
        std::fs::read_to_string("./static-app/index.html")
            .or_else(|_| std::fs::read_to_string("./static/index.html"))
            .unwrap_or_default()
    })
}

fn get_editor_html() -> &'static str {
    EDITOR_HTML.get_or_init(|| {
        std::fs::read_to_string("./static-editor/index.html").unwrap_or_default()
    })
}

pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // API routes that go through auth middleware
    let api_routes = Router::new()
        .nest("/users", users::router())
        .nest("/instances", instances::authed_router())
        .nest("/workspaces", workspaces::router())
        .route("/workspaces/", axum::routing::get(workspaces::list_workspaces).post(workspaces::create_workspace))
        .nest("/notifications", notifications::router())
        .route("/workspace-slug-check/", axum::routing::get(workspaces::slug_check))
        .route("/workspace-slug-check", axum::routing::get(workspaces::slug_check))
        // Asset upload v2 (workspace-scoped)
        .route("/assets/v2/workspaces/{slug}/", axum::routing::post(assets::upload_asset_v2))
        .route("/assets/v2/workspaces/{slug}", axum::routing::post(assets::upload_asset_v2))
        .route("/assets/v2/workspaces/{slug}/{asset_id}/", axum::routing::patch(assets::update_v2_asset_status))
        .route("/assets/v2/workspaces/{slug}/{asset_id}", axum::routing::patch(assets::update_v2_asset_status))
        .route("/assets/v2/workspaces/{slug}/projects/{project_id}/{entity_id}/bulk/", axum::routing::post(assets::bulk_update_assets))
        .route("/assets/v2/workspaces/{slug}/projects/{project_id}/{entity_id}/bulk", axum::routing::post(assets::bulk_update_assets))
        // Unsplash proxy stub
        .route("/unsplash", axum::routing::get(unsplash_stub))
        .route("/unsplash/", axum::routing::get(unsplash_stub))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    let search_routes = Router::new()
        .route("/{workspace_slug}/search", axum::routing::get(search::search_handler))
        .route("/{workspace_slug}/search/", axum::routing::get(search::search_handler))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    let asset_routes = Router::new()
        .merge(assets::router())
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    // Public asset upload endpoint — no auth required (presigned-URL style)
    let asset_upload_routes = Router::new()
        .route("/api/assets/upload/{asset_id}", axum::routing::put(assets::upload_asset_file).post(assets::upload_asset_file))
        .route("/api/assets/upload/{asset_id}/", axum::routing::put(assets::upload_asset_file).post(assets::upload_asset_file))
        .with_state(state.clone());

    let live_routes = Router::new()
        .route("/collaboration/{page_id}", axum::routing::get(collab::collab_ws_upgrade))
        .route("/collaboration-authed/{page_id}", axum::routing::get(collab::collab_ws_upgrade_authed))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    // MCP service (no auth required)
    let mcp_service = mcp::create_mcp_service(state.db.clone());

    let app = Router::new()
        .merge(health::router())
        .nest("/auth", auth::router())
        .nest("/api/instances/", instances::public_router())
        .nest("/api/instances", instances::public_router())
        .merge(asset_upload_routes)
        // GitHub webhook receiver — outside auth middleware (GitHub sends webhooks without our auth)
        .route("/api/webhooks/github", axum::routing::post(webhooks::github_webhook_handler))
        .nest("/api", api_routes)
        .nest("/api/workspaces", search_routes)
        .nest("/api/assets", asset_routes)
        .nest("/live", live_routes)
        .route_service("/mcp", mcp_service)
        .fallback(serve_static_or_spa)
        .layer(middleware::from_fn(rate_limit_middleware))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    // Wrap with trailing-slash stripping middleware that runs BEFORE routing
    // Note: removed strip_api_trailing_slash middleware — it broke nested router
    // trailing-slash matching. Routes now handle both forms explicitly.
    app
}

/// Middleware that strips trailing slashes from API paths before routing.
/// Axum's `nest` doesn't handle trailing slashes well, so this normalizes paths.
async fn strip_api_trailing_slash(
    mut req: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let path = req.uri().path();
    if path.starts_with("/api/") && path.len() > 1 && path.ends_with('/') {
        let trimmed = path.trim_end_matches('/');
        let query = req.uri().path_and_query()
            .and_then(|pq| pq.query())
            .map(|q| format!("?{}", q))
            .unwrap_or_default();
        let new_uri_str = format!("{}{}", trimmed, query);
        if let Ok(new_uri) = axum::http::Uri::try_from(new_uri_str.as_str()) {
            *req.uri_mut() = new_uri;
        }
    }
    next.run(req).await
}

/// Fallback handler: tries to serve the static file, falls back to index.html (SPA routing).
/// API/auth/live paths return 404 JSON instead of the SPA.
async fn serve_static_or_spa(req: Request) -> Response {
    let path = req.uri().path();

    // Strip trailing slash for API/auth/live paths and redirect
    let trimmed_path = if (path.starts_with("/api/") || path.starts_with("/auth/") || path.starts_with("/live/"))
        && path.len() > 1 && path.ends_with('/')
    {
        path.trim_end_matches('/')
    } else {
        path
    };

    // Never serve SPA for API or live paths
    if trimmed_path.starts_with("/api/") || trimmed_path.starts_with("/live/") {
        // For trailing slash cases, redirect to the non-trailing-slash URL
        if trimmed_path != path {
            let query = req.uri().path_and_query()
                .and_then(|pq| pq.query())
                .map(|q| format!("?{}", q))
                .unwrap_or_default();
            let location = format!("{}{}", trimmed_path, query);
            return (
                StatusCode::PERMANENT_REDIRECT,
                [(header::LOCATION, location)],
                axum::body::Body::empty(),
            ).into_response();
        }
        return (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"error":"Not found"}"#,
        ).into_response();
    }

    // For /auth/ paths: serve SPA for GET (frontend routes like /auth/login),
    // return 404 for non-GET (API endpoints that should have been matched by the router)
    if trimmed_path.starts_with("/auth/") {
        if req.method() == axum::http::Method::GET {
            // Serve SPA for frontend auth routes (login, register, callback)
            // fall through to SPA serving below
        } else {
            return (
                StatusCode::NOT_FOUND,
                [(header::CONTENT_TYPE, "application/json")],
                r#"{"error":"Not found"}"#,
            ).into_response();
        }
    }

    // Editor SPA: serve from static-editor/ for /editor/ paths
    if trimmed_path.starts_with("/editor") {
        let editor_path = trimmed_path.trim_start_matches("/editor").trim_start_matches('/');
        if editor_path.is_empty() {
            // /editor/ → serve editor SPA index.html
            return Html(get_editor_html().to_string()).into_response();
        }
        // Try static-editor/{file}
        let full_path = format!("static-editor/{}", editor_path);
        if let Ok(content) = tokio::fs::read(&full_path).await {
            let content_type = guess_content_type(editor_path);
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, content_type)],
                content,
            ).into_response();
        }
        // SPA fallback: any /editor/* route that doesn't match a file → index.html
        return Html(get_editor_html().to_string()).into_response();
    }

    let file_path = trimmed_path.trim_start_matches('/');

    // Try to serve the file from static-app/ first, then static/
    if !file_path.is_empty() {
        let app_path = format!("static-app/{}", file_path);
        if let Ok(content) = tokio::fs::read(&app_path).await {
            let content_type = guess_content_type(file_path);
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, content_type)],
                content,
            ).into_response();
        }
        let full_path = format!("static/{}", file_path);
        if let Ok(content) = tokio::fs::read(&full_path).await {
            let content_type = guess_content_type(file_path);
            return (
                StatusCode::OK,
                [(header::CONTENT_TYPE, content_type)],
                content,
            ).into_response();
        }
    }

    // SPA fallback: serve index.html
    Html(get_index_html()).into_response()
}

/// GET /api/unsplash/ - Stub that returns empty results (no Unsplash integration).
async fn unsplash_stub(
    axum::extract::Query(_params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "results": [],
        "total": 0,
        "total_pages": 0,
    }))
}

fn guess_content_type(path: &str) -> &'static str {
    if path.ends_with(".js") || path.ends_with(".mjs") {
        "application/javascript"
    } else if path.ends_with(".css") {
        "text/css"
    } else if path.ends_with(".html") {
        "text/html"
    } else if path.ends_with(".json") {
        "application/json"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else if path.ends_with(".woff") || path.ends_with(".woff2") {
        "font/woff2"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else if path.ends_with(".gif") {
        "image/gif"
    } else {
        "application/octet-stream"
    }
}

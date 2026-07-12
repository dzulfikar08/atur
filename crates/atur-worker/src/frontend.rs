use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use worker::send;

#[send]
pub async fn fallback() -> Response {
    let html = r#"<!DOCTYPE html>
<html>
<head><title>Atur API</title></head>
<body>
  <h1>Atur — API Server</h1>
  <p>The API is running. Frontend not embedded in this deployment.</p>
  <p>Build the frontend: <code>cd frontend && npm run build</code></p>
</body>
</html>"#;
    (StatusCode::OK, [("Content-Type", "text/html; charset=utf-8")], html).into_response()
}

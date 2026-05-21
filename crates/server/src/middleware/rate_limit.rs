use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// Simple in-memory token-bucket rate limiter keyed by IP.
/// Allows `max_requests` per `window_secs` seconds.

const DEFAULT_MAX_REQUESTS: u32 = 1000;
const DEFAULT_WINDOW_SECS: u64 = 60;

struct Bucket {
    count: u32,
    reset_at: Instant,
}

struct RateLimitState {
    buckets: HashMap<String, Bucket>,
    max_requests: u32,
    window_secs: u64,
}

impl RateLimitState {
    fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            buckets: HashMap::new(),
            max_requests,
            window_secs,
        }
    }

    fn check(&mut self, key: &str) -> (bool, u32, u64) {
        let now = Instant::now();
        let entry = self.buckets.entry(key.to_string()).or_insert_with(|| Bucket {
            count: 0,
            reset_at: now + std::time::Duration::from_secs(self.window_secs),
        });

        if now >= entry.reset_at {
            entry.count = 0;
            entry.reset_at = now + std::time::Duration::from_secs(self.window_secs);
        }

        let remaining = self.max_requests.saturating_sub(entry.count);
        let reset_epoch = entry.reset_at.duration_since(Instant::now()).as_secs();

        if entry.count >= self.max_requests {
            (false, 0, reset_epoch)
        } else {
            entry.count += 1;
            (true, remaining.saturating_sub(1), reset_epoch)
        }
    }
}

fn rate_limit_store() -> &'static Mutex<RateLimitState> {
    static STORE: std::sync::OnceLock<Mutex<RateLimitState>> = std::sync::OnceLock::new();
    STORE.get_or_init(|| {
        Mutex::new(RateLimitState::new(DEFAULT_MAX_REQUESTS, DEFAULT_WINDOW_SECS))
    })
}

/// Rate-limit middleware: checks per-IP counters and returns 429 when exceeded.
pub async fn rate_limit_middleware(req: Request, next: Next) -> Response {
    crate::routes::health::inc_requests_total();

    let ip = extract_ip(&req);

    let (allowed, remaining, reset) = {
        let mut store = rate_limit_store().lock().unwrap_or_else(|e| e.into_inner());
        store.check(&ip)
    };

    if !allowed {
        let body = json!({"error": "Rate limit exceeded"});
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [
                (header::HeaderName::from_static("x-ratelimit-remaining"), HeaderValue::from(0)),
                (header::HeaderName::from_static("x-ratelimit-reset"), HeaderValue::from(reset)),
            ],
            axum::Json(body),
        )
            .into_response();
    }

    // Run the handler
    let mut response = next.run(req).await;

    // Add rate-limit headers
    let headers = response.headers_mut();
    headers.insert(
        header::HeaderName::from_static("x-ratelimit-remaining"),
        HeaderValue::from(remaining),
    );
    headers.insert(
        header::HeaderName::from_static("x-ratelimit-reset"),
        HeaderValue::from(reset),
    );

    response
}

fn extract_ip(req: &Request) -> String {
    // Try X-Forwarded-For first (reverse proxy scenario)
    if let Some(xff) = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
    {
        if let Some(first) = xff.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    // Try X-Real-IP
    if let Some(xri) = req
        .headers()
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
    {
        let trimmed = xri.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    // Fallback
    "unknown".to_string()
}

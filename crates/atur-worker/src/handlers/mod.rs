pub mod assets;
pub mod auth;
pub mod cycles;
pub mod instances;
pub mod issues;
pub mod labels;
pub mod modules;
pub mod notifications;
pub mod pages;
pub mod projects;
pub mod search;
pub mod states;
pub mod users;
pub mod workspaces;

fn get_cookie_value<'a>(cookie_str: &'a str, name: &str) -> Option<&'a str> {
    cookie_str.split(';').find_map(|c| {
        let c = c.trim();
        c.strip_prefix(&format!("{}=", name))
    })
}

fn extract_cookie(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get("Cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| get_cookie_value(s, name))
        .map(|s| s.to_string())
}

fn set_cookie(name: &str, value: &str, http_only: bool, max_age: Option<i64>) -> String {
    let mut cookie = format!("{}={}; Path=/; SameSite=Lax", name, value);
    if http_only {
        cookie.push_str("; HttpOnly");
    }
    if let Some(age) = max_age {
        cookie.push_str(&format!("; Max-Age={}", age));
    }
    if max_age == Some(0) {
        cookie.push_str("; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    }
    cookie
}

fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

//! Webhook dispatcher: finds matching webhooks and delivers event payloads via HTTP POST.
//!
//! Usage: call `dispatch_event` from any handler that creates/updates/deletes an entity.
//! The function is fire-and-forget -- it spawns a tokio task so it never blocks the caller.

use chrono::Utc;
use db::entities::{webhook_deliveries, webhooks};
use hmac::{Hmac, Mac};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde::Serialize;
use sha2::Sha256;

/// The list of event types that the system recognises.
pub const VALID_EVENTS: &[&str] = &[
    "issue.created",
    "issue.updated",
    "issue.deleted",
    "comment.created",
    "cycle.created",
    "module.created",
];

type HmacSha256 = Hmac<Sha256>;

/// Fire-and-forget: dispatch an event to all matching active webhooks.
///
/// - `db`         - database connection
/// - `workspace_id` - the workspace the event belongs to
/// - `project_id`  - optional project ID (used to match project-scoped webhooks)
/// - `event`       - e.g. "issue.created"
/// - `payload`     - arbitrary JSON-serialisable payload
pub fn dispatch_event(
    db: DatabaseConnection,
    workspace_id: uuid::Uuid,
    project_id: Option<uuid::Uuid>,
    event: String,
    payload: impl Serialize + Send + 'static,
) {
    let payload_value = match serde_json::to_value(&payload) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("failed to serialise webhook payload: {e}");
            return;
        }
    };

    tokio::spawn(async move {
        if let Err(e) = dispatch_inner(&db, workspace_id, project_id, &event, payload_value).await
        {
            tracing::error!("webhook dispatch failed: {e}");
        }
    });
}

async fn dispatch_inner(
    db: &DatabaseConnection,
    workspace_id: uuid::Uuid,
    project_id: Option<uuid::Uuid>,
    event: &str,
    payload: serde_json::Value,
) -> Result<(), anyhow::Error> {
    // Load all active, non-deleted webhooks for this workspace
    let all_hooks = webhooks::Entity::find()
        .filter(webhooks::Column::WorkspaceId.eq(workspace_id))
        .filter(webhooks::Column::IsActive.eq(true))
        .filter(webhooks::Column::DeletedAt.is_null())
        .all(db)
        .await?;

    // Filter to webhooks whose events list includes this event and whose
    // project_id scope matches (NULL project_id = all projects).
    let matching: Vec<_> = all_hooks
        .into_iter()
        .filter(|wh| {
            // Check project scope
            let project_match = match wh.project_id {
                None => true, // webhook covers all projects
                Some(pid) => project_id == Some(pid),
            };
            if !project_match {
                return false;
            }

            // Check event is in the webhook's event list
            if let Some(events) = &wh.events {
                if let Some(arr) = events.as_array() {
                    return arr.iter().any(|v| v.as_str() == Some(event));
                }
            }
            false
        })
        .collect();

    if matching.is_empty() {
        return Ok(());
    }

    // Build the outer envelope once
    let envelope = serde_json::json!({
        "event": event,
        "timestamp": Utc::now().to_rfc3339(),
        "data": payload,
    });
    let body = serde_json::to_string(&envelope)?;

    let client = reqwest::Client::new();

    for wh in matching {
        let secret = wh.secret.as_deref().unwrap_or("");

        // Compute HMAC-SHA256 signature
        let signature = compute_signature(secret, &body);

        let delivery_id = uuid::Uuid::new_v4();
        let now = Utc::now().fixed_offset();
        let webhook_id = wh.id;

        // Send the POST request
        let result = client
            .post(&wh.url)
            .header("Content-Type", "application/json")
            .header("X-Webhook-Signature", signature)
            .header("X-Webhook-Event", event)
            .header("X-Webhook-ID", delivery_id.to_string())
            .body(body.clone())
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;

        let (response_status, response_body) = match result {
            Ok(resp) => {
                let status = resp.status().as_u16() as i32;
                let text = resp.text().await.unwrap_or_default();
                (Some(status), Some(text))
            }
            Err(e) => {
                tracing::warn!(
                    "webhook delivery {} to {} failed: {e}",
                    delivery_id,
                    wh.url
                );
                (None, Some(e.to_string()))
            }
        };

        let delivered_at = if response_status.is_some() {
            Some(now)
        } else {
            None
        };

        // Record delivery
        let delivery = webhook_deliveries::ActiveModel {
            id: Set(delivery_id),
            webhook_id: Set(webhook_id),
            event: Set(event.to_string()),
            payload: Set(envelope.clone()),
            response_status: Set(response_status),
            response_body: Set(response_body.map(|b| {
                // Truncate to avoid storing huge responses
                if b.len() > 10000 {
                    format!("{}...(truncated)", &b[..10000])
                } else {
                    b
                }
            })),
            delivered_at: Set(delivered_at),
            created_at: Set(Some(now)),
        };

        if let Err(e) = delivery.insert(db).await {
            tracing::error!("failed to record webhook delivery {delivery_id}: {e}");
        }
    }

    Ok(())
}

/// Compute HMAC-SHA256 hex signature for the given body using the shared secret.
fn compute_signature(secret: &str, body: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(body.as_bytes());
    let result = mac.finalize();
    let code_bytes = result.into_bytes();
    format!("sha256={}", hex_encode(code_bytes.as_slice()))
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

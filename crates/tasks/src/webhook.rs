use anyhow::Result;
use db::entities::webhooks;
use hmac::{Hmac, Mac};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::Value;
use sha2::Sha256;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

/// Deliver a webhook payload to the configured URL.
///
/// Signs the body with HMAC-SHA256 using the webhook secret and sends:
/// - `X-Plane-Signature`: hex-encoded HMAC signature
/// - `X-Plane-Event`: the event name (e.g. "issue.created")
/// - `X-Plane-Delivery`: a unique UUID for this delivery
///
/// The delivery is performed asynchronously via a spawned tokio task.
pub async fn deliver_webhook(
    db: &sea_orm::DatabaseConnection,
    webhook_id: Uuid,
    event: &str,
    payload: &Value,
) -> Result<()> {
    let webhook = webhooks::Entity::find()
        .filter(webhooks::Column::Id.eq(webhook_id))
        .filter(webhooks::Column::DeletedAt.is_null())
        .one(db)
        .await?;

    let webhook = match webhook {
        Some(w) => w,
        None => {
            tracing::warn!(webhook_id = %webhook_id, "Webhook not found, skipping delivery");
            return Ok(());
        }
    };

    if !webhook.is_active {
        tracing::info!(webhook_id = %webhook_id, "Webhook is inactive, skipping delivery");
        return Ok(());
    }

    // Check if the event is subscribed
    let subscribed_events: Vec<String> = webhook
        .events
        .as_ref()
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    if !subscribed_events.contains(&event.to_string()) {
        tracing::info!(
            webhook_id = %webhook_id,
            event = event,
            "Event not in webhook subscription list, skipping"
        );
        return Ok(());
    }

    let url = webhook.url.clone();
    let secret = webhook.secret.clone();
    let body = serde_json::to_string(payload)?;
    let event = event.to_string();
    let delivery_id = Uuid::new_v4();

    // Spawn the HTTP request as a background task so we don't block the API
    tokio::spawn(async move {
        match send_webhook_request(&url, &secret, &event, &delivery_id, &body).await {
            Ok(()) => {
                tracing::info!(
                    webhook_id = %webhook_id,
                    delivery_id = %delivery_id,
                    event = %event,
                    "Webhook delivered successfully"
                );
            }
            Err(e) => {
                tracing::error!(
                    webhook_id = %webhook_id,
                    delivery_id = %delivery_id,
                    event = %event,
                    error = %e,
                    "Webhook delivery failed"
                );
            }
        }
    });

    Ok(())
}

/// Send the actual HTTP POST request to the webhook URL with HMAC signing.
async fn send_webhook_request(
    url: &str,
    secret: &Option<String>,
    event: &str,
    delivery_id: &Uuid,
    body: &str,
) -> Result<()> {
    let signature = match secret {
        Some(s) => compute_hmac_signature(s, body.as_bytes()),
        None => "no-secret".to_string(),
    };

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("X-Plane-Signature", signature)
        .header("X-Plane-Event", event)
        .header("X-Plane-Delivery", delivery_id.to_string())
        .body(body.to_string())
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!(
            "Webhook delivery returned non-success status {}: {}",
            status,
            body
        );
    }

    Ok(())
}

/// Compute HMAC-SHA256 signature and return it as a hex string.
fn compute_hmac_signature(secret: &str, body: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(body);
    let result = mac.finalize();
    let code_bytes = result.into_bytes();
    code_bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Deliver a webhook to all active webhooks in a workspace for a given event.
/// This is a convenience function for broadcasting events.
pub async fn broadcast_webhook(
    db: &sea_orm::DatabaseConnection,
    workspace_id: Uuid,
    event: &str,
    payload: &Value,
) -> Result<()> {
    let webhook_list = webhooks::Entity::find()
        .filter(webhooks::Column::WorkspaceId.eq(workspace_id))
        .filter(webhooks::Column::IsActive.eq(true))
        .filter(webhooks::Column::DeletedAt.is_null())
        .all(db)
        .await?;

    for webhook in webhook_list {
        // Check if the event is subscribed
        let subscribed_events: Vec<String> = webhook
            .events
            .as_ref()
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        if subscribed_events.contains(&event.to_string()) {
            if let Err(e) = deliver_webhook(db, webhook.id, event, payload).await {
                tracing::error!(
                    webhook_id = %webhook.id,
                    error = %e,
                    "Failed to queue webhook delivery"
                );
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hmac_signature() {
        let secret = "test-secret";
        let body = br#"{"test": true}"#;
        let sig = compute_hmac_signature(secret, body);

        // Should be a hex string of 64 characters (SHA-256 = 32 bytes)
        assert_eq!(sig.len(), 64);
        assert!(sig.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_hmac_signature_deterministic() {
        let secret = "test-secret";
        let body = b"hello world";
        let sig1 = compute_hmac_signature(secret, body);
        let sig2 = compute_hmac_signature(secret, body);
        assert_eq!(sig1, sig2);
    }
}

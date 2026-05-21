use anyhow::Result;
use chrono::Utc;
use db::entities::notifications;
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, DatabaseConnection};
use serde_json::json;
use uuid::Uuid;

/// Create a notification for a user when an issue activity happens.
pub async fn create_notification(
    db: &DatabaseConnection,
    receiver_id: Uuid,
    workspace_id: Uuid,
    entity_id: Uuid,
    entity_name: &str,
    title: &str,
    triggered_by_id: Uuid,
) -> Result<notifications::Model> {
    let now = Utc::now().fixed_offset();

    let notification = notifications::ActiveModel {
        id: Set(Uuid::new_v4()),
        data: Set(Some(json!({
            "issue_id": entity_id.to_string(),
            "triggered_by": triggered_by_id.to_string(),
        }))),
        entity_identifier: Set(Some(entity_id)),
        entity_name: Set(Some(entity_name.to_string())),
        title: Set(Some(title.to_string())),
        message: Set(None),
        read_at: Set(None),
        archived_at: Set(None),
        workspace_id: Set(workspace_id),
        project_id: Set(None),
        triggered_by_id: Set(Some(triggered_by_id)),
        receiver_id: Set(receiver_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(db)
    .await?;

    tracing::info!(
        notification_id = %notification.id,
        receiver_id = %receiver_id,
        entity = entity_name,
        "Created notification"
    );

    Ok(notification)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_notification_creation_fields() {
        // Verify the function signature compiles correctly
        // Actual DB tests would need a test database
    }
}

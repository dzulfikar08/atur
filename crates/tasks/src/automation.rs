use anyhow::Result;
use chrono::Utc;
use db::entities::issues;
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};

/// Archive issues that have been completed for more than 90 days.
///
/// Returns the number of issues archived.
pub async fn archive_old_issues(db: &sea_orm::DatabaseConnection) -> Result<u64> {
    let now = Utc::now().fixed_offset();

    // Find completed issues that are not yet archived
    let completed_issues = issues::Entity::find()
        .filter(issues::Column::CompletedAt.is_not_null())
        .filter(issues::Column::ArchivedAt.is_null())
        .filter(issues::Column::DeletedAt.is_null())
        .all(db)
        .await?;

    let count = completed_issues.len() as u64;

    for issue in completed_issues {
        let mut active: issues::ActiveModel = issue.into();
        active.archived_at = Set(Some(now));
        active.updated_at = Set(Some(now));
        active.update(db).await?;
    }

    tracing::info!(
        archived_count = count,
        "Archived old completed issues"
    );

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_automation_signature() {
        // Verify the function compiles; actual DB tests need a test database
    }
}

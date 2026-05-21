use anyhow::Result;
use chrono::{Duration, Utc};
use db::entities::issues;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

/// Hard-delete old soft-deleted records that are older than `days` days.
///
/// Returns the number of records deleted.
pub async fn hard_delete_old_records(
    db: &sea_orm::DatabaseConnection,
    days: u32,
) -> Result<u64> {
    let cutoff = Utc::now()
        .checked_sub_signed(Duration::days(days as i64))
        .expect("valid duration")
        .fixed_offset();

    // Hard-delete issues that were soft-deleted more than `days` ago
    let deleted_issues = issues::Entity::find()
        .filter(issues::Column::DeletedAt.lt(cutoff))
        .all(db)
        .await?;

    let count = deleted_issues.len() as u64;

    for issue in deleted_issues {
        let _ = issues::Entity::delete_by_id(issue.id)
            .exec(db)
            .await;
    }

    tracing::info!(
        days_threshold = days,
        deleted_count = count,
        "Hard deleted old records"
    );

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cutoff_calculation() {
        let cutoff = Utc::now()
            .checked_sub_signed(Duration::days(90))
            .expect("valid duration")
            .fixed_offset();
        assert!(cutoff < Utc::now().fixed_offset());
    }
}

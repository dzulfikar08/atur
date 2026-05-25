pub use migrator::Migrator;

mod m20250520_000001_initial;
mod m20250521_000002_notification_preferences;
mod m20250521_000003_user_favorites;
mod m20250521_000004_work_item_types;
mod m20250521_000005_views;
mod m20250521_000006_api_keys;
mod m20250521_000007_webhooks;
mod m20250521_000008_time_entries;
mod m20250521_000009_github_integrations;
mod m20250522_000010_custom_fields;

mod migrator {
    use sea_orm_migration::prelude::*;

    use super::m20250520_000001_initial;
    use super::m20250521_000002_notification_preferences;
    use super::m20250521_000003_user_favorites;
    use super::m20250521_000004_work_item_types;
    use super::m20250521_000005_views;
    use super::m20250521_000006_api_keys;
    use super::m20250521_000007_webhooks;
    use super::m20250521_000008_time_entries;
    use super::m20250521_000009_github_integrations;
    use super::m20250522_000010_custom_fields;

    pub struct Migrator;

    #[async_trait::async_trait]
    impl MigratorTrait for Migrator {
        fn migrations() -> Vec<Box<dyn MigrationTrait>> {
            vec![
                Box::new(m20250520_000001_initial::Migration),
                Box::new(m20250521_000002_notification_preferences::Migration),
                Box::new(m20250521_000003_user_favorites::Migration),
                Box::new(m20250521_000004_work_item_types::Migration),
                Box::new(m20250521_000005_views::Migration),
                Box::new(m20250521_000006_api_keys::Migration),
                Box::new(m20250521_000007_webhooks::Migration),
                Box::new(m20250521_000008_time_entries::Migration),
                Box::new(m20250521_000009_github_integrations::Migration),
                Box::new(m20250522_000010_custom_fields::Migration),
            ]
        }
    }
}

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Add project_id column to webhooks (nullable, NULL = all projects in workspace)
        // Skip if column already exists (idempotent)
        if !manager.has_column("webhooks", "project_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Webhooks::Table)
                        .add_column(ColumnDef::new(Webhooks::ProjectId).uuid().null())
                        .to_owned(),
                )
                .await?;
        }

        // Add created_by column to webhooks (nullable FK to users)
        if !manager.has_column("webhooks", "created_by").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Webhooks::Table)
                        .add_column(ColumnDef::new(Webhooks::CreatedBy).uuid().null())
                        .to_owned(),
                )
                .await?;
        }

        // Note: SQLite doesn't support adding FK constraints to existing tables.
        // Skip FK creation — the column reference is still valid at the application level.
        // manager.create_foreign_key(...) would panic on SQLite.

        // Create webhook_deliveries table
        manager
            .create_table(
                Table::create()
                    .table(WebhookDeliveries::Table)
                    .col(
                        ColumnDef::new(WebhookDeliveries::Id)
                            .uuid()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(WebhookDeliveries::WebhookId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(WebhookDeliveries::Event)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(WebhookDeliveries::Payload)
                            .json()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(WebhookDeliveries::ResponseStatus)
                            .integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(WebhookDeliveries::ResponseBody)
                            .text()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(WebhookDeliveries::DeliveredAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(WebhookDeliveries::CreatedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(
                                WebhookDeliveries::Table,
                                WebhookDeliveries::WebhookId,
                            )
                            .to(Webhooks::Table, Webhooks::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(WebhookDeliveries::Table).to_owned())
            .await?;

        // Remove created_by column
        manager
            .alter_table(
                Table::alter()
                    .table(Webhooks::Table)
                    .drop_column(Webhooks::CreatedBy)
                    .to_owned(),
            )
            .await?;

        // Remove project_id column
        manager
            .alter_table(
                Table::alter()
                    .table(Webhooks::Table)
                    .drop_column(Webhooks::ProjectId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

#[derive(Iden)]
enum Webhooks {
    Table,
    Id,
    #[iden = "project_id"]
    ProjectId,
    #[iden = "created_by"]
    CreatedBy,
}

#[derive(Iden)]
enum Projects {
    Table,
    Id,
}

#[derive(Iden)]
enum WebhookDeliveries {
    Table,
    Id,
    WebhookId,
    Event,
    Payload,
    ResponseStatus,
    ResponseBody,
    DeliveredAt,
    CreatedAt,
}

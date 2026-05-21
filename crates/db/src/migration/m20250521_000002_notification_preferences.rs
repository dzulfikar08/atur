use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(
            Table::create()
                .table(NotificationPreferences::Table)
                .col(ColumnDef::new(NotificationPreferences::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(NotificationPreferences::UserId).uuid().not_null())
                .col(ColumnDef::new(NotificationPreferences::WorkspaceId).uuid().null())
                .col(ColumnDef::new(NotificationPreferences::ProjectId).uuid().null())
                .col(ColumnDef::new(NotificationPreferences::PropertyChange).boolean().not_null().default(true))
                .col(ColumnDef::new(NotificationPreferences::StateChange).boolean().not_null().default(true))
                .col(ColumnDef::new(NotificationPreferences::Comment).boolean().not_null().default(true))
                .col(ColumnDef::new(NotificationPreferences::Mention).boolean().not_null().default(true))
                .col(ColumnDef::new(NotificationPreferences::IssueCompleted).boolean().not_null().default(true))
                .col(ColumnDef::new(NotificationPreferences::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(NotificationPreferences::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(NotificationPreferences::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(NotificationPreferences::Table, NotificationPreferences::UserId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.drop_table(Table::drop().table(NotificationPreferences::Table).to_owned()).await?;
        Ok(())
    }
}

#[derive(Iden)]
enum Users { Table, Id }

#[derive(Iden)]
enum NotificationPreferences {
    Table,
    Id,
    UserId,
    WorkspaceId,
    ProjectId,
    PropertyChange,
    StateChange,
    Comment,
    Mention,
    IssueCompleted,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(
            Table::create()
                .table(ApiKeys::Table)
                .col(ColumnDef::new(ApiKeys::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(ApiKeys::Name).string().not_null())
                .col(ColumnDef::new(ApiKeys::KeyHash).string().not_null().unique_key())
                .col(ColumnDef::new(ApiKeys::KeyPrefix).string().not_null())
                .col(ColumnDef::new(ApiKeys::UserId).uuid().not_null())
                .col(ColumnDef::new(ApiKeys::WorkspaceId).uuid().null())
                .col(ColumnDef::new(ApiKeys::Scopes).string().not_null().default("[]"))
                .col(ColumnDef::new(ApiKeys::LastUsedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(ApiKeys::ExpiresAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(ApiKeys::IsActive).boolean().not_null().default(true))
                .col(ColumnDef::new(ApiKeys::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(ApiKeys::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(ApiKeys::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(ApiKeys::Table, ApiKeys::UserId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(ApiKeys::Table, ApiKeys::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.drop_table(Table::drop().table(ApiKeys::Table).to_owned()).await?;
        Ok(())
    }
}

#[derive(Iden)]
enum Users { Table, Id }

#[derive(Iden)]
enum Workspaces { Table, Id }

#[derive(Iden)]
enum ApiKeys {
    Table,
    Id,
    Name,
    KeyHash,
    KeyPrefix,
    UserId,
    WorkspaceId,
    Scopes,
    LastUsedAt,
    ExpiresAt,
    IsActive,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

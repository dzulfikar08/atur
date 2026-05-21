use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(
            Table::create()
                .table(UserFavorites::Table)
                .col(ColumnDef::new(UserFavorites::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(UserFavorites::UserId).uuid().not_null())
                .col(ColumnDef::new(UserFavorites::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(UserFavorites::EntityType).string().not_null())
                .col(ColumnDef::new(UserFavorites::EntityId).uuid().not_null())
                .col(ColumnDef::new(UserFavorites::IsFavored).boolean().not_null().default(true))
                .col(ColumnDef::new(UserFavorites::SortOrder).float().not_null().default(65535.0))
                .col(ColumnDef::new(UserFavorites::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(UserFavorites::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(UserFavorites::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(UserFavorites::Table, UserFavorites::UserId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(UserFavorites::Table, UserFavorites::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.drop_table(Table::drop().table(UserFavorites::Table).to_owned()).await?;
        Ok(())
    }
}

#[derive(Iden)]
enum Users { Table, Id }

#[derive(Iden)]
enum Workspaces { Table, Id }

#[derive(Iden)]
enum UserFavorites {
    Table,
    Id,
    UserId,
    WorkspaceId,
    EntityType,
    EntityId,
    IsFavored,
    SortOrder,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

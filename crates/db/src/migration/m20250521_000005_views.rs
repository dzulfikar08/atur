use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(
            Table::create()
                .table(Views::Table)
                .col(ColumnDef::new(Views::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Views::Name).string().not_null())
                .col(ColumnDef::new(Views::Description).text().null())
                .col(ColumnDef::new(Views::Query).json().null())
                .col(ColumnDef::new(Views::IsLocked).boolean().not_null().default(false))
                .col(ColumnDef::new(Views::Access).string().not_null().default("private"))
                .col(ColumnDef::new(Views::ProjectId).uuid().not_null())
                .col(ColumnDef::new(Views::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(Views::CreatedById).uuid().null())
                .col(ColumnDef::new(Views::IsFavorite).boolean().not_null().default(false))
                .col(ColumnDef::new(Views::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Views::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Views::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Views::Table, Views::ProjectId)
                    .to(Projects::Table, Projects::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(Views::Table, Views::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.drop_table(Table::drop().table(Views::Table).to_owned()).await?;
        Ok(())
    }
}

#[derive(Iden)]
enum Projects { Table, Id }

#[derive(Iden)]
enum Workspaces { Table, Id }

#[derive(Iden)]
enum Views {
    Table,
    Id,
    Name,
    Description,
    Query,
    IsLocked,
    Access,
    ProjectId,
    WorkspaceId,
    CreatedById,
    IsFavorite,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

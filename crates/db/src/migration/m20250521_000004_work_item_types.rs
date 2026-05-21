use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(
            Table::create()
                .table(WorkItemTypes::Table)
                .col(ColumnDef::new(WorkItemTypes::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(WorkItemTypes::Name).string().not_null())
                .col(ColumnDef::new(WorkItemTypes::Description).text().null())
                .col(ColumnDef::new(WorkItemTypes::Icon).string().null())
                .col(ColumnDef::new(WorkItemTypes::Color).string().null())
                .col(ColumnDef::new(WorkItemTypes::IsActive).boolean().not_null().default(true))
                .col(ColumnDef::new(WorkItemTypes::SortOrder).float().not_null().default(65535.0))
                .col(ColumnDef::new(WorkItemTypes::ProjectId).uuid().not_null())
                .col(ColumnDef::new(WorkItemTypes::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(WorkItemTypes::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(WorkItemTypes::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(WorkItemTypes::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(WorkItemTypes::Table, WorkItemTypes::ProjectId)
                    .to(Projects::Table, Projects::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(WorkItemTypes::Table, WorkItemTypes::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.drop_table(Table::drop().table(WorkItemTypes::Table).to_owned()).await?;
        Ok(())
    }
}

#[derive(Iden)]
enum Projects { Table, Id }

#[derive(Iden)]
enum Workspaces { Table, Id }

#[derive(Iden)]
enum WorkItemTypes {
    Table,
    Id,
    Name,
    Description,
    Icon,
    Color,
    IsActive,
    SortOrder,
    ProjectId,
    WorkspaceId,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

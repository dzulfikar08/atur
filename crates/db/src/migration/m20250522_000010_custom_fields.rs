use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(
            Table::create()
                .table(CustomFields::Table)
                .col(ColumnDef::new(CustomFields::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(CustomFields::Name).string().not_null())
                .col(ColumnDef::new(CustomFields::FieldType).string().not_null())
                .col(ColumnDef::new(CustomFields::Settings).json().null())
                .col(ColumnDef::new(CustomFields::IsRequired).boolean().not_null().default(false))
                .col(ColumnDef::new(CustomFields::SortOrder).float().not_null().default(65535.0))
                .col(ColumnDef::new(CustomFields::ProjectId).uuid().not_null())
                .col(ColumnDef::new(CustomFields::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(CustomFields::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(CustomFields::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(CustomFields::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(CustomFields::Table, CustomFields::ProjectId)
                    .to(Projects::Table, Projects::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(CustomFields::Table, CustomFields::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        manager.create_table(
            Table::create()
                .table(IssueCustomValues::Table)
                .col(ColumnDef::new(IssueCustomValues::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(IssueCustomValues::IssueId).uuid().not_null())
                .col(ColumnDef::new(IssueCustomValues::CustomFieldId).uuid().not_null())
                .col(ColumnDef::new(IssueCustomValues::ValueJson).json().null())
                .col(ColumnDef::new(IssueCustomValues::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueCustomValues::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueCustomValues::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(IssueCustomValues::Table, IssueCustomValues::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(IssueCustomValues::Table, IssueCustomValues::CustomFieldId)
                    .to(CustomFields::Table, CustomFields::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        manager.create_index(
            Index::create()
                .unique()
                .name("idx_issue_custom_values_unique")
                .table(IssueCustomValues::Table)
                .col(IssueCustomValues::IssueId)
                .col(IssueCustomValues::CustomFieldId)
                .to_owned(),
        ).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.drop_table(Table::drop().table(IssueCustomValues::Table).to_owned()).await?;
        manager.drop_table(Table::drop().table(CustomFields::Table).to_owned()).await?;
        Ok(())
    }
}

#[derive(Iden)]
enum Projects { Table, Id }

#[derive(Iden)]
enum Workspaces { Table, Id }

#[derive(Iden)]
enum Issues { Table, Id }

#[derive(Iden)]
enum CustomFields {
    Table,
    Id,
    Name,
    FieldType,
    Settings,
    IsRequired,
    SortOrder,
    ProjectId,
    WorkspaceId,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(Iden)]
enum IssueCustomValues {
    Table,
    Id,
    IssueId,
    CustomFieldId,
    ValueJson,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

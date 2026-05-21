use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(TimeEntries::Table)
                    .col(
                        ColumnDef::new(TimeEntries::Id)
                            .uuid()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(TimeEntries::IssueId).uuid().not_null())
                    .col(ColumnDef::new(TimeEntries::WorkspaceId).uuid().not_null())
                    .col(ColumnDef::new(TimeEntries::UserId).uuid().not_null())
                    .col(ColumnDef::new(TimeEntries::DurationSeconds).integer().not_null())
                    .col(ColumnDef::new(TimeEntries::Description).text().null())
                    .col(
                        ColumnDef::new(TimeEntries::StartedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TimeEntries::EndedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(ColumnDef::new(TimeEntries::ClockifyId).text().null())
                    .col(
                        ColumnDef::new(TimeEntries::CreatedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(TimeEntries::UpdatedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(TimeEntries::DeletedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(TimeEntries::Table, TimeEntries::IssueId)
                            .to(Issues::Table, Issues::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(TimeEntries::Table, TimeEntries::WorkspaceId)
                            .to(Workspaces::Table, Workspaces::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(TimeEntries::Table, TimeEntries::UserId)
                            .to(Users::Table, Users::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(TimeEntries::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
enum TimeEntries {
    Table,
    Id,
    IssueId,
    WorkspaceId,
    UserId,
    DurationSeconds,
    Description,
    StartedAt,
    EndedAt,
    ClockifyId,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(Iden)]
enum Issues {
    Table,
    Id,
}

#[derive(Iden)]
enum Workspaces {
    Table,
    Id,
}

#[derive(Iden)]
enum Users {
    Table,
    Id,
}

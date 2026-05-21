use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(GithubIntegrations::Table)
                    .col(
                        ColumnDef::new(GithubIntegrations::Id)
                            .uuid()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::WorkspaceId)
                            .uuid()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::GithubRepoOwner)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::GithubRepoName)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::GithubInstallationId)
                            .text()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::AccessToken)
                            .text()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::WebhookSecret)
                            .text()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::SyncEnabled)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::ProjectId)
                            .uuid()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::LastSyncedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::CreatedBy)
                            .uuid()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::CreatedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::UpdatedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(GithubIntegrations::DeletedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(GithubIntegrations::Table, GithubIntegrations::WorkspaceId)
                            .to(Workspaces::Table, Workspaces::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(GithubIntegrations::Table, GithubIntegrations::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(GithubIntegrations::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
enum GithubIntegrations {
    Table,
    Id,
    WorkspaceId,
    GithubRepoOwner,
    GithubRepoName,
    GithubInstallationId,
    AccessToken,
    WebhookSecret,
    SyncEnabled,
    ProjectId,
    LastSyncedAt,
    CreatedBy,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(Iden)]
enum Workspaces {
    Table,
    Id,
}

#[derive(Iden)]
enum Projects {
    Table,
    Id,
}

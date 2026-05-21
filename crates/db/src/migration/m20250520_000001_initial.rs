use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let tables_in_order = [
            "users", "accounts", "profiles", "workspaces",
            "workspace_members", "workspace_invites",
            "projects", "project_members",
            "states", "labels", "estimates", "estimate_points",
            "issues", "issue_sequences", "issue_assignees", "issue_labels",
            "issue_comments", "issue_activities", "issue_relations",
            "issue_subscribers", "issue_attachments", "issue_links", "issue_reactions",
            "cycles", "cycle_issues",
            "modules", "module_issues", "module_members",
            "pages", "page_versions",
            "notifications", "notification_preferences",
            "webhooks", "file_assets", "imports",
        ];

        // Users
        manager.create_table(
            Table::create()
                .table(Users::Table)
                .col(ColumnDef::new(Users::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Users::Email).string().not_null().unique_key())
                .col(ColumnDef::new(Users::Username).string().not_null().unique_key())
                .col(ColumnDef::new(Users::DisplayName).string().null())
                .col(ColumnDef::new(Users::PasswordHash).string().null())
                .col(ColumnDef::new(Users::Avatar).text().null())
                .col(ColumnDef::new(Users::Token).string().null())
                .col(ColumnDef::new(Users::UserTimezone).string().default("UTC"))
                .col(ColumnDef::new(Users::IsActive).boolean().not_null().default(true))
                .col(ColumnDef::new(Users::IsSuperuser).boolean().not_null().default(false))
                .col(ColumnDef::new(Users::IsEmailVerified).boolean().not_null().default(false))
                .col(ColumnDef::new(Users::IsBot).boolean().not_null().default(false))
                .col(ColumnDef::new(Users::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Users::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Users::DeletedAt).timestamp_with_time_zone().null())
                .to_owned(),
        ).await?;

        // Accounts (OAuth)
        manager.create_table(
            Table::create()
                .table(Accounts::Table)
                .col(ColumnDef::new(Accounts::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Accounts::Provider).string().not_null())
                .col(ColumnDef::new(Accounts::ProviderAccountId).string().not_null())
                .col(ColumnDef::new(Accounts::AccessToken).text().null())
                .col(ColumnDef::new(Accounts::RefreshToken).text().null())
                .col(ColumnDef::new(Accounts::IdToken).text().null())
                .col(ColumnDef::new(Accounts::Metadata).json().null())
                .col(ColumnDef::new(Accounts::UserId).uuid().not_null())
                .col(ColumnDef::new(Accounts::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Accounts::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Accounts::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Accounts::Table, Accounts::UserId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .index(Index::create().col(Accounts::Provider).col(Accounts::ProviderAccountId).unique())
                .to_owned(),
        ).await?;

        // Profiles
        manager.create_table(
            Table::create()
                .table(Profiles::Table)
                .col(ColumnDef::new(Profiles::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Profiles::Theme).json().null())
                .col(ColumnDef::new(Profiles::IsOnboarded).boolean().not_null().default(false))
                .col(ColumnDef::new(Profiles::OnboardingStep).json().null())
                .col(ColumnDef::new(Profiles::UseCase).string().null())
                .col(ColumnDef::new(Profiles::Role).string().null())
                .col(ColumnDef::new(Profiles::Language).string().default("en"))
                .col(ColumnDef::new(Profiles::UserId).uuid().not_null())
                .col(ColumnDef::new(Profiles::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Profiles::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Profiles::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Profiles::Table, Profiles::UserId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Workspaces
        manager.create_table(
            Table::create()
                .table(Workspaces::Table)
                .col(ColumnDef::new(Workspaces::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Workspaces::Name).string().not_null())
                .col(ColumnDef::new(Workspaces::Slug).string().not_null().unique_key())
                .col(ColumnDef::new(Workspaces::Logo).text().null())
                .col(ColumnDef::new(Workspaces::OrganizationSize).string().null())
                .col(ColumnDef::new(Workspaces::Timezone).string().default("UTC"))
                .col(ColumnDef::new(Workspaces::BackgroundColor).string().null())
                .col(ColumnDef::new(Workspaces::OwnerId).uuid().not_null())
                .col(ColumnDef::new(Workspaces::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Workspaces::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Workspaces::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Workspaces::Table, Workspaces::OwnerId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Workspace Members
        manager.create_table(
            Table::create()
                .table(WorkspaceMembers::Table)
                .col(ColumnDef::new(WorkspaceMembers::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(WorkspaceMembers::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(WorkspaceMembers::MemberId).uuid().not_null())
                .col(ColumnDef::new(WorkspaceMembers::Role).small_integer().not_null().default(15))
                .col(ColumnDef::new(WorkspaceMembers::IsActive).boolean().not_null().default(true))
                .col(ColumnDef::new(WorkspaceMembers::ViewProps).json().null())
                .col(ColumnDef::new(WorkspaceMembers::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(WorkspaceMembers::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(WorkspaceMembers::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(WorkspaceMembers::Table, WorkspaceMembers::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(WorkspaceMembers::Table, WorkspaceMembers::MemberId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .index(Index::create().col(WorkspaceMembers::WorkspaceId).col(WorkspaceMembers::MemberId).unique())
                .to_owned(),
        ).await?;

        // Workspace Invites
        manager.create_table(
            Table::create()
                .table(WorkspaceInvites::Table)
                .col(ColumnDef::new(WorkspaceInvites::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(WorkspaceInvites::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(WorkspaceInvites::Email).string().not_null())
                .col(ColumnDef::new(WorkspaceInvites::Role).small_integer().not_null().default(15))
                .col(ColumnDef::new(WorkspaceInvites::Token).string().null())
                .col(ColumnDef::new(WorkspaceInvites::Accepted).boolean().not_null().default(false))
                .col(ColumnDef::new(WorkspaceInvites::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(WorkspaceInvites::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(WorkspaceInvites::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(WorkspaceInvites::Table, WorkspaceInvites::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Projects
        manager.create_table(
            Table::create()
                .table(Projects::Table)
                .col(ColumnDef::new(Projects::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Projects::Name).string().not_null())
                .col(ColumnDef::new(Projects::Identifier).string().not_null())
                .col(ColumnDef::new(Projects::Description).text().null())
                .col(ColumnDef::new(Projects::DescriptionHtml).json().null())
                .col(ColumnDef::new(Projects::DescriptionJson).json().null())
                .col(ColumnDef::new(Projects::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(Projects::Network).small_integer().not_null().default(0))
                .col(ColumnDef::new(Projects::Emoji).string().null())
                .col(ColumnDef::new(Projects::IconProp).json().null())
                .col(ColumnDef::new(Projects::CoverImage).text().null())
                .col(ColumnDef::new(Projects::DefaultAssigneeId).uuid().null())
                .col(ColumnDef::new(Projects::ProjectLeadId).uuid().null())
                .col(ColumnDef::new(Projects::DefaultStateId).uuid().null())
                .col(ColumnDef::new(Projects::ModuleView).boolean().not_null().default(true))
                .col(ColumnDef::new(Projects::CycleView).boolean().not_null().default(true))
                .col(ColumnDef::new(Projects::PageView).boolean().not_null().default(true))
                .col(ColumnDef::new(Projects::IntakeView).boolean().not_null().default(true))
                .col(ColumnDef::new(Projects::IsTimeTrackingEnabled).boolean().not_null().default(false))
                .col(ColumnDef::new(Projects::ArchiveIn).small_integer().null())
                .col(ColumnDef::new(Projects::CloseIn).small_integer().null())
                .col(ColumnDef::new(Projects::Timezone).string().default("UTC"))
                .col(ColumnDef::new(Projects::ArchivedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Projects::ExternalSource).string().null())
                .col(ColumnDef::new(Projects::ExternalId).string().null())
                .col(ColumnDef::new(Projects::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Projects::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Projects::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Projects::Table, Projects::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .index(Index::create().col(Projects::Identifier).col(Projects::WorkspaceId).unique())
                .to_owned(),
        ).await?;

        // Project Members
        manager.create_table(
            Table::create()
                .table(ProjectMembers::Table)
                .col(ColumnDef::new(ProjectMembers::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(ProjectMembers::ProjectId).uuid().not_null())
                .col(ColumnDef::new(ProjectMembers::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(ProjectMembers::MemberId).uuid().not_null())
                .col(ColumnDef::new(ProjectMembers::Role).small_integer().not_null().default(15))
                .col(ColumnDef::new(ProjectMembers::IsActive).boolean().not_null().default(true))
                .col(ColumnDef::new(ProjectMembers::SortOrder).float().not_null().default(65535.0))
                .col(ColumnDef::new(ProjectMembers::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(ProjectMembers::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(ProjectMembers::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(ProjectMembers::Table, ProjectMembers::ProjectId)
                    .to(Projects::Table, Projects::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(ProjectMembers::Table, ProjectMembers::MemberId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // States
        manager.create_table(
            Table::create()
                .table(States::Table)
                .col(ColumnDef::new(States::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(States::Name).string().not_null())
                .col(ColumnDef::new(States::Description).text().null())
                .col(ColumnDef::new(States::Color).string().null())
                .col(ColumnDef::new(States::Slug).string().null())
                .col(ColumnDef::new(States::Sequence).float().not_null().default(65535.0))
                .col(ColumnDef::new(States::Group).string().not_null())
                .col(ColumnDef::new(States::IsTriage).boolean().not_null().default(false))
                .col(ColumnDef::new(States::IsDefault).boolean().not_null().default(false))
                .col(ColumnDef::new(States::ProjectId).uuid().not_null())
                .col(ColumnDef::new(States::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(States::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(States::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(States::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(States::Table, States::ProjectId)
                    .to(Projects::Table, Projects::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Labels
        manager.create_table(
            Table::create()
                .table(Labels::Table)
                .col(ColumnDef::new(Labels::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Labels::Name).string().not_null())
                .col(ColumnDef::new(Labels::Description).text().null())
                .col(ColumnDef::new(Labels::Color).string().null())
                .col(ColumnDef::new(Labels::SortOrder).float().not_null().default(65535.0))
                .col(ColumnDef::new(Labels::ParentId).uuid().null())
                .col(ColumnDef::new(Labels::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(Labels::ProjectId).uuid().null())
                .col(ColumnDef::new(Labels::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Labels::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Labels::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Labels::Table, Labels::ParentId)
                    .to(Labels::Table, Labels::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(Labels::Table, Labels::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Estimates
        manager.create_table(
            Table::create()
                .table(Estimates::Table)
                .col(ColumnDef::new(Estimates::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Estimates::Name).string().not_null())
                .col(ColumnDef::new(Estimates::ProjectId).uuid().not_null())
                .col(ColumnDef::new(Estimates::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(Estimates::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Estimates::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Estimates::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Estimates::Table, Estimates::ProjectId)
                    .to(Projects::Table, Projects::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Issues
        manager.create_table(
            Table::create()
                .table(Issues::Table)
                .col(ColumnDef::new(Issues::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Issues::Name).string().not_null())
                .col(ColumnDef::new(Issues::SequenceId).big_integer().not_null())
                .col(ColumnDef::new(Issues::SortOrder).float().not_null().default(65535.0))
                .col(ColumnDef::new(Issues::Priority).string().default("none"))
                .col(ColumnDef::new(Issues::StartDate).date().null())
                .col(ColumnDef::new(Issues::TargetDate).date().null())
                .col(ColumnDef::new(Issues::CompletedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Issues::ArchivedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Issues::IsDraft).boolean().not_null().default(false))
                .col(ColumnDef::new(Issues::DescriptionJson).json().null())
                .col(ColumnDef::new(Issues::DescriptionHtml).text().null())
                .col(ColumnDef::new(Issues::DescriptionStripped).text().null())
                .col(ColumnDef::new(Issues::DescriptionBinary).binary().null())
                .col(ColumnDef::new(Issues::ParentId).uuid().null())
                .col(ColumnDef::new(Issues::StateId).uuid().null())
                .col(ColumnDef::new(Issues::EstimatePointId).uuid().null())
                .col(ColumnDef::new(Issues::TypeId).uuid().null())
                .col(ColumnDef::new(Issues::ProjectId).uuid().not_null())
                .col(ColumnDef::new(Issues::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(Issues::CreatedById).uuid().null())
                .col(ColumnDef::new(Issues::ExternalSource).string().null())
                .col(ColumnDef::new(Issues::ExternalId).string().null())
                .col(ColumnDef::new(Issues::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Issues::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Issues::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Issues::Table, Issues::ParentId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(Issues::Table, Issues::StateId)
                    .to(States::Table, States::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(Issues::Table, Issues::ProjectId)
                    .to(Projects::Table, Projects::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .index(Index::create().col(Issues::ProjectId).col(Issues::SequenceId).unique())
                .to_owned(),
        ).await?;

        // Issue Assignees
        manager.create_table(
            Table::create()
                .table(IssueAssignees::Table)
                .col(ColumnDef::new(IssueAssignees::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(IssueAssignees::IssueId).uuid().not_null())
                .col(ColumnDef::new(IssueAssignees::AssigneeId).uuid().not_null())
                .col(ColumnDef::new(IssueAssignees::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueAssignees::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueAssignees::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(IssueAssignees::Table, IssueAssignees::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(IssueAssignees::Table, IssueAssignees::AssigneeId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Issue Labels
        manager.create_table(
            Table::create()
                .table(IssueLabels::Table)
                .col(ColumnDef::new(IssueLabels::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(IssueLabels::IssueId).uuid().not_null())
                .col(ColumnDef::new(IssueLabels::LabelId).uuid().not_null())
                .col(ColumnDef::new(IssueLabels::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueLabels::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueLabels::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(IssueLabels::Table, IssueLabels::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(IssueLabels::Table, IssueLabels::LabelId)
                    .to(Labels::Table, Labels::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Issue Comments
        manager.create_table(
            Table::create()
                .table(IssueComments::Table)
                .col(ColumnDef::new(IssueComments::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(IssueComments::CommentStripped).text().null())
                .col(ColumnDef::new(IssueComments::CommentJson).json().null())
                .col(ColumnDef::new(IssueComments::CommentHtml).text().null())
                .col(ColumnDef::new(IssueComments::Access).string().default("internal"))
                .col(ColumnDef::new(IssueComments::ParentId).uuid().null())
                .col(ColumnDef::new(IssueComments::IssueId).uuid().not_null())
                .col(ColumnDef::new(IssueComments::ActorId).uuid().not_null())
                .col(ColumnDef::new(IssueComments::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueComments::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueComments::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(IssueComments::Table, IssueComments::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(IssueComments::Table, IssueComments::ActorId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Issue Activities
        manager.create_table(
            Table::create()
                .table(IssueActivities::Table)
                .col(ColumnDef::new(IssueActivities::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(IssueActivities::Verb).string().default("created"))
                .col(ColumnDef::new(IssueActivities::Field).string().null())
                .col(ColumnDef::new(IssueActivities::OldValue).text().null())
                .col(ColumnDef::new(IssueActivities::NewValue).text().null())
                .col(ColumnDef::new(IssueActivities::IssueId).uuid().null())
                .col(ColumnDef::new(IssueActivities::IssueCommentId).uuid().null())
                .col(ColumnDef::new(IssueActivities::ActorId).uuid().null())
                .col(ColumnDef::new(IssueActivities::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueActivities::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueActivities::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(IssueActivities::Table, IssueActivities::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::NoAction))
                .foreign_key(ForeignKey::create()
                    .from(IssueActivities::Table, IssueActivities::ActorId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::SetNull))
                .to_owned(),
        ).await?;

        // Issue Relations
        manager.create_table(
            Table::create()
                .table(IssueRelations::Table)
                .col(ColumnDef::new(IssueRelations::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(IssueRelations::IssueId).uuid().not_null())
                .col(ColumnDef::new(IssueRelations::RelatedIssueId).uuid().not_null())
                .col(ColumnDef::new(IssueRelations::RelationType).string().not_null())
                .col(ColumnDef::new(IssueRelations::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueRelations::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueRelations::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(IssueRelations::Table, IssueRelations::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(IssueRelations::Table, IssueRelations::RelatedIssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Issue Subscribers
        manager.create_table(
            Table::create()
                .table(IssueSubscribers::Table)
                .col(ColumnDef::new(IssueSubscribers::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(IssueSubscribers::IssueId).uuid().not_null())
                .col(ColumnDef::new(IssueSubscribers::SubscriberId).uuid().not_null())
                .col(ColumnDef::new(IssueSubscribers::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueSubscribers::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueSubscribers::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(IssueSubscribers::Table, IssueSubscribers::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Issue Attachments
        manager.create_table(
            Table::create()
                .table(IssueAttachments::Table)
                .col(ColumnDef::new(IssueAttachments::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(IssueAttachments::IssueId).uuid().not_null())
                .col(ColumnDef::new(IssueAttachments::Asset).string().null())
                .col(ColumnDef::new(IssueAttachments::Attributes).json().null())
                .col(ColumnDef::new(IssueAttachments::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueAttachments::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueAttachments::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(IssueAttachments::Table, IssueAttachments::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Issue Links
        manager.create_table(
            Table::create()
                .table(IssueLinks::Table)
                .col(ColumnDef::new(IssueLinks::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(IssueLinks::IssueId).uuid().not_null())
                .col(ColumnDef::new(IssueLinks::Title).string().null())
                .col(ColumnDef::new(IssueLinks::Url).string().null())
                .col(ColumnDef::new(IssueLinks::Metadata).json().null())
                .col(ColumnDef::new(IssueLinks::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueLinks::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueLinks::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(IssueLinks::Table, IssueLinks::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Issue Reactions
        manager.create_table(
            Table::create()
                .table(IssueReactions::Table)
                .col(ColumnDef::new(IssueReactions::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(IssueReactions::IssueId).uuid().not_null())
                .col(ColumnDef::new(IssueReactions::ActorId).uuid().not_null())
                .col(ColumnDef::new(IssueReactions::Reaction).string().not_null())
                .col(ColumnDef::new(IssueReactions::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueReactions::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueReactions::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(IssueReactions::Table, IssueReactions::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Issue Sequences
        manager.create_table(
            Table::create()
                .table(IssueSequences::Table)
                .col(ColumnDef::new(IssueSequences::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(IssueSequences::Sequence).big_integer().not_null())
                .col(ColumnDef::new(IssueSequences::IssueId).uuid().null())
                .col(ColumnDef::new(IssueSequences::ProjectId).uuid().not_null())
                .col(ColumnDef::new(IssueSequences::IsDeleted).boolean().not_null().default(false))
                .col(ColumnDef::new(IssueSequences::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueSequences::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(IssueSequences::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(IssueSequences::Table, IssueSequences::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::SetNull))
                .to_owned(),
        ).await?;

        // Cycles
        manager.create_table(
            Table::create()
                .table(Cycles::Table)
                .col(ColumnDef::new(Cycles::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Cycles::Name).string().not_null())
                .col(ColumnDef::new(Cycles::Description).text().null())
                .col(ColumnDef::new(Cycles::StartDate).date().null())
                .col(ColumnDef::new(Cycles::EndDate).date().null())
                .col(ColumnDef::new(Cycles::SortOrder).float().not_null().default(65535.0))
                .col(ColumnDef::new(Cycles::ProgressSnapshot).json().null())
                .col(ColumnDef::new(Cycles::ArchivedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Cycles::ProjectId).uuid().not_null())
                .col(ColumnDef::new(Cycles::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(Cycles::OwnedById).uuid().not_null())
                .col(ColumnDef::new(Cycles::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Cycles::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Cycles::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Cycles::Table, Cycles::ProjectId)
                    .to(Projects::Table, Projects::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(Cycles::Table, Cycles::OwnedById)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Cycle Issues
        manager.create_table(
            Table::create()
                .table(CycleIssues::Table)
                .col(ColumnDef::new(CycleIssues::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(CycleIssues::CycleId).uuid().not_null())
                .col(ColumnDef::new(CycleIssues::IssueId).uuid().not_null())
                .col(ColumnDef::new(CycleIssues::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(CycleIssues::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(CycleIssues::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(CycleIssues::Table, CycleIssues::CycleId)
                    .to(Cycles::Table, Cycles::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(CycleIssues::Table, CycleIssues::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Modules
        manager.create_table(
            Table::create()
                .table(Modules::Table)
                .col(ColumnDef::new(Modules::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Modules::Name).string().not_null())
                .col(ColumnDef::new(Modules::Description).text().null())
                .col(ColumnDef::new(Modules::Status).string().default("planned"))
                .col(ColumnDef::new(Modules::StartDate).date().null())
                .col(ColumnDef::new(Modules::TargetDate).date().null())
                .col(ColumnDef::new(Modules::SortOrder).float().not_null().default(65535.0))
                .col(ColumnDef::new(Modules::ArchivedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Modules::LeadId).uuid().null())
                .col(ColumnDef::new(Modules::ProjectId).uuid().not_null())
                .col(ColumnDef::new(Modules::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(Modules::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Modules::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Modules::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Modules::Table, Modules::ProjectId)
                    .to(Projects::Table, Projects::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(Modules::Table, Modules::LeadId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::SetNull))
                .to_owned(),
        ).await?;

        // Module Issues
        manager.create_table(
            Table::create()
                .table(ModuleIssues::Table)
                .col(ColumnDef::new(ModuleIssues::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(ModuleIssues::ModuleId).uuid().not_null())
                .col(ColumnDef::new(ModuleIssues::IssueId).uuid().not_null())
                .col(ColumnDef::new(ModuleIssues::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(ModuleIssues::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(ModuleIssues::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(ModuleIssues::Table, ModuleIssues::ModuleId)
                    .to(Modules::Table, Modules::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(ModuleIssues::Table, ModuleIssues::IssueId)
                    .to(Issues::Table, Issues::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Module Members
        manager.create_table(
            Table::create()
                .table(ModuleMembers::Table)
                .col(ColumnDef::new(ModuleMembers::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(ModuleMembers::ModuleId).uuid().not_null())
                .col(ColumnDef::new(ModuleMembers::MemberId).uuid().not_null())
                .col(ColumnDef::new(ModuleMembers::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(ModuleMembers::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(ModuleMembers::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(ModuleMembers::Table, ModuleMembers::ModuleId)
                    .to(Modules::Table, Modules::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Pages
        manager.create_table(
            Table::create()
                .table(Pages::Table)
                .col(ColumnDef::new(Pages::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Pages::Name).text().not_null())
                .col(ColumnDef::new(Pages::DescriptionJson).json().null())
                .col(ColumnDef::new(Pages::DescriptionBinary).binary().null())
                .col(ColumnDef::new(Pages::DescriptionHtml).text().null())
                .col(ColumnDef::new(Pages::DescriptionStripped).text().null())
                .col(ColumnDef::new(Pages::Access).small_integer().not_null().default(0))
                .col(ColumnDef::new(Pages::Color).string().null())
                .col(ColumnDef::new(Pages::ArchivedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Pages::IsLocked).boolean().not_null().default(false))
                .col(ColumnDef::new(Pages::SortOrder).float().not_null().default(65535.0))
                .col(ColumnDef::new(Pages::ParentId).uuid().null())
                .col(ColumnDef::new(Pages::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(Pages::OwnedById).uuid().not_null())
                .col(ColumnDef::new(Pages::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Pages::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Pages::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Pages::Table, Pages::ParentId)
                    .to(Pages::Table, Pages::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(Pages::Table, Pages::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Page Versions
        manager.create_table(
            Table::create()
                .table(PageVersions::Table)
                .col(ColumnDef::new(PageVersions::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(PageVersions::PageId).uuid().not_null())
                .col(ColumnDef::new(PageVersions::DescriptionBinary).binary().null())
                .col(ColumnDef::new(PageVersions::DescriptionHtml).text().null())
                .col(ColumnDef::new(PageVersions::DescriptionJson).json().null())
                .col(ColumnDef::new(PageVersions::LastSavedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(PageVersions::OwnedById).uuid().null())
                .col(ColumnDef::new(PageVersions::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(PageVersions::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(PageVersions::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(PageVersions::Table, PageVersions::PageId)
                    .to(Pages::Table, Pages::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Notifications
        manager.create_table(
            Table::create()
                .table(Notifications::Table)
                .col(ColumnDef::new(Notifications::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Notifications::Data).json().null())
                .col(ColumnDef::new(Notifications::EntityIdentifier).uuid().null())
                .col(ColumnDef::new(Notifications::EntityName).string().null())
                .col(ColumnDef::new(Notifications::Title).text().null())
                .col(ColumnDef::new(Notifications::Message).json().null())
                .col(ColumnDef::new(Notifications::ReadAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Notifications::ArchivedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Notifications::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(Notifications::ProjectId).uuid().null())
                .col(ColumnDef::new(Notifications::TriggeredById).uuid().null())
                .col(ColumnDef::new(Notifications::ReceiverId).uuid().not_null())
                .col(ColumnDef::new(Notifications::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Notifications::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Notifications::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Notifications::Table, Notifications::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .foreign_key(ForeignKey::create()
                    .from(Notifications::Table, Notifications::ReceiverId)
                    .to(Users::Table, Users::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // Webhooks
        manager.create_table(
            Table::create()
                .table(Webhooks::Table)
                .col(ColumnDef::new(Webhooks::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Webhooks::Url).string().not_null())
                .col(ColumnDef::new(Webhooks::Secret).string().null())
                .col(ColumnDef::new(Webhooks::Events).json().null())
                .col(ColumnDef::new(Webhooks::IsActive).boolean().not_null().default(true))
                .col(ColumnDef::new(Webhooks::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(Webhooks::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Webhooks::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Webhooks::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Webhooks::Table, Webhooks::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        // File Assets
        manager.create_table(
            Table::create()
                .table(FileAssets::Table)
                .col(ColumnDef::new(FileAssets::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(FileAssets::Asset).string().null())
                .col(ColumnDef::new(FileAssets::Attributes).json().null())
                .col(ColumnDef::new(FileAssets::EntityId).uuid().null())
                .col(ColumnDef::new(FileAssets::EntityType).string().null())
                .col(ColumnDef::new(FileAssets::Size).big_integer().null())
                .col(ColumnDef::new(FileAssets::ContentType).string().null())
                .col(ColumnDef::new(FileAssets::IsUploaded).boolean().not_null().default(false))
                .col(ColumnDef::new(FileAssets::CreatedById).uuid().not_null())
                .col(ColumnDef::new(FileAssets::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(FileAssets::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(FileAssets::DeletedAt).timestamp_with_time_zone().null())
                .to_owned(),
        ).await?;

        // Imports
        manager.create_table(
            Table::create()
                .table(Imports::Table)
                .col(ColumnDef::new(Imports::Id).uuid().not_null().primary_key())
                .col(ColumnDef::new(Imports::Service).string().not_null())
                .col(ColumnDef::new(Imports::Status).string().default("queued"))
                .col(ColumnDef::new(Imports::Data).json().null())
                .col(ColumnDef::new(Imports::Metadata).json().null())
                .col(ColumnDef::new(Imports::WorkspaceId).uuid().not_null())
                .col(ColumnDef::new(Imports::ProjectId).uuid().null())
                .col(ColumnDef::new(Imports::CreatedById).uuid().not_null())
                .col(ColumnDef::new(Imports::CreatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Imports::UpdatedAt).timestamp_with_time_zone().null())
                .col(ColumnDef::new(Imports::DeletedAt).timestamp_with_time_zone().null())
                .foreign_key(ForeignKey::create()
                    .from(Imports::Table, Imports::WorkspaceId)
                    .to(Workspaces::Table, Workspaces::Id)
                    .on_delete(ForeignKeyAction::Cascade))
                .to_owned(),
        ).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let tables = [
            "imports", "file_assets", "webhooks", "notifications",
            "page_versions", "pages",
            "module_members", "module_issues", "modules",
            "cycle_issues", "cycles",
            "issue_reactions", "issue_links", "issue_attachments",
            "issue_subscribers", "issue_relations", "issue_activities",
            "issue_comments", "issue_labels", "issue_assignees",
            "issue_sequences", "issues",
            "estimates", "labels", "states",
            "project_members", "projects",
            "workspace_invites", "workspace_members",
            "workspaces", "profiles", "accounts", "users",
        ];
        for t in tables {
            manager.drop_table(Table::drop().table(Alias::new(t)).to_owned()).await?;
        }
        Ok(())
    }
}

// Table identifier enums
#[derive(Iden)]
enum Users { Table, Id, Email, Username, DisplayName, PasswordHash, Avatar, Token, UserTimezone, IsActive, IsSuperuser, IsEmailVerified, IsBot, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Accounts { Table, Id, Provider, ProviderAccountId, AccessToken, RefreshToken, IdToken, Metadata, UserId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Profiles { Table, Id, Theme, IsOnboarded, OnboardingStep, UseCase, Role, Language, UserId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Workspaces { Table, Id, Name, Slug, Logo, OrganizationSize, Timezone, BackgroundColor, OwnerId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum WorkspaceMembers { Table, Id, WorkspaceId, MemberId, Role, IsActive, ViewProps, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum WorkspaceInvites { Table, Id, WorkspaceId, Email, Role, Token, Accepted, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Projects { Table, Id, Name, Identifier, Description, DescriptionHtml, DescriptionJson, WorkspaceId, Network, Emoji, IconProp, CoverImage, DefaultAssigneeId, ProjectLeadId, DefaultStateId, ModuleView, CycleView, PageView, IntakeView, IsTimeTrackingEnabled, ArchiveIn, CloseIn, Timezone, ArchivedAt, ExternalSource, ExternalId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum ProjectMembers { Table, Id, ProjectId, WorkspaceId, MemberId, Role, IsActive, SortOrder, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum States { Table, Id, Name, Description, Color, Slug, Sequence, Group, IsTriage, IsDefault, ProjectId, WorkspaceId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Labels { Table, Id, Name, Description, Color, SortOrder, ParentId, WorkspaceId, ProjectId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Estimates { Table, Id, Name, ProjectId, WorkspaceId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Issues { Table, Id, Name, SequenceId, SortOrder, Priority, StartDate, TargetDate, CompletedAt, ArchivedAt, IsDraft, DescriptionJson, DescriptionHtml, DescriptionStripped, DescriptionBinary, ParentId, StateId, EstimatePointId, TypeId, ProjectId, WorkspaceId, CreatedById, ExternalSource, ExternalId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum IssueAssignees { Table, Id, IssueId, AssigneeId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum IssueLabels { Table, Id, IssueId, LabelId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum IssueComments { Table, Id, CommentStripped, CommentJson, CommentHtml, Access, ParentId, IssueId, ActorId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum IssueActivities { Table, Id, Verb, Field, OldValue, NewValue, IssueId, IssueCommentId, ActorId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum IssueRelations { Table, Id, IssueId, RelatedIssueId, RelationType, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum IssueSubscribers { Table, Id, IssueId, SubscriberId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum IssueAttachments { Table, Id, IssueId, Asset, Attributes, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum IssueLinks { Table, Id, IssueId, Title, Url, Metadata, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum IssueReactions { Table, Id, IssueId, ActorId, Reaction, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum IssueSequences { Table, Id, Sequence, IssueId, ProjectId, IsDeleted, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Cycles { Table, Id, Name, Description, StartDate, EndDate, SortOrder, ProgressSnapshot, ArchivedAt, ProjectId, WorkspaceId, OwnedById, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum CycleIssues { Table, Id, CycleId, IssueId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Modules { Table, Id, Name, Description, Status, StartDate, TargetDate, SortOrder, ArchivedAt, LeadId, ProjectId, WorkspaceId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum ModuleIssues { Table, Id, ModuleId, IssueId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum ModuleMembers { Table, Id, ModuleId, MemberId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Pages { Table, Id, Name, DescriptionJson, DescriptionBinary, DescriptionHtml, DescriptionStripped, Access, Color, ArchivedAt, IsLocked, SortOrder, ParentId, WorkspaceId, OwnedById, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum PageVersions { Table, Id, PageId, DescriptionBinary, DescriptionHtml, DescriptionJson, LastSavedAt, OwnedById, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Notifications { Table, Id, Data, EntityIdentifier, EntityName, Title, Message, ReadAt, ArchivedAt, WorkspaceId, ProjectId, TriggeredById, ReceiverId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Webhooks { Table, Id, Url, Secret, Events, IsActive, WorkspaceId, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum FileAssets { Table, Id, Asset, Attributes, EntityId, EntityType, Size, ContentType, IsUploaded, CreatedById, CreatedAt, UpdatedAt, DeletedAt }

#[derive(Iden)]
enum Imports { Table, Id, Service, Status, Data, Metadata, WorkspaceId, ProjectId, CreatedById, CreatedAt, UpdatedAt, DeletedAt }

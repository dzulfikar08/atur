use chrono::{DateTime, FixedOffset};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "projects")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub name: String,
    pub identifier: String,
    pub description: Option<String>,
    pub description_html: Option<serde_json::Value>,
    pub description_json: Option<serde_json::Value>,
    pub workspace_id: Uuid,
    pub network: i16,
    pub emoji: Option<String>,
    pub icon_prop: Option<serde_json::Value>,
    pub cover_image: Option<String>,
    pub default_assignee_id: Option<Uuid>,
    pub project_lead_id: Option<Uuid>,
    pub default_state_id: Option<Uuid>,
    pub module_view: bool,
    pub cycle_view: bool,
    pub page_view: bool,
    pub intake_view: bool,
    pub is_time_tracking_enabled: bool,
    pub archive_in: Option<i16>,
    pub close_in: Option<i16>,
    pub timezone: Option<String>,
    pub archived_at: Option<DateTime<FixedOffset>>,
    pub external_source: Option<String>,
    pub external_id: Option<String>,
    pub created_at: Option<DateTime<FixedOffset>>,
    pub updated_at: Option<DateTime<FixedOffset>>,
    pub deleted_at: Option<DateTime<FixedOffset>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::workspaces::Entity",
        from = "Column::WorkspaceId",
        to = "super::workspaces::Column::Id"
    )]
    Workspace,
    #[sea_orm(has_many = "super::project_members::Entity")]
    ProjectMembers,
    #[sea_orm(has_many = "super::states::Entity")]
    States,
    #[sea_orm(has_many = "super::estimates::Entity")]
    Estimates,
}

impl Related<super::workspaces::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Workspace.def()
    }
}

impl Related<super::project_members::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ProjectMembers.def()
    }
}

impl Related<super::states::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::States.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

use chrono::{DateTime, FixedOffset};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "issues")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub name: String,
    pub sequence_id: i64,
    pub sort_order: f32,
    pub priority: Option<String>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub completed_at: Option<DateTime<FixedOffset>>,
    pub archived_at: Option<DateTime<FixedOffset>>,
    pub is_draft: bool,
    pub description_json: Option<serde_json::Value>,
    pub description_html: Option<String>,
    pub description_stripped: Option<String>,
    pub description_binary: Option<Vec<u8>>,
    pub parent_id: Option<Uuid>,
    pub state_id: Option<Uuid>,
    pub estimate_point_id: Option<Uuid>,
    pub type_id: Option<Uuid>,
    pub project_id: Uuid,
    pub workspace_id: Uuid,
    pub created_by_id: Option<Uuid>,
    pub external_source: Option<String>,
    pub external_id: Option<String>,
    pub created_at: Option<DateTime<FixedOffset>>,
    pub updated_at: Option<DateTime<FixedOffset>>,
    pub deleted_at: Option<DateTime<FixedOffset>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::projects::Entity",
        from = "Column::ProjectId",
        to = "super::projects::Column::Id"
    )]
    Project,
    #[sea_orm(
        belongs_to = "super::workspaces::Entity",
        from = "Column::WorkspaceId",
        to = "super::workspaces::Column::Id"
    )]
    Workspace,
    #[sea_orm(
        belongs_to = "super::issues::Entity",
        from = "Column::ParentId",
        to = "super::issues::Column::Id"
    )]
    Parent,
    #[sea_orm(
        belongs_to = "super::states::Entity",
        from = "Column::StateId",
        to = "super::states::Column::Id"
    )]
    State,
}

impl Related<super::projects::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Project.def()
    }
}

impl Related<super::workspaces::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Workspace.def()
    }
}

impl Related<super::states::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::State.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

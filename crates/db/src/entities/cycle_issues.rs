use chrono::{DateTime, FixedOffset};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "cycle_issues")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub cycle_id: Uuid,
    pub issue_id: Uuid,
    pub created_at: Option<DateTime<FixedOffset>>,
    pub updated_at: Option<DateTime<FixedOffset>>,
    pub deleted_at: Option<DateTime<FixedOffset>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::cycles::Entity",
        from = "Column::CycleId",
        to = "super::cycles::Column::Id"
    )]
    Cycle,
    #[sea_orm(
        belongs_to = "super::issues::Entity",
        from = "Column::IssueId",
        to = "super::issues::Column::Id"
    )]
    Issue,
}

impl Related<super::cycles::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Cycle.def()
    }
}

impl Related<super::issues::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Issue.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

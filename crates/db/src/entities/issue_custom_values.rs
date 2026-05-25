use chrono::{DateTime, FixedOffset};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "issue_custom_values")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub issue_id: Uuid,
    pub custom_field_id: Uuid,
    pub value_json: Option<serde_json::Value>,
    pub created_at: Option<DateTime<FixedOffset>>,
    pub updated_at: Option<DateTime<FixedOffset>>,
    pub deleted_at: Option<DateTime<FixedOffset>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::issues::Entity",
        from = "Column::IssueId",
        to = "super::issues::Column::Id"
    )]
    Issue,
    #[sea_orm(
        belongs_to = "super::custom_fields::Entity",
        from = "Column::CustomFieldId",
        to = "super::custom_fields::Column::Id"
    )]
    CustomField,
}

impl Related<super::issues::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Issue.def()
    }
}

impl Related<super::custom_fields::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::CustomField.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

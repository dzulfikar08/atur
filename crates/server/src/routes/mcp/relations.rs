use chrono::Utc;
use db::entities::{issue_relations, issues};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};
use uuid::Uuid;

use super::*;

// --- Relations parameter structs ---

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListIssueRelationsParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub issue_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AddIssueRelationParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub issue_id: String,
    pub related_issue_id: String,
    #[schemars(description = "Relation type: blocks, blocked_by, relates_to, duplicates")]
    pub relation_type: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RemoveIssueRelationParams {
    pub workspace: Option<String>,
    pub relation_id: String,
}

// --- Relations implementations ---

pub async fn list_issue_relations_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListIssueRelationsParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    // Find relations where this issue is either side
    let relations = match issue_relations::Entity::find()
        .filter(
            issue_relations::Column::IssueId
                .eq(issue_id)
                .or(issue_relations::Column::RelatedIssueId.eq(issue_id)),
        )
        .filter(issue_relations::Column::DeletedAt.is_null())
        .all(db)
        .await
    {
        Ok(r) => r,
        Err(e) => return err_str(e),
    };

    let mut result = Vec::new();
    for rel in &relations {
        // Determine the "other" issue
        let other_id = if rel.issue_id == issue_id {
            rel.related_issue_id
        } else {
            rel.issue_id
        };

        // Look up the other issue's name and sequence_id
        let (name, sequence_id) = match issues::Entity::find_by_id(other_id).one(db).await {
            Ok(Some(i)) => (i.name, i.sequence_id),
            _ => ("Unknown".to_string(), 0),
        };

        result.push(serde_json::json!({
            "id": rel.id,
            "issue_id": rel.issue_id,
            "related_issue_id": rel.related_issue_id,
            "relation_type": rel.relation_type,
            "related_issue_name": name,
            "related_issue_sequence_id": sequence_id,
        }));
    }

    ok_json(serde_json::json!(result))
}

pub async fn add_issue_relation_impl(
    db: &sea_orm::DatabaseConnection,
    params: AddIssueRelationParams,
    bot_user_id: Uuid,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let related_issue_id = match parse_uuid(&params.related_issue_id, "related_issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    // Validate relation_type
    let valid_types = ["blocks", "blocked_by", "relates_to", "duplicates"];
    if !valid_types.contains(&params.relation_type.as_str()) {
        return err_str(format!(
            "Invalid relation_type '{}'. Must be one of: {}",
            params.relation_type,
            valid_types.join(", ")
        ));
    }

    // Verify both issues exist in project
    for (id, label) in [(issue_id, "issue_id"), (related_issue_id, "related_issue_id")] {
        match issues::Entity::find()
            .filter(issues::Column::Id.eq(id))
            .filter(issues::Column::ProjectId.eq(project_id))
            .filter(issues::Column::DeletedAt.is_null())
            .one(db)
            .await
        {
            Ok(Some(_)) => {}
            Ok(None) => return err_str(format!("{} not found in project", label)),
            Err(e) => return err_str(e),
        }
    }

    // Check no duplicate
    match issue_relations::Entity::find()
        .filter(issue_relations::Column::IssueId.eq(issue_id))
        .filter(issue_relations::Column::RelatedIssueId.eq(related_issue_id))
        .filter(issue_relations::Column::RelationType.eq(&params.relation_type))
        .filter(issue_relations::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => return err_str("This relation already exists"),
        Ok(None) => {}
        Err(e) => return err_str(e),
    }

    let now = Utc::now().fixed_offset();

    match (issue_relations::ActiveModel {
        id: Set(Uuid::new_v4()),
        issue_id: Set(issue_id),
        related_issue_id: Set(related_issue_id),
        relation_type: Set(params.relation_type),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(rel) => ok_json(serde_json::json!({
            "id": rel.id,
            "issue_id": rel.issue_id,
            "related_issue_id": rel.related_issue_id,
            "relation_type": rel.relation_type,
        })),
        Err(e) => err_str(format!("Relation insert error: {}", e)),
    }
}

pub async fn remove_issue_relation_impl(
    db: &sea_orm::DatabaseConnection,
    params: RemoveIssueRelationParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let relation_id = match parse_uuid(&params.relation_id, "relation_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let rel = match issue_relations::Entity::find()
        .filter(issue_relations::Column::Id.eq(relation_id))
        .filter(issue_relations::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) => return err_str("Relation not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: issue_relations::ActiveModel = rel.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(_) => ok_json(serde_json::json!({ "message": "Relation removed" })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

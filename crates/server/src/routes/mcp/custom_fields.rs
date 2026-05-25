use db::entities::{custom_fields, issue_custom_values};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use uuid::Uuid;

use super::*;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListCustomFieldsParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GetCustomFieldParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Custom field UUID")]
    pub field_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SetCustomFieldValueParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Issue UUID")]
    pub issue_id: String,
    #[schemars(description = "Custom field UUID")]
    pub custom_field_id: String,
    #[schemars(description = "JSON value for the field (null to clear)")]
    pub value_json: Option<serde_json::Value>,
}

pub async fn list_custom_fields_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListCustomFieldsParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    match custom_fields::Entity::find()
        .filter(custom_fields::Column::ProjectId.eq(project_id))
        .filter(custom_fields::Column::WorkspaceId.eq(ws.id))
        .filter(custom_fields::Column::DeletedAt.is_null())
        .order_by_asc(custom_fields::Column::SortOrder)
        .all(db)
        .await
    {
        Ok(list) => {
            let result: Vec<serde_json::Value> = list
                .iter()
                .map(|f| {
                    serde_json::json!({
                        "id": f.id,
                        "name": f.name,
                        "field_type": f.field_type,
                        "settings": f.settings,
                        "is_required": f.is_required,
                        "sort_order": f.sort_order,
                    })
                })
                .collect();
            ok_json(serde_json::json!(result))
        }
        Err(e) => err_str(e),
    }
}

pub async fn get_custom_field_impl(
    db: &sea_orm::DatabaseConnection,
    params: GetCustomFieldParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let field_id = match parse_uuid(&params.field_id, "field_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    match custom_fields::Entity::find_by_id(field_id)
        .one(db)
        .await
    {
        Ok(Some(f)) if f.project_id == project_id && f.deleted_at.is_none() => {
            ok_json(serde_json::json!({
                "id": f.id,
                "name": f.name,
                "field_type": f.field_type,
                "settings": f.settings,
                "is_required": f.is_required,
                "sort_order": f.sort_order,
                "project_id": f.project_id,
                "workspace_id": f.workspace_id,
            }))
        }
        Ok(_) => err_str("Custom field not found"),
        Err(e) => err_str(e),
    }
}

pub async fn set_custom_field_value_impl(
    db: &sea_orm::DatabaseConnection,
    params: SetCustomFieldValueParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let custom_field_id = match parse_uuid(&params.custom_field_id, "custom_field_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    // Check field exists
    let field = match custom_fields::Entity::find_by_id(custom_field_id).one(db).await {
        Ok(Some(f)) if f.deleted_at.is_none() => f,
        Ok(_) => return err_str("Custom field not found"),
        Err(e) => return err_str(e),
    };

    let now = chrono::Utc::now().fixed_offset();

    if params.value_json.is_none() || params.value_json.as_ref().map_or(false, |v| v.is_null()) {
        // Clear value
        match issue_custom_values::Entity::find()
            .filter(issue_custom_values::Column::IssueId.eq(issue_id))
            .filter(issue_custom_values::Column::CustomFieldId.eq(custom_field_id))
            .filter(issue_custom_values::Column::DeletedAt.is_null())
            .one(db)
            .await
        {
            Ok(Some(row)) => {
                let mut active: issue_custom_values::ActiveModel = row.into();
                active.deleted_at = Set(Some(now));
                active.updated_at = Set(Some(now));
                match active.update(db).await {
                    Ok(_) => ok_json(serde_json::json!({"success": true, "action": "cleared"})),
                    Err(e) => return err_str(e),
                }
            }
            Ok(None) => ok_json(serde_json::json!({"success": true, "action": "noop", "reason": "no existing value"})),
            Err(e) => return err_str(e),
        }
    } else {
        // Upsert value
        let existing = match issue_custom_values::Entity::find()
            .filter(issue_custom_values::Column::IssueId.eq(issue_id))
            .filter(issue_custom_values::Column::CustomFieldId.eq(custom_field_id))
            .filter(issue_custom_values::Column::DeletedAt.is_null())
            .one(db)
            .await
        {
            Ok(o) => o,
            Err(e) => return err_str(e),
        };

        match existing {
            Some(row) => {
                let mut active: issue_custom_values::ActiveModel = row.into();
                active.value_json = Set(params.value_json.clone());
                active.updated_at = Set(Some(now));
                match active.update(db).await {
                    Ok(_) => ok_json(serde_json::json!({"success": true, "action": "updated", "field": field.name})),
                    Err(e) => return err_str(e),
                }
            }
            None => {
                let new_val = issue_custom_values::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    issue_id: Set(issue_id),
                    custom_field_id: Set(custom_field_id),
                    value_json: Set(params.value_json.clone()),
                    created_at: Set(Some(now)),
                    updated_at: Set(Some(now)),
                    deleted_at: Set(None),
                };
                match new_val.insert(db).await {
                    Ok(_) => ok_json(serde_json::json!({"success": true, "action": "created", "field": field.name})),
                    Err(e) => return err_str(e),
                }
            }
        }
    }
}

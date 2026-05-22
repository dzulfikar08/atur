use chrono::Utc;
use db::entities::{issues, module_issues, modules};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use uuid::Uuid;

use super::*;

// --- Modules parameter structs ---

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListModulesParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GetModuleParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Module UUID")]
    pub module_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AddIssueToModuleParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Module UUID")]
    pub module_id: String,
    #[schemars(description = "Issue UUID")]
    pub issue_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RemoveIssueFromModuleParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Module UUID")]
    pub module_id: String,
    #[schemars(description = "Issue UUID")]
    pub issue_id: String,
}

// --- Modules implementations ---

pub async fn list_modules_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListModulesParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    match modules::Entity::find()
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::WorkspaceId.eq(ws.id))
        .filter(modules::Column::DeletedAt.is_null())
        .filter(modules::Column::ArchivedAt.is_null())
        .order_by_asc(modules::Column::SortOrder)
        .all(db)
        .await
    {
        Ok(list) => {
            let result: Vec<serde_json::Value> = list.iter().map(module_to_json).collect();
            ok_json(serde_json::json!(result))
        }
        Err(e) => err_str(e),
    }
}

pub async fn get_module_impl(
    db: &sea_orm::DatabaseConnection,
    params: GetModuleParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let module_id = match parse_uuid(&params.module_id, "module_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let module = match modules::Entity::find()
        .filter(modules::Column::Id.eq(module_id))
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::WorkspaceId.eq(ws.id))
        .filter(modules::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(m)) => m,
        Ok(None) => return err_str("Module not found"),
        Err(e) => return err_str(e),
    };

    // Count issues in module
    let issue_count = match module_issues::Entity::find()
        .filter(module_issues::Column::ModuleId.eq(module_id))
        .filter(module_issues::Column::DeletedAt.is_null())
        .all(db)
        .await
    {
        Ok(list) => list.len(),
        Err(e) => return err_str(e),
    };

    let mut val = module_to_json(&module);
    val["issue_count"] = serde_json::json!(issue_count);
    ok_json(val)
}

pub async fn add_issue_to_module_impl(
    db: &sea_orm::DatabaseConnection,
    params: AddIssueToModuleParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let module_id = match parse_uuid(&params.module_id, "module_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    // Verify module exists
    match modules::Entity::find()
        .filter(modules::Column::Id.eq(module_id))
        .filter(modules::Column::ProjectId.eq(project_id))
        .filter(modules::Column::WorkspaceId.eq(ws.id))
        .filter(modules::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err_str("Module not found"),
        Err(e) => return err_str(e),
    }

    // Verify issue exists
    match issues::Entity::find()
        .filter(issues::Column::Id.eq(issue_id))
        .filter(issues::Column::ProjectId.eq(project_id))
        .filter(issues::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err_str("Issue not found"),
        Err(e) => return err_str(e),
    }

    // Check if already in module
    match module_issues::Entity::find()
        .filter(module_issues::Column::ModuleId.eq(module_id))
        .filter(module_issues::Column::IssueId.eq(issue_id))
        .filter(module_issues::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => return err_str("Issue is already in this module"),
        Ok(None) => {}
        Err(e) => return err_str(e),
    }

    let now = Utc::now().fixed_offset();

    match (module_issues::ActiveModel {
        id: Set(Uuid::new_v4()),
        module_id: Set(module_id),
        issue_id: Set(issue_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(mi) => ok_json(serde_json::json!({
            "id": mi.id,
            "module_id": mi.module_id,
            "issue_id": mi.issue_id,
        })),
        Err(e) => err_str(format!("Module issue insert error: {}", e)),
    }
}

pub async fn remove_issue_from_module_impl(
    db: &sea_orm::DatabaseConnection,
    params: RemoveIssueFromModuleParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let module_id = match parse_uuid(&params.module_id, "module_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let mi = match module_issues::Entity::find()
        .filter(module_issues::Column::ModuleId.eq(module_id))
        .filter(module_issues::Column::IssueId.eq(issue_id))
        .filter(module_issues::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(mi)) => mi,
        Ok(None) => return err_str("Issue not found in this module"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: module_issues::ActiveModel = mi.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(_) => ok_json(serde_json::json!({ "message": "Issue removed from module" })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

/// Build a JSON representation of a module model.
fn module_to_json(m: &modules::Model) -> serde_json::Value {
    serde_json::json!({
        "id": m.id,
        "name": m.name,
        "description": m.description,
        "status": m.status,
        "start_date": m.start_date,
        "target_date": m.target_date,
        "sort_order": m.sort_order,
        "lead_id": m.lead_id,
        "project_id": m.project_id,
        "workspace_id": m.workspace_id,
        "created_at": m.created_at.map(|dt| dt.to_rfc3339()),
        "updated_at": m.updated_at.map(|dt| dt.to_rfc3339()),
    })
}

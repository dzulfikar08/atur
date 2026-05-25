use chrono::Utc;
use db::entities::states;
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use uuid::Uuid;

use super::*;

// --- States parameter structs ---

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListStatesParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CreateStateParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "State name")]
    pub name: String,
    #[schemars(description = "State group: backlog, unstarted, started, completed, cancelled")]
    pub group: String,
    #[schemars(description = "State color (hex, e.g. '#3B82F6')")]
    pub color: Option<String>,
    #[schemars(description = "State description")]
    pub description: Option<String>,
    #[schemars(description = "Is this the default state?")]
    pub is_default: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct UpdateStateParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "State UUID")]
    pub state_id: String,
    #[schemars(description = "State name")]
    pub name: Option<String>,
    #[schemars(description = "State group")]
    pub group: Option<String>,
    #[schemars(description = "State color (hex)")]
    pub color: Option<String>,
    #[schemars(description = "State description")]
    pub description: Option<String>,
    #[schemars(description = "Is default state?")]
    pub is_default: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct DeleteStateParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "State UUID")]
    pub state_id: String,
}

// --- States implementations ---

pub async fn list_states_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListStatesParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    match states::Entity::find()
        .filter(states::Column::ProjectId.eq(project_id))
        .filter(states::Column::WorkspaceId.eq(ws.id))
        .filter(states::Column::DeletedAt.is_null())
        .order_by_asc(states::Column::Sequence)
        .all(db)
        .await
    {
        Ok(list) => {
            let result: Vec<serde_json::Value> = list
                .iter()
                .map(|s| {
                    serde_json::json!({
                        "id": s.id,
                        "name": s.name,
                        "group": s.group,
                        "color": s.color,
                        "slug": s.slug,
                        "sequence": s.sequence,
                        "is_default": s.is_default,
                        "is_triage": s.is_triage,
                    })
                })
                .collect();
            ok_json(serde_json::json!(result))
        }
        Err(e) => err_str(e),
    }
}

pub async fn create_state_impl(
    db: &sea_orm::DatabaseConnection,
    params: CreateStateParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let valid_groups = ["backlog", "unstarted", "started", "completed", "cancelled"];
    if !valid_groups.contains(&params.group.as_str()) {
        return err_str(format!(
            "Invalid group '{}'. Must be one of: {}",
            params.group,
            valid_groups.join(", ")
        ));
    }

    // Compute sequence: max existing + 10000
    let max_seq = match states::Entity::find()
        .filter(states::Column::ProjectId.eq(project_id))
        .filter(states::Column::DeletedAt.is_null())
        .order_by_desc(states::Column::Sequence)
        .one(db)
        .await
    {
        Ok(m) => m.map(|s| s.sequence).unwrap_or(0.0),
        Err(e) => return err_str(e),
    };

    let is_default = params.is_default.unwrap_or(false);
    let slug = params.name.to_lowercase().replace(' ', "-");
    let now = Utc::now().fixed_offset();

    match (states::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(params.name),
        description: Set(params.description),
        color: Set(params.color),
        slug: Set(Some(slug)),
        sequence: Set(max_seq + 10000.0),
        group: Set(params.group),
        is_triage: Set(false),
        is_default: Set(is_default),
        project_id: Set(project_id),
        workspace_id: Set(ws.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(s) => ok_json(serde_json::json!({
            "id": s.id,
            "name": s.name,
            "group": s.group,
            "color": s.color,
            "slug": s.slug,
            "sequence": s.sequence,
            "is_default": s.is_default,
            "is_triage": s.is_triage,
            "project_id": s.project_id,
        })),
        Err(e) => err_str(format!("State insert error: {}", e)),
    }
}

pub async fn update_state_impl(
    db: &sea_orm::DatabaseConnection,
    params: UpdateStateParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let state_id = match parse_uuid(&params.state_id, "state_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let state = match states::Entity::find()
        .filter(states::Column::Id.eq(state_id))
        .filter(states::Column::ProjectId.eq(project_id))
        .filter(states::Column::WorkspaceId.eq(ws.id))
        .filter(states::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(s)) => s,
        Ok(None) => return err_str("State not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: states::ActiveModel = state.into();

    if let Some(name) = params.name {
        let slug = name.to_lowercase().replace(' ', "-");
        active.name = Set(name);
        active.slug = Set(Some(slug));
    }
    if let Some(group) = params.group {
        active.group = Set(group);
    }
    if let Some(color) = params.color {
        active.color = Set(Some(color));
    }
    if let Some(description) = params.description {
        active.description = Set(Some(description));
    }
    if let Some(is_default) = params.is_default {
        active.is_default = Set(is_default);
    }
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(updated) => ok_json(serde_json::json!({
            "id": updated.id,
            "name": updated.name,
            "group": updated.group,
            "color": updated.color,
            "slug": updated.slug,
            "sequence": updated.sequence,
            "is_default": updated.is_default,
            "is_triage": updated.is_triage,
            "project_id": updated.project_id,
        })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

pub async fn delete_state_impl(
    db: &sea_orm::DatabaseConnection,
    params: DeleteStateParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let state_id = match parse_uuid(&params.state_id, "state_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let state = match states::Entity::find()
        .filter(states::Column::Id.eq(state_id))
        .filter(states::Column::ProjectId.eq(project_id))
        .filter(states::Column::WorkspaceId.eq(ws.id))
        .filter(states::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(s)) => s,
        Ok(None) => return err_str("State not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: states::ActiveModel = state.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(_) => ok_json(serde_json::json!({ "message": "State deleted" })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

use db::entities::states;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
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

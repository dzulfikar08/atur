use db::entities::{users, workspace_members};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use uuid::Uuid;

use super::*;

// --- Workspace parameter structs ---

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListWorkspaceMembersParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
}

// --- Workspace implementations ---

pub async fn list_workspace_members_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListWorkspaceMembersParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };

    match workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(ws.id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .filter(workspace_members::Column::IsActive.eq(true))
        .all(db)
        .await
    {
        Ok(members) => {
            let mut result = Vec::new();
            for m in &members {
                let user_info = match users::Entity::find_by_id(m.member_id).one(db).await {
                    Ok(Some(u)) => serde_json::json!({
                        "id": u.id,
                        "email": u.email,
                        "username": u.username,
                        "display_name": u.display_name,
                    }),
                    _ => serde_json::json!({
                        "id": m.member_id,
                    }),
                };

                let role_str = match m.role {
                    20 => "admin",
                    15 => "member",
                    10 => "guest",
                    _ => "unknown",
                };

                result.push(serde_json::json!({
                    "member_id": m.member_id,
                    "role": role_str,
                    "is_active": m.is_active,
                    "user": user_info,
                }));
            }
            ok_json(serde_json::json!(result))
        }
        Err(e) => err_str(e),
    }
}

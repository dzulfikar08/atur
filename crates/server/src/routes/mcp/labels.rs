use chrono::Utc;
use db::entities::{issue_assignees, issues, labels, project_members, users};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};
use uuid::Uuid;

use super::*;

// --- Label & Member parameter structs ---

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListLabelsParams {
    pub workspace: Option<String>,
    pub project_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListMembersParams {
    pub workspace: Option<String>,
    pub project_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SetAssigneeParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub issue_id: String,
    pub user_id: String,
    #[schemars(description = "\"add\" (default) or \"remove\"")]
    pub action: Option<String>,
}

// --- Label & Member implementations ---

pub async fn list_labels_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListLabelsParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    match labels::Entity::find()
        .filter(labels::Column::WorkspaceId.eq(ws.id))
        .filter(
            labels::Column::ProjectId
                .eq(Some(project_id))
                .or(labels::Column::ProjectId.is_null()),
        )
        .filter(labels::Column::DeletedAt.is_null())
        .all(db)
        .await
    {
        Ok(list) => {
            let result: Vec<serde_json::Value> = list
                .iter()
                .map(|l| {
                    serde_json::json!({
                        "id": l.id,
                        "name": l.name,
                        "description": l.description,
                        "color": l.color,
                        "project_id": l.project_id,
                    })
                })
                .collect();
            ok_json(serde_json::json!(result))
        }
        Err(e) => err_str(e),
    }
}

pub async fn list_members_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListMembersParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    match project_members::Entity::find()
        .filter(project_members::Column::ProjectId.eq(project_id))
        .filter(project_members::Column::DeletedAt.is_null())
        .filter(project_members::Column::IsActive.eq(true))
        .all(db)
        .await
    {
        Ok(members) => {
            let mut result = Vec::new();
            for m in &members {
                let user_display = match users::Entity::find_by_id(m.member_id).one(db).await {
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
                result.push(serde_json::json!({
                    "member_id": m.member_id,
                    "role": m.role,
                    "user": user_display,
                }));
            }
            ok_json(serde_json::json!(result))
        }
        Err(e) => err_str(e),
    }
}

pub async fn set_assignee_impl(
    db: &sea_orm::DatabaseConnection,
    params: SetAssigneeParams,
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
    let user_id = match parse_uuid(&params.user_id, "user_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

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

    let action = params.action.unwrap_or_else(|| "add".to_string());
    let now = Utc::now().fixed_offset();

    match action.as_str() {
        "add" => {
            // Check if already assigned
            match issue_assignees::Entity::find()
                .filter(issue_assignees::Column::IssueId.eq(issue_id))
                .filter(issue_assignees::Column::AssigneeId.eq(user_id))
                .filter(issue_assignees::Column::DeletedAt.is_null())
                .one(db)
                .await
            {
                Ok(Some(_)) => {
                    return ok_json(serde_json::json!({ "message": "Already assigned" }))
                }
                Ok(None) => {}
                Err(e) => return err_str(e),
            }

            match (issue_assignees::ActiveModel {
                id: Set(Uuid::new_v4()),
                issue_id: Set(issue_id),
                assignee_id: Set(user_id),
                created_at: Set(Some(now)),
                updated_at: Set(Some(now)),
                deleted_at: Set(None),
            })
            .insert(db)
            .await
            {
                Ok(_) => ok_json(serde_json::json!({ "message": "Assignee added" })),
                Err(e) => err_str(format!("Assignee insert error: {}", e)),
            }
        }
        "remove" => {
            let assignee = match issue_assignees::Entity::find()
                .filter(issue_assignees::Column::IssueId.eq(issue_id))
                .filter(issue_assignees::Column::AssigneeId.eq(user_id))
                .filter(issue_assignees::Column::DeletedAt.is_null())
                .one(db)
                .await
            {
                Ok(Some(a)) => a,
                Ok(None) => {
                    return ok_json(serde_json::json!({ "message": "Not assigned" }))
                }
                Err(e) => return err_str(e),
            };

            let mut active: issue_assignees::ActiveModel = assignee.into();
            active.deleted_at = Set(Some(now));
            active.updated_at = Set(Some(now));

            match active.update(db).await {
                Ok(_) => ok_json(serde_json::json!({ "message": "Assignee removed" })),
                Err(e) => err_str(format!("DB update error: {}", e)),
            }
        }
        _ => err_str("Invalid action. Use 'add' or 'remove'"),
    }
}

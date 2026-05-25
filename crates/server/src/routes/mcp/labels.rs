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
pub struct CreateLabelParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Label name")]
    pub name: String,
    #[schemars(description = "Label color (hex, e.g. '#FF0000')")]
    pub color: Option<String>,
    #[schemars(description = "Label description")]
    pub description: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct UpdateLabelParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Label UUID")]
    pub label_id: String,
    #[schemars(description = "Label name")]
    pub name: Option<String>,
    #[schemars(description = "Label color (hex, e.g. '#FF0000')")]
    pub color: Option<String>,
    #[schemars(description = "Label description")]
    pub description: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct DeleteLabelParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Label UUID")]
    pub label_id: String,
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

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AddProjectMemberParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "User UUID")]
    pub user_id: String,
    #[schemars(description = "Role: 20=admin, 15=member, 5=guest")]
    pub role: Option<i16>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RemoveProjectMemberParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "User UUID")]
    pub user_id: String,
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

pub async fn create_label_impl(
    db: &sea_orm::DatabaseConnection,
    params: CreateLabelParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();

    match (labels::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(params.name),
        description: Set(params.description),
        color: Set(params.color),
        sort_order: Set(65535.0),
        parent_id: Set(None),
        workspace_id: Set(ws.id),
        project_id: Set(Some(project_id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(l) => ok_json(serde_json::json!({
            "id": l.id,
            "name": l.name,
            "description": l.description,
            "color": l.color,
            "project_id": l.project_id,
        })),
        Err(e) => err_str(format!("Label insert error: {}", e)),
    }
}

pub async fn update_label_impl(
    db: &sea_orm::DatabaseConnection,
    params: UpdateLabelParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let label_id = match parse_uuid(&params.label_id, "label_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let label = match labels::Entity::find()
        .filter(labels::Column::Id.eq(label_id))
        .filter(labels::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(l)) => l,
        Ok(None) => return err_str("Label not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: labels::ActiveModel = label.into();

    if let Some(name) = params.name {
        active.name = Set(name);
    }
    if let Some(color) = params.color {
        active.color = Set(Some(color));
    }
    if let Some(description) = params.description {
        active.description = Set(Some(description));
    }
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(updated) => ok_json(serde_json::json!({
            "id": updated.id,
            "name": updated.name,
            "description": updated.description,
            "color": updated.color,
            "project_id": updated.project_id,
        })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

pub async fn delete_label_impl(
    db: &sea_orm::DatabaseConnection,
    params: DeleteLabelParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let label_id = match parse_uuid(&params.label_id, "label_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let label = match labels::Entity::find()
        .filter(labels::Column::Id.eq(label_id))
        .filter(labels::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(l)) => l,
        Ok(None) => return err_str("Label not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: labels::ActiveModel = label.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(_) => ok_json(serde_json::json!({ "message": "Label deleted" })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

pub async fn add_project_member_impl(
    db: &sea_orm::DatabaseConnection,
    params: AddProjectMemberParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let user_id = match parse_uuid(&params.user_id, "user_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    // Check if already a member
    match project_members::Entity::find()
        .filter(project_members::Column::ProjectId.eq(project_id))
        .filter(project_members::Column::MemberId.eq(user_id))
        .filter(project_members::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => return err_str("User is already a project member"),
        Ok(None) => {}
        Err(e) => return err_str(e),
    }

    let now = Utc::now().fixed_offset();
    let role = params.role.unwrap_or(15);

    match (project_members::ActiveModel {
        id: Set(Uuid::new_v4()),
        project_id: Set(project_id),
        workspace_id: Set(ws.id),
        member_id: Set(user_id),
        role: Set(role),
        is_active: Set(true),
        sort_order: Set(65535.0),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(_) => ok_json(serde_json::json!({
            "message": "Project member added",
            "project_id": project_id,
            "user_id": user_id,
            "role": role,
        })),
        Err(e) => err_str(format!("Project member insert error: {}", e)),
    }
}

pub async fn remove_project_member_impl(
    db: &sea_orm::DatabaseConnection,
    params: RemoveProjectMemberParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let user_id = match parse_uuid(&params.user_id, "user_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let member = match project_members::Entity::find()
        .filter(project_members::Column::ProjectId.eq(project_id))
        .filter(project_members::Column::MemberId.eq(user_id))
        .filter(project_members::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(m)) => m,
        Ok(None) => return err_str("User is not a project member"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: project_members::ActiveModel = member.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active.is_active = Set(false);

    match active.update(db).await {
        Ok(_) => ok_json(serde_json::json!({ "message": "Project member removed" })),
        Err(e) => err_str(format!("DB update error: {}", e)),
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

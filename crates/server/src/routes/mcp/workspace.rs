use chrono::Utc;
use db::entities::{users, workspaces, workspace_members};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};
use uuid::Uuid;

use super::*;

// --- Workspace parameter structs ---

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListWorkspaceMembersParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CreateWorkspaceParams {
    #[schemars(description = "Workspace name (required)")]
    pub name: String,
    #[schemars(description = "URL-friendly slug (required, e.g. 'my-team')")]
    pub slug: String,
    #[schemars(description = "Logo image URL")]
    pub logo: Option<String>,
    #[schemars(description = "Organization size (e.g. 'just-me', '2-10', '11-50', '51-200', '200+')")]
    pub organization_size: Option<String>,
    #[schemars(description = "Timezone (default: UTC)")]
    pub timezone: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AddWorkspaceMemberParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "User UUID")]
    pub user_id: String,
    #[schemars(description = "Role: 20=admin, 15=member, 10=guest")]
    pub role: Option<i16>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RemoveWorkspaceMemberParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "User UUID")]
    pub user_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct UpdateWorkspaceMemberRoleParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "User UUID")]
    pub user_id: String,
    #[schemars(description = "New role: 20=admin, 15=member, 10=guest")]
    pub role: i16,
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

pub async fn create_workspace_impl(
    db: &sea_orm::DatabaseConnection,
    params: CreateWorkspaceParams,
    bot_user_id: Uuid,
) -> String {
    // Validate slug
    if params.slug.is_empty() {
        return err_str("Slug is required");
    }
    if !params
        .slug
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return err_str("Slug must contain only alphanumeric characters, hyphens, or underscores");
    }

    // Check slug uniqueness
    match workspaces::Entity::find()
        .filter(workspaces::Column::Slug.eq(&params.slug))
        .filter(workspaces::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => return err_str(format!("Workspace slug '{}' already exists", params.slug)),
        Ok(None) => {}
        Err(e) => return err_str(e),
    }

    // Resolve an actual user to be the workspace owner
    let owner = match users::Entity::find()
        .filter(users::Column::IsActive.eq(true))
        .filter(users::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(u)) => u,
        Ok(None) => return err_str("No active user found to assign as workspace owner"),
        Err(e) => return err_str(format!("User lookup error: {}", e)),
    };
    let owner_id = owner.id;

    let now = Utc::now().fixed_offset();
    let workspace_id = Uuid::new_v4();

    let workspace = match (workspaces::ActiveModel {
        id: Set(workspace_id),
        name: Set(params.name),
        slug: Set(params.slug),
        logo: Set(params.logo),
        organization_size: Set(params.organization_size),
        timezone: Set(Some(params.timezone.unwrap_or_else(|| "UTC".into()))),
        background_color: Set(None),
        owner_id: Set(owner_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(w) => w,
        Err(e) => return err_str(format!("Workspace insert error: {}", e)),
    };

    // Add owner as workspace admin
    let member_id = Uuid::new_v4();
    if let Err(e) = (workspace_members::ActiveModel {
        id: Set(member_id),
        workspace_id: Set(workspace_id),
        member_id: Set(owner_id),
        role: Set(20), // Admin
        is_active: Set(true),
        view_props: Set(None),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        return err_str(format!("Workspace member insert error: {}", e));
    }

    ok_json(serde_json::json!({
        "id": workspace_id,
        "name": workspace.name,
        "slug": workspace.slug,
        "timezone": workspace.timezone,
        "owner_id": owner_id,
        "created_at": now.to_rfc3339(),
    }))
}

pub async fn add_workspace_member_impl(
    db: &sea_orm::DatabaseConnection,
    params: AddWorkspaceMemberParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let user_id = match parse_uuid(&params.user_id, "user_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    // Check if already a member
    match workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(ws.id))
        .filter(workspace_members::Column::MemberId.eq(user_id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => return err_str("User is already a workspace member"),
        Ok(None) => {}
        Err(e) => return err_str(e),
    }

    let now = Utc::now().fixed_offset();
    let role = params.role.unwrap_or(15);

    match (workspace_members::ActiveModel {
        id: Set(Uuid::new_v4()),
        workspace_id: Set(ws.id),
        member_id: Set(user_id),
        role: Set(role),
        is_active: Set(true),
        view_props: Set(None),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(_) => ok_json(serde_json::json!({
            "message": "Workspace member added",
            "workspace_id": ws.id,
            "user_id": user_id,
            "role": role,
        })),
        Err(e) => err_str(format!("Workspace member insert error: {}", e)),
    }
}

pub async fn remove_workspace_member_impl(
    db: &sea_orm::DatabaseConnection,
    params: RemoveWorkspaceMemberParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let user_id = match parse_uuid(&params.user_id, "user_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let member = match workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(ws.id))
        .filter(workspace_members::Column::MemberId.eq(user_id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(m)) => m,
        Ok(None) => return err_str("User is not a workspace member"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: workspace_members::ActiveModel = member.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active.is_active = Set(false);

    match active.update(db).await {
        Ok(_) => ok_json(serde_json::json!({ "message": "Workspace member removed" })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

pub async fn update_workspace_member_role_impl(
    db: &sea_orm::DatabaseConnection,
    params: UpdateWorkspaceMemberRoleParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let user_id = match parse_uuid(&params.user_id, "user_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let member = match workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(ws.id))
        .filter(workspace_members::Column::MemberId.eq(user_id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(m)) => m,
        Ok(None) => return err_str("User is not a workspace member"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: workspace_members::ActiveModel = member.into();
    active.role = Set(params.role);
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(_) => {
            let role_str = match params.role {
                20 => "admin",
                15 => "member",
                10 => "guest",
                _ => "unknown",
            };
            ok_json(serde_json::json!({
                "message": "Workspace member role updated",
                "user_id": user_id,
                "role": role_str,
            }))
        }
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

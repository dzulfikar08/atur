use chrono::Utc;
use db::entities::{projects, states};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};
use uuid::Uuid;

use super::*;

// --- Project parameter structs ---

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListProjectsParams {
    #[schemars(description = "Workspace slug (uses default if not specified)")]
    pub workspace: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GetProjectParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CreateProjectParams {
    #[schemars(description = "Workspace slug (uses default if not specified)")]
    pub workspace: Option<String>,
    #[schemars(description = "Project name (required)")]
    pub name: String,
    #[schemars(description = "Short identifier (1-12 chars, uppercase recommended, e.g. MKTG)")]
    pub identifier: String,
    #[schemars(description = "Project description")]
    pub description: Option<String>,
    #[schemars(description = "Project emoji icon")]
    pub emoji: Option<String>,
    #[schemars(description = "Cover image URL")]
    pub cover_image: Option<String>,
}

// --- Project implementations ---

pub async fn list_projects_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListProjectsParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };

    match projects::Entity::find()
        .filter(projects::Column::WorkspaceId.eq(ws.id))
        .filter(projects::Column::DeletedAt.is_null())
        .all(db)
        .await
    {
        Ok(list) => {
            let result: Vec<serde_json::Value> = list
                .iter()
                .map(|p| {
                    serde_json::json!({
                        "id": p.id,
                        "name": p.name,
                        "identifier": p.identifier,
                        "description": p.description,
                        "emoji": p.emoji,
                        "workspace_id": p.workspace_id,
                        "created_at": p.created_at.map(|d| d.to_rfc3339()),
                    })
                })
                .collect();
            ok_json(serde_json::json!(result))
        }
        Err(e) => err_str(e),
    }
}

pub async fn get_project_impl(
    db: &sea_orm::DatabaseConnection,
    params: GetProjectParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    match projects::Entity::find()
        .filter(projects::Column::Id.eq(project_id))
        .filter(projects::Column::WorkspaceId.eq(ws.id))
        .filter(projects::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(p)) => ok_json(serde_json::json!({
            "id": p.id,
            "name": p.name,
            "identifier": p.identifier,
            "description": p.description,
            "emoji": p.emoji,
            "cover_image": p.cover_image,
            "default_assignee_id": p.default_assignee_id,
            "project_lead_id": p.project_lead_id,
            "module_view": p.module_view,
            "cycle_view": p.cycle_view,
            "workspace_id": p.workspace_id,
            "created_at": p.created_at.map(|d| d.to_rfc3339()),
        })),
        Ok(None) => err_str("Project not found"),
        Err(e) => err_str(e),
    }
}

pub async fn create_project_impl(
    db: &sea_orm::DatabaseConnection,
    params: CreateProjectParams,
    bot_user_id: Uuid,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };

    // Validate identifier
    if params.identifier.is_empty() || params.identifier.len() > 12 {
        return err_str("Identifier must be 1-12 characters");
    }

    // Check uniqueness
    match projects::Entity::find()
        .filter(projects::Column::Identifier.eq(&params.identifier))
        .filter(projects::Column::WorkspaceId.eq(ws.id))
        .filter(projects::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => {
            return err_str(format!(
                "Identifier '{}' already taken in this workspace",
                params.identifier
            ))
        }
        Ok(None) => {}
        Err(e) => return err_str(e),
    }

    let now = Utc::now().fixed_offset();
    let project_id = Uuid::new_v4();

    // Insert project
    let project = match (projects::ActiveModel {
        id: Set(project_id),
        name: Set(params.name),
        identifier: Set(params.identifier),
        description: Set(params.description),
        description_html: Set(None),
        description_json: Set(None),
        workspace_id: Set(ws.id),
        network: Set(0),
        emoji: Set(params.emoji),
        icon_prop: Set(None),
        cover_image: Set(params.cover_image),
        default_assignee_id: Set(None),
        project_lead_id: Set(None),
        default_state_id: Set(None),
        module_view: Set(true),
        cycle_view: Set(true),
        page_view: Set(true),
        intake_view: Set(true),
        is_time_tracking_enabled: Set(false),
        archive_in: Set(None),
        close_in: Set(None),
        timezone: Set(Some("UTC".into())),
        archived_at: Set(None),
        external_source: Set(None),
        external_id: Set(None),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(p) => p,
        Err(e) => return err_str(format!("Project insert error: {}", e)),
    };

    // Create default states
    let default_states = [
        ("Backlog", "backlog", "backlog", "#A3A3A3", 10000.0, false, false),
        ("Todo", "unstarted", "todo", "#3B82F6", 20000.0, true, false),
        (
            "In Progress",
            "started",
            "in-progress",
            "#F59E0B",
            30000.0,
            false,
            false,
        ),
        ("Done", "completed", "done", "#16A34A", 40000.0, false, false),
        (
            "Cancelled",
            "cancelled",
            "cancelled",
            "#EF4444",
            50000.0,
            false,
            false,
        ),
        ("Triage", "triage", "triage", "#8B5CF6", 60000.0, false, true),
    ];

    let mut default_state_id: Option<Uuid> = None;
    for (name, group, slug, color, sequence, is_default, is_triage) in &default_states {
        let state_id = Uuid::new_v4();
        if *is_default {
            default_state_id = Some(state_id);
        }
        if let Err(e) = (states::ActiveModel {
            id: Set(state_id),
            name: Set(name.to_string()),
            description: Set(None),
            color: Set(Some(color.to_string())),
            slug: Set(Some(slug.to_string())),
            sequence: Set(*sequence),
            group: Set(group.to_string()),
            is_triage: Set(*is_triage),
            is_default: Set(*is_default),
            project_id: Set(project_id),
            workspace_id: Set(ws.id),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        })
        .insert(db)
        .await
        {
            return err_str(format!("State insert error: {}", e));
        }
    }

    // Update default_state_id on project
    if let Some(sid) = default_state_id {
        let mut active: projects::ActiveModel = project.clone().into();
        active.default_state_id = Set(Some(sid));
        if let Err(e) = active.update(db).await {
            return err_str(format!("Project update error: {}", e));
        }
    }

    ok_json(serde_json::json!({
        "id": project_id,
        "name": project.name,
        "identifier": project.identifier,
        "description": project.description,
        "emoji": project.emoji,
        "workspace_id": ws.id,
        "default_state_id": default_state_id,
        "created_at": now.to_rfc3339(),
    }))
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct UpdateProjectParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Project name")]
    pub name: Option<String>,
    #[schemars(description = "Project description")]
    pub description: Option<String>,
    #[schemars(description = "Project emoji icon")]
    pub emoji: Option<String>,
    #[schemars(description = "Cover image URL")]
    pub cover_image: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct DeleteProjectParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
}

pub async fn update_project_impl(
    db: &sea_orm::DatabaseConnection,
    params: UpdateProjectParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let project = match projects::Entity::find()
        .filter(projects::Column::Id.eq(project_id))
        .filter(projects::Column::WorkspaceId.eq(ws.id))
        .filter(projects::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(p)) => p,
        Ok(None) => return err_str("Project not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: projects::ActiveModel = project.into();

    if let Some(name) = params.name {
        active.name = Set(name);
    }
    if let Some(description) = params.description {
        active.description = Set(Some(description));
    }
    if let Some(emoji) = params.emoji {
        active.emoji = Set(Some(emoji));
    }
    if let Some(cover_image) = params.cover_image {
        active.cover_image = Set(Some(cover_image));
    }
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(updated) => ok_json(serde_json::json!({
            "id": updated.id,
            "name": updated.name,
            "identifier": updated.identifier,
            "description": updated.description,
            "emoji": updated.emoji,
            "cover_image": updated.cover_image,
            "workspace_id": updated.workspace_id,
        })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

pub async fn delete_project_impl(
    db: &sea_orm::DatabaseConnection,
    params: DeleteProjectParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let project = match projects::Entity::find()
        .filter(projects::Column::Id.eq(project_id))
        .filter(projects::Column::WorkspaceId.eq(ws.id))
        .filter(projects::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(p)) => p,
        Ok(None) => return err_str("Project not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: projects::ActiveModel = project.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(_) => ok_json(serde_json::json!({ "message": "Project deleted" })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

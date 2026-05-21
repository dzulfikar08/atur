use db::entities::{project_members, workspace_members, workspaces};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::state::AppState;

/// Load a workspace by slug (non-deleted).
pub async fn load_workspace_by_slug(
    state: &AppState,
    slug: &str,
) -> Result<workspaces::Model, AppError> {
    workspaces::Entity::find()
        .filter(workspaces::Column::Slug.eq(slug))
        .filter(workspaces::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound(format!("Workspace '{}' not found", slug)))
}

/// Load a workspace by ID (non-deleted).
pub async fn load_workspace_by_id(
    state: &AppState,
    workspace_id: Uuid,
) -> Result<workspaces::Model, AppError> {
    workspaces::Entity::find_by_id(workspace_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Workspace not found".into()))
        .and_then(|w| {
            if w.deleted_at.is_some() {
                Err(AppError::NotFound("Workspace not found".into()))
            } else {
                Ok(w)
            }
        })
}

/// Get the role of the current user in a workspace.
/// Returns None if the user is not a member.
pub async fn get_workspace_role(
    state: &AppState,
    workspace_id: Uuid,
    user: &CurrentUser,
) -> Result<Option<i16>, AppError> {
    let membership = workspace_members::Entity::find()
        .filter(workspace_members::Column::WorkspaceId.eq(workspace_id))
        .filter(workspace_members::Column::MemberId.eq(user.0.id))
        .filter(workspace_members::Column::DeletedAt.is_null())
        .filter(workspace_members::Column::IsActive.eq(true))
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    Ok(membership.map(|m| m.role))
}

/// Require that the user is a member of the workspace with at least the given role level.
/// Returns the workspace model on success.
pub async fn require_workspace_role(
    state: &AppState,
    workspace_id: Uuid,
    user: &CurrentUser,
    min_role: i16,
) -> Result<workspaces::Model, AppError> {
    let workspace = load_workspace_by_id(state, workspace_id).await?;

    // Workspace owner always has admin access
    if workspace.owner_id == user.0.id {
        return Ok(workspace);
    }

    // Superusers bypass all checks
    if user.0.is_superuser {
        return Ok(workspace);
    }

    let role = get_workspace_role(state, workspace_id, user)
        .await?
        .ok_or_else(|| AppError::Forbidden("Not a member of this workspace".into()))?;

    if role < min_role {
        return Err(AppError::Forbidden(
            "Insufficient permissions for this workspace".into(),
        ));
    }

    Ok(workspace)
}

/// Get the role of the current user in a project.
/// Returns None if the user is not a project member.
pub async fn get_project_role(
    state: &AppState,
    project_id: Uuid,
    user: &CurrentUser,
) -> Result<Option<i16>, AppError> {
    let membership = project_members::Entity::find()
        .filter(project_members::Column::ProjectId.eq(project_id))
        .filter(project_members::Column::MemberId.eq(user.0.id))
        .filter(project_members::Column::DeletedAt.is_null())
        .filter(project_members::Column::IsActive.eq(true))
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    Ok(membership.map(|m| m.role))
}

/// Require that the user has at least the given role in the project or workspace.
/// Workspace members with sufficient role are also granted access.
/// Returns the workspace model on success.
pub async fn require_project_role(
    state: &AppState,
    workspace_id: Uuid,
    project_id: Uuid,
    user: &CurrentUser,
    min_role: i16,
) -> Result<workspaces::Model, AppError> {
    let workspace = load_workspace_by_id(state, workspace_id).await?;

    // Workspace owner always has admin access
    if workspace.owner_id == user.0.id {
        return Ok(workspace);
    }

    // Superusers bypass all checks
    if user.0.is_superuser {
        return Ok(workspace);
    }

    // Check project-level membership first
    if let Some(role) = get_project_role(state, project_id, user).await? {
        if role >= min_role {
            return Ok(workspace);
        }
    }

    // Fall back to workspace-level membership
    let ws_role = get_workspace_role(state, workspace_id, user)
        .await?
        .ok_or_else(|| AppError::Forbidden("Not a member of this project or workspace".into()))?;

    if ws_role < min_role {
        return Err(AppError::Forbidden(
            "Insufficient permissions for this project".into(),
        ));
    }

    Ok(workspace)
}

use chrono::Utc;
use db::entities::pages;
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};
use uuid::Uuid;

use super::*;

// --- Pages parameter structs ---

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListPagesParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Parent page UUID (optional, lists root pages if not set)")]
    pub parent_id: Option<String>,
    #[schemars(description = "Max results (default 20, max 100)")]
    pub limit: Option<u64>,
    #[schemars(description = "Offset for pagination")]
    pub offset: Option<u64>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GetPageParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Page UUID")]
    pub page_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CreatePageParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Page name")]
    pub name: String,
    #[schemars(description = "HTML description")]
    pub description_html: Option<String>,
    #[schemars(description = "Parent page UUID (optional)")]
    pub parent_id: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct UpdatePageParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Page UUID")]
    pub page_id: String,
    #[schemars(description = "New name")]
    pub name: Option<String>,
    #[schemars(description = "New HTML description")]
    pub description_html: Option<String>,
    #[schemars(description = "Lock/unlock the page")]
    pub is_locked: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct DeletePageParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Page UUID")]
    pub page_id: String,
}

// --- Pages implementations ---

pub async fn list_pages_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListPagesParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };

    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);

    let mut condition = sea_orm::Condition::all()
        .add(pages::Column::WorkspaceId.eq(ws.id))
        .add(pages::Column::DeletedAt.is_null())
        .add(pages::Column::ArchivedAt.is_null());

    if let Some(ref parent_id_str) = params.parent_id {
        let parent_id = match parse_uuid(parent_id_str, "parent_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        condition = condition.add(pages::Column::ParentId.eq(parent_id));
    } else {
        condition = condition.add(pages::Column::ParentId.is_null());
    }

    let query = pages::Entity::find()
        .filter(condition)
        .order_by_asc(pages::Column::SortOrder);

    let paginator = query.paginate(db, limit);

    let total = match paginator.num_items().await {
        Ok(t) => t,
        Err(e) => return err_str(e),
    };

    match paginator.fetch_page(offset / limit).await {
        Ok(page_list) => {
            let results: Vec<serde_json::Value> =
                page_list.iter().map(page_to_json).collect();
            ok_json(serde_json::json!({
                "results": results,
                "total": total,
                "limit": limit,
                "offset": offset,
            }))
        }
        Err(e) => err_str(e),
    }
}

pub async fn get_page_impl(
    db: &sea_orm::DatabaseConnection,
    params: GetPageParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let page_id = match parse_uuid(&params.page_id, "page_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    match pages::Entity::find()
        .filter(pages::Column::Id.eq(page_id))
        .filter(pages::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(p)) => ok_json(page_to_json(&p)),
        Ok(None) => err_str("Page not found"),
        Err(e) => err_str(e),
    }
}

pub async fn create_page_impl(
    db: &sea_orm::DatabaseConnection,
    params: CreatePageParams,
    bot_user_id: Uuid,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };

    let parent_id = match params.parent_id {
        Some(ref pid_str) => match parse_uuid(pid_str, "parent_id") {
            Ok(id) => Some(id),
            Err(e) => return err_str(e),
        },
        None => None,
    };

    let now = Utc::now().fixed_offset();

    match (pages::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(params.name),
        description_json: Set(None),
        description_binary: Set(None),
        description_html: Set(params.description_html.clone()),
        description_stripped: Set(params.description_html.as_deref().map(strip_html)),
        access: Set(0),
        color: Set(None),
        archived_at: Set(None),
        is_locked: Set(false),
        sort_order: Set(65535.0),
        parent_id: Set(parent_id),
        workspace_id: Set(ws.id),
        owned_by_id: Set(bot_user_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(p) => ok_json(page_to_json(&p)),
        Err(e) => err_str(format!("Page insert error: {}", e)),
    }
}

pub async fn update_page_impl(
    db: &sea_orm::DatabaseConnection,
    params: UpdatePageParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let page_id = match parse_uuid(&params.page_id, "page_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let page = match pages::Entity::find()
        .filter(pages::Column::Id.eq(page_id))
        .filter(pages::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(p)) => p,
        Ok(None) => return err_str("Page not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: pages::ActiveModel = page.into();

    if let Some(name) = params.name {
        active.name = Set(name);
    }
    if let Some(description_html) = params.description_html {
        active.description_html = Set(Some(description_html.clone()));
        active.description_stripped = Set(Some(strip_html(&description_html)));
    }
    if let Some(is_locked) = params.is_locked {
        active.is_locked = Set(is_locked);
    }
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(updated) => ok_json(page_to_json(&updated)),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

pub async fn delete_page_impl(
    db: &sea_orm::DatabaseConnection,
    params: DeletePageParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let page_id = match parse_uuid(&params.page_id, "page_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let page = match pages::Entity::find()
        .filter(pages::Column::Id.eq(page_id))
        .filter(pages::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(p)) => p,
        Ok(None) => return err_str("Page not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: pages::ActiveModel = page.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(_) => ok_json(serde_json::json!({ "message": "Page deleted" })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

/// Build a JSON representation of a page model.
fn page_to_json(p: &pages::Model) -> serde_json::Value {
    serde_json::json!({
        "id": p.id,
        "name": p.name,
        "description_html": p.description_html,
        "access": p.access,
        "color": p.color,
        "is_locked": p.is_locked,
        "sort_order": p.sort_order,
        "parent_id": p.parent_id,
        "workspace_id": p.workspace_id,
        "owned_by_id": p.owned_by_id,
        "archived_at": p.archived_at.map(|dt| dt.to_rfc3339()),
        "created_at": p.created_at.map(|dt| dt.to_rfc3339()),
        "updated_at": p.updated_at.map(|dt| dt.to_rfc3339()),
    })
}

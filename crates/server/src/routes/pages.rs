use axum::extract::{Extension, Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use axum::routing::{get, post};
use chrono::Utc;
use db::entities::{page_versions, pages};
use sea_orm::ActiveValue::Set;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::middleware::permission::{load_workspace_by_slug, require_workspace_role};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Role constants
// ---------------------------------------------------------------------------

const ROLE_ADMIN: i16 = 20;
const ROLE_MEMBER: i16 = 15;
const ROLE_GUEST: i16 = 5;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct PageResponse {
    pub id: Uuid,
    pub name: String,
    pub description_json: Option<serde_json::Value>,
    pub description_html: Option<String>,
    pub description_stripped: Option<String>,
    pub access: i16,
    pub color: Option<String>,
    pub archived_at: Option<String>,
    pub is_locked: bool,
    pub sort_order: f32,
    pub parent_id: Option<Uuid>,
    pub workspace_id: Uuid,
    pub owned_by_id: Uuid,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<pages::Model> for PageResponse {
    fn from(m: pages::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            description_json: m.description_json,
            description_html: m.description_html,
            description_stripped: m.description_stripped,
            access: m.access,
            color: m.color,
            archived_at: m.archived_at.map(|dt| dt.to_rfc3339()),
            is_locked: m.is_locked,
            sort_order: m.sort_order,
            parent_id: m.parent_id,
            workspace_id: m.workspace_id,
            owned_by_id: m.owned_by_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
            updated_at: m.updated_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct PageVersionResponse {
    pub id: Uuid,
    pub page_id: Uuid,
    pub description_html: Option<String>,
    pub description_json: Option<serde_json::Value>,
    pub last_saved_at: Option<String>,
    pub owned_by_id: Option<Uuid>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<page_versions::Model> for PageVersionResponse {
    fn from(m: page_versions::Model) -> Self {
        Self {
            id: m.id,
            page_id: m.page_id,
            description_html: m.description_html,
            description_json: m.description_json,
            last_saved_at: m.last_saved_at.map(|dt| dt.to_rfc3339()),
            owned_by_id: m.owned_by_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
            updated_at: m.updated_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreatePageRequest {
    pub name: String,
    pub description_html: Option<String>,
    pub description_json: Option<serde_json::Value>,
    pub description_binary: Option<Vec<u8>>,
    pub access: Option<i16>,
    pub color: Option<String>,
    pub parent_id: Option<Uuid>,
    pub sort_order: Option<f32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePageRequest {
    pub name: Option<String>,
    pub description_html: Option<String>,
    pub description_json: Option<serde_json::Value>,
    pub description_binary: Option<Vec<u8>>,
    pub access: Option<i16>,
    pub color: Option<String>,
    pub parent_id: Option<Uuid>,
    pub sort_order: Option<f32>,
    pub is_locked: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct PageListQuery {
    pub parent_id: Option<Uuid>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Simple HTML-to-plaintext stripper (removes tags).
fn strip_html(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    result
}

/// Load a non-deleted page by ID within a workspace.
async fn load_page(
    state: &AppState,
    page_id: Uuid,
    workspace_id: Uuid,
) -> Result<pages::Model, AppError> {
    pages::Entity::find()
        .filter(pages::Column::Id.eq(page_id))
        .filter(pages::Column::WorkspaceId.eq(workspace_id))
        .filter(pages::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Page not found".into()))
}

/// Maximum number of versions per page.
const MAX_VERSIONS: u64 = 20;

/// Create a page version snapshot (if under the version limit).
/// Drops the oldest version if at capacity.
async fn maybe_create_page_version(
    db: &sea_orm::DatabaseConnection,
    page: &pages::Model,
    user_id: Uuid,
) -> Result<(), AppError> {
    // Count existing versions
    let count = page_versions::Entity::find()
        .filter(page_versions::Column::PageId.eq(page.id))
        .filter(page_versions::Column::DeletedAt.is_null())
        .count(db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    // If at capacity, soft-delete the oldest
    if count >= MAX_VERSIONS {
        let oldest = page_versions::Entity::find()
            .filter(page_versions::Column::PageId.eq(page.id))
            .filter(page_versions::Column::DeletedAt.is_null())
            .order_by_asc(page_versions::Column::CreatedAt)
            .one(db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

        if let Some(old) = oldest {
            let now = Utc::now().fixed_offset();
            let mut active: page_versions::ActiveModel = old.into();
            active.deleted_at = Set(Some(now));
            active.updated_at = Set(Some(now));
            active
                .update(db)
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Version update error: {}", e)))?;
        }
    }

    let now = Utc::now().fixed_offset();
    page_versions::ActiveModel {
        id: Set(Uuid::new_v4()),
        page_id: Set(page.id),
        description_binary: Set(page.description_binary.clone()),
        description_html: Set(page.description_html.clone()),
        description_json: Set(page.description_json.clone()),
        last_saved_at: Set(Some(now)),
        owned_by_id: Set(Some(user_id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Version insert error: {}", e)))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/", get(list_pages).post(create_page))
        .route(
            "/{page_id}/",
            get(get_page).patch(update_page).delete(delete_page),
        )
        .route("/{page_id}/lock/", post(lock_page))
        .route("/{page_id}/unlock/", post(unlock_page))
        .route("/{page_id}/versions/", get(list_page_versions))
        .route("/{page_id}/archive/", post(archive_page))
        .route("/{page_id}/sub-pages/", get(list_sub_pages))
        .route("/{page_id}/backlinks/", get(list_backlinks))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/workspaces/<slug>/pages/ - List pages (workspace-level, exclude archived)
pub async fn list_pages(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Query(query): Query<PageListQuery>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let mut condition = sea_orm::Condition::all()
        .add(pages::Column::WorkspaceId.eq(workspace.id))
        .add(pages::Column::DeletedAt.is_null())
        .add(pages::Column::ArchivedAt.is_null());

    // Support ?parent_id= for tree listing
    match query.parent_id {
        Some(pid) => {
            condition = condition.add(pages::Column::ParentId.eq(pid));
        }
        None => {
            // Default: show root-level pages (no parent)
            condition = condition.add(pages::Column::ParentId.is_null());
        }
    }

    let limit = query.limit.unwrap_or(50).min(100);
    let offset = query.offset.unwrap_or(0);

    let paginator = pages::Entity::find()
        .filter(condition)
        .order_by_asc(pages::Column::SortOrder)
        .paginate(&state.db, limit);

    let total = paginator
        .num_items()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let page_list = paginator
        .fetch_page(offset / limit)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<PageResponse> = page_list.into_iter().map(Into::into).collect();

    Ok(Json(serde_json::json!({
        "results": resp,
        "total": total,
        "limit": limit,
        "offset": offset,
    })))
}

/// POST /api/workspaces/<slug>/pages/ - Create page
pub async fn create_page(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<CreatePageRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_MEMBER).await?;

    let description_stripped = body.description_html.as_deref().map(strip_html);

    let now = Utc::now().fixed_offset();
    let page_id = Uuid::new_v4();

    let page = pages::ActiveModel {
        id: Set(page_id),
        name: Set(body.name),
        description_json: Set(body.description_json),
        description_binary: Set(body.description_binary),
        description_html: Set(body.description_html),
        description_stripped: Set(description_stripped),
        access: Set(body.access.unwrap_or(0)),
        color: Set(body.color),
        archived_at: Set(None),
        is_locked: Set(false),
        sort_order: Set(body.sort_order.unwrap_or(65535.0)),
        parent_id: Set(body.parent_id),
        workspace_id: Set(workspace.id),
        owned_by_id: Set(current_user.0.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Page insert error: {}", e)))?;

    // Index the page in Tantivy if available
    index_page(&state, &page);

    Ok((axum::http::StatusCode::CREATED, Json(PageResponse::from(page))))
}

/// GET /api/workspaces/<slug>/pages/<uuid>/ - Get page
pub async fn get_page(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, page_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let page = load_page(&state, page_id, workspace.id).await?;
    Ok(Json(PageResponse::from(page)))
}

/// PATCH /api/workspaces/<slug>/pages/<uuid>/ - Update page
pub async fn update_page(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, page_id)): Path<(String, Uuid)>,
    Json(body): Json<UpdatePageRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_MEMBER).await?;

    let page = load_page(&state, page_id, workspace.id).await?;

    // Check if description is changing (to decide on versioning)
    let description_changing = body.description_html.is_some()
        || body.description_json.is_some()
        || body.description_binary.is_some();

    let now = Utc::now().fixed_offset();
    let mut active: pages::ActiveModel = page.clone().into();

    if let Some(name) = body.name {
        active.name = Set(name);
    }
    if let Some(description_html) = body.description_html {
        active.description_html = Set(Some(description_html.clone()));
        active.description_stripped = Set(Some(strip_html(&description_html)));
    }
    if let Some(description_json) = body.description_json {
        active.description_json = Set(Some(description_json));
    }
    if let Some(description_binary) = body.description_binary {
        active.description_binary = Set(Some(description_binary));
    }
    if let Some(access) = body.access {
        active.access = Set(access);
    }
    if let Some(color) = body.color {
        active.color = Set(Some(color));
    }
    if let Some(parent_id) = body.parent_id {
        active.parent_id = Set(Some(parent_id));
    }
    if let Some(sort_order) = body.sort_order {
        active.sort_order = Set(sort_order);
    }
    if let Some(is_locked) = body.is_locked {
        active.is_locked = Set(is_locked);
    }

    active.updated_at = Set(Some(now));

    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    // Create a version snapshot if description changed and under limit
    if description_changing {
        let version_count = page_versions::Entity::find()
            .filter(page_versions::Column::PageId.eq(page_id))
            .filter(page_versions::Column::DeletedAt.is_null())
            .count(&state.db)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

        if version_count < MAX_VERSIONS {
            let _ = maybe_create_page_version(&state.db, &page, current_user.0.id).await;
        }
    }

    // Re-index the page in Tantivy if available
    index_page(&state, &updated);

    Ok(Json(PageResponse::from(updated)))
}

/// DELETE /api/workspaces/<slug>/pages/<uuid>/ - Soft-delete page
pub async fn delete_page(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, page_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_ADMIN).await?;

    let page = load_page(&state, page_id, workspace.id).await?;

    let now = Utc::now().fixed_offset();
    let mut active: pages::ActiveModel = page.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    // Remove from Tantivy index if available
    if let Some(ref index) = state.search_index {
        let _ = crate::search_index::remove_entity(index, &page_id.to_string());
    }

    Ok(Json(serde_json::json!({ "message": "Page deleted" })))
}

/// POST /api/workspaces/<slug>/pages/<uuid>/lock/ - Lock page
pub async fn lock_page(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, page_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_MEMBER).await?;

    let page = load_page(&state, page_id, workspace.id).await?;

    let now = Utc::now().fixed_offset();
    let mut active: pages::ActiveModel = page.into();
    active.is_locked = Set(true);
    active.updated_at = Set(Some(now));
    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(PageResponse::from(updated)))
}

/// POST /api/workspaces/<slug>/pages/<uuid>/unlock/ - Unlock page
pub async fn unlock_page(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, page_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_MEMBER).await?;

    let page = load_page(&state, page_id, workspace.id).await?;

    let now = Utc::now().fixed_offset();
    let mut active: pages::ActiveModel = page.into();
    active.is_locked = Set(false);
    active.updated_at = Set(Some(now));
    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(PageResponse::from(updated)))
}

/// GET /api/workspaces/<slug>/pages/<uuid>/versions/ - List page versions (max 20)
pub async fn list_page_versions(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, page_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let _page = load_page(&state, page_id, workspace.id).await?;

    let versions = page_versions::Entity::find()
        .filter(page_versions::Column::PageId.eq(page_id))
        .filter(page_versions::Column::DeletedAt.is_null())
        .order_by_desc(page_versions::Column::CreatedAt)
        .limit(MAX_VERSIONS)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<PageVersionResponse> = versions.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// POST /api/workspaces/<slug>/pages/<uuid>/archive/ - Archive page
pub async fn archive_page(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, page_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_MEMBER).await?;

    let page = load_page(&state, page_id, workspace.id).await?;

    let now = Utc::now().fixed_offset();
    let mut active: pages::ActiveModel = page.into();
    active.archived_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    let updated = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(PageResponse::from(updated)))
}

/// GET /api/workspaces/<slug>/pages/<uuid>/sub-pages/ - List child pages
pub async fn list_sub_pages(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, page_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let _page = load_page(&state, page_id, workspace.id).await?;

    let children = pages::Entity::find()
        .filter(pages::Column::ParentId.eq(page_id))
        .filter(pages::Column::WorkspaceId.eq(workspace.id))
        .filter(pages::Column::DeletedAt.is_null())
        .filter(pages::Column::ArchivedAt.is_null())
        .order_by_asc(pages::Column::SortOrder)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<PageResponse> = children.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

/// GET /api/workspaces/<slug>/pages/<uuid>/backlinks/ - Find pages that link to this page
pub async fn list_backlinks(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, page_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_workspace_role(&state, workspace.id, &current_user, ROLE_GUEST).await?;

    let page = load_page(&state, page_id, workspace.id).await?;
    let page_name = page.name.to_lowercase();

    // Find pages whose description_stripped contains [[page_name]]
    let pattern = format!("[[{}]]", page_name);
    let all_pages: Vec<pages::Model> = pages::Entity::find()
        .filter(pages::Column::WorkspaceId.eq(workspace.id))
        .filter(pages::Column::DeletedAt.is_null())
        .filter(pages::Column::ArchivedAt.is_null())
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let backlinks: Vec<PageResponse> = all_pages
        .into_iter()
        .filter(|p| {
            p.id != page_id
                && p.description_stripped
                    .as_deref()
                    .map(|d| d.to_lowercase().contains(&pattern))
                    .unwrap_or(false)
        })
        .map(Into::into)
        .collect();

    Ok(Json(backlinks))
}

// ---------------------------------------------------------------------------
// Tantivy index helpers
// ---------------------------------------------------------------------------

/// Index a page entity in the Tantivy search index (if available).
fn index_page(state: &AppState, page: &pages::Model) {
    if let Some(ref index) = state.search_index {
        let description = page.description_stripped.as_deref().unwrap_or("");
        if let Err(e) = crate::search_index::index_entity(
            index,
            "page",
            &page.id.to_string(),
            &page.workspace_id.to_string(),
            None, // pages don't have project_id in the search schema
            &page.name,
            description,
            description,
        ) {
            tracing::warn!(error = %e, page_id = %page.id, "Failed to index page in Tantivy");
        }
    }
}

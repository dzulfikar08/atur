use axum::extract::{Extension, Multipart, Path, State};
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use db::entities::file_assets;
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};
use serde::Serialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct AssetResponse {
    pub id: Uuid,
    pub asset: Option<String>,
    pub attributes: Option<serde_json::Value>,
    pub entity_id: Option<Uuid>,
    pub entity_type: Option<String>,
    pub size: Option<i64>,
    pub content_type: Option<String>,
    pub is_uploaded: bool,
    pub created_by_id: Uuid,
    pub url: String,
    pub created_at: Option<String>,
}

impl From<(file_assets::Model, String)> for AssetResponse {
    fn from((m, base_url): (file_assets::Model, String)) -> Self {
        let url = format!("{}/api/assets/{}/", base_url, m.id);
        Self {
            id: m.id,
            asset: m.asset,
            attributes: m.attributes,
            entity_id: m.entity_id,
            entity_type: m.entity_type,
            size: m.size,
            content_type: m.content_type,
            is_uploaded: m.is_uploaded,
            created_by_id: m.created_by_id,
            url,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/", axum::routing::post(upload_asset))
        .route("/{asset_id}", axum::routing::get(get_asset).delete(delete_asset))
        .route("/{asset_id}/", axum::routing::get(get_asset).delete(delete_asset))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// POST /api/assets/upload/ - upload file (multipart)
pub async fn upload_asset(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, AppError> {
    let mut uploaded_id: Option<Uuid> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {}", e)))?
    {
        let file_name = field
            .file_name()
            .map(|n| n.to_string())
            .unwrap_or_else(|| "upload".to_string());

        let content_type = field
            .content_type()
            .map(|ct| ct.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string());

        let data = field
            .bytes()
            .await
            .map_err(|e| AppError::BadRequest(format!("Failed to read file data: {}", e)))?;

        let size = data.len() as i64;
        let asset_id = Uuid::new_v4();

        // Determine file extension
        let ext = std::path::Path::new(&file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");

        let stored_filename = format!("{}.{}", asset_id, ext);

        // Ensure storage directory exists
        let storage_path = &state.config.storage.path;
        tokio::fs::create_dir_all(storage_path)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to create storage dir: {}", e)))?;

        // Save file to disk
        let file_path = std::path::Path::new(storage_path).join(&stored_filename);
        tokio::fs::write(&file_path, &data)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to write file: {}", e)))?;

        let now = Utc::now().fixed_offset();

        // Create database record
        let _asset = file_assets::ActiveModel {
            id: Set(asset_id),
            asset: Set(Some(stored_filename)),
            attributes: Set(Some(serde_json::json!({
                "original_name": file_name,
            }))),
            entity_id: Set(None),
            entity_type: Set(None),
            size: Set(Some(size)),
            content_type: Set(Some(content_type)),
            is_uploaded: Set(true),
            created_by_id: Set(current_user.0.id),
            created_at: Set(Some(now)),
            updated_at: Set(Some(now)),
            deleted_at: Set(None),
        }
        .insert(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Asset insert error: {}", e)))?;

        uploaded_id = Some(asset_id);
        // Only process the first file field
        break;
    }

    let asset_id = uploaded_id.ok_or_else(|| AppError::BadRequest("No file uploaded".to_string()))?;

    // Fetch the created asset for response
    let asset = file_assets::Entity::find_by_id(asset_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("Asset not found after insert")))?;

    let resp = AssetResponse::from((asset, state.config.server.base_url.clone()));

    Ok((axum::http::StatusCode::CREATED, Json(resp)))
}

/// GET /api/assets/{uuid}/ - get asset metadata
pub async fn get_asset(
    State(state): State<AppState>,
    Extension(_current_user): Extension<CurrentUser>,
    Path(asset_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let asset = file_assets::Entity::find()
        .filter(file_assets::Column::Id.eq(asset_id))
        .filter(file_assets::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Asset not found".into()))?;

    let resp = AssetResponse::from((asset, state.config.server.base_url.clone()));
    Ok(Json(resp))
}

/// DELETE /api/assets/{uuid}/ - delete asset
pub async fn delete_asset(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(asset_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let asset = file_assets::Entity::find()
        .filter(file_assets::Column::Id.eq(asset_id))
        .filter(file_assets::Column::DeletedAt.is_null())
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Asset not found".into()))?;

    // Only the uploader or admin can delete
    if asset.created_by_id != current_user.0.id && !current_user.0.is_superuser {
        return Err(AppError::Forbidden("Cannot delete this asset".into()));
    }

    let now = Utc::now().fixed_offset();

    // Delete file from disk if present
    if let Some(ref filename) = asset.asset {
        let file_path = std::path::Path::new(&state.config.storage.path).join(filename);
        let _ = tokio::fs::remove_file(file_path).await;
    }

    // Soft-delete in DB
    let mut active: file_assets::ActiveModel = asset.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "message": "Asset deleted" })))
}

/// POST /api/assets/v2/workspaces/{slug}/ - Create asset record (JSON metadata).
/// The Plane frontend uses a two-step upload: first POST JSON metadata, then PUT the file.
/// For self-hosted, we return an upload URL that points back to our file-upload endpoint.
#[derive(serde::Deserialize)]
pub struct V2AssetRequest {
    pub entity_type: Option<String>,
    pub entity_identifier: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub mime_type: Option<String>,
    pub size: Option<i64>,
}

pub async fn upload_asset_v2(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<V2AssetRequest>,
) -> Result<impl IntoResponse, AppError> {
    let asset_id = Uuid::new_v4();
    let now = Utc::now().fixed_offset();

    let file_name = body.name.unwrap_or_else(|| "upload".to_string());
    let content_type = body.mime_type.unwrap_or_else(|| "application/octet-stream".to_string());
    let size = body.size.unwrap_or(0);

    let ext = std::path::Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");

    let stored_filename = format!("{}.{}", asset_id, ext);

    // Create DB record in pending state (is_uploaded = false)
    let _asset = file_assets::ActiveModel {
        id: Set(asset_id),
        asset: Set(Some(stored_filename)),
        attributes: Set(Some(serde_json::json!({
            "original_name": file_name,
        }))),
        entity_id: Set(None),
        entity_type: Set(body.entity_type),
        size: Set(Some(size)),
        content_type: Set(Some(content_type)),
        is_uploaded: Set(false),
        created_by_id: Set(current_user.0.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Asset insert error: {}", e)))?;

    // Return asset metadata with upload URL pointing to our own server
    let upload_url = format!("{}/api/assets/upload/{}/", state.config.server.base_url, asset_id);

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({
            "asset_id": asset_id.to_string(),
            "asset_url": format!("{}/api/assets/{}/", state.config.server.base_url, asset_id),
            "upload_data": {
                "url": upload_url,
                "fields": {},
            },
        })),
    ))
}

/// PUT/POST /api/assets/upload/{asset_id}/ - Receive the actual file for a v2 asset.
/// Accepts both raw bytes and multipart/form-data (the fileUploadService sends multipart).
pub async fn upload_asset_file(
    State(state): State<AppState>,
    Path(asset_id): Path<Uuid>,
    req: axum::extract::Request,
) -> Result<impl IntoResponse, AppError> {
    let asset = file_assets::Entity::find_by_id(asset_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Asset not found".into()))?;

    let content_type = req.headers().get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let data: Vec<u8> = if content_type.contains("multipart/form-data") {
        // Parse multipart and extract the file field
        let boundary = content_type.split("boundary=")
            .nth(1)
            .unwrap_or("")
            .to_string();
        let body_bytes = axum::body::to_bytes(req.into_body(), 50 * 1024 * 1024)
            .await
            .map_err(|e| AppError::BadRequest(format!("Failed to read body: {}", e)))?;
        let body_str = String::from_utf8_lossy(&body_bytes);

        // Find the file content between boundary markers
        let boundary_marker = format!("--{}", boundary);
        let parts: Vec<&str> = body_str.split(&boundary_marker).collect();
        let mut file_data: Vec<u8> = Vec::new();

        for part in &parts {
            if part.contains("Content-Disposition") && part.contains("filename") {
                if let Some(header_end) = part.find("\r\n\r\n") {
                    let raw = part[header_end + 4..].trim_end_matches("\r\n--").trim_end_matches("--");
                    file_data = raw.as_bytes().to_vec();
                    break;
                }
            }
        }

        if file_data.is_empty() {
            // Fallback: use entire body
            body_bytes.to_vec()
        } else {
            file_data
        }
    } else {
        // Raw bytes
        axum::body::to_bytes(req.into_body(), 50 * 1024 * 1024)
            .await
            .map_err(|e| AppError::BadRequest(format!("Failed to read body: {}", e)))?
            .to_vec()
    };

    let stored_filename = asset.asset.as_deref().unwrap_or("upload.bin");
    let storage_path = &state.config.storage.path;
    tokio::fs::create_dir_all(storage_path)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to create storage dir: {}", e)))?;

    let file_path = std::path::Path::new(storage_path).join(stored_filename);
    tokio::fs::write(&file_path, &data)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to write file: {}", e)))?;

    // Mark as uploaded
    let now = Utc::now().fixed_offset();
    let mut active: file_assets::ActiveModel = asset.into();
    active.is_uploaded = Set(true);
    active.size = Set(Some(data.len() as i64));
    active.updated_at = Set(Some(now));
    active.update(&state.db).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    Ok(Json(serde_json::json!({ "success": true })))
}

/// POST /api/assets/v2/workspaces/{slug}/projects/{project_id}/{entity_id}/bulk/
/// Bulk-associate assets with an entity (e.g. issue cover image).
#[derive(serde::Deserialize)]
pub struct BulkAssetRequest {
    pub asset_ids: Option<Vec<Uuid>>,
}

pub async fn bulk_update_assets(
    State(state): State<AppState>,
    Extension(_current_user): Extension<CurrentUser>,
    Path((_slug, _project_id, entity_id)): Path<(String, Uuid, Uuid)>,
    Json(body): Json<BulkAssetRequest>,
) -> Result<impl IntoResponse, AppError> {
    let asset_ids = body.asset_ids.unwrap_or_default();
    let now = Utc::now().fixed_offset();
    let mut results = Vec::new();

    for aid in &asset_ids {
        if let Some(asset) = file_assets::Entity::find_by_id(*aid).one(&state.db).await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        {
            let mut active: file_assets::ActiveModel = asset.into();
            active.entity_id = Set(Some(entity_id));
            active.entity_type = Set(Some("issue".to_string()));
            active.updated_at = Set(Some(now));
            let updated = active.update(&state.db).await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;
            results.push(AssetResponse::from((updated, state.config.server.base_url.clone())));
        }
    }

    Ok(Json(serde_json::json!(results)))
}

/// PATCH /api/assets/v2/workspaces/{slug}/{asset_id}/ - Mark v2 asset upload as complete.
pub async fn update_v2_asset_status(
    State(state): State<AppState>,
    Path((slug, asset_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let asset = file_assets::Entity::find_by_id(asset_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Asset not found".into()))?;

    let now = Utc::now().fixed_offset();
    let mut active: file_assets::ActiveModel = asset.into();
    active.is_uploaded = Set(true);
    active.updated_at = Set(Some(now));
    let updated = active.update(&state.db).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB update error: {}", e)))?;

    let resp = AssetResponse::from((updated, state.config.server.base_url.clone()));
    Ok(Json(resp))
}

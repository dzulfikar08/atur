use chrono::Utc;
use db::entities::{page_versions, pages};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};
use uuid::Uuid;

/// Maximum number of versions retained per page.
const MAX_VERSIONS: u64 = 20;

/// Load the binary document state from the pages table.
/// Returns an empty Vec if no binary state exists.
pub async fn load_document_binary(
    db: &sea_orm::DatabaseConnection,
    page_id: Uuid,
) -> anyhow::Result<Vec<u8>> {
    let page = pages::Entity::find_by_id(page_id)
        .one(db)
        .await?;

    Ok(page
        .and_then(|p| p.description_binary)
        .unwrap_or_default())
}

/// Save the document binary state back to the pages table.
pub async fn save_document_binary(
    db: &sea_orm::DatabaseConnection,
    page_id: Uuid,
    data: &[u8],
) -> anyhow::Result<()> {
    let page = pages::Entity::find_by_id(page_id)
        .one(db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Page {} not found", page_id))?;

    let now = Utc::now().fixed_offset();
    let mut active: pages::ActiveModel = page.into();
    active.description_binary = Set(if data.is_empty() {
        None
    } else {
        Some(data.to_vec())
    });
    active.updated_at = Set(Some(now));
    active.update(db).await?;

    Ok(())
}

/// Create a page version snapshot (if under the MAX_VERSIONS limit).
/// On success returns the new version ID. Drops the oldest version if at capacity.
pub async fn create_page_version(
    db: &sea_orm::DatabaseConnection,
    page_id: Uuid,
    description_binary: Option<Vec<u8>>,
    description_html: Option<String>,
    description_json: Option<serde_json::Value>,
    owned_by_id: Option<Uuid>,
) -> anyhow::Result<Uuid> {
    // Count existing versions
    let count = page_versions::Entity::find()
        .filter(page_versions::Column::PageId.eq(page_id))
        .filter(page_versions::Column::DeletedAt.is_null())
        .count(db)
        .await?;

    // If at capacity, soft-delete the oldest version
    if count >= MAX_VERSIONS {
        let oldest = page_versions::Entity::find()
            .filter(page_versions::Column::PageId.eq(page_id))
            .filter(page_versions::Column::DeletedAt.is_null())
            .order_by_asc(page_versions::Column::CreatedAt)
            .one(db)
            .await?;

        if let Some(old) = oldest {
            let now = Utc::now().fixed_offset();
            let mut active: page_versions::ActiveModel = old.into();
            active.deleted_at = Set(Some(now));
            active.updated_at = Set(Some(now));
            active.update(db).await?;
        }
    }

    let now = Utc::now().fixed_offset();
    let version_id = Uuid::new_v4();

    page_versions::ActiveModel {
        id: Set(version_id),
        page_id: Set(page_id),
        description_binary: Set(description_binary),
        description_html: Set(description_html),
        description_json: Set(description_json),
        last_saved_at: Set(Some(now)),
        owned_by_id: Set(owned_by_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    }
    .insert(db)
    .await?;

    Ok(version_id)
}

/// Simple HTML-to-plaintext stripper (removes tags).
pub fn strip_html(html: &str) -> String {
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

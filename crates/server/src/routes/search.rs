use axum::extract::{Extension, Path, Query, State};
use axum::Json;
use axum::routing::get;
use db::entities::{issues, pages};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::middleware::permission::load_workspace_by_slug;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    #[serde(alias = "search")]
    pub q: String,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub issues: Vec<IssueSearchResult>,
    pub pages: Vec<PageSearchResult>,
}

#[derive(Debug, Serialize)]
pub struct IssueSearchResult {
    pub id: Uuid,
    pub name: String,
    pub description_stripped: Option<String>,
    pub sequence_id: i64,
    pub project_id: Uuid,
    pub workspace_id: Uuid,
    pub state_id: Option<Uuid>,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PageSearchResult {
    pub id: Uuid,
    pub name: String,
    pub description_stripped: Option<String>,
    pub workspace_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub created_at: Option<String>,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> axum::Router<AppState> {
    axum::Router::new().route("/", get(search_handler))
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/workspaces/{slug}/search/?q=<query>
pub async fn search_handler(
    State(state): State<AppState>,
    Extension(_user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Query(params): Query<SearchQuery>,
) -> Result<Json<SearchResults>, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    let query = &params.q;

    // Try Tantivy search first, fall back to SQL LIKE
    if state.search_index.is_some() {
        tantivy_search(&state, workspace.id, query).await
    } else {
        sql_search(&state, workspace.id, query).await
    }
}

// ---------------------------------------------------------------------------
// Tantivy-based search
// ---------------------------------------------------------------------------

async fn tantivy_search(
    state: &AppState,
    workspace_id: Uuid,
    query: &str,
) -> Result<Json<SearchResults>, AppError> {
    let index = state.search_index.as_ref().unwrap();

    let results = crate::search_index::search(
        index,
        query,
        Some(&workspace_id.to_string()),
        50,
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Tantivy search error: {}", e)))?;

    let mut issue_results: Vec<IssueSearchResult> = Vec::new();
    let mut page_results: Vec<PageSearchResult> = Vec::new();

    for sr in &results {
        match sr.entity_type.as_str() {
            "issue" => {
                // Fetch the full issue from DB to get all fields
                if let Ok(uuid) = Uuid::parse_str(&sr.id) {
                    if let Some(issue) = issues::Entity::find_by_id(uuid)
                        .one(&state.db)
                        .await
                        .ok()
                        .flatten()
                    {
                        // Only include non-deleted issues in this workspace
                        if issue.deleted_at.is_none() && issue.workspace_id == workspace_id {
                            issue_results.push(IssueSearchResult {
                                id: issue.id,
                                name: issue.name,
                                description_stripped: issue.description_stripped,
                                sequence_id: issue.sequence_id,
                                project_id: issue.project_id,
                                workspace_id: issue.workspace_id,
                                state_id: issue.state_id,
                                created_at: issue.created_at.map(|dt| dt.to_rfc3339()),
                            });
                        }
                    }
                }
            }
            "page" => {
                if let Ok(uuid) = Uuid::parse_str(&sr.id) {
                    if let Some(page) = pages::Entity::find_by_id(uuid)
                        .one(&state.db)
                        .await
                        .ok()
                        .flatten()
                    {
                        if page.deleted_at.is_none() && page.workspace_id == workspace_id {
                            page_results.push(PageSearchResult {
                                id: page.id,
                                name: page.name,
                                description_stripped: page.description_stripped,
                                workspace_id: page.workspace_id,
                                parent_id: page.parent_id,
                                created_at: page.created_at.map(|dt| dt.to_rfc3339()),
                            });
                        }
                    }
                }
            }
            "project" => {
                // Projects are not in the search response format, skip
            }
            _ => {}
        }
    }

    Ok(Json(SearchResults {
        issues: issue_results,
        pages: page_results,
    }))
}

// ---------------------------------------------------------------------------
// SQL LIKE fallback search (original implementation)
// ---------------------------------------------------------------------------

async fn sql_search(
    state: &AppState,
    workspace_id: Uuid,
    query: &str,
) -> Result<Json<SearchResults>, AppError> {
    // Search issues by name or description_stripped (case-insensitive via contains)
    let issue_results: Vec<issues::Model> = issues::Entity::find()
        .filter(issues::Column::WorkspaceId.eq(workspace_id))
        .filter(issues::Column::DeletedAt.is_null())
        .filter(
            sea_orm::Condition::any()
                .add(issues::Column::Name.contains(query))
                .add(issues::Column::DescriptionStripped.contains(query)),
        )
        .order_by_desc(issues::Column::CreatedAt)
        .limit(50)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    // Search pages by name
    let page_results: Vec<pages::Model> = pages::Entity::find()
        .filter(pages::Column::WorkspaceId.eq(workspace_id))
        .filter(pages::Column::DeletedAt.is_null())
        .filter(pages::Column::Name.contains(query))
        .order_by_desc(pages::Column::CreatedAt)
        .limit(50)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let issue_list = issue_results
        .into_iter()
        .map(|i| IssueSearchResult {
            id: i.id,
            name: i.name,
            description_stripped: i.description_stripped,
            sequence_id: i.sequence_id,
            project_id: i.project_id,
            workspace_id: i.workspace_id,
            state_id: i.state_id,
            created_at: i.created_at.map(|dt| dt.to_rfc3339()),
        })
        .collect();

    let page_list = page_results
        .into_iter()
        .map(|p| PageSearchResult {
            id: p.id,
            name: p.name,
            description_stripped: p.description_stripped,
            workspace_id: p.workspace_id,
            parent_id: p.parent_id,
            created_at: p.created_at.map(|dt| dt.to_rfc3339()),
        })
        .collect();

    Ok(Json(SearchResults {
        issues: issue_list,
        pages: page_list,
    }))
}

use axum::extract::{Extension, Path, State};
use axum::response::IntoResponse;
use axum::Json;
use axum::routing::{delete, get, patch, post};
use chrono::Utc;
use db::entities::custom_fields;
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::auth::CurrentUser;
use crate::middleware::permission::{load_workspace_by_slug, require_project_role};
use crate::state::AppState;

const ROLE_ADMIN: i16 = 20;
const ROLE_MEMBER: i16 = 15;
const ROLE_GUEST: i16 = 5;

const VALID_FIELD_TYPES: &[&str] = &[
    "text", "select", "multi_select", "number", "date", "checkbox", "url", "user",
];

#[derive(Debug, Serialize)]
pub struct CustomFieldResponse {
    pub id: Uuid,
    pub name: String,
    pub field_type: String,
    pub settings: Option<serde_json::Value>,
    pub is_required: bool,
    pub sort_order: f32,
    pub project_id: Uuid,
    pub workspace_id: Uuid,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl From<custom_fields::Model> for CustomFieldResponse {
    fn from(m: custom_fields::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            field_type: m.field_type,
            settings: m.settings,
            is_required: m.is_required,
            sort_order: m.sort_order,
            project_id: m.project_id,
            workspace_id: m.workspace_id,
            created_at: m.created_at.map(|dt| dt.to_rfc3339()),
            updated_at: m.updated_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateCustomFieldRequest {
    pub name: String,
    pub field_type: String,
    pub settings: Option<serde_json::Value>,
    pub is_required: Option<bool>,
    pub sort_order: Option<f32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCustomFieldRequest {
    pub name: Option<String>,
    pub settings: Option<serde_json::Value>,
    pub is_required: Option<bool>,
    pub sort_order: Option<f32>,
}

pub fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/", get(list_custom_fields).post(create_custom_field))
        .route(
            "/{field_id}/",
            get(get_custom_field)
                .patch(update_custom_field)
                .delete(delete_custom_field),
        )
}

async fn list_custom_fields(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let fields = custom_fields::Entity::find()
        .filter(custom_fields::Column::ProjectId.eq(project_id))
        .filter(custom_fields::Column::DeletedAt.is_null())
        .order_by_asc(custom_fields::Column::SortOrder)
        .all(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    let resp: Vec<CustomFieldResponse> = fields.into_iter().map(Into::into).collect();
    Ok(Json(resp))
}

async fn create_custom_field(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id)): Path<(String, Uuid)>,
    Json(body): Json<CreateCustomFieldRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    if !VALID_FIELD_TYPES.contains(&body.field_type.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Invalid field_type '{}'. Must be one of: {}",
            body.field_type,
            VALID_FIELD_TYPES.join(", ")
        )));
    }

    validate_settings(&body.field_type, &body.settings)?;

    let now = Utc::now().fixed_offset();
    let field = custom_fields::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(body.name),
        field_type: Set(body.field_type),
        settings: Set(body.settings),
        is_required: Set(body.is_required.unwrap_or(false)),
        sort_order: Set(body.sort_order.unwrap_or(65535.0)),
        project_id: Set(project_id),
        workspace_id: Set(workspace.id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    };

    let result = field
        .insert(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    Ok(Json(CustomFieldResponse::from(result)))
}

async fn get_custom_field(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, field_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_GUEST).await?;

    let field = custom_fields::Entity::find_by_id(field_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Custom field not found".into()))?;

    if field.project_id != project_id || field.deleted_at.is_some() {
        return Err(AppError::NotFound("Custom field not found".into()));
    }

    Ok(Json(CustomFieldResponse::from(field)))
}

async fn update_custom_field(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, field_id)): Path<(String, Uuid, Uuid)>,
    Json(body): Json<UpdateCustomFieldRequest>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_MEMBER).await?;

    let field = custom_fields::Entity::find_by_id(field_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Custom field not found".into()))?;

    if field.project_id != project_id || field.deleted_at.is_some() {
        return Err(AppError::NotFound("Custom field not found".into()));
    }

    if let Some(ref settings) = body.settings {
        validate_settings(&field.field_type, &Some(settings.clone()))?;
    }

    let now = Utc::now().fixed_offset();
    let mut active: custom_fields::ActiveModel = field.into();
    if let Some(name) = body.name {
        active.name = Set(name);
    }
    if let Some(settings) = body.settings {
        active.settings = Set(Some(settings));
    }
    if let Some(is_required) = body.is_required {
        active.is_required = Set(is_required);
    }
    if let Some(sort_order) = body.sort_order {
        active.sort_order = Set(sort_order);
    }
    active.updated_at = Set(Some(now));

    let result = active
        .update(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    Ok(Json(CustomFieldResponse::from(result)))
}

async fn delete_custom_field(
    State(state): State<AppState>,
    Extension(current_user): Extension<CurrentUser>,
    Path((slug, project_id, field_id)): Path<(String, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let workspace = load_workspace_by_slug(&state, &slug).await?;
    require_project_role(&state, workspace.id, project_id, &current_user, ROLE_ADMIN).await?;

    let field = custom_fields::Entity::find_by_id(field_id)
        .one(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Custom field not found".into()))?;

    if field.project_id != project_id || field.deleted_at.is_some() {
        return Err(AppError::NotFound("Custom field not found".into()));
    }

    let now = Utc::now().fixed_offset();

    let mut active: custom_fields::ActiveModel = field.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));
    active.update(&state.db).await.map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    db::entities::issue_custom_values::Entity::update_many()
        .col_expr(
            db::entities::issue_custom_values::Column::DeletedAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(db::entities::issue_custom_values::Column::CustomFieldId.eq(field_id))
        .filter(db::entities::issue_custom_values::Column::DeletedAt.is_null())
        .exec(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DB error: {}", e)))?;

    Ok(Json(serde_json::json!({"success": true})))
}

fn validate_settings(
    field_type: &str,
    settings: &Option<serde_json::Value>,
) -> Result<(), AppError> {
    if field_type == "select" || field_type == "multi_select" {
        if let Some(s) = settings {
            if !s.is_object() {
                return Err(AppError::BadRequest(
                    "Settings must be a JSON object with 'options' array".into(),
                ));
            }
            if let Some(opts) = s.get("options") {
                if !opts.is_array() {
                    return Err(AppError::BadRequest(
                        "settings.options must be an array".into(),
                    ));
                }
            }
        }
    }
    Ok(())
}

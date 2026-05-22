use chrono::Utc;
use db::entities::{cycle_issues, cycles, issues, states};
use sea_orm::ActiveValue::Set;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use uuid::Uuid;

use super::*;

// --- Sprint parameter structs ---

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListSprintsParams {
    pub workspace: Option<String>,
    pub project_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CreateSprintParams {
    pub workspace: Option<String>,
    pub project_id: String,
    #[schemars(description = "Sprint name")]
    pub name: String,
    pub description: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GetSprintParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub sprint_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct UpdateSprintParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub sprint_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AddIssueToSprintParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub sprint_id: String,
    pub issue_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RemoveIssueFromSprintParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub sprint_id: String,
    pub issue_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GetSprintProgressParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub sprint_id: String,
}

// --- Sprint implementations ---

pub async fn list_sprints_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListSprintsParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    match cycles::Entity::find()
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::WorkspaceId.eq(ws.id))
        .filter(cycles::Column::DeletedAt.is_null())
        .order_by_asc(cycles::Column::SortOrder)
        .all(db)
        .await
    {
        Ok(list) => {
            let result: Vec<serde_json::Value> = list.iter().map(cycle_to_json).collect();
            ok_json(serde_json::json!(result))
        }
        Err(e) => err_str(e),
    }
}

pub async fn create_sprint_impl(
    db: &sea_orm::DatabaseConnection,
    params: CreateSprintParams,
    bot_user_id: Uuid,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    // Compute sort_order: min existing - 10000
    let min_sort = match cycles::Entity::find()
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::DeletedAt.is_null())
        .order_by_asc(cycles::Column::SortOrder)
        .one(db)
        .await
    {
        Ok(m) => m.map(|c| c.sort_order).unwrap_or(0.0),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();

    match (cycles::ActiveModel {
        id: Set(Uuid::new_v4()),
        name: Set(params.name),
        description: Set(params.description),
        start_date: Set(params.start_date),
        end_date: Set(params.end_date),
        sort_order: Set(min_sort - 10000.0),
        progress_snapshot: Set(None),
        archived_at: Set(None),
        project_id: Set(project_id),
        workspace_id: Set(ws.id),
        owned_by_id: Set(Some(bot_user_id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(cycle) => ok_json(cycle_to_json(&cycle)),
        Err(e) => err_str(format!("Cycle insert error: {}", e)),
    }
}

pub async fn get_sprint_impl(
    db: &sea_orm::DatabaseConnection,
    params: GetSprintParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let sprint_id = match parse_uuid(&params.sprint_id, "sprint_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    match cycles::Entity::find()
        .filter(cycles::Column::Id.eq(sprint_id))
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::WorkspaceId.eq(ws.id))
        .filter(cycles::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(c)) => ok_json(cycle_to_json(&c)),
        Ok(None) => err_str("Sprint not found"),
        Err(e) => err_str(e),
    }
}

pub async fn update_sprint_impl(
    db: &sea_orm::DatabaseConnection,
    params: UpdateSprintParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let sprint_id = match parse_uuid(&params.sprint_id, "sprint_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let cycle = match cycles::Entity::find()
        .filter(cycles::Column::Id.eq(sprint_id))
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::WorkspaceId.eq(ws.id))
        .filter(cycles::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(c)) => c,
        Ok(None) => return err_str("Sprint not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: cycles::ActiveModel = cycle.into();

    if let Some(name) = params.name {
        active.name = Set(name);
    }
    if let Some(description) = params.description {
        active.description = Set(Some(description));
    }
    if let Some(start_date) = params.start_date {
        active.start_date = Set(Some(start_date));
    }
    if let Some(end_date) = params.end_date {
        active.end_date = Set(Some(end_date));
    }
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(updated) => ok_json(cycle_to_json(&updated)),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

pub async fn add_issue_to_sprint_impl(
    db: &sea_orm::DatabaseConnection,
    params: AddIssueToSprintParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let sprint_id = match parse_uuid(&params.sprint_id, "sprint_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    // Verify cycle exists
    match cycles::Entity::find()
        .filter(cycles::Column::Id.eq(sprint_id))
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::WorkspaceId.eq(ws.id))
        .filter(cycles::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err_str("Sprint not found"),
        Err(e) => return err_str(e),
    }

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

    // Check if already in this cycle
    match cycle_issues::Entity::find()
        .filter(cycle_issues::Column::CycleId.eq(sprint_id))
        .filter(cycle_issues::Column::IssueId.eq(issue_id))
        .filter(cycle_issues::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => return err_str("Issue is already in this sprint"),
        Ok(None) => {}
        Err(e) => return err_str(e),
    }

    let now = Utc::now().fixed_offset();

    match (cycle_issues::ActiveModel {
        id: Set(Uuid::new_v4()),
        cycle_id: Set(sprint_id),
        issue_id: Set(issue_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(ci) => ok_json(serde_json::json!({
            "id": ci.id,
            "cycle_id": ci.cycle_id,
            "issue_id": ci.issue_id,
        })),
        Err(e) => err_str(format!("Cycle issue insert error: {}", e)),
    }
}

pub async fn remove_issue_from_sprint_impl(
    db: &sea_orm::DatabaseConnection,
    params: RemoveIssueFromSprintParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let sprint_id = match parse_uuid(&params.sprint_id, "sprint_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let ci = match cycle_issues::Entity::find()
        .filter(cycle_issues::Column::CycleId.eq(sprint_id))
        .filter(cycle_issues::Column::IssueId.eq(issue_id))
        .filter(cycle_issues::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(ci)) => ci,
        Ok(None) => return err_str("Issue not found in this sprint"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: cycle_issues::ActiveModel = ci.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(_) => ok_json(serde_json::json!({ "message": "Issue removed from sprint" })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

pub async fn get_sprint_progress_impl(
    db: &sea_orm::DatabaseConnection,
    params: GetSprintProgressParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let sprint_id = match parse_uuid(&params.sprint_id, "sprint_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    // Verify cycle
    match cycles::Entity::find()
        .filter(cycles::Column::Id.eq(sprint_id))
        .filter(cycles::Column::ProjectId.eq(project_id))
        .filter(cycles::Column::WorkspaceId.eq(ws.id))
        .filter(cycles::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err_str("Sprint not found"),
        Err(e) => return err_str(e),
    }

    // Get issue IDs in this cycle
    let cycle_issue_list = match cycle_issues::Entity::find()
        .filter(cycle_issues::Column::CycleId.eq(sprint_id))
        .filter(cycle_issues::Column::DeletedAt.is_null())
        .all(db)
        .await
    {
        Ok(l) => l,
        Err(e) => return err_str(e),
    };

    let issue_ids: Vec<Uuid> = cycle_issue_list.iter().map(|ci| ci.issue_id).collect();
    let total = issue_ids.len() as u64;

    if issue_ids.is_empty() {
        return ok_json(serde_json::json!({
            "total": 0,
            "backlog": 0,
            "unstarted": 0,
            "started": 0,
            "completed": 0,
            "cancelled": 0,
        }));
    }

    // Fetch issues
    let cycle_issues_models = match issues::Entity::find()
        .filter(issues::Column::Id.is_in(issue_ids))
        .filter(issues::Column::DeletedAt.is_null())
        .all(db)
        .await
    {
        Ok(m) => m,
        Err(e) => return err_str(e),
    };

    let state_ids: Vec<Uuid> = cycle_issues_models
        .iter()
        .filter_map(|i| i.state_id)
        .collect();

    let mut state_groups: std::collections::HashMap<Uuid, String> = std::collections::HashMap::new();
    if !state_ids.is_empty() {
        match states::Entity::find()
            .filter(states::Column::Id.is_in(state_ids))
            .all(db)
            .await
        {
            Ok(sm) => {
                for s in sm {
                    state_groups.insert(s.id, s.group);
                }
            }
            Err(e) => return err_str(e),
        }
    }

    let mut backlog = 0u64;
    let mut unstarted = 0u64;
    let mut started = 0u64;
    let mut completed = 0u64;
    let mut cancelled = 0u64;

    for issue in &cycle_issues_models {
        let group = issue
            .state_id
            .as_ref()
            .and_then(|sid| state_groups.get(sid))
            .map(|g| g.as_str())
            .unwrap_or("backlog");

        match group {
            "backlog" => backlog += 1,
            "unstarted" => unstarted += 1,
            "started" => started += 1,
            "completed" => completed += 1,
            "cancelled" => cancelled += 1,
            _ => backlog += 1,
        }
    }

    ok_json(serde_json::json!({
        "total": total,
        "backlog": backlog,
        "unstarted": unstarted,
        "started": started,
        "completed": completed,
        "cancelled": cancelled,
    }))
}

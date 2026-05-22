use chrono::Utc;
use db::entities::{
    cycle_issues, issue_activities, issue_assignees, issue_comments, issue_labels,
    issue_sequences, issue_subscribers, issues, projects, states,
};
use sea_orm::ActiveValue::Set;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use uuid::Uuid;

use super::*;

// --- Issue parameter structs ---

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListIssuesParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Filter by state UUID")]
    pub state: Option<String>,
    #[schemars(description = "Filter by priority: urgent, high, medium, low, none")]
    pub priority: Option<String>,
    #[schemars(description = "Filter by assignee UUID")]
    pub assignee: Option<String>,
    #[schemars(description = "Filter by sprint/cycle UUID")]
    pub sprint: Option<String>,
    #[schemars(description = "Text search in name and description")]
    pub search: Option<String>,
    #[schemars(description = "Max results (default 20, max 100)")]
    pub limit: Option<u64>,
    #[schemars(description = "Offset for pagination")]
    pub offset: Option<u64>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CreateIssueParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Issue title")]
    pub name: String,
    #[schemars(description = "HTML description")]
    pub description_html: Option<String>,
    #[schemars(description = "Priority: urgent, high, medium, low, none")]
    pub priority: Option<String>,
    #[schemars(description = "State UUID")]
    pub state_id: Option<String>,
    #[schemars(description = "List of assignee UUIDs")]
    pub assignee_ids: Option<Vec<String>>,
    #[schemars(description = "List of label UUIDs")]
    pub label_ids: Option<Vec<String>>,
    #[schemars(description = "Start date (ISO format)")]
    pub start_date: Option<String>,
    #[schemars(description = "Target date (ISO format)")]
    pub target_date: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GetIssueParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Issue UUID")]
    pub issue_id: Option<String>,
    #[schemars(description = "Issue sequence ID (e.g. 42)")]
    pub sequence_id: Option<i64>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct UpdateIssueParams {
    #[schemars(description = "Workspace slug")]
    pub workspace: Option<String>,
    #[schemars(description = "Project UUID")]
    pub project_id: String,
    #[schemars(description = "Issue UUID")]
    pub issue_id: String,
    #[schemars(description = "New title")]
    pub name: Option<String>,
    #[schemars(description = "New HTML description")]
    pub description_html: Option<String>,
    #[schemars(description = "Priority: urgent, high, medium, low, none")]
    pub priority: Option<String>,
    #[schemars(description = "State UUID")]
    pub state_id: Option<String>,
    #[schemars(description = "Start date")]
    pub start_date: Option<String>,
    #[schemars(description = "Target date")]
    pub target_date: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct DeleteIssueParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub issue_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SearchIssuesParams {
    pub workspace: Option<String>,
    pub project_id: Option<String>,
    #[schemars(description = "Search query")]
    pub query: String,
    pub limit: Option<u64>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AddCommentParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub issue_id: String,
    #[schemars(description = "Comment HTML content")]
    pub comment_html: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListCommentsParams {
    pub workspace: Option<String>,
    pub project_id: String,
    pub issue_id: String,
}

// --- Issue implementations ---

pub async fn list_issues_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListIssuesParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    // Verify project exists in workspace
    match projects::Entity::find()
        .filter(projects::Column::Id.eq(project_id))
        .filter(projects::Column::WorkspaceId.eq(ws.id))
        .filter(projects::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(_)) => {}
        Ok(None) => return err_str("Project not found"),
        Err(e) => return err_str(e),
    };

    let mut condition = sea_orm::Condition::all()
        .add(issues::Column::ProjectId.eq(project_id))
        .add(issues::Column::DeletedAt.is_null())
        .add(issues::Column::ArchivedAt.is_null());

    if let Some(state_str) = &params.state {
        match parse_uuid(state_str, "state") {
            Ok(sid) => condition = condition.add(issues::Column::StateId.eq(sid)),
            Err(e) => return err_str(e),
        }
    }
    if let Some(ref priority) = params.priority {
        condition = condition.add(issues::Column::Priority.eq(priority.as_str()));
    }
    if let Some(search) = params.search {
        condition = condition.add(
            sea_orm::Condition::any()
                .add(issues::Column::Name.contains(&search))
                .add(issues::Column::DescriptionStripped.contains(&search)),
        );
    }

    // Handle assignee filter
    if let Some(assignee_str) = &params.assignee {
        let assignee_id = match parse_uuid(assignee_str, "assignee") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        match issue_assignees::Entity::find()
            .filter(issue_assignees::Column::AssigneeId.eq(assignee_id))
            .filter(issue_assignees::Column::DeletedAt.is_null())
            .all(db)
            .await
        {
            Ok(assigned) => {
                let ids: Vec<Uuid> = assigned.into_iter().map(|a| a.issue_id).collect();
                condition = condition.add(issues::Column::Id.is_in(ids));
            }
            Err(e) => return err_str(e),
        }
    }

    // Handle sprint/cycle filter
    if let Some(sprint_str) = &params.sprint {
        let sprint_id = match parse_uuid(sprint_str, "sprint") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        match cycle_issues::Entity::find()
            .filter(cycle_issues::Column::CycleId.eq(sprint_id))
            .filter(cycle_issues::Column::DeletedAt.is_null())
            .all(db)
            .await
        {
            Ok(ci) => {
                let ids: Vec<Uuid> = ci.into_iter().map(|c| c.issue_id).collect();
                condition = condition.add(issues::Column::Id.is_in(ids));
            }
            Err(e) => return err_str(e),
        }
    }

    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);

    let query_builder = issues::Entity::find()
        .filter(condition)
        .order_by_asc(issues::Column::SortOrder);

    let paginator = query_builder.paginate(db, limit);

    let total = match paginator.num_items().await {
        Ok(t) => t,
        Err(e) => return err_str(e),
    };

    match paginator.fetch_page(offset / limit).await {
        Ok(issue_list) => {
            let results: Vec<serde_json::Value> = issue_list.iter().map(issue_to_json).collect();
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

pub async fn create_issue_impl(
    db: &sea_orm::DatabaseConnection,
    params: CreateIssueParams,
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

    // Generate sequence_id
    let max_seq = match issue_sequences::Entity::find()
        .filter(issue_sequences::Column::ProjectId.eq(project_id))
        .filter(issue_sequences::Column::IsDeleted.eq(false))
        .order_by_desc(issue_sequences::Column::Sequence)
        .one(db)
        .await
    {
        Ok(m) => m,
        Err(e) => return err_str(e),
    };
    let next_seq = max_seq.map(|s| s.sequence + 1).unwrap_or(1);

    let description_stripped = params.description_html.as_deref().map(strip_html);

    // Find default state if none provided
    let state_id = match params.state_id {
        Some(ref sid_str) => match parse_uuid(sid_str, "state_id") {
            Ok(id) => Some(id),
            Err(e) => return err_str(e),
        },
        None => match states::Entity::find()
            .filter(states::Column::ProjectId.eq(project_id))
            .filter(states::Column::IsDefault.eq(true))
            .filter(states::Column::DeletedAt.is_null())
            .one(db)
            .await
        {
            Ok(s) => s.map(|s| s.id),
            Err(e) => return err_str(e),
        },
    };

    let now = Utc::now().fixed_offset();
    let issue_id = Uuid::new_v4();

    let issue = match (issues::ActiveModel {
        id: Set(issue_id),
        name: Set(params.name),
        sequence_id: Set(next_seq),
        sort_order: Set(65535.0),
        priority: Set(params.priority.or(Some("none".to_string()))),
        start_date: Set(params.start_date),
        target_date: Set(params.target_date),
        completed_at: Set(None),
        archived_at: Set(None),
        is_draft: Set(false),
        description_json: Set(None),
        description_html: Set(params.description_html),
        description_stripped: Set(description_stripped),
        description_binary: Set(None),
        parent_id: Set(None),
        state_id: Set(state_id),
        estimate_point_id: Set(None),
        type_id: Set(None),
        project_id: Set(project_id),
        workspace_id: Set(ws.id),
        created_by_id: Set(Some(bot_user_id)),
        external_source: Set(None),
        external_id: Set(None),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(i) => i,
        Err(e) => return err_str(format!("Issue insert error: {}", e)),
    };

    // Create sequence record
    if let Err(e) = (issue_sequences::ActiveModel {
        id: Set(Uuid::new_v4()),
        sequence: Set(next_seq),
        issue_id: Set(Some(issue_id)),
        project_id: Set(project_id),
        is_deleted: Set(false),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        return err_str(format!("Sequence insert error: {}", e));
    }

    // Auto-subscribe bot
    let _ = (issue_subscribers::ActiveModel {
        id: Set(Uuid::new_v4()),
        issue_id: Set(issue_id),
        subscriber_id: Set(bot_user_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await;

    // Create activity
    let _ = (issue_activities::ActiveModel {
        id: Set(Uuid::new_v4()),
        verb: Set(Some("created".to_string())),
        field: Set(None),
        old_value: Set(None),
        new_value: Set(None),
        issue_id: Set(Some(issue_id)),
        issue_comment_id: Set(None),
        actor_id: Set(Some(bot_user_id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await;

    // Add assignees
    if let Some(assignee_strs) = params.assignee_ids {
        for assignee_str in assignee_strs {
            if let Ok(assignee_id) = parse_uuid(&assignee_str, "assignee_id") {
                let _ = (issue_assignees::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    issue_id: Set(issue_id),
                    assignee_id: Set(assignee_id),
                    created_at: Set(Some(now)),
                    updated_at: Set(Some(now)),
                    deleted_at: Set(None),
                })
                .insert(db)
                .await;
            }
        }
    }

    // Add labels
    if let Some(label_strs) = params.label_ids {
        for label_str in label_strs {
            if let Ok(label_id) = parse_uuid(&label_str, "label_id") {
                let _ = (issue_labels::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    issue_id: Set(issue_id),
                    label_id: Set(label_id),
                    created_at: Set(Some(now)),
                    updated_at: Set(Some(now)),
                    deleted_at: Set(None),
                })
                .insert(db)
                .await;
            }
        }
    }

    ok_json(issue_to_json(&issue))
}

pub async fn get_issue_impl(
    db: &sea_orm::DatabaseConnection,
    params: GetIssueParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let issue = if let Some(ref issue_id_str) = params.issue_id {
        let iid = match parse_uuid(issue_id_str, "issue_id") {
            Ok(id) => id,
            Err(e) => return err_str(e),
        };
        match issues::Entity::find()
            .filter(issues::Column::Id.eq(iid))
            .filter(issues::Column::ProjectId.eq(project_id))
            .filter(issues::Column::DeletedAt.is_null())
            .one(db)
            .await
        {
            Ok(Some(i)) => i,
            Ok(None) => return err_str("Issue not found"),
            Err(e) => return err_str(e),
        }
    } else if let Some(seq_id) = params.sequence_id {
        match issues::Entity::find()
            .filter(issues::Column::ProjectId.eq(project_id))
            .filter(issues::Column::SequenceId.eq(seq_id))
            .filter(issues::Column::DeletedAt.is_null())
            .one(db)
            .await
        {
            Ok(Some(i)) => i,
            Ok(None) => return err_str("Issue not found"),
            Err(e) => return err_str(e),
        }
    } else {
        return err_str("Must provide either issue_id or sequence_id");
    };

    let _ = ws;

    // Fetch assignees
    let assignees = match issue_assignees::Entity::find()
        .filter(issue_assignees::Column::IssueId.eq(issue.id))
        .filter(issue_assignees::Column::DeletedAt.is_null())
        .all(db)
        .await
    {
        Ok(a) => a
            .into_iter()
            .map(|a| a.assignee_id.to_string())
            .collect::<Vec<_>>(),
        Err(_) => vec![],
    };

    // Fetch labels
    let issue_labels_list = match issue_labels::Entity::find()
        .filter(issue_labels::Column::IssueId.eq(issue.id))
        .filter(issue_labels::Column::DeletedAt.is_null())
        .all(db)
        .await
    {
        Ok(l) => l
            .into_iter()
            .map(|l| l.label_id.to_string())
            .collect::<Vec<_>>(),
        Err(_) => vec![],
    };

    let mut val = issue_to_json(&issue);
    val["assignees"] = serde_json::json!(assignees);
    val["labels"] = serde_json::json!(issue_labels_list);
    ok_json(val)
}

pub async fn update_issue_impl(
    db: &sea_orm::DatabaseConnection,
    params: UpdateIssueParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let issue = match issues::Entity::find()
        .filter(issues::Column::Id.eq(issue_id))
        .filter(issues::Column::ProjectId.eq(project_id))
        .filter(issues::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(i)) => i,
        Ok(None) => return err_str("Issue not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: issues::ActiveModel = issue.into();

    if let Some(name) = params.name {
        active.name = Set(name);
    }
    if let Some(priority) = params.priority {
        active.priority = Set(Some(priority));
    }
    if let Some(ref state_id_str) = params.state_id {
        match parse_uuid(state_id_str, "state_id") {
            Ok(sid) => active.state_id = Set(Some(sid)),
            Err(e) => return err_str(e),
        }
    }
    if let Some(description_html) = params.description_html {
        active.description_html = Set(Some(description_html.clone()));
        active.description_stripped = Set(Some(strip_html(&description_html)));
    }
    if let Some(start_date) = params.start_date {
        active.start_date = Set(Some(start_date));
    }
    if let Some(target_date) = params.target_date {
        active.target_date = Set(Some(target_date));
    }

    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(updated) => ok_json(issue_to_json(&updated)),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

pub async fn delete_issue_impl(
    db: &sea_orm::DatabaseConnection,
    params: DeleteIssueParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let issue = match issues::Entity::find()
        .filter(issues::Column::Id.eq(issue_id))
        .filter(issues::Column::ProjectId.eq(project_id))
        .filter(issues::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(i)) => i,
        Ok(None) => return err_str("Issue not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let mut active: issues::ActiveModel = issue.into();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(Some(now));

    match active.update(db).await {
        Ok(_) => ok_json(serde_json::json!({ "message": "Issue deleted" })),
        Err(e) => err_str(format!("DB update error: {}", e)),
    }
}

pub async fn search_issues_impl(
    db: &sea_orm::DatabaseConnection,
    params: SearchIssuesParams,
) -> String {
    let ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };

    let limit = params.limit.unwrap_or(20).min(100);

    let mut condition = sea_orm::Condition::all()
        .add(issues::Column::WorkspaceId.eq(ws.id))
        .add(issues::Column::DeletedAt.is_null())
        .add(issues::Column::ArchivedAt.is_null())
        .add(
            sea_orm::Condition::any()
                .add(issues::Column::Name.contains(&params.query))
                .add(issues::Column::DescriptionStripped.contains(&params.query)),
        );

    if let Some(ref pid_str) = params.project_id {
        match parse_uuid(pid_str, "project_id") {
            Ok(pid) => condition = condition.add(issues::Column::ProjectId.eq(pid)),
            Err(e) => return err_str(e),
        }
    }

    match issues::Entity::find()
        .filter(condition)
        .order_by_asc(issues::Column::SortOrder)
        .limit(limit)
        .all(db)
        .await
    {
        Ok(list) => {
            let results: Vec<serde_json::Value> =
                list.into_iter().map(|i| issue_to_json(&i)).collect();
            ok_json(serde_json::json!({
                "results": results,
                "total": results.len(),
            }))
        }
        Err(e) => err_str(e),
    }
}

pub async fn add_comment_impl(
    db: &sea_orm::DatabaseConnection,
    params: AddCommentParams,
    bot_user_id: Uuid,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let project_id = match parse_uuid(&params.project_id, "project_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };
    let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    // Verify issue exists
    let issue = match issues::Entity::find()
        .filter(issues::Column::Id.eq(issue_id))
        .filter(issues::Column::ProjectId.eq(project_id))
        .filter(issues::Column::DeletedAt.is_null())
        .one(db)
        .await
    {
        Ok(Some(i)) => i,
        Ok(None) => return err_str("Issue not found"),
        Err(e) => return err_str(e),
    };

    let now = Utc::now().fixed_offset();
    let comment_stripped = strip_html(&params.comment_html);

    let comment = match (issue_comments::ActiveModel {
        id: Set(Uuid::new_v4()),
        comment_stripped: Set(Some(comment_stripped)),
        comment_json: Set(None),
        comment_html: Set(Some(params.comment_html)),
        access: Set(Some("internal".to_string())),
        parent_id: Set(None),
        issue_id: Set(issue.id),
        actor_id: Set(bot_user_id),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await
    {
        Ok(c) => c,
        Err(e) => return err_str(format!("Comment insert error: {}", e)),
    };

    // Create activity
    let _ = (issue_activities::ActiveModel {
        id: Set(Uuid::new_v4()),
        verb: Set(Some("commented".to_string())),
        field: Set(None),
        old_value: Set(None),
        new_value: Set(None),
        issue_id: Set(Some(issue.id)),
        issue_comment_id: Set(Some(comment.id)),
        actor_id: Set(Some(bot_user_id)),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
        deleted_at: Set(None),
    })
    .insert(db)
    .await;

    ok_json(serde_json::json!({
        "id": comment.id,
        "issue_id": comment.issue_id,
        "actor_id": comment.actor_id,
        "comment_html": comment.comment_html,
        "created_at": comment.created_at.map(|d| d.to_rfc3339()),
    }))
}

pub async fn list_comments_impl(
    db: &sea_orm::DatabaseConnection,
    params: ListCommentsParams,
) -> String {
    let _ws = match resolve_workspace(db, params.workspace.as_ref()).await {
        Ok(ws) => ws,
        Err(e) => return err_str(e),
    };
    let issue_id = match parse_uuid(&params.issue_id, "issue_id") {
        Ok(id) => id,
        Err(e) => return err_str(e),
    };

    let comments = match issue_comments::Entity::find()
        .filter(issue_comments::Column::IssueId.eq(issue_id))
        .filter(issue_comments::Column::DeletedAt.is_null())
        .order_by_asc(issue_comments::Column::CreatedAt)
        .all(db)
        .await
    {
        Ok(c) => c,
        Err(e) => return err_str(e),
    };

    let result: Vec<serde_json::Value> = comments
        .iter()
        .map(|c| {
            serde_json::json!({
                "id": c.id,
                "comment_html": c.comment_html,
                "comment_stripped": c.comment_stripped,
                "actor_id": c.actor_id,
                "issue_id": c.issue_id,
                "created_at": c.created_at.map(|d| d.to_rfc3339()),
            })
        })
        .collect();
    ok_json(serde_json::json!(result))
}

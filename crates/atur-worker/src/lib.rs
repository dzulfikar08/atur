mod auth;
mod error;
mod frontend;
mod handlers;
mod health;
mod state;

use state::AppState;
use tower_service::Service;
use worker::*;

fn router() -> axum::Router<AppState> {
    axum::Router::new()
        .merge(health::router())
        .nest("/auth", handlers::auth::router())
        .route("/api/users/me", axum::routing::get(handlers::users::get_me))
        .route("/api/users/me/", axum::routing::get(handlers::users::get_me))
        .route("/api/workspaces", axum::routing::get(handlers::workspaces::list_workspaces).post(handlers::workspaces::create_workspace))
        .route("/api/workspaces/", axum::routing::get(handlers::workspaces::list_workspaces).post(handlers::workspaces::create_workspace))
        .route("/api/workspaces/{slug}", axum::routing::get(handlers::workspaces::get_workspace).patch(handlers::workspaces::update_workspace))
        .route("/api/workspaces/{slug}/", axum::routing::get(handlers::workspaces::get_workspace).patch(handlers::workspaces::update_workspace))
        .route("/api/workspaces/{slug}/members", axum::routing::get(handlers::workspaces::list_members))
        .route("/api/workspaces/{slug}/members/", axum::routing::get(handlers::workspaces::list_members))
        .route("/api/workspaces/{slug}/projects", axum::routing::get(handlers::projects::list_projects).post(handlers::projects::create_project))
        .route("/api/workspaces/{slug}/projects/", axum::routing::get(handlers::projects::list_projects).post(handlers::projects::create_project))
        .route("/api/workspaces/{slug}/projects/{project_id}", axum::routing::get(handlers::projects::get_project).patch(handlers::projects::update_project).delete(handlers::projects::delete_project))
        .route("/api/workspaces/{slug}/projects/{project_id}/", axum::routing::get(handlers::projects::get_project).patch(handlers::projects::update_project).delete(handlers::projects::delete_project))
        .route("/api/workspaces/{slug}/projects/{project_id}/states", axum::routing::get(handlers::states::list_states).post(handlers::states::create_state))
        .route("/api/workspaces/{slug}/projects/{project_id}/states/", axum::routing::get(handlers::states::list_states).post(handlers::states::create_state))
        .route("/api/workspaces/{slug}/projects/{project_id}/states/{state_id}", axum::routing::patch(handlers::states::update_state).delete(handlers::states::delete_state))
        .route("/api/workspaces/{slug}/labels", axum::routing::get(handlers::labels::list_labels).post(handlers::labels::create_label))
        .route("/api/workspaces/{slug}/labels/", axum::routing::get(handlers::labels::list_labels).post(handlers::labels::create_label))
        .route("/api/workspaces/{slug}/labels/{label_id}", axum::routing::patch(handlers::labels::update_label).delete(handlers::labels::delete_label))
        .route("/api/workspaces/{slug}/projects/{project_id}/issues", axum::routing::get(handlers::issues::list_issues).post(handlers::issues::create_issue))
        .route("/api/workspaces/{slug}/projects/{project_id}/issues/", axum::routing::get(handlers::issues::list_issues).post(handlers::issues::create_issue))
        .route("/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}", axum::routing::get(handlers::issues::get_issue).patch(handlers::issues::update_issue).delete(handlers::issues::delete_issue))
        .route("/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/", axum::routing::get(handlers::issues::get_issue).patch(handlers::issues::update_issue).delete(handlers::issues::delete_issue))
        .route("/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/comments", axum::routing::get(handlers::issues::list_comments).post(handlers::issues::create_comment))
        .route("/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/comments/", axum::routing::get(handlers::issues::list_comments).post(handlers::issues::create_comment))
        .route("/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/activities", axum::routing::get(handlers::issues::list_activities))
        .route("/api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/activities/", axum::routing::get(handlers::issues::list_activities))
        .route("/api/workspaces/{slug}/projects/{project_id}/cycles", axum::routing::get(handlers::cycles::list_cycles).post(handlers::cycles::create_cycle))
        .route("/api/workspaces/{slug}/projects/{project_id}/cycles/", axum::routing::get(handlers::cycles::list_cycles).post(handlers::cycles::create_cycle))
        .route("/api/workspaces/{slug}/projects/{project_id}/cycles/{cycle_id}", axum::routing::patch(handlers::cycles::update_cycle).delete(handlers::cycles::delete_cycle))
        .route("/api/workspaces/{slug}/projects/{project_id}/modules", axum::routing::get(handlers::modules::list_modules).post(handlers::modules::create_module))
        .route("/api/workspaces/{slug}/projects/{project_id}/modules/", axum::routing::get(handlers::modules::list_modules).post(handlers::modules::create_module))
        .route("/api/workspaces/{slug}/projects/{project_id}/modules/{module_id}", axum::routing::patch(handlers::modules::update_module).delete(handlers::modules::delete_module))
        .route("/api/workspaces/{slug}/pages", axum::routing::get(handlers::pages::list_pages).post(handlers::pages::create_page))
        .route("/api/workspaces/{slug}/pages/", axum::routing::get(handlers::pages::list_pages).post(handlers::pages::create_page))
        .route("/api/workspaces/{slug}/pages/{page_id}", axum::routing::get(handlers::pages::get_page).patch(handlers::pages::update_page).delete(handlers::pages::delete_page))
        .route("/api/workspaces/{slug}/notifications", axum::routing::get(handlers::notifications::list_notifications).patch(handlers::notifications::mark_read))
        .route("/api/workspaces/{slug}/notifications/", axum::routing::get(handlers::notifications::list_notifications).patch(handlers::notifications::mark_read))
        .route("/api/workspaces/{slug}/search", axum::routing::get(handlers::search::search_handler))
        .route("/api/workspaces/{slug}/search/", axum::routing::get(handlers::search::search_handler))
        .route("/api/instances", axum::routing::get(handlers::instances::get_instance))
        .route("/api/instances/", axum::routing::get(handlers::instances::get_instance))
        .fallback(frontend::fallback)
}

#[event(fetch)]
async fn fetch(
    req: HttpRequest,
    env: Env,
    _ctx: Context,
) -> Result<axum::http::Response<axum::body::Body>> {
    console_log!("{} {}", req.method(), req.uri());
    let state = AppState { env };
    let mut app = router().with_state(state);
    Ok(app.call(req).await?)
}

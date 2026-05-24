use crate::client::{AturClient, Issue, IssueList, Project, Sprint, SprintProgress, State, Workspace};
use crate::components::table::TableState;

/// Which view is currently active.
#[derive(Debug, Clone)]
pub enum View {
    WorkspaceList,
    ProjectList {
        workspace_slug: String,
    },
    /// Sub-menu shown after selecting a project: choose Issues or Sprints.
    ProjectMenu {
        workspace_slug: String,
        project_id: String,
        project_name: String,
    },
    IssueList {
        workspace_slug: String,
        project_id: String,
        project_name: String,
    },
    IssueDetail {
        workspace_slug: String,
        project_id: String,
        issue_id: String,
    },
    SprintList {
        workspace_slug: String,
        project_id: String,
        project_name: String,
    },
    SprintDetail {
        workspace_slug: String,
        project_id: String,
        sprint_id: String,
    },
    Help,
}

/// Options available in the ProjectMenu.
const PROJECT_MENU_OPTIONS: &[&str] = &["Issues", "Sprints"];

/// A view on the navigation stack, each with its own table state.
#[derive(Debug, Clone)]
pub struct ViewFrame {
    pub view: View,
    pub table_state: TableState,
}

/// The main application state.
pub struct App {
    pub client: AturClient,
    pub view_stack: Vec<ViewFrame>,
    pub should_quit: bool,
    pub loading: bool,
    pub error: Option<String>,

    // Cached data keyed by what's being shown.
    pub workspaces: Vec<Workspace>,
    pub projects: Vec<Project>,
    pub issues: IssueList,
    pub current_issue: Option<Issue>,
    pub sprints: Vec<Sprint>,
    pub sprint_progress: Option<SprintProgress>,

    // Sprint detail: issues in the sprint.
    pub sprint_issues: Vec<Issue>,

    // State name cache: state_id -> state name
    pub states: Vec<State>,

    // Issue filter state: 0=None, 1=urgent, 2=high, 3=medium, 4=low, 5=none.
    pub filter_index: usize,
}

/// Priority labels corresponding to `filter_index`.
const FILTER_LABELS: &[&str] = &["All", "urgent", "high", "medium", "low", "none"];

impl App {
    pub fn new(client: AturClient) -> Self {
        Self {
            client,
            view_stack: Vec::new(),
            should_quit: false,
            loading: false,
            error: None,
            workspaces: Vec::new(),
            projects: Vec::new(),
            issues: IssueList {
                results: Vec::new(),
                total: 0,
                limit: None,
                offset: None,
            },
            current_issue: None,
            sprints: Vec::new(),
            sprint_progress: None,
            sprint_issues: Vec::new(),
            states: Vec::new(),
            filter_index: 0,
        }
    }

    // ── View stack helpers ──────────────────────────────────────────────

    /// Get the current (top of stack) view frame.
    pub fn current_frame(&self) -> Option<&ViewFrame> {
        self.view_stack.last()
    }

    /// Get a mutable reference to the current view frame.
    pub fn current_frame_mut(&mut self) -> Option<&mut ViewFrame> {
        self.view_stack.last_mut()
    }

    /// Push a new view onto the stack.
    pub fn push_view(&mut self, view: View) {
        self.view_stack.push(ViewFrame {
            view,
            table_state: TableState::new(),
        });
    }

    /// Pop the top view, returning to the previous one.
    pub fn pop_view(&mut self) {
        self.view_stack.pop();
    }

    /// Get the current workspace slug from the view stack.
    pub fn current_workspace(&self) -> Option<&str> {
        for frame in self.view_stack.iter().rev() {
            match &frame.view {
                View::ProjectList { workspace_slug } => return Some(workspace_slug),
                View::ProjectMenu { workspace_slug, .. } => return Some(workspace_slug),
                View::IssueList { workspace_slug, .. } => return Some(workspace_slug),
                View::IssueDetail { workspace_slug, .. } => return Some(workspace_slug),
                View::SprintList { workspace_slug, .. } => return Some(workspace_slug),
                View::SprintDetail { workspace_slug, .. } => return Some(workspace_slug),
                _ => {}
            }
        }
        None
    }

    /// Get current project_id from the view stack.
    pub fn current_project_id(&self) -> Option<&str> {
        for frame in self.view_stack.iter().rev() {
            match &frame.view {
                View::ProjectMenu { project_id, .. } => return Some(project_id),
                View::IssueList { project_id, .. } => return Some(project_id),
                View::IssueDetail { project_id, .. } => return Some(project_id),
                View::SprintList { project_id, .. } => return Some(project_id),
                View::SprintDetail { project_id, .. } => return Some(project_id),
                _ => {}
            }
        }
        None
    }

    /// Get current project name from the view stack.
    pub fn current_project_name(&self) -> Option<&str> {
        for frame in self.view_stack.iter().rev() {
            match &frame.view {
                View::ProjectMenu { project_name, .. } => return Some(project_name),
                View::IssueList { project_name, .. } => return Some(project_name),
                View::SprintList { project_name, .. } => return Some(project_name),
                _ => {}
            }
        }
        None
    }

    /// Build a status bar context / breadcrumb string.
    pub fn status_context(&self) -> String {
        let mut parts = Vec::new();
        for frame in &self.view_stack {
            match &frame.view {
                View::WorkspaceList => parts.push("Workspaces".to_string()),
                View::ProjectList { workspace_slug } => parts.push(workspace_slug.clone()),
                View::ProjectMenu { project_name, .. } => {
                    parts.push(format!("{} > Menu", project_name))
                }
                View::IssueList {
                    project_name, ..
                } => parts.push(project_name.clone()),
                View::IssueDetail { issue_id, .. } => parts.push(format!("Issue {}", issue_id)),
                View::SprintList {
                    project_name, ..
                } => parts.push(format!("{} > Sprints", project_name)),
                View::SprintDetail { sprint_id, .. } => {
                    parts.push(format!("Sprint {}", sprint_id))
                }
                View::Help => parts.push("Help".to_string()),
            }
        }
        parts.join(" > ")
    }

    /// Get the current filter priority label.
    pub fn current_filter(&self) -> &str {
        FILTER_LABELS[self.filter_index]
    }

    // ── Key handling ────────────────────────────────────────────────────

    /// Handle a key event.
    ///
    /// Returns `HandleResult::Fetch` if the caller should run
    /// `fetch_current_view`, `HandleResult::Enter` if `handle_enter`
    /// should be called, and `HandleResult::None` otherwise.
    pub fn handle_key(&mut self, key: crossterm::event::KeyEvent) -> HandleResult {
        use crossterm::event::KeyCode;

        match key.code {
            KeyCode::Char('q') => {
                // If help overlay is on top, pop it; otherwise quit.
                if matches!(
                    self.current_frame().map(|f| &f.view),
                    Some(View::Help)
                ) {
                    self.pop_view();
                } else {
                    self.should_quit = true;
                }
                HandleResult::None
            }
            KeyCode::Esc => {
                if self.view_stack.len() > 1 {
                    self.pop_view();
                    HandleResult::None
                } else {
                    self.should_quit = true;
                    HandleResult::None
                }
            }
            KeyCode::Char('j') | KeyCode::Down => {
                if let Some(frame) = self.current_frame_mut() {
                    frame.table_state.next();
                }
                HandleResult::None
            }
            KeyCode::Char('k') | KeyCode::Up => {
                if let Some(frame) = self.current_frame_mut() {
                    frame.table_state.prev();
                }
                HandleResult::None
            }
            KeyCode::Enter => HandleResult::Enter,
            KeyCode::Tab => {
                if matches!(
                    self.current_frame().map(|f| &f.view),
                    Some(View::IssueList { .. })
                ) {
                    self.filter_index = (self.filter_index + 1) % FILTER_LABELS.len();
                    return HandleResult::Fetch;
                }
                HandleResult::None
            }
            KeyCode::BackTab => {
                if matches!(
                    self.current_frame().map(|f| &f.view),
                    Some(View::IssueList { .. })
                ) {
                    self.filter_index = if self.filter_index == 0 {
                        FILTER_LABELS.len() - 1
                    } else {
                        self.filter_index - 1
                    };
                    return HandleResult::Fetch;
                }
                HandleResult::None
            }
            KeyCode::Char('r') => HandleResult::Fetch,
            KeyCode::Char('?') => {
                self.push_view(View::Help);
                HandleResult::None
            }
            KeyCode::PageDown => {
                if let Some(frame) = self.current_frame_mut() {
                    let page = 10; // reasonable page size
                    frame.table_state.page_down(page);
                }
                HandleResult::None
            }
            KeyCode::PageUp => {
                if let Some(frame) = self.current_frame_mut() {
                    let page = 10;
                    frame.table_state.page_up(page);
                }
                HandleResult::None
            }
            _ => HandleResult::None,
        }
    }

    // ── Enter handling ──────────────────────────────────────────────────

    /// Handle Enter key on selected item in current view.
    pub async fn handle_enter(&mut self) {
        // Determine which view we are in and get selected index.
        let current = self.current_frame().cloned();
        let Some(frame) = current else { return };

        match &frame.view {
            View::WorkspaceList => {
                let idx = frame.table_state.selected;
                if let Some(ws) = self.workspaces.get(idx) {
                    let slug = ws.slug.clone();
                    self.push_view(View::ProjectList {
                        workspace_slug: slug,
                    });
                    self.fetch_current_view().await;
                }
            }
            View::ProjectList { workspace_slug } => {
                let idx = frame.table_state.selected;
                if let Some(proj) = self.projects.get(idx) {
                    let ws = workspace_slug.clone();
                    let pid = proj.id.clone();
                    let pname = proj.name.clone();
                    self.push_view(View::ProjectMenu {
                        workspace_slug: ws,
                        project_id: pid,
                        project_name: pname,
                    });
                    self.fetch_current_view().await;
                }
            }
            View::ProjectMenu {
                workspace_slug,
                project_id,
                project_name,
            } => {
                let idx = frame.table_state.selected;
                let ws = workspace_slug.clone();
                let pid = project_id.clone();
                let pname = project_name.clone();
                match idx {
                    0 => {
                        // Issues
                        self.push_view(View::IssueList {
                            workspace_slug: ws,
                            project_id: pid,
                            project_name: pname,
                        });
                        self.fetch_current_view().await;
                    }
                    1 => {
                        // Sprints
                        self.push_view(View::SprintList {
                            workspace_slug: ws,
                            project_id: pid,
                            project_name: pname,
                        });
                        self.fetch_current_view().await;
                    }
                    _ => {}
                }
            }
            View::IssueList {
                workspace_slug,
                project_id,
                ..
            } => {
                // Apply filter to visible issues.
                let visible = self.filtered_issues();
                let idx = frame.table_state.selected;
                if let Some(issue) = visible.get(idx) {
                    let ws = workspace_slug.clone();
                    let pid = project_id.clone();
                    let iid = issue.id.clone();
                    self.push_view(View::IssueDetail {
                        workspace_slug: ws,
                        project_id: pid,
                        issue_id: iid,
                    });
                    self.fetch_current_view().await;
                }
            }
            View::SprintList {
                workspace_slug,
                project_id,
                ..
            } => {
                let idx = frame.table_state.selected;
                if let Some(sprint) = self.sprints.get(idx) {
                    let ws = workspace_slug.clone();
                    let pid = project_id.clone();
                    let sid = sprint.id.clone();
                    self.push_view(View::SprintDetail {
                        workspace_slug: ws,
                        project_id: pid,
                        sprint_id: sid,
                    });
                    self.fetch_current_view().await;
                }
            }
            View::Help => {
                self.pop_view();
            }
            _ => {}
        }
    }

    // ── Data fetching ───────────────────────────────────────────────────

    /// Fetch data for the current view.
    pub async fn fetch_current_view(&mut self) {
        let current = self.current_frame().cloned();
        let Some(frame) = current else { return };

        self.loading = true;
        self.error = None;

        let result = match &frame.view {
            View::WorkspaceList => self.fetch_workspaces().await,
            View::ProjectList { workspace_slug } => {
                self.fetch_projects(workspace_slug.clone()).await
            }
            View::ProjectMenu { .. } => {
                // No-op: menu items are static, just set item count.
                if let Some(frame) = self.current_frame_mut() {
                    frame.table_state.set_items(PROJECT_MENU_OPTIONS.len());
                }
                Ok(())
            }
            View::IssueList {
                workspace_slug,
                project_id,
                ..
            } => self.fetch_issues(project_id.clone(), workspace_slug.clone()).await,
            View::IssueDetail {
                workspace_slug,
                project_id,
                issue_id,
            } => {
                self.fetch_issue_detail(project_id.clone(), issue_id.clone(), workspace_slug.clone())
                    .await
            }
            View::SprintList {
                workspace_slug,
                project_id,
                ..
            } => self.fetch_sprints(project_id.clone(), workspace_slug.clone()).await,
            View::SprintDetail {
                workspace_slug,
                project_id,
                sprint_id,
            } => {
                self.fetch_sprint_detail(
                    project_id.clone(),
                    sprint_id.clone(),
                    workspace_slug.clone(),
                )
                .await
            }
            View::Help => Ok(()),
        };

        if let Err(e) = result {
            self.error = Some(e.to_string());
        }
        self.loading = false;
    }

    async fn fetch_workspaces(&mut self) -> anyhow::Result<()> {
        self.workspaces = self.client.list_workspaces().await?;
        // Update table item count.
        let count = self.workspaces.len();
        if let Some(frame) = self.current_frame_mut() {
            frame.table_state.set_items(count);
        }
        Ok(())
    }

    async fn fetch_projects(&mut self, workspace_slug: String) -> anyhow::Result<()> {
        self.projects = self
            .client
            .list_projects(Some(&workspace_slug))
            .await?;
        let count = self.projects.len();
        if let Some(frame) = self.current_frame_mut() {
            frame.table_state.set_items(count);
        }
        Ok(())
    }

    async fn fetch_issues(
        &mut self,
        project_id: String,
        workspace_slug: String,
    ) -> anyhow::Result<()> {
        self.issues = self
            .client
            .list_issues(&project_id, Some(&workspace_slug), Some(100), None)
            .await?;
        // Fetch states for this project so we can show state names.
        self.states = self
            .client
            .list_states(&project_id, Some(&workspace_slug))
            .await
            .unwrap_or_default();
        // Item count is based on filtered list.
        let count = self.filtered_issues().len();
        if let Some(frame) = self.current_frame_mut() {
            frame.table_state.set_items(count);
        }
        Ok(())
    }

    async fn fetch_issue_detail(
        &mut self,
        project_id: String,
        issue_id: String,
        workspace_slug: String,
    ) -> anyhow::Result<()> {
        self.current_issue = Some(
            self.client
                .get_issue(&project_id, &issue_id, Some(&workspace_slug))
                .await?,
        );
        Ok(())
    }

    async fn fetch_sprints(
        &mut self,
        project_id: String,
        workspace_slug: String,
    ) -> anyhow::Result<()> {
        self.sprints = self
            .client
            .list_sprints(&project_id, Some(&workspace_slug))
            .await?;
        let count = self.sprints.len();
        if let Some(frame) = self.current_frame_mut() {
            frame.table_state.set_items(count);
        }
        Ok(())
    }

    async fn fetch_sprint_detail(
        &mut self,
        project_id: String,
        sprint_id: String,
        workspace_slug: String,
    ) -> anyhow::Result<()> {
        self.sprint_progress = Some(
            self.client
                .get_sprint_progress(&project_id, &sprint_id, Some(&workspace_slug))
                .await?,
        );
        // Fetch issues filtered by sprint
        let result = self
            .client
            .list_issues(&project_id, Some(&workspace_slug), Some(100), Some(&sprint_id))
            .await?;
        self.sprint_issues = result.results;
        Ok(())
    }

    // ── Filtered issues ─────────────────────────────────────────────────

    /// Return issues filtered by the current priority filter.
    /// Look up a state name by ID.
    fn state_name(&self, state_id: &Option<String>) -> String {
        state_id
            .as_ref()
            .and_then(|id| self.states.iter().find(|s| s.id == *id))
            .map(|s| s.name.clone())
            .unwrap_or_else(|| "-".to_string())
    }

    pub fn filtered_issues(&self) -> Vec<&Issue> {
        if self.filter_index == 0 {
            self.issues.results.iter().collect()
        } else {
            let priority = FILTER_LABELS[self.filter_index];
            self.issues
                .results
                .iter()
                .filter(|i| {
                    i.priority
                        .as_deref()
                        .map(|p| p == priority)
                        .unwrap_or(false)
                })
                .collect()
        }
    }

    // ── Rendering ───────────────────────────────────────────────────────

    pub fn render(&mut self, frame: &mut ratatui::Frame) {
        use ratatui::layout::{Constraint, Direction, Layout};

        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(0), Constraint::Length(1), Constraint::Length(1)])
            .split(frame.area());

        // Determine the index of the view to render (skip Help overlay to show behind it).
        let render_idx = if self.view_stack.last().map(|f| matches!(f.view, View::Help)).unwrap_or(false) && self.view_stack.len() >= 2 {
            self.view_stack.len() - 2
        } else {
            self.view_stack.len().saturating_sub(1)
        };

        // Extract view info to avoid borrow conflicts, then write back table_state after render.
        let frame_info = self.view_stack.get(render_idx).map(|f| (f.view.clone(), f.table_state.clone()));
        if let Some((view, mut table_state)) = frame_info {
            match &view {
                View::WorkspaceList => {
                    self.render_workspaces(frame, chunks[0], &mut table_state);
                }
                View::ProjectList { .. } => {
                    self.render_projects(frame, chunks[0], &mut table_state);
                }
                View::ProjectMenu { .. } => {
                    self.render_project_menu(frame, chunks[0], &mut table_state);
                }
                View::IssueList { .. } => {
                    self.render_issues(frame, chunks[0], &mut table_state);
                }
                View::IssueDetail { .. } => {
                    self.render_issue_detail(frame, chunks[0]);
                }
                View::SprintList { .. } => {
                    self.render_sprints(frame, chunks[0], &mut table_state);
                }
                View::SprintDetail { .. } => {
                    self.render_sprint_detail(frame, chunks[0], &mut table_state);
                }
                View::Help => {}
            }
            // Write back the (possibly scroll-adjusted) table state.
            if let Some(f) = self.view_stack.get_mut(render_idx) {
                f.table_state = table_state;
            }
        }

        // Help overlay on top of everything.
        if self.view_stack.last().map(|f| matches!(f.view, View::Help)).unwrap_or(false) {
            crate::components::help::HelpOverlay::render(frame, frame.area());
        }

        // Status bar.
        let status = crate::components::status_bar::StatusBar {
            context: self.status_context(),
            loading: self.loading,
            error: self.error.clone(),
        };
        status.render(frame, chunks[1]);

        // Hotkey footer.
        self.render_hotkey_bar(frame, chunks[2]);
    }

    fn render_hotkey_bar(&self, frame: &mut ratatui::Frame, area: ratatui::layout::Rect) {
        use ratatui::style::Style;
        use ratatui::text::{Line, Span};
        use ratatui::widgets::{Block, Paragraph};

        let keys: Vec<(&str, &str)> = match self.view_stack.last().map(|f| &f.view) {
            Some(View::WorkspaceList) => vec![
                ("j/k", "Navigate"), ("Enter", "Select"), ("?", "Help"), ("q", "Quit"),
            ],
            Some(View::ProjectList { .. }) => vec![
                ("j/k", "Navigate"), ("Enter", "Select"), ("Esc", "Back"), ("?", "Help"), ("q", "Quit"),
            ],
            Some(View::ProjectMenu { .. }) => vec![
                ("j/k", "Navigate"), ("Enter", "Select"), ("Esc", "Back"), ("?", "Help"),
            ],
            Some(View::IssueList { .. }) => vec![
                ("j/k", "Nav"), ("Enter", "Open"), ("Tab", "Filter"), ("r", "Refresh"), ("Esc", "Back"), ("?", "Help"),
            ],
            Some(View::IssueDetail { .. }) => vec![
                ("Esc", "Back"), ("?", "Help"),
            ],
            Some(View::SprintList { .. }) => vec![
                ("j/k", "Navigate"), ("Enter", "Select"), ("Esc", "Back"), ("?", "Help"),
            ],
            Some(View::SprintDetail { .. }) => vec![
                ("j/k", "Navigate"), ("Enter", "Open issue"), ("Esc", "Back"), ("?", "Help"),
            ],
            Some(View::Help) => vec![
                ("Esc", "Close"), ("q", "Quit"),
            ],
            None => vec![],
        };

        let mut spans: Vec<Span> = Vec::new();
        for (i, (key, desc)) in keys.iter().enumerate() {
            if i > 0 {
                spans.push(Span::styled("  ", crate::theme::muted_style()));
            }
            spans.push(Span::styled(
                format!(" {} ", key),
                Style::default().fg(crate::theme::ACCENT).bg(crate::theme::SURFACE),
            ));
            spans.push(Span::styled(
                format!(" {}", desc),
                crate::theme::muted_style(),
            ));
        }

        let bar = Paragraph::new(Line::from(spans)).block(
            Block::default().style(Style::default().bg(crate::theme::BG)),
        );
        frame.render_widget(bar, area);
    }

    fn render_workspaces(
        &self,
        frame: &mut ratatui::Frame,
        area: ratatui::layout::Rect,
        state: &mut TableState,
    ) {
        let headers = ["Name", "Slug", "Created"];
        let widths = [
            ratatui::layout::Constraint::Percentage(40),
            ratatui::layout::Constraint::Percentage(30),
            ratatui::layout::Constraint::Percentage(30),
        ];
        let rows: Vec<Vec<String>> = self
            .workspaces
            .iter()
            .map(|w| vec![w.name.clone(), w.slug.clone(), w.created_at.clone()])
            .collect();
        crate::components::table::render(frame, area, "Workspaces", &headers, &widths, &rows, state);
    }

    fn render_projects(
        &self,
        frame: &mut ratatui::Frame,
        area: ratatui::layout::Rect,
        state: &mut TableState,
    ) {
        let headers = ["Identifier", "Name", "Created"];
        let widths = [
            ratatui::layout::Constraint::Length(12),
            ratatui::layout::Constraint::Percentage(50),
            ratatui::layout::Constraint::Percentage(30),
        ];
        let rows: Vec<Vec<String>> = self
            .projects
            .iter()
            .map(|p| {
                vec![
                    p.identifier.clone(),
                    p.name.clone(),
                    p.created_at.clone(),
                ]
            })
            .collect();
        crate::components::table::render(frame, area, "Projects", &headers, &widths, &rows, state);
    }

    fn render_project_menu(
        &self,
        frame: &mut ratatui::Frame,
        area: ratatui::layout::Rect,
        state: &mut TableState,
    ) {
        // Get the project name from the current view for the title.
        let project_name = self.current_project_name().unwrap_or("Project");
        let title = format!("{} > Choose", project_name);

        let headers = ["Option", "Description"];
        let widths = [
            ratatui::layout::Constraint::Length(12),
            ratatui::layout::Constraint::Percentage(70),
        ];
        let rows: Vec<Vec<String>> = vec![
            vec!["Issues".to_string(), "View and manage project issues".to_string()],
            vec!["Sprints".to_string(), "View and manage project sprints / cycles".to_string()],
        ];
        crate::components::table::render(frame, area, &title, &headers, &widths, &rows, state);
    }

    fn render_issues(
        &self,
        frame: &mut ratatui::Frame,
        area: ratatui::layout::Rect,
        state: &mut TableState,
    ) {
        let filter_label = self.current_filter();
        let title = format!("Issues [filter: {}]", filter_label);
        let headers = ["#", "Status", "Priority", "Name", "Created"];
        let widths = [
            ratatui::layout::Constraint::Length(6),
            ratatui::layout::Constraint::Length(14),
            ratatui::layout::Constraint::Length(10),
            ratatui::layout::Constraint::Percentage(40),
            ratatui::layout::Constraint::Percentage(20),
        ];
        let visible = self.filtered_issues();
        let rows: Vec<Vec<String>> = visible
            .iter()
            .map(|i| {
                vec![
                    i.sequence_id.to_string(),
                    self.state_name(&i.state_id),
                    i.priority.clone().unwrap_or_else(|| "-".to_string()),
                    i.name.clone(),
                    i.created_at.clone(),
                ]
            })
            .collect();
        crate::components::table::render(frame, area, &title, &headers, &widths, &rows, state);
    }

    fn render_issue_detail(&self, frame: &mut ratatui::Frame, area: ratatui::layout::Rect) {
        use ratatui::style::{Modifier, Style};
        use ratatui::text::{Line, Span};
        use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

        let content = if let Some(issue) = &self.current_issue {
            // Determine priority color.
            let (priority_label, priority_color) = match issue
                .priority
                .as_deref()
                .unwrap_or("none")
            {
                "urgent" => ("URGENT", crate::theme::ERROR),
                "high" => ("HIGH", crate::theme::WARNING),
                "medium" => ("MEDIUM", crate::theme::WARNING),
                "low" => ("LOW", crate::theme::SUCCESS),
                _ => ("NONE", crate::theme::MUTED),
            };

            // Format dates nicely (truncate to date portion if ISO datetime).
            let fmt_date = |d: &Option<String>| -> String {
                d.as_ref()
                    .map(|s| {
                        // Take just the date part if it's a full datetime.
                        s.split('T').next().unwrap_or(s).to_string()
                    })
                    .unwrap_or_else(|| "-".to_string())
            };

            let created = fmt_date(&Some(issue.created_at.clone()));
            let start = fmt_date(&issue.start_date);
            let target = fmt_date(&issue.target_date);
            let completed = fmt_date(&issue.completed_at);
            let updated = fmt_date(&issue.updated_at);

            let state_id = issue
                .state_id
                .as_deref()
                .unwrap_or("unknown")
                .to_string();

            // Build the structured content as Spans for color coding.
            let lines = vec![
                // Title line
                Line::from(vec![
                    Span::styled(
                        format!("Issue #{}", issue.sequence_id),
                        Style::default()
                            .fg(crate::theme::ACCENT)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw("  "),
                    Span::styled(
                        issue.name.clone(),
                        Style::default()
                            .fg(crate::theme::FG)
                            .add_modifier(Modifier::BOLD),
                    ),
                ]),
                // Blank line
                Line::raw(""),
                // Priority
                Line::from(vec![
                    Span::styled("Priority: ", Style::default().fg(crate::theme::MUTED)),
                    Span::styled(
                        priority_label.to_string(),
                        Style::default()
                            .fg(priority_color)
                            .add_modifier(Modifier::BOLD),
                    ),
                ]),
                // State
                Line::from(vec![
                    Span::styled("State:    ", Style::default().fg(crate::theme::MUTED)),
                    Span::styled(state_id, Style::default().fg(crate::theme::FG)),
                ]),
                // Blank line
                Line::raw(""),
                // Dates section
                Line::from(vec![
                    Span::styled("Created:   ", Style::default().fg(crate::theme::MUTED)),
                    Span::raw(created),
                ]),
                Line::from(vec![
                    Span::styled("Updated:   ", Style::default().fg(crate::theme::MUTED)),
                    Span::raw(updated),
                ]),
                Line::from(vec![
                    Span::styled("Start:     ", Style::default().fg(crate::theme::MUTED)),
                    Span::raw(start),
                ]),
                Line::from(vec![
                    Span::styled("Target:    ", Style::default().fg(crate::theme::MUTED)),
                    Span::raw(target),
                ]),
                Line::from(vec![
                    Span::styled("Completed: ", Style::default().fg(crate::theme::MUTED)),
                    if issue.completed_at.is_some() {
                        Span::styled(completed, Style::default().fg(crate::theme::SUCCESS))
                    } else {
                        Span::raw("-")
                    },
                ]),
                // Blank line
                Line::raw(""),
                // Draft indicator
                Line::from(vec![
                    Span::styled("Draft:     ", Style::default().fg(crate::theme::MUTED)),
                    Span::styled(
                        if issue.is_draft.unwrap_or(false) {
                            "Yes"
                        } else {
                            "No"
                        },
                        Style::default().fg(crate::theme::FG),
                    ),
                ]),
                // Blank line
                Line::raw(""),
                // Description header
                Line::from(vec![Span::styled(
                    "── Description ──",
                    Style::default().fg(crate::theme::ACCENT),
                )]),
            ];

            // Add description text (strip HTML tags for display).
            let desc = issue
                .description_html
                .as_deref()
                .unwrap_or("(no description)");
            let desc_clean = strip_html_tags(desc);
            let mut all_lines = lines;
            for line in desc_clean.lines() {
                all_lines.push(Line::raw(line.to_string()));
            }
            all_lines
        } else {
            vec![Line::raw("No issue loaded.")]
        };

        let paragraph = Paragraph::new(content)
            .block(
                Block::default()
                    .title(" Issue Detail ")
                    .title_style(crate::theme::title_style())
                    .borders(Borders::ALL)
                    .style(ratatui::style::Style::default().bg(crate::theme::BG)),
            )
            .wrap(Wrap { trim: true })
            .style(crate::theme::normal_style());

        frame.render_widget(paragraph, area);
    }

    fn render_sprints(
        &self,
        frame: &mut ratatui::Frame,
        area: ratatui::layout::Rect,
        state: &mut TableState,
    ) {
        let headers = ["Name", "Start", "End", "Created"];
        let widths = [
            ratatui::layout::Constraint::Percentage(30),
            ratatui::layout::Constraint::Percentage(20),
            ratatui::layout::Constraint::Percentage(20),
            ratatui::layout::Constraint::Percentage(30),
        ];
        let rows: Vec<Vec<String>> = self
            .sprints
            .iter()
            .map(|s| {
                vec![
                    s.name.clone(),
                    s.start_date.clone().unwrap_or_else(|| "-".to_string()),
                    s.end_date.clone().unwrap_or_else(|| "-".to_string()),
                    s.created_at.clone(),
                ]
            })
            .collect();
        crate::components::table::render(frame, area, "Sprints", &headers, &widths, &rows, state);
    }

    fn render_sprint_detail(
        &self,
        frame: &mut ratatui::Frame,
        area: ratatui::layout::Rect,
        state: &mut TableState,
    ) {
        use ratatui::layout::{Constraint, Direction, Layout};
        use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

        // Split area into progress section (top 5 lines) + issues table (rest).
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(5), // progress bar section
                Constraint::Min(0),    // issues table
            ])
            .split(area);

        // ── Progress section ────────────────────────────────────────────
        let progress_text = if let Some(p) = &self.sprint_progress {
            // Build ASCII progress bar.
            let bar_width = 30usize;
            let done = p.completed as usize;
            let total = p.total.max(1) as usize;
            let filled = (done * bar_width) / total;
            let empty = bar_width - filled;
            let bar: String = "█".repeat(filled) + &"░".repeat(empty);

            format!(
                "Total: {}  |  Backlog: {}  |  Todo: {}  |  In Progress: {}  |  Done: {}  |  Cancelled: {}\n\
                 \n\
                 [{}] {}/{} done",
                p.total, p.backlog, p.unstarted, p.started, p.completed, p.cancelled,
                bar, done, total
            )
        } else {
            "No progress data.".to_string()
        };

        let progress_paragraph = Paragraph::new(progress_text)
            .block(
                Block::default()
                    .title(" Sprint Progress ")
                    .title_style(crate::theme::title_style())
                    .borders(Borders::ALL)
                    .style(ratatui::style::Style::default().bg(crate::theme::BG)),
            )
            .wrap(Wrap { trim: true })
            .style(crate::theme::normal_style());

        frame.render_widget(progress_paragraph, chunks[0]);

        // ── Issues table section ────────────────────────────────────────
        let headers = ["#", "Priority", "Name", "State"];
        let widths = [
            ratatui::layout::Constraint::Length(6),
            ratatui::layout::Constraint::Length(10),
            ratatui::layout::Constraint::Percentage(50),
            ratatui::layout::Constraint::Length(36),
        ];
        let rows: Vec<Vec<String>> = self
            .sprint_issues
            .iter()
            .map(|i| {
                vec![
                    i.sequence_id.to_string(),
                    i.priority.clone().unwrap_or_else(|| "-".to_string()),
                    i.name.clone(),
                    i.state_id.clone().unwrap_or_else(|| "-".to_string()),
                ]
            })
            .collect();
        crate::components::table::render(
            frame,
            chunks[1],
            " Sprint Issues ",
            &headers,
            &widths,
            &rows,
            state,
        );
    }
}

/// Result of handling a key event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandleResult {
    /// The caller should call `fetch_current_view`.
    Fetch,
    /// The caller should call `handle_enter`.
    Enter,
    /// No further action needed.
    None,
}

/// Strip basic HTML tags from a string for display in the terminal.
fn strip_html_tags(html: &str) -> String {
    // Simple approach: remove anything between < and >.
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                continue;
            }
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    // Collapse multiple whitespace.
    let collapsed: String = result
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    collapsed
}

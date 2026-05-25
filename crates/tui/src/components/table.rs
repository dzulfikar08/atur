use ratatui::layout::Constraint;
use ratatui::style::Style;
use ratatui::widgets::{Block, Borders, Row, Table, TableState as RatatuiTableState};
use ratatui::Frame;

use crate::theme::{header_style, normal_style, selected_style, title_style, BG};

/// Tracks scroll offset and selection for a scrollable table.
#[derive(Debug, Clone)]
pub struct TableState {
    pub offset: usize,
    pub selected: usize,
    pub items: usize,
}

impl Default for TableState {
    fn default() -> Self {
        Self::new()
    }
}

impl TableState {
    pub fn new() -> Self {
        Self {
            offset: 0,
            selected: 0,
            items: 0,
        }
    }

    /// Set the total number of items and clamp selection.
    pub fn set_items(&mut self, count: usize) {
        self.items = count;
        self.clamp_selected();
    }

    /// Move selection to `index`, clamped to valid range.
    pub fn select(&mut self, index: usize) {
        self.selected = index;
        self.clamp_selected();
    }

    /// Move selection down by one.
    pub fn next(&mut self) {
        if self.items > 0 {
            self.selected = self.selected.saturating_add(1).min(self.items - 1);
        }
    }

    /// Move selection up by one.
    pub fn prev(&mut self) {
        self.selected = self.selected.saturating_sub(1);
    }

    /// Jump down by `page_size` rows.
    pub fn page_down(&mut self, page_size: usize) {
        if self.items > 0 {
            self.selected = self.selected.saturating_add(page_size).min(self.items - 1);
        }
    }

    /// Jump up by `page_size` rows.
    pub fn page_up(&mut self, page_size: usize) {
        self.selected = self.selected.saturating_sub(page_size);
    }

    /// Ensure selected index is within bounds.
    fn clamp_selected(&mut self) {
        if self.items == 0 {
            self.selected = 0;
        } else {
            self.selected = self.selected.min(self.items - 1);
        }
    }

    /// Adjust scroll offset so the selected row is visible.
    fn adjust_offset(&mut self, visible_height: usize) {
        if visible_height == 0 {
            return;
        }
        // Scroll down if selected is below the visible window.
        if self.selected >= self.offset + visible_height {
            self.offset = self.selected.saturating_sub(visible_height) + 1;
        }
        // Scroll up if selected is above the visible window.
        if self.selected < self.offset {
            self.offset = self.selected;
        }
    }
}

/// Render a scrollable table with headers and highlighted selection.
///
/// * `frame`   — the ratatui Frame to render into
/// * `area`    — the Rect to occupy
/// * `title`   — table title (shown in the block border)
/// * `headers` — column header strings
/// * `widths`  — column width constraints
/// * `rows`    — row data (each inner vec is one cell string)
/// * `state`   — mutable TableState tracking selection & scroll
pub fn render(
    frame: &mut Frame,
    area: ratatui::layout::Rect,
    title: &str,
    headers: &[&str],
    widths: &[Constraint],
    rows: &[Vec<String>],
    state: &mut TableState,
) {
    state.set_items(rows.len());

    // Reserve 2 rows for border, 1 for header.
    let visible_height = area.height.saturating_sub(3) as usize;
    state.adjust_offset(visible_height);

    // Build ratatui rows.
    let data_rows: Vec<Row> = rows
        .iter()
        .map(|cells| {
            let cells: Vec<_> = cells.iter().map(|c| c.as_str()).collect();
            Row::new(cells).style(normal_style())
        })
        .collect();

    // Build header row.
    let header_cells: Vec<&str> = headers.to_vec();
    let header_row = Row::new(header_cells)
        .style(header_style())
        .bottom_margin(1);

    let table = Table::new(data_rows, widths)
        .header(header_row)
        .block(
            Block::default()
                .title(format!(" {title} "))
                .title_style(title_style())
                .borders(Borders::ALL)
                .style(Style::default().bg(BG)),
        )
        .highlight_symbol(">> ")
        .row_highlight_style(selected_style());

    // Wrap in ratatui's own TableState for rendering.
    let mut rat_state = RatatuiTableState::default();
    rat_state.select(Some(state.selected));
    *rat_state.offset_mut() = state.offset;

    frame.render_stateful_widget(table, area, &mut rat_state);

    // Sync offset back in case ratatui adjusted it.
    state.offset = rat_state.offset();
}

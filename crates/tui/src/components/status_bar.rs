use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

use crate::theme::{error_style, muted_style, normal_style, success_style, ACCENT, BG};

/// A bottom status bar showing context, loading state, and errors.
#[derive(Debug, Clone)]
pub struct StatusBar {
    /// Breadcrumb context, e.g. `"plane-pmo > PRJ"`.
    pub context: String,
    /// When true, show a spinner indicator.
    pub loading: bool,
    /// When set, display in red.
    pub error: Option<String>,
}

impl Default for StatusBar {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusBar {
    pub fn new() -> Self {
        Self {
            context: String::new(),
            loading: false,
            error: None,
        }
    }

    pub fn render(&self, frame: &mut Frame, area: Rect) {
        // Build the three segments.
        let context_part = if self.context.is_empty() {
            String::new()
        } else {
            format!(" {} ", self.context)
        };

        let status_part = if self.loading {
            " \u{23F3} Loading... ".to_string() // hourglass
        } else {
            " Ready ".to_string()
        };

        let error_part = match &self.error {
            Some(e) => format!(" \u{26A0} {} ", e), // warning sign
            None => String::new(),
        };

        // Use Span-based rendering for per-segment coloring.
        use ratatui::text::{Line, Span};

        let spans = vec![
            Span::styled(context_part, Style::default().fg(ACCENT)),
            Span::styled(" | ", muted_style()),
            Span::styled(
                status_part,
                if self.loading {
                    normal_style()
                } else {
                    success_style()
                },
            ),
        ];

        let mut all_spans = spans;

        if !error_part.is_empty() {
            all_spans.push(Span::styled(" | ", muted_style()));
            all_spans.push(Span::styled(error_part, error_style()));
        }

        let line = Line::from(all_spans);

        let bar = Paragraph::new(line).block(
            Block::default()
                .borders(Borders::TOP)
                .style(Style::default().bg(BG)),
        );

        frame.render_widget(bar, area);
    }
}

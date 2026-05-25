use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
use ratatui::Frame;

use crate::theme::{ACCENT, BG, FG, MUTED};

/// A centered overlay listing keyboard shortcuts.
pub struct HelpOverlay;

impl HelpOverlay {
    /// Render the help overlay centred inside `area`.
    pub fn render(frame: &mut Frame, area: Rect) {
        // Calculate a centred popup area (50 cols x 11 rows).
        let popup_width = 50u16.min(area.width);
        let popup_height = 11u16.min(area.height);

        let x = area.x + (area.width.saturating_sub(popup_width)) / 2;
        let y = area.y + (area.height.saturating_sub(popup_height)) / 2;

        let popup_area = Rect::new(x, y, popup_width, popup_height);

        // Clear behind the popup.
        frame.render_widget(Clear, popup_area);

        let shortcuts = [
            ("j/k  \u{2191}/\u{2193}", "Navigate"),
            ("Enter", "Select"),
            ("Tab", "Next filter"),
            ("Esc", "Back"),
            ("r", "Refresh"),
            ("?", "Help"),
            ("q", "Quit"),
        ];

        let lines: Vec<Line> = shortcuts
            .iter()
            .map(|(key, desc)| {
                Line::from(vec![
                    Span::styled(
                        format!("  {:<14}", key),
                        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(desc.to_string(), Style::default().fg(FG)),
                ])
            })
            .collect();

        let paragraph = Paragraph::new(lines)
            .block(
                Block::default()
                    .title(" Keyboard Shortcuts ")
                    .title_style(Style::default().fg(ACCENT).add_modifier(Modifier::BOLD))
                    .title_alignment(Alignment::Center)
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(MUTED))
                    .style(Style::default().bg(BG)),
            )
            .wrap(Wrap { trim: true })
            .alignment(Alignment::Left);

        frame.render_widget(paragraph, popup_area);
    }
}

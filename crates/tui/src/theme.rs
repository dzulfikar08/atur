use ratatui::style::Color;
use ratatui::style::Style;

// ── Color constants ──────────────────────────────────────────────────────

pub const BG: Color = Color::Rgb(18, 18, 18);
pub const FG: Color = Color::Rgb(224, 224, 224);
pub const ACCENT: Color = Color::Rgb(59, 130, 246);
pub const SUCCESS: Color = Color::Rgb(34, 197, 94);
pub const WARNING: Color = Color::Rgb(234, 179, 8);
pub const ERROR: Color = Color::Rgb(239, 68, 68);
pub const MUTED: Color = Color::Rgb(107, 114, 128);
pub const SURFACE: Color = Color::Rgb(30, 30, 30);

// ── Style helpers ────────────────────────────────────────────────────────

/// Bold title text in accent blue.
pub fn title_style() -> Style {
    Style::default().fg(ACCENT).add_modifier(ratatui::style::Modifier::BOLD)
}

/// Highlighted / selected row — accent background with white text.
pub fn selected_style() -> Style {
    Style::default().bg(ACCENT).fg(Color::White).add_modifier(ratatui::style::Modifier::BOLD)
}

/// Column header — bold white on dark-gray surface.
pub fn header_style() -> Style {
    Style::default()
        .fg(Color::White)
        .bg(SURFACE)
        .add_modifier(ratatui::style::Modifier::BOLD)
}

/// Default body text.
pub fn normal_style() -> Style {
    Style::default().fg(FG)
}

/// Dimmed / secondary text.
pub fn muted_style() -> Style {
    Style::default().fg(MUTED)
}

/// Error messages in red.
pub fn error_style() -> Style {
    Style::default().fg(ERROR)
}

/// Success / positive indicators in green.
pub fn success_style() -> Style {
    Style::default().fg(SUCCESS)
}

/// Warning indicators in yellow.
pub fn warning_style() -> Style {
    Style::default().fg(WARNING)
}

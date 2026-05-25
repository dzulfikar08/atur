mod app;
mod client;
mod components;
mod theme;
mod views;

use std::io;

use clap::Parser;
use crossterm::event::{self, Event};
use crossterm::terminal::{disable_raw_mode, enable_raw_mode};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;

use app::{App, HandleResult, View};
use client::AturClient;

/// atur-tui — Terminal UI for Atur project management
#[derive(Parser, Debug)]
#[command(name = "atur-tui", version, about = "Terminal UI for Atur PMO")]
struct Args {
    /// MCP endpoint URL
    #[arg(long, default_value = "http://localhost:8080/mcp")]
    url: String,

    /// API key for X-API-Key header
    #[arg(long)]
    api_key: Option<String>,

    /// Path to config TOML file
    #[arg(short, long)]
    config: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Create and connect MCP client.
    let mut client = AturClient::new(args.url, args.api_key);
    client.connect().await?;

    // Setup terminal.
    enable_raw_mode()?;
    let stderr = io::stderr();
    let backend = CrosstermBackend::new(stderr);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;

    // Create app, push initial view, fetch data.
    let mut app = App::new(client);
    app.push_view(View::WorkspaceList);
    app.fetch_current_view().await;

    // Event loop.
    while !app.should_quit {
        // Draw.
        terminal.draw(|f| app.render(f))?;

        // Poll events (250ms timeout).
        if event::poll(std::time::Duration::from_millis(250))? {
            if let Event::Key(key) = event::read()? {
                let result = app.handle_key(key);
                match result {
                    HandleResult::Fetch => {
                        app.fetch_current_view().await;
                    }
                    HandleResult::Enter => {
                        app.handle_enter().await;
                    }
                    HandleResult::None => {}
                }
            }
        }
    }

    // Restore terminal.
    disable_raw_mode()?;
    terminal.show_cursor()?;

    Ok(())
}

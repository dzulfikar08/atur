mod app;
mod client;
mod components;
mod theme;
mod views;

use clap::Parser;

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

    println!("atur-tui connecting to {}...", args.url);

    Ok(())
}

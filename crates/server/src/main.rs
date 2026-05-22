mod config;
mod email;
mod error;
mod middleware;
mod routes;
pub mod search_index;
mod state;
pub mod webhook_dispatcher;

use clap::Parser;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "atur", about = "Organize everything")]
struct Cli {
    #[arg(short, long, default_value = "config.toml")]
    config: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(clap::Subcommand)]
enum Commands {
    /// Start the server
    Serve,
    /// Run database migrations
    Migrate,
    /// Create a new user
    CreateUser {
        /// User email
        #[arg(long)]
        email: String,
        /// Username
        #[arg(long)]
        username: String,
        /// Password (min 8 chars)
        #[arg(long)]
        password: String,
    },
    /// Reset a user's password
    ResetPassword {
        /// User email
        #[arg(long)]
        email: String,
        /// New password (min 8 chars)
        #[arg(long)]
        password: String,
    },
    /// List all users
    ListUsers,
    /// Run cleanup tasks (hard delete, archive)
    Cleanup,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // For commands that don't need full config, we still load it for the DB URL.
    let cfg = config::Config::load(&cli.config)?;

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new(&cfg.server.log_level)),
        )
        .json()
        .init();

    match cli.command {
        Commands::Serve => run_server(cfg).await,
        Commands::Migrate => run_migrations(cfg).await,
        Commands::CreateUser { email, username, password } => {
            run_create_user(cfg, &email, &username, &password).await
        }
        Commands::ResetPassword { email, password } => {
            run_reset_password(cfg, &email, &password).await
        }
        Commands::ListUsers => run_list_users(cfg).await,
        Commands::Cleanup => run_cleanup(cfg).await,
    }
}

async fn run_server(cfg: config::Config) -> anyhow::Result<()> {
    let state = state::AppState::new(cfg.clone()).await?;

    tracing::info!(
        host = %cfg.server.host,
        port = %cfg.server.port,
        "Starting atur server"
    );

    let listener = tokio::net::TcpListener::bind(format!("{}:{}", cfg.server.host, cfg.server.port)).await?;
    axum::serve(listener, routes::router(state)).await?;

    Ok(())
}

async fn run_migrations(cfg: config::Config) -> anyhow::Result<()> {
    tracing::info!("Running migrations...");
    let state = state::AppState::new(cfg).await?;
    state.run_migrations().await?;
    tracing::info!("Migrations complete");
    Ok(())
}

// ---------------------------------------------------------------------------
// Admin CLI commands
// ---------------------------------------------------------------------------

async fn run_create_user(
    cfg: config::Config,
    email: &str,
    username: &str,
    password: &str,
) -> anyhow::Result<()> {
    domain::auth::validate_password_strength(password)
        .map_err(|e| anyhow::anyhow!(e))?;

    let state = state::AppState::new(cfg).await?;
    use db::entities::users;
    use sea_orm::ActiveValue::Set;

    // Check duplicate
    let existing: Option<users::Model> = users::Entity::find()
        .filter(users::Column::Email.eq(email))
        .one(&state.db)
        .await?;
    if existing.is_some() {
        anyhow::bail!("A user with email '{}' already exists", email);
    }

    let existing_uname: Option<users::Model> = users::Entity::find()
        .filter(users::Column::Username.eq(username))
        .one(&state.db)
        .await?;
    if existing_uname.is_some() {
        anyhow::bail!("A user with username '{}' already exists", username);
    }

    let hash = domain::auth::hash_password(password)?;
    let user = users::ActiveModel {
        id: Set(uuid::Uuid::new_v4()),
        email: Set(email.to_string()),
        username: Set(username.to_string()),
        password_hash: Set(Some(hash)),
        display_name: Set(None),
        avatar: Set(None),
        token: Set(None),
        user_timezone: Set(None),
        is_active: Set(true),
        is_superuser: Set(false),
        is_email_verified: Set(true),
        is_bot: Set(false),
        created_at: Set(Some(chrono::Utc::now().into())),
        updated_at: Set(Some(chrono::Utc::now().into())),
        deleted_at: Set(None),
    };

    let inserted = user.insert(&state.db).await?;
    println!(
        "Created user: {} (email: {}, id: {})",
        inserted.username, inserted.email, inserted.id
    );
    Ok(())
}

async fn run_reset_password(
    cfg: config::Config,
    email: &str,
    password: &str,
) -> anyhow::Result<()> {
    domain::auth::validate_password_strength(password)
        .map_err(|e| anyhow::anyhow!(e))?;

    let state = state::AppState::new(cfg).await?;
    use db::entities::users;
    use sea_orm::ActiveValue::Set;

    let user: users::Model = users::Entity::find()
        .filter(users::Column::Email.eq(email))
        .one(&state.db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("User with email '{}' not found", email))?;

    let hash = domain::auth::hash_password(password)?;
    let mut active: users::ActiveModel = user.into();
    active.password_hash = Set(Some(hash));
    active.updated_at = Set(Some(chrono::Utc::now().into()));
    active.update(&state.db).await?;

    println!("Password reset for {}", email);
    Ok(())
}

async fn run_list_users(cfg: config::Config) -> anyhow::Result<()> {
    let state = state::AppState::new(cfg).await?;
    use db::entities::users;

    let all_users: Vec<users::Model> = users::Entity::find()
        .filter(users::Column::DeletedAt.is_null())
        .all(&state.db)
        .await?;

    println!("{:<38} {:<30} {:<20} {:<10} {:<10}", "ID", "Email", "Username", "Active", "Super");
    println!("{}", "-".repeat(110));
    for u in all_users {
        println!(
            "{:<38} {:<30} {:<20} {:<10} {:<10}",
            u.id,
            u.email,
            u.username,
            u.is_active,
            u.is_superuser,
        );
    }
    Ok(())
}

async fn run_cleanup(cfg: config::Config) -> anyhow::Result<()> {
    let state = state::AppState::new(cfg.clone()).await?;
    use chrono::Utc;
    use db::entities::{issues, pages};

    let cutoff_days = cfg.tasks.hard_delete_after_days as i64;
    let cutoff = Utc::now() - chrono::Duration::days(cutoff_days);
    let cutoff_fixed: chrono::DateTime<chrono::FixedOffset> = cutoff.into();

    // Hard-delete issues soft-deleted more than cutoff_days ago
    let old_issues: Vec<issues::Model> = issues::Entity::find()
        .filter(issues::Column::DeletedAt.lt(cutoff_fixed))
        .all(&state.db)
        .await?;

    let issue_count = old_issues.len();
    for issue in old_issues {
        let _ = issues::ActiveModel::from(issue)
            .delete(&state.db)
            .await;
    }

    // Hard-delete pages soft-deleted more than cutoff_days ago
    let old_pages: Vec<pages::Model> = pages::Entity::find()
        .filter(pages::Column::DeletedAt.lt(cutoff_fixed))
        .all(&state.db)
        .await?;

    let page_count = old_pages.len();
    for page in old_pages {
        let _ = pages::ActiveModel::from(page)
            .delete(&state.db)
            .await;
    }

    tracing::info!(
        "Cleanup complete: hard-deleted {} issues, {} pages (older than {} days)",
        issue_count,
        page_count,
        cutoff_days,
    );
    println!(
        "Cleanup complete: hard-deleted {} issues, {} pages (older than {} days)",
        issue_count, page_count, cutoff_days,
    );
    Ok(())
}

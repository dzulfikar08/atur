use std::sync::Arc;

use crate::config::Config;
use crate::email::EmailService;
use collab::document::DocumentRegistry;
use sea_orm::Database;
use sea_orm_migration::MigratorTrait as _;

#[derive(Clone)]
pub struct AppState {
    pub db: sea_orm::DatabaseConnection,
    pub config: Config,
    pub doc_registry: Arc<DocumentRegistry>,
    pub search_index: Option<tantivy::Index>,
    pub email: Option<EmailService>,
}

impl AppState {
    pub async fn new(cfg: Config) -> anyhow::Result<Self> {
        let db = Database::connect(&cfg.database.url).await?;

        // Auto-run migrations on startup for SQLite
        if cfg.database.url.starts_with("sqlite") {
            db::migration::Migrator::up(&db, None).await?;
        }

        // Initialize Tantivy search index
        let search_index = match crate::search_index::init_index(&cfg.search.index_path) {
            Ok(idx) => {
                tracing::info!(path = %cfg.search.index_path, "Tantivy search index initialized");
                Some(idx)
            }
            Err(e) => {
                tracing::warn!(error = %e, "Failed to initialize Tantivy search index, search will use SQL fallback");
                None
            }
        };

        // Initialize email service if SMTP is configured
        let email = EmailService::from_config(&cfg.email);
        if email.is_some() {
            tracing::info!("Email service initialized (SMTP enabled)");
        } else {
            tracing::info!("Email service not configured, email notifications disabled");
        }

        Ok(Self {
            db,
            config: cfg,
            doc_registry: Arc::new(DocumentRegistry::new()),
            search_index,
            email,
        })
    }

    pub async fn run_migrations(&self) -> anyhow::Result<()> {
        db::migration::Migrator::up(&self.db, None).await?;
        Ok(())
    }
}

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub storage: StorageConfig,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub email: EmailConfig,
    #[serde(default)]
    pub search: SearchConfig,
    #[serde(default)]
    pub tasks: TasksConfig,
    #[serde(default)]
    pub cleanup: CleanupConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub base_url: String,
    #[serde(default = "default_log_level")]
    pub log_level: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,
    #[serde(default = "default_min_connections")]
    pub min_connections: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StorageConfig {
    #[serde(default = "default_storage_backend")]
    pub backend: String,
    #[serde(default = "default_storage_path")]
    pub path: String,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct AuthConfig {
    pub session_secret: Option<String>,
    #[serde(default = "default_session_ttl")]
    pub session_ttl_hours: u64,
    pub oauth: Option<OAuthConfig>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct OAuthConfig {
    pub github: Option<OAuthProvider>,
    pub google: Option<OAuthProvider>,
    pub gitlab: Option<GitLabProvider>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OAuthProvider {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitLabProvider {
    pub client_id: String,
    pub client_secret: String,
    #[serde(default = "default_gitlab_url")]
    pub server_url: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct EmailConfig {
    #[serde(default)]
    pub enabled: bool,
    pub smtp_host: Option<String>,
    #[serde(default = "default_smtp_port")]
    pub smtp_port: u16,
    pub smtp_user: Option<String>,
    pub smtp_pass: Option<String>,
    pub from_address: Option<String>,
    #[serde(default = "default_smtp_tls")]
    pub use_tls: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchConfig {
    #[serde(default = "default_search_backend")]
    pub backend: String,
    #[serde(default = "default_search_index_path")]
    pub index_path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TasksConfig {
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    #[serde(default = "default_retry_base_delay")]
    pub retry_base_delay_secs: u64,
    #[serde(default = "default_hard_delete_days")]
    pub hard_delete_after_days: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CleanupConfig {
    #[serde(default = "default_archive_days")]
    pub archive_api_logs_days: u32,
    #[serde(default = "default_max_page_versions")]
    pub max_page_versions: u32,
    #[serde(default = "default_max_issue_desc_versions")]
    pub max_issue_description_versions: u32,
}

impl Config {
    pub fn load(path: &str) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| anyhow::anyhow!("Failed to read config file {}: {}", path, e))?;
        let cfg: Config = toml::from_str(&content)?;
        Ok(cfg)
    }
}

fn default_log_level() -> String { "info".into() }
fn default_max_connections() -> u32 { 10 }
fn default_min_connections() -> u32 { 1 }
fn default_storage_backend() -> String { "local".into() }
fn default_storage_path() -> String { "./data/uploads".into() }
fn default_session_ttl() -> u64 { 720 }
fn default_gitlab_url() -> String { "https://gitlab.com".into() }
fn default_smtp_port() -> u16 { 587 }
fn default_smtp_tls() -> bool { true }
fn default_search_backend() -> String { "tantivy".into() }
fn default_search_index_path() -> String { "./data/search".into() }
fn default_max_retries() -> u32 { 5 }
fn default_retry_base_delay() -> u64 { 600 }
fn default_hard_delete_days() -> u32 { 30 }
fn default_archive_days() -> u32 { 30 }
fn default_max_page_versions() -> u32 { 20 }
fn default_max_issue_desc_versions() -> u32 { 20 }

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            backend: default_search_backend(),
            index_path: default_search_index_path(),
        }
    }
}

impl Default for TasksConfig {
    fn default() -> Self {
        Self {
            max_retries: default_max_retries(),
            retry_base_delay_secs: default_retry_base_delay(),
            hard_delete_after_days: default_hard_delete_days(),
        }
    }
}

impl Default for CleanupConfig {
    fn default() -> Self {
        Self {
            archive_api_logs_days: default_archive_days(),
            max_page_versions: default_max_page_versions(),
            max_issue_description_versions: default_max_issue_desc_versions(),
        }
    }
}

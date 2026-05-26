use std::collections::HashMap;

use anyhow::{Context, Result};
use http::{HeaderName, HeaderValue};
use rmcp::model::{CallToolRequestParams, ClientInfo};
use rmcp::service::{RunningService, RoleClient};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::{ClientHandler, ServiceExt};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Data types matching the Atur MCP server JSON response shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub identifier: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub emoji: Option<String>,
    pub workspace_id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    pub id: String,
    pub name: String,
    pub sequence_id: i64,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub is_draft: Option<bool>,
    #[serde(default)]
    pub description_html: Option<String>,
    #[serde(default)]
    pub state_id: Option<String>,
    pub project_id: String,
    pub workspace_id: String,
    #[serde(default)]
    pub created_by_id: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueList {
    pub results: Vec<Issue>,
    pub total: u64,
    #[serde(default)]
    pub limit: Option<u64>,
    #[serde(default)]
    pub offset: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sprint {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    pub project_id: String,
    pub workspace_id: String,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SprintProgress {
    pub total: u64,
    #[serde(default)]
    pub backlog: u64,
    #[serde(default)]
    pub unstarted: u64,
    #[serde(default)]
    pub started: u64,
    #[serde(default)]
    pub completed: u64,
    #[serde(default)]
    pub cancelled: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Module {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub target_date: Option<String>,
    pub project_id: String,
    pub workspace_id: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct State {
    pub id: String,
    pub name: String,
    pub group: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    pub sequence: f64,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub is_triage: bool,
}

// ---------------------------------------------------------------------------
// Client handler (implements rmcp ClientHandler trait)
// ---------------------------------------------------------------------------

/// Minimal ClientHandler -- just provides client info during MCP handshake.
/// We do not handle server-to-client requests (sampling, roots, etc.).
#[derive(Debug, Clone)]
struct AturClientHandler;

impl ClientHandler for AturClientHandler {
    fn get_info(&self) -> ClientInfo {
        ClientInfo::default()
    }
}

// ---------------------------------------------------------------------------
// AturClient -- the public wrapper
// ---------------------------------------------------------------------------

/// High-level client that connects to an Atur MCP server and exposes typed
/// methods for each tool call.
pub struct AturClient {
    url: String,
    api_key: Option<String>,
    service: Option<RunningService<RoleClient, AturClientHandler>>,
}

impl AturClient {
    /// Create a new (unconnected) client.
    pub fn new(url: String, api_key: Option<String>) -> Self {
        Self {
            url,
            api_key,
            service: None,
        }
    }

    /// Perform the MCP handshake. Must be called before any tool methods.
    pub async fn connect(&mut self) -> Result<()> {
        let mut config = StreamableHttpClientTransportConfig::with_uri(self.url.clone());

        // Pass the API key as a custom header (X-API-Key, not Bearer auth).
        if let Some(ref key) = self.api_key {
            let mut headers = HashMap::new();
            headers.insert(
                HeaderName::from_static("x-api-key"),
                HeaderValue::from_str(key)
                    .context("invalid API key header value")?,
            );
            config = config.custom_headers(headers);
        }

        // Use from_config which is implemented on
        // StreamableHttpClientTransport<reqwest::Client> (rmcp's bundled reqwest).
        let transport =
            rmcp::transport::StreamableHttpClientTransport::from_config(config);

        let service = AturClientHandler
            .serve(transport)
            .await
            .map_err(|e| anyhow::anyhow!("MCP handshake failed: {e}"))?;

        self.service = Some(service);
        Ok(())
    }

    // -- Helpers -------------------------------------------------------------

    fn service(&self) -> Result<&RunningService<RoleClient, AturClientHandler>> {
        self.service
            .as_ref()
            .context("AturClient not connected -- call connect() first")
    }

    /// Call a named MCP tool and return the concatenated text content.
    async fn call_tool_raw(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<String> {
        let service = self.service()?;

        // Convert a serde_json::Value (must be an object) into a JsonObject.
        let args_map: serde_json::Map<String, serde_json::Value> = match arguments {
            serde_json::Value::Object(map) => map,
            other => anyhow::bail!("tool arguments must be a JSON object, got: {other}"),
        };

        // tool_name.to_owned() gives us a String which satisfies Into<Cow<'static, str>>.
        let params = CallToolRequestParams::new(tool_name.to_owned()).with_arguments(args_map);

        let result = service
            .call_tool(params)
            .await
            .map_err(|e| anyhow::anyhow!("tool call '{tool_name}' failed: {e}"))?;

        if result.is_error.unwrap_or(false) {
            let text = extract_text_content(&result.content);
            anyhow::bail!("tool '{}' returned error: {}", tool_name, text);
        }

        Ok(extract_text_content(&result.content))
    }

    /// Call a tool and deserialize the text response into a typed struct.
    async fn call_tool_typed<T: serde::de::DeserializeOwned>(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<T> {
        let text = self.call_tool_raw(tool_name, arguments).await?;
        serde_json::from_str::<T>(&text).with_context(|| {
            let preview = &text[..text.len().min(200)];
            format!("failed to parse '{tool_name}' response: {preview}")
        })
    }

    // -- Public API ----------------------------------------------------------

    pub async fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        self.call_tool_typed("list_workspaces", serde_json::json!({}))
            .await
    }

    pub async fn list_projects(&self, workspace: Option<&str>) -> Result<Vec<Project>> {
        let mut args = serde_json::json!({});
        if let Some(ws) = workspace {
            args["workspace"] = serde_json::json!(ws);
        }
        self.call_tool_typed("list_projects", args).await
    }

    pub async fn list_issues(
        &self,
        project_id: &str,
        workspace: Option<&str>,
        limit: Option<u64>,
        sprint: Option<&str>,
    ) -> Result<IssueList> {
        let mut args = serde_json::json!({
            "project_id": project_id,
        });
        if let Some(ws) = workspace {
            args["workspace"] = serde_json::json!(ws);
        }
        if let Some(limit) = limit {
            args["limit"] = serde_json::json!(limit);
        }
        if let Some(sprint_id) = sprint {
            args["sprint"] = serde_json::json!(sprint_id);
        }
        self.call_tool_typed("list_issues", args).await
    }

    pub async fn get_issue(
        &self,
        project_id: &str,
        issue_id: &str,
        workspace: Option<&str>,
    ) -> Result<Issue> {
        let mut args = serde_json::json!({
            "project_id": project_id,
            "issue_id": issue_id,
        });
        if let Some(ws) = workspace {
            args["workspace"] = serde_json::json!(ws);
        }
        self.call_tool_typed("get_issue", args).await
    }

    pub async fn get_issue_by_sequence(
        &self,
        project_id: &str,
        sequence_id: i64,
        workspace: Option<&str>,
    ) -> Result<Issue> {
        let mut args = serde_json::json!({
            "project_id": project_id,
            "sequence_id": sequence_id,
        });
        if let Some(ws) = workspace {
            args["workspace"] = serde_json::json!(ws);
        }
        self.call_tool_typed("get_issue", args).await
    }

    pub async fn list_sprints(
        &self,
        project_id: &str,
        workspace: Option<&str>,
    ) -> Result<Vec<Sprint>> {
        let mut args = serde_json::json!({
            "project_id": project_id,
        });
        if let Some(ws) = workspace {
            args["workspace"] = serde_json::json!(ws);
        }
        self.call_tool_typed("list_sprints", args).await
    }

    pub async fn get_sprint_progress(
        &self,
        project_id: &str,
        sprint_id: &str,
        workspace: Option<&str>,
    ) -> Result<SprintProgress> {
        let mut args = serde_json::json!({
            "project_id": project_id,
            "sprint_id": sprint_id,
        });
        if let Some(ws) = workspace {
            args["workspace"] = serde_json::json!(ws);
        }
        self.call_tool_typed("get_sprint_progress", args).await
    }

    pub async fn list_modules(
        &self,
        project_id: &str,
        workspace: Option<&str>,
    ) -> Result<Vec<Module>> {
        let mut args = serde_json::json!({
            "project_id": project_id,
        });
        if let Some(ws) = workspace {
            args["workspace"] = serde_json::json!(ws);
        }
        self.call_tool_typed("list_modules", args).await
    }

    pub async fn get_module(
        &self,
        project_id: &str,
        module_id: &str,
        workspace: Option<&str>,
    ) -> Result<Module> {
        let mut args = serde_json::json!({
            "project_id": project_id,
            "module_id": module_id,
        });
        if let Some(ws) = workspace {
            args["workspace"] = serde_json::json!(ws);
        }
        self.call_tool_typed("get_module", args).await
    }

    pub async fn list_states(
        &self,
        project_id: &str,
        workspace: Option<&str>,
    ) -> Result<Vec<State>> {
        let mut args = serde_json::json!({
            "project_id": project_id,
        });
        if let Some(ws) = workspace {
            args["workspace"] = serde_json::json!(ws);
        }
        self.call_tool_typed("list_states", args).await
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract text from all text-type content items in a tool result.
fn extract_text_content(content: &[rmcp::model::Content]) -> String {
    content
        .iter()
        .filter_map(|c| match &c.raw {
            rmcp::model::RawContent::Text(t) => Some(t.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

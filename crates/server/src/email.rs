use anyhow::Result;
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

use crate::config::EmailConfig;

/// Email service wrapping SMTP configuration and transport.
#[derive(Clone)]
pub struct EmailService {
    from_address: String,
    transport: AsyncSmtpTransport<Tokio1Executor>,
}

impl EmailService {
    /// Build an `EmailService` from the email configuration.
    /// Returns `None` if the configuration is incomplete or email is disabled.
    pub fn from_config(cfg: &EmailConfig) -> Option<Self> {
        if !cfg.enabled {
            return None;
        }

        let host = cfg.smtp_host.as_deref().unwrap_or("");
        if host.is_empty() {
            return None;
        }

        let user = cfg.smtp_user.as_deref().unwrap_or("");
        let pass = cfg.smtp_pass.as_deref().unwrap_or("");
        if user.is_empty() || pass.is_empty() {
            return None;
        }

        let from_address = cfg
            .from_address
            .clone()
            .unwrap_or_else(|| format!("Atur <{}>", user));

        let creds = Credentials::new(user.to_string(), pass.to_string());

        // If TLS is disabled, use the plain transport (not STARTTLS)
        let transport = if cfg.use_tls {
            let builder = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)
                .expect("starttls_relay builder should not fail with a valid host string")
                .port(cfg.smtp_port)
                .credentials(creds)
                .timeout(Some(std::time::Duration::from_secs(30)));
            builder.build()
        } else {
            // Build without TLS: direct connection without STARTTLS
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
                .port(cfg.smtp_port)
                .credentials(creds)
                .timeout(Some(std::time::Duration::from_secs(30)))
                .build()
        };

        Some(Self {
            from_address,
            transport,
        })
    }

    /// Send an email with both HTML and plain-text bodies.
    pub async fn send_email(
        &self,
        to: &str,
        subject: &str,
        body_html: &str,
        body_text: &str,
    ) -> Result<()> {
        let message = Message::builder()
            .from(self.from_address.parse()?)
            .to(to.parse()?)
            .subject(subject)
            .multipart(
                lettre::message::MultiPart::alternative()
                    .singlepart(
                        lettre::message::SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(body_text.to_string()),
                    )
                    .singlepart(
                        lettre::message::SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(body_html.to_string()),
                    ),
            )?;

        self.transport.send(message).await?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

/// Base HTML wrapper for all email templates.
pub fn html_wrapper(title: &str, body_content: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>{title}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#3b82f6;padding:24px;color:#ffffff;">
<h1 style="margin:0;font-size:20px;">Atur</h1>
</td></tr>
<tr><td style="padding:24px 32px;">
{body_content}
</td></tr>
<tr><td style="padding:16px 32px;background:#f9fafb;color:#6b7280;font-size:12px;text-align:center;">
You received this email because you have email notifications enabled in Atur.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"#,
        title = title,
        body_content = body_content,
    )
}

/// Build the "issue assigned" email.
pub fn template_issue_assigned(
    user_display_name: &str,
    issue_name: &str,
    project_name: Option<&str>,
    base_url: &str,
    workspace_slug: &str,
    project_slug: &str,
    issue_sequence_id: &str,
) -> (String, String, String) {
    let project_info = project_name
        .map(|n| format!(" in project <strong>{}</strong>", n))
        .unwrap_or_default();

    let issue_url = format!(
        "{}/{}/projects/{}/issues/{}",
        base_url, workspace_slug, project_slug, issue_sequence_id
    );

    let body_html = html_wrapper(
        "Issue Assigned",
        &format!(
            r#"<p>Hello {user_display_name},</p>
<p>You have been assigned to issue <strong><a href="{issue_url}">{issue_name}</a></strong>{project_info}.</p>
<p style="margin:24px 0;">
  <a href="{issue_url}" style="background:#3b82f6;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">View Issue</a>
</p>"#,
            user_display_name = user_display_name,
            issue_name = issue_name,
            issue_url = issue_url,
            project_info = project_info,
        ),
    );

    let body_text = format!(
        "Hello {user_display_name},\n\nYou have been assigned to issue \"{issue_name}\"{project_info}.\n\nView issue: {issue_url}\n",
        user_display_name = user_display_name,
        issue_name = issue_name,
        project_info = project_name.map(|n| format!(" in project {}", n)).unwrap_or_default(),
        issue_url = issue_url,
    );

    let subject = format!("You were assigned to: {}", issue_name);
    (subject, body_html, body_text)
}

/// Build the "issue mentioned" email.
pub fn template_issue_mentioned(
    user_display_name: &str,
    issue_name: &str,
    mentioned_by: &str,
    base_url: &str,
    workspace_slug: &str,
    project_slug: &str,
    issue_sequence_id: &str,
) -> (String, String, String) {
    let issue_url = format!(
        "{}/{}/projects/{}/issues/{}",
        base_url, workspace_slug, project_slug, issue_sequence_id
    );

    let body_html = html_wrapper(
        "You were mentioned",
        &format!(
            r#"<p>Hello {user_display_name},</p>
<p><strong>{mentioned_by}</strong> mentioned you in issue <strong><a href="{issue_url}">{issue_name}</a></strong>.</p>
<p style="margin:24px 0;">
  <a href="{issue_url}" style="background:#3b82f6;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">View Issue</a>
</p>"#,
            user_display_name = user_display_name,
            mentioned_by = mentioned_by,
            issue_name = issue_name,
            issue_url = issue_url,
        ),
    );

    let body_text = format!(
        "Hello {user_display_name},\n\n{mentioned_by} mentioned you in issue \"{issue_name}\".\n\nView issue: {issue_url}\n",
        user_display_name = user_display_name,
        mentioned_by = mentioned_by,
        issue_name = issue_name,
        issue_url = issue_url,
    );

    let subject = format!("{} mentioned you in: {}", mentioned_by, issue_name);
    (subject, body_html, body_text)
}

/// Build the "sprint reminder" email.
pub fn template_sprint_reminder(
    user_display_name: &str,
    sprint_name: &str,
    action: &str, // "starts" or "ends"
    project_name: Option<&str>,
) -> (String, String, String) {
    let project_info = project_name
        .map(|n| format!(" in project <strong>{}</strong>", n))
        .unwrap_or_default();

    let body_html = html_wrapper(
        "Sprint Reminder",
        &format!(
            r#"<p>Hello {user_display_name},</p>
<p>Sprint <strong>{sprint_name}</strong> {action} tomorrow{project_info}.</p>
<p>Please make sure your issues are up to date.</p>"#,
            user_display_name = user_display_name,
            sprint_name = sprint_name,
            action = action,
            project_info = project_info,
        ),
    );

    let body_text = format!(
        "Hello {user_display_name},\n\nSprint \"{sprint_name}\" {action} tomorrow{project_info}.\nPlease make sure your issues are up to date.\n",
        user_display_name = user_display_name,
        sprint_name = sprint_name,
        action = action,
        project_info = project_name.map(|n| format!(" in project {}", n)).unwrap_or_default(),
    );

    let subject = format!("Sprint {} {} tomorrow", sprint_name, action);
    (subject, body_html, body_text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_email_config_disabled_returns_none() {
        let cfg = EmailConfig::default();
        assert!(EmailService::from_config(&cfg).is_none());
    }

    #[test]
    fn test_email_config_missing_host_returns_none() {
        let cfg = EmailConfig {
            enabled: true,
            ..Default::default()
        };
        assert!(EmailService::from_config(&cfg).is_none());
    }

    #[test]
    fn test_template_issue_assigned() {
        let (subject, html, text) = template_issue_assigned(
            "Alice",
            "Fix login bug",
            Some("Backend"),
            "http://localhost:8080",
            "my-workspace",
            "backend",
            "PROJ-42",
        );
        assert!(subject.contains("Fix login bug"));
        assert!(html.contains("Alice"));
        assert!(text.contains("Alice"));
    }

    #[test]
    fn test_template_issue_mentioned() {
        let (subject, html, text) = template_issue_mentioned(
            "Bob",
            "Refactor API",
            "Carol",
            "http://localhost:8080",
            "my-workspace",
            "backend",
            "PROJ-10",
        );
        assert!(subject.contains("Carol"));
        assert!(html.contains("Bob"));
        assert!(text.contains("Carol"));
    }

    #[test]
    fn test_template_sprint_reminder() {
        let (subject, html, text) = template_sprint_reminder(
            "Dave",
            "Sprint 5",
            "starts",
            Some("Mobile App"),
        );
        assert!(subject.contains("Sprint 5"));
        assert!(html.contains("starts tomorrow"));
        assert!(text.contains("starts tomorrow"));
    }
}

use anyhow::Result;

/// Represents an email to be sent.
#[derive(Debug, Clone)]
pub struct EmailTask {
    pub to: String,
    pub subject: String,
    pub body_html: String,
}

impl EmailTask {
    /// Send the email.
    ///
    /// Currently logs the email for development purposes.
    /// Real SMTP delivery will be added in a future phase.
    pub async fn send(&self) -> Result<()> {
        tracing::info!(
            to = %self.to,
            subject = %self.subject,
            "Email queued (stub): length={} bytes",
            self.body_html.len()
        );

        // TODO: Replace with actual SMTP send when email provider is configured
        // Example: lettre::AsyncTransport::send(...)
        Ok(())
    }
}

/// Convenience function to send a single email.
pub async fn send_email(to: &str, subject: &str, body_html: &str) -> Result<()> {
    let task = EmailTask {
        to: to.to_string(),
        subject: subject.to_string(),
        body_html: body_html.to_string(),
    };
    task.send().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_send_email_stub() {
        let task = EmailTask {
            to: "test@example.com".to_string(),
            subject: "Test Subject".to_string(),
            body_html: "<h1>Hello</h1>".to_string(),
        };
        // Should not error
        task.send().await.unwrap();
    }
}

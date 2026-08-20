-- CRM customer email templates (stored per-workspace so each team can tailor
-- the wording). Templates use {{placeholder}} variables that are filled with
-- customer/purchase data at send time.
CREATE TABLE IF NOT EXISTS crm_email_templates (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,           -- 'feedback_request', etc.
  subject      TEXT NOT NULL,            -- e.g. "How was your experience, {{name}}?"
  body         TEXT NOT NULL,             -- plain-text body with {{placeholders}}
  is_html      INTEGER NOT NULL DEFAULT 0, -- 1 = body is HTML, 0 = plain text
  created_at   TEXT,
  updated_at   TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_email_templates_workspace
  ON crm_email_templates(workspace_id, template_name);
CREATE INDEX IF NOT EXISTS idx_crm_email_templates_workspace
  ON crm_email_templates(workspace_id);

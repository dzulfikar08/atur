-- Data migration: existing per-workspace template overrides become variants
-- (purpose = old template_name, is_default so they keep being the ones sent).
INSERT INTO `crm_email_variants` (`id`, `workspace_id`, `purpose`, `name`, `subject`, `body`, `is_html`, `is_default`, `created_at`, `updated_at`)
SELECT `id`, `workspace_id`, `template_name`, 'Imported', `subject`, `body`, `is_html`, 1, `created_at`, `updated_at`
FROM `crm_email_templates`;
--> statement-breakpoint
DROP TABLE `crm_email_templates`;
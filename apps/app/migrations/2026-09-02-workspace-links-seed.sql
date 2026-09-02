-- Seed bindings for every active workspace in the single-operator portfolio.
-- Only evidence-backed fields are filled; NULL means "not known yet" and is
-- completed via PUT /api/workspaces/:slug/links or the set_workspace_link MCP
-- tool as repos land locally. Run like the DDL migration. Safe to re-run:
-- INSERT OR IGNORE (never overwrites an edited row).

INSERT OR IGNORE INTO workspace_links (id, workspace_slug, repo_urls, local_path, default_branch, herdr_workspace, notes, created_at, updated_at) VALUES
  ('wl-opexmx', 'opexmx', '["opexmx-app","opex-flow","opexmx-landing-tanstack"]', NULL, NULL, NULL, 'Repos referenced across DEV issues; local checkout paths pending.', NULL, NULL),
  ('wl-voltrus', 'voltrus', NULL, NULL, NULL, NULL, 'MacTools product fleet (~15 codebases per TOOL project).', NULL, NULL),
  ('wl-cowculator', 'cowculator', NULL, NULL, NULL, NULL, 'Binding pending.', NULL, NULL),
  ('wl-e-pondok', 'e-pondok', NULL, NULL, NULL, NULL, 'Binding pending.', NULL, NULL),
  ('wl-revklik', 'revklik', NULL, NULL, NULL, NULL, 'klikapa analytics + voltrus.id sites.', NULL, NULL),
  ('wl-waqtu', 'waqtu', NULL, NULL, NULL, NULL, 'Binding pending.', NULL, NULL),
  ('wl-cloudagni', 'cloudagni', NULL, NULL, NULL, NULL, 'Binding pending.', NULL, NULL),
  ('wl-joyodigitama', 'joyodigitama', '["DECK paparan engine","WAYCAP recorder"]', '/home/dzul/Documents/JoyoDigitama', NULL, NULL, 'Holding workspace; DECK + WAYCAP live under the JoyoDigitama dir.', NULL, NULL),
  ('wl-weloveourbaby', 'weloveourbaby', NULL, NULL, NULL, NULL, 'apps/app + apps/web + cctv-hls-worker.', NULL, NULL),
  ('wl-briefok', 'briefok', NULL, NULL, NULL, NULL, 'Binding pending.', NULL, NULL),
  ('wl-watchfit', 'watchfit', NULL, NULL, NULL, NULL, 'Binding pending.', NULL, NULL),
  ('wl-diatur', 'diatur', NULL, '/home/dzul/Documents/JoyoDigitama/atur', NULL, NULL, 'This repo: Hono on Workers (worker atur-hono) + Astro marketing site.', NULL, NULL),
  ('wl-motioncue', 'motioncue', NULL, NULL, NULL, NULL, 'No projects yet.', NULL, NULL),
  ('wl-family', 'family', NULL, NULL, NULL, NULL, 'Personal workspace — no repo by design.', NULL, NULL),
  ('wl-youtube-automation', 'youtube-automation', NULL, NULL, NULL, NULL, 'Mac-side Python agent + CF control plane.', NULL, NULL),
  ('wl-nempel', 'nempel', NULL, NULL, NULL, NULL, 'Live MVP https://nempel.com; React 19 + Hono on Workers.', NULL, NULL),
  ('wl-mailflare', 'mailflare', '["dzulfikar08/mailflare"]', NULL, NULL, NULL, 'Self-hosted email on Workers (Next.js/OpenNext at review time).', NULL, NULL),
  ('wl-intip', 'intip', NULL, '/home/dzul/Documents/JoyoDigitama/intip', NULL, NULL, 'Threads keyword watcher (Hono + drizzle), style matches nempel.', NULL, NULL);

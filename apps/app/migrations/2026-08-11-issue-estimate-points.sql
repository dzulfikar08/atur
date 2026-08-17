-- Numeric story-point estimate on issues.
-- Source of truth: server-js/src/db/schema.ts -> issues.estimatePoints.
-- Run: wrangler d1 execute DB --local --file=server-js/migrations/2026-08-11-issue-estimate-points.sql
-- (use --remote for prod D1).

ALTER TABLE issues ADD COLUMN estimate_points INTEGER;

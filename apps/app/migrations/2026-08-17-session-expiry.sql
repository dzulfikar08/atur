-- Sliding 24h session validity for users.token.
-- Source of truth: server-js/src/db/schema.ts -> users.sessionExpiresAt.
-- Run: wrangler d1 execute DB --local --file=server-js/migrations/2026-08-17-session-expiry.sql
-- (use --remote for prod D1). One-shot: the ALTER is not guarded — do not re-run.

ALTER TABLE users ADD COLUMN session_expires_at TEXT;

# Legacy migrations (superseded)

These hand-written SQL migrations are **no longer applied by wrangler** —
`migrations_dir` was removed from `wrangler.toml` on 2026-08-18 when the project
switched to Drizzle migrations.

Schema changes now flow through:

```bash
bun run db:generate   # drizzle-kit generate → drizzle/0000_*.sql, 0001_*.sql, ...
bun run db:migrate    # drizzle-kit migrate → applies pending migrations to prod D1
bun run db:migrate:local  # fresh local D1 from baseline + seed
```

The prod D1 was adopted at baseline `0000_simple_meteorite.sql` (51 tables).
The `d1_migrations` table in prod is inert history from the wrangler era and is
safe to ignore.

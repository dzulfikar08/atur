-- Dev seed: creates a test user (email: dev@atur.local, password: password123)
-- Password hash = SHA-256("password123" + "HelloWorldFoo123")

INSERT OR IGNORE INTO users (id, email, username, password_hash, token, is_active, is_superuser, is_email_verified, is_bot, created_at, updated_at)
VALUES ('dev-user-001', 'dev@atur.local', 'dev', 'a1f136d6cce2e126c85ebccc16206142c1e476e71079203e797d36edf0b26f1c:48656c6c6f576f726c64466f6f313233', 'dev-token-00000000000000000000000000', 1, 1, 1, 0, datetime('now'), datetime('now'));

-- One row per extension name. `publisher` ("owner/repo") is pinned by the first
-- publish so a name cannot be taken over by another repository.
CREATE TABLE extensions (
  name TEXT PRIMARY KEY,
  publisher TEXT NOT NULL,
  first_party INTEGER NOT NULL DEFAULT 0,
  -- Highest non-yanked version; NULL when every version is yanked.
  latest_version TEXT,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Published versions are immutable: only `yanked*` and `downloads` ever change.
CREATE TABLE extension_versions (
  name TEXT NOT NULL REFERENCES extensions (name),
  version TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  signature TEXT NOT NULL,
  metadata_signature TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  categories TEXT NOT NULL DEFAULT '[]',
  author_name TEXT,
  author_github TEXT,
  homepage TEXT,
  repository TEXT,
  archive_key TEXT NOT NULL,
  icon_key TEXT,
  icon_type TEXT,
  screenshot_keys TEXT NOT NULL DEFAULT '[]',
  yanked INTEGER NOT NULL DEFAULT 0,
  yanked_reason TEXT,
  yanked_at INTEGER,
  downloads INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER NOT NULL,
  PRIMARY KEY (name, version)
);

CREATE INDEX extension_versions_by_name ON extension_versions (name);

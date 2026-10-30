export interface Env {
  DB: D1Database;
  ARCHIVES: R2Bucket;
  /** Raw 32-byte Ed25519 public key, base64. */
  SIGNING_PUBKEY: string;
  /** Worker secret; bearer token for /api/publish and /api/yank. */
  EXTENSIONS_PUBLISH_TOKEN?: string;
}

export type AppEnv = { Bindings: Env };

/** `extension_versions` joined with the owning `extensions` row. */
export interface VersionRow {
  name: string;
  version: string;
  sha256: string;
  size: number;
  signature: string;
  metadata_signature: string;
  description: string | null;
  permissions: string;
  categories: string;
  author_name: string | null;
  author_github: string | null;
  homepage: string | null;
  repository: string | null;
  archive_key: string;
  icon_key: string | null;
  icon_type: string | null;
  screenshot_keys: string;
  yanked: number;
  yanked_reason: string | null;
  yanked_at: number | null;
  downloads: number;
  published_at: number;
}

export interface ListedRow extends VersionRow {
  publisher: string;
  first_party: number;
  total_downloads: number;
}

export interface PublishedAsset {
  field: string;
  filename: string;
  sha256: string;
}

export interface Metadata {
  name: string;
  version: string;
  sha256: string;
  size: number;
  description: string | null;
  permissions: string[];
  author: { name: string | null; github: string | null } | null;
  homepage: string | null;
  repository: string | null;
  categories: string[];
  icon: PublishedAsset | null;
  screenshots: PublishedAsset[];
  publisher: string;
  firstParty: boolean;
}

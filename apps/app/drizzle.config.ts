import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// d1-http driver talks to the Cloudflare API. `generate` only needs the schema
// and out paths; `migrate` needs credentials (resolved from env at run time).
// accountId/databaseId are hardcoded to match wrangler.toml; the API token is
// read from CLOUDFLARE_API_TOKEN (falls back to the wrangler OAuth token).
const accountId = "b7e6f8457bd39fa37a7eea5249799754";
const databaseId = "08a18888-5e9a-4384-8ec2-03e73adab633";

function resolveToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  // Fall back to the wrangler OAuth token so `drizzle-kit migrate` works with
  // `wrangler login` credentials without needing a separate API token.
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const configPath = `${home}/Library/Preferences/.wrangler/config/default.toml`;
  try {
    const toml = readFileSync(configPath, "utf8");
    const match = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch {}
  return undefined;
}

export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/worker/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    accountId,
    databaseId,
    token: resolveToken(),
  },
});

import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// d1-http driver talks to the Cloudflare API. `generate` only needs the schema
// and out paths; `migrate` needs credentials (resolved from env at run time).
// accountId/databaseId are hardcoded to match wrangler.toml; the API token is
// read from CLOUDFLARE_API_TOKEN (falls back to the wrangler OAuth token).
const accountId = "bab412435164c01fcd1b8932bc74950f";
const databaseId = "08a18888-5e9a-4384-8ec2-03e73adab633";

function resolveToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  // Fall back to the wrangler OAuth token so `drizzle-kit migrate` works with
  // `wrangler login` credentials without needing a separate API token. The
  // file lives under Library/Preferences on macOS and ~/.config (XDG) on Linux.
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const configPaths = [
    `${home}/.config/.wrangler/config/default.toml`, // Linux
    `${home}/Library/Preferences/.wrangler/config/default.toml`, // macOS
  ];
  for (const configPath of configPaths) {
    try {
      const toml = readFileSync(configPath, "utf8");
      const match = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m);
      if (match) return match[1];
    } catch {}
  }
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

import { defineConfig } from "astro/config";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

// Public marketing-site origin. Override with ATUR_WEB_SITE at build time, or
// edit here before deploy. Canonical URLs, OG tags, the sitemap, and robots.txt
// all derive from this, so it must match the deployed domain (diatur.com).
const SITE = process.env.ATUR_WEB_SITE ?? "https://diatur.com";

// Per-page <lastmod> for the sitemap: the git committer date of the source
// .astro file behind each URL. Falls back to build time for dynamic-route
// misses or untracked files.
const PAGES_DIR = fileURLToPath(new URL("./src/pages/", import.meta.url));

const BLOG_CONTENT_DIR = fileURLToPath(
  new URL("./src/content/blog/", import.meta.url),
);

function srcForUrl(urlPath) {
  if (urlPath === "/") return path.join(PAGES_DIR, "index.astro");
  const clean = urlPath.replace(/^\/|\/$/g, "");
  // Static route first: /foo -> pages/foo.astro or pages/foo/index.astro
  for (const t of [
    path.join(PAGES_DIR, clean + ".astro"),
    path.join(PAGES_DIR, clean, "index.astro"),
  ]) {
    if (existsSync(t)) return t;
  }
  // Article pages: /blog/<slug> maps to the markdown file itself, so lastmod
  // tracks the article content rather than the shared template.
  const segs = clean.split("/");
  if (segs.length === 2 && segs[0] === "blog") {
    const md = path.join(BLOG_CONTENT_DIR, segs[1] + ".md");
    if (existsSync(md)) return md;
  }
  // Nested dynamic routes: /blog/category/<x> -> pages/blog/category/[category]/index.astro
  if (segs.length >= 3) {
    const parent = path.join(PAGES_DIR, ...segs.slice(0, -2));
    try {
      const dyn = readdirSync(parent).find((d) => /^\[.+\]$/.test(d));
      if (dyn && existsSync(path.join(parent, dyn, "index.astro")))
        return path.join(parent, dyn, "index.astro");
    } catch {}
  }
  // Dynamic routes: /blog/x -> pages/blog/[slug].astro
  if (segs.length >= 1) {
    const parent = path.join(PAGES_DIR, ...segs.slice(0, -1));
    const leafFile = path.join(parent, "[slug].astro");
    if (existsSync(leafFile)) return leafFile;
  }
  return null;
}

function lastmodFor(urlPath) {
  const src = srcForUrl(urlPath);
  if (!src) return new Date().toISOString();
  try {
    const iso = execFileSync("git", ["log", "-1", "--format=%cI", "--", src], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    return iso || new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// @astrojs/sitemap emits sitemap-index.xml + sitemap-0.xml. Expose a single
// /sitemap.xml (referenced by robots.txt and search consoles) by copying the
// generated index at build end.
function sitemapAtRoot() {
  return {
    name: "sitemap-at-root",
    hooks: {
      "astro:build:done": ({ dir }) => {
        const out = fileURLToPath(dir);
        const indexFile = path.join(out, "sitemap-index.xml");
        if (existsSync(indexFile))
          writeFileSync(path.join(out, "sitemap.xml"), readFileSync(indexFile));
      },
    },
  };
}

export default defineConfig({
  site: SITE,
  output: "static",
  // "@" -> ./src, so deep routes import "@/layouts/BaseLayout.astro" instead
  // of counting ../../../. Mirrored in tsconfig.json paths for the editor.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !page.endsWith("/rss.xml"),
      serialize(item) {
        item.lastmod = lastmodFor(new URL(item.url).pathname);
        return item;
      },
    }),
    sitemapAtRoot(),
  ],
  build: { format: "directory", inlineStylesheets: "never" },
  compressHTML: false,
});

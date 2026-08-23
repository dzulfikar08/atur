import type { CollectionEntry } from "astro:content";

// Shared view-model over the blog content collection. Route files stay thin;
// the category vocabulary lives here so the content schema and the generated
// /blog/category/ routes always agree.

export const BLOG_CATEGORIES = [
  "projects",
  "support",
  "crm",
  "time",
  "pages",
  "ai",
  "comparisons",
  "company",
] as const;

export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<BlogCategory, string> = {
  projects: "Projects",
  support: "Support",
  crm: "CRM",
  time: "Time",
  pages: "Pages",
  ai: "AI & MCP",
  comparisons: "Comparisons",
  company: "Company",
};

export type Post = CollectionEntry<"blog">;

/** Rough reading time from the raw markdown body (~220 wpm). */
export function readMins(body: string | undefined): number {
  const words = (body ?? "").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** Slugify a tag label for /blog/tag/ URLs. */
export function tagSlug(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

export function newestFirst(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export function byCategory(posts: Post[], category: string): Post[] {
  return posts.filter((p) => p.data.category === category);
}

export function byTag(posts: Post[], tag: string): Post[] {
  const slug = tagSlug(tag);
  return posts.filter((p) => (p.data.tags ?? []).some((t) => tagSlug(t) === slug));
}

export interface CategoryInfo {
  key: BlogCategory;
  label: string;
  count: number;
}

/** Categories with at least one post, in BLOG_CATEGORIES order. */
export function allCategories(posts: Post[]): CategoryInfo[] {
  const counts = new Map<BlogCategory, number>();
  for (const p of posts) {
    counts.set(p.data.category, (counts.get(p.data.category) ?? 0) + 1);
  }
  return BLOG_CATEGORIES.filter((key) => counts.has(key)).map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    count: counts.get(key) ?? 0,
  }));
}

export interface TagInfo {
  slug: string;
  label: string;
  count: number;
}

/** Every distinct tag across posts, most-used first, then alphabetical. */
export function allTags(posts: Post[]): TagInfo[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const p of posts) {
    for (const t of p.data.tags ?? []) {
      const slug = tagSlug(t);
      const cur = counts.get(slug);
      if (cur) cur.count += 1;
      else counts.set(slug, { label: t, count: 1 });
    }
  }
  return Array.from(counts, ([slug, v]) => ({ slug, ...v })).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

/** Same category first, then posts sharing a tag, deduped, capped. */
export function relatedPosts(all: Post[], post: Post, cap = 3): Post[] {
  const tagSet = new Set((post.data.tags ?? []).map(tagSlug));
  const sameCategory = byCategory(all, post.data.category).filter((p) => p.id !== post.id);
  const bySharedTag = tagSet.size
    ? all.filter(
        (p) =>
          p.id !== post.id &&
          p.data.category !== post.data.category &&
          (p.data.tags ?? []).some((t) => tagSet.has(tagSlug(t))),
      )
    : [];
  return [...sameCategory, ...bySharedTag]
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
    .slice(0, cap);
}

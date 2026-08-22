import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { CATEGORY_LABELS } from "@/lib/blog";

export async function GET(context) {
  const posts = (await getCollection("blog")).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );
  return rss({
    title: "Atur Blog",
    description:
      "Guides and notes on running projects, support, CRM, and time in one connected workspace.",
    site: context.site ?? "https://diatur.com",
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.id}/`,
      categories: [
        CATEGORY_LABELS[post.data.category],
        ...(post.data.tags ?? []),
      ],
    })),
  });
}

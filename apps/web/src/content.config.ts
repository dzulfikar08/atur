import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { BLOG_CATEGORIES } from "./lib/blog";

export const collections = {
  blog: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
    schema: z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      category: z.enum(BLOG_CATEGORIES),
      tags: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional(),
      author: z.string().optional(),
    }),
  }),
};

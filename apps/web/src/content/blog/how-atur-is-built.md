---
title: "How Atur is built: one Bun monorepo, Astro, and a Cloudflare Worker"
description: "The whole product is two apps in one Bun-workspaces repo: a static Astro marketing site and a Hono worker on Cloudflare that serves the API, the SPA, and the MCP server from one origin."
pubDate: 2026-08-22
category: "company"
tags: ["engineering", "astro", "cloudflare"]
keywords: ["bun workspaces monorepo", "astro marketing site", "hono cloudflare workers"]
---

When we described [why we built Atur][w], we left out the how. This post fixes that, not because the stack is exotic (it is deliberately boring), but because the shape of the codebase mirrors the product argument: fewer moving parts, one place for things to live.

## Two apps, one repo

Atur is a Bun-workspaces monorepo. `bun run build` at the root fans out into two deployables:

- **apps/web**: the marketing site and this blog, built with Astro and deployed to Cloudflare Pages.
- **apps/app**: the product itself: a Hono application on a Cloudflare Worker, with the React SPA and the JSON API served from the same origin.

That's the entire topology. No service mesh, no API gateway, no separate docs site. When something breaks, there are exactly two places to look.

## The marketing site is static, and that's the point

Marketing pages need to do two things well: load fast and be crawlable. Astro delivers both by default: every page you're reading is pre-rendered HTML at deploy time, with zero client-side JavaScript required to read it. The blog is markdown files in the repo, rendered through Astro's content collections, with the sitemap and RSS feed generated on every build.

This is also the honest SEO answer. A marketing site doesn't need a client-side framework; it needs correct HTML, fast responses, and content that ships. Astro gives us that without a fight, and the content collection schema (`content.config.ts`) enforces a category vocabulary so the blog index, category routes, and post cards can never drift apart.

## The product is one worker

The app is a single Cloudflare Worker built with Vite. Inside it:

- **Hono** handles routing for the API and the MCP endpoint.
- **D1** (Cloudflare's SQLite) is the only database, accessed through Drizzle ORM with versioned migrations in the repo.
- **The SPA** is served from the same worker, so the app and its API share an origin: no CORS, no cookie domain gymnastics, one deploy.

Running close to the database matters for the parts of the product that feel like plumbing but decide whether it's usable: board drag-and-drop, ticket updates, time logging. Each of those is a small request that should complete in the time it takes to paint a frame.

## The MCP server rides along

The MCP endpoint at `app.diatur.com/mcp` is not a separate service. It's a route in the same worker, backed by the same D1 database and the same permission model as the UI. That's why an agent session can span [issues, tickets, deals, and time in one conversation][a]: the agent isn't federating across five vendors; it's talking to one data model.

Scoped API keys, hashed at rest, control what an agent can touch. The same key format works for Claude Code, Cursor, or anything else that speaks MCP over HTTP.

## Why not more services?

A small team's scarcest resource is attention. Microservices spend attention on orchestration; a monorepo with two deployables spends it on the product. When we need a background job, it runs in the worker. When we need a migration, it's a Drizzle file reviewed like any other diff. The repo root holds the whole toolchain (typecheck, lint, format, tests, builds) as Bun filter scripts, so one command validates everything before deploy.

Boring, legible, and cheap to reason about. The same adjectives we'd want customers to use about their own operations, so we hold ourselves to them first.

For the product story, read [why we built Atur][w]. For what an agent can do against this architecture, watch one [run the whole operation][a].

[w]: /blog/why-we-built-atur
[a]: /blog/agent-run-whole-operation

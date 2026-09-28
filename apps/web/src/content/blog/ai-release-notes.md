---
title: "Release notes from done issues: let an agent draft the changelog"
description: "Changelogs stall because writing them is nobody's job. An agent reading the Done column drafts user-facing notes from real issues; a human edits tone, not facts."
pubDate: 2026-09-22
category: "ai"
tags: ["changelog", "ai"]
keywords: ["ai release notes", "changelog generator"]
---

Release notes fail in a predictable way: the release happens, the notes are "coming soon," and the soon becomes never. Not because anyone disagrees that notes matter, but because at release time the people who know what shipped are the people least able to spend an hour writing prose. The knowledge exists in exactly one place — the issues closed since the last release — and is then re-typed by hand from memory, which is both the slow path and the lossy one.

## What an agent does with the Done column

The raw material is already structured: issue titles, the projects they belong to, the tickets that spawned them, the cycle they closed in. An agent reading the tracker turns that into a first draft in under a minute:

- **Grouped by what changed.** Fixes, new things, and breaking changes separated, because the issue's project and labels already say which is which.
- **Written for the user of the feature, not the builder of it.** "Fixed pagination on invoices over 500 rows" becomes "long invoice lists no longer cut off after one page." The translation from implementation to consequence is the actual work of release notes, and it is a language task — the thing models are good at.
- **Traceable.** Each line carries its issue number, so "why is this in the release?" has a one-click answer. If a line cannot name its issue, it does not belong in the notes — which is also a quiet audit of the Done column itself.

The draft is not the notes. It is the notes minus the twenty minutes nobody had: the human pass fixes tone, deletes the two lines that are internal plumbing, and adds the sentence about pricing that marketing wants in. Editing real facts into shape is minutes; inventing facts from memory is the hour that never happens.

## Why it has to read the tracker, not the git log

The commit log tells you what changed in the code. Release notes answer what changed for the customer, and the mapping is not mechanical — a refactor is invisible, a one-line fix behind a flag is the headline. Issues are where that judgment is already recorded: the ticket says "customer could not pay with Amex," which is the sentence the customer needs to read. This is the same argument as [AI ticket triage][t]: the tracker is the system of record, and agents should work from it rather than from adjacent logs.

The habit compounds. When notes are cheap, they get written for every release, and the changelog becomes a running answer to "what does this product do now" — for support drafting replies, for sales answering a prospect, for the team itself six months out.

## The failure to avoid

Fully automated notes, unreviewed, eventually ship an internal codename or an embarrassing admission. The draft-review-publish loop takes five minutes and keeps the changelog in the company's voice; publish-without-reading takes zero minutes and eventually costs more than five. Keep the publish button human.

For where the published notes can live next to the decisions behind them, see [wiki habits that survive growth][w]; for the tool boundary that lets an agent read done issues and draft pages, read [MCP for project management][m].

[t]: /blog/ai-ticket-triage
[w]: /blog/team-wiki-habits
[m]: /blog/mcp-project-management

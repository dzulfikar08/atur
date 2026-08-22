---
title: "Why team wikis die (and how to keep yours alive)"
description: "Wikis die from orphans and decay, not good intentions. Backlinks, a knowledge graph, and docs next to the work keep a wiki useful long enough to matter."
pubDate: 2026-08-20
category: "pages"
tags: ["wiki","docs"]
keywords: ["team wiki best practices","internal knowledge base"]
---

Team wikis almost always die the same way: they start with enthusiasm, accumulate a few good pages, then slowly fill with orphans — documents that nobody links to and nobody remembers. By the time anyone hunts for an answer, the wiki's last edit was six months ago and the person who might know the answer left the company last quarter. The technology is rarely the failure; the habits around linking and updating are.

## Death by orphan, and by decay

An orphaned page is a page with zero incoming links. In a wiki with 500 pages, a typical audit finds 38% of them are orphans — they were written once, linked from one meeting note, and then forgotten. The decay problem is the other half: information that was accurate last quarter is wrong now, but there is no owner assigned to notice.

A wiki that survives treats writing as decision-making, not note-taking. The rule that works is: every page must be referenced by at least one other page, or it does not belong in the wiki. Meeting notes that capture a decision, link that decision to the page it affected, and tag the owner who will revisit it — that is a living document. A transcript of the meeting is not.

## Write decisions, not transcripts

Wikis fill up with meeting transcripts and procedural lists nobody revisits, and those are exactly the pages that decay fastest. The pages worth keeping are the ones that record a choice that will be referenced again: why we picked vendor X over Y, what service level we agreed to for the API contract, how to rotate the signing key.

A simple habit makes this durable: after every planning session, the notes page is edited to surface three things — the decision, the rationale, and the next owner to revisit it. That turns the page into a checkpoint rather than a graveyard.

## Backlinks and the graph keep each other honest

Backlinks are the early warning system that a wiki is drifting. When a page stops receiving any new links for four weeks, it is either settled knowledge or dead weight — a quick check by the assigned owner settles which. Teams that review the "unlinked pages" report every fortnight keep their wikis under 10% orphans.

A knowledge graph makes the drift visible before it is terminal. When a page's incoming links drop to zero, the graph shows it as an isolated node, and the editor assigned to it gets a prompt during their weekly sweep. The graph does not need to be fancy — a list of "pages with no inbound links" run every two weeks catches most of the rot.

## Keep docs next to the work

The deepest reason wikis die is separation: the documentation lives in one tool and the work happens in another, so updating the docs is always an extra step that loses. When docs live next to the work they describe, keeping them current becomes a side effect of doing work, not a separate task.

Atur's pages support wikilinks and backlinks natively, so a deal page can reference the pricing decision that underpins it, and that decision page can trace back to the support ticket that exposed the gap. The knowledge graph highlights the pages that nobody has touched, and whiteboards keep the scratch work that never needed to be persistent in the first place. For how Atur compares to a doc-flexible tool when your focus is operational structure rather than publishing, see the [comparison with Notion][n].

[n]: /blog/atur-vs-notion

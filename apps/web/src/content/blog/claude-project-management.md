---
title: "Claude as a project management frontend: what an MCP tracker changes"
description: "Point Claude at your tracker through MCP and it stops being a chat window: it files, updates, and closes work with the same states your team uses."
pubDate: 2026-09-28
category: "ai"
tags: ["claude", "mcp"]
keywords: ["claude project management", "claude mcp tracker"]
---

Claude is good at reasoning about work and bad at remembering it. Ask it to plan a week and it will produce a sensible plan; ask it tomorrow what happened to item three, and it has no idea, because the plan lived in the chat. Connecting Claude to your project tracker through MCP (Model Context Protocol) closes that gap: the plan, the issues, and the states stop being chat history and become rows a teammate can see.

## What the connection actually is

MCP is a protocol through which Claude discovers tools and calls them: create issue, update state, list tickets, the same operations your teammates do in the UI. A tracker that exposes an MCP server gives Claude a live view of the board instead of a pasted screenshot of it. The conversation becomes one client among many, not a separate place where work goes to be summarized.

The practical difference shows up in what Claude can be asked. Without a connection, "what should we cut from this cycle?" produces a generic essay about prioritization. With one, Claude reads the actual cycle: ages of the issues, what is blocked by what, which tickets have been waiting on a reply, and answers with the board's own rows, then moves them when you agree.

## Three working setups

- **Planning partner.** Claude reads the backlog and the current cycle, drafts the next cycle split by theme, and flags anything with no owner. A human drags the two or three items it got wrong; the other forty were going to be proposed by a person anyway.
- **Standing queries.** "What changed since yesterday?" "Which issues have been in review more than three days?" "Summarize everything blocking the billing migration." These are answered from live state, and the answer is the same one a teammate would get opening the board.
- **Filing as you think.** Half-formed thoughts become issues in the right project with a state and an owner while the conversation is still happening. The failure mode of note-taking (ideas that never become rows) disappears because the row is one tool call away.

## Where it goes wrong

The failure mode is not hallucinated rows; it is confident motion. An agent told to "clean up the backlog" will archive things no human would have archived, at the speed of token generation. Two habits keep this small. First, scope the key: an API key limited to one project cannot clean up the other five. Second, start read-plus-draft: Claude proposes states and drafts issues, a human applies them, before granting write access to anything. Teams that skip the draft phase tend to spend a week re-creating deleted items and then skip it forever after.

The other trap is treating Claude as the system of record. It is not. If a decision lives only in the chat, it does not exist; the decision goes into an issue or a page, and the chat is just where the typing happened.

## What to look for in a tracker

For this to work, the tracker has to expose the same state model over MCP that the UI uses, not a reduced read-only API. Check that the tools cover create and update on the objects you use, that API keys can be scoped per project, and that actions an agent takes look identical to actions a human takes, so the audit trail is one history rather than two.

Atur ships a built-in MCP server with 70+ tools across issues, tickets, deals, time entries, and pages, with scoped keys per project. For the broader argument, read [MCP for project management][m]; for the discipline that keeps an agent-driven board sane, see [how WIP limits keep work moving][k].

[m]: /blog/mcp-project-management
[k]: /blog/kanban-wip-limits

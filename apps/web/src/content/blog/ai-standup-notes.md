---
title: "AI standup notes, written from the board instead of memory"
description: "An agent that reads your tracker can write the standup: what moved, what is stuck, what needs a decision. The human meeting is for the third one."
pubDate: 2026-09-23
category: "ai"
tags: ["standup", "ai"]
keywords: ["ai standup notes", "standup generator"]
---

Most standup time is spent narrating the past. What did I do yesterday, what am I doing today: information the tracker already has, delivered from memory, worse, one voice at a time. The part of the meeting that deserves humans is the part memory cannot produce: what is stuck and who unblocks it. That is also the part an AI standup note handles well, because "what is stuck" is a query, not a recollection.

## What the agent writes

A standup note generated from live tracker state has three sections, and the first two are basically free:

- **Moved.** Issues that changed state since the last note, with who moved them. This replaces the recited list, and unlike the recited list it does not forget the thing that got done Wednesday.
- **Stuck.** Issues with no state change in N days, blocked relations, and items waiting on a reply: in review for four days, waiting on customer for a week. This is the section a standup exists to surface, and it is the one humans reliably under-report because "it's still on my plate" feels like status.
- **Decisions needed.** The one or two items where the note says what it cannot know: the deploy is waiting on a call with the vendor; two issues want the same person tomorrow.

The third section is why the meeting survives. A note that ends with "needs a decision" gives the meeting an agenda; a meeting without one is twelve minutes of narration that a query already answered.

## Why memory-based standups rot

The alternative (asking an AI to summarize what everyone typed in a chat) inherits the chat's problems: status lives in prose, in twelve places, with no state attached. The note is only as good as the typing, and the typing is a tax on the same people the standup was meant to unblock. Generating from the tracker inverts the flow: do the work where the state lives, and the note is a read, not a write.

There is a second-order benefit. Once "what is stuck" is a query that runs every morning, it also runs on days nobody calls a meeting, and the pattern of _what gets stuck_ (reviews, waiting-on-customer, anything owned by the absent teammate) becomes visible over weeks. That is the input to fixing the bottleneck instead of reporting it daily.

## Keep the human in the loop

The agent's note is a draft with a small blast radius: it goes to the team, not to a customer, so this is one place where full automation is defensible. Even so, the writer should be named: a note from the agent, visibly from the agent, that anyone can query follow-ups ("how long has X been in review?") because the agent still has the board open. The failure to avoid is the silent note: a message nobody can interrogate, whose numbers nobody can trace back to rows.

For the board discipline the note depends on (stale states are lies in, garbage out), read [how WIP limits keep work moving][k]. For the plumbing that lets an agent read states and relations directly, see [MCP for project management][m], and for the crew pattern of many agents reporting into one tracker, [project management for AI agent crews][c].

[k]: /blog/kanban-wip-limits
[m]: /blog/mcp-project-management
[c]: /blog/project-management-for-ai-agents

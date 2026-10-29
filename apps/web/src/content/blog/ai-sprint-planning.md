---
title: "AI sprint planning: draft the cycle, keep the human veto"
description: "An agent can propose a cycle from your backlog in seconds: capacity, themes, risks. The judgment about what matters stays human; the assembly was never the job."
pubDate: 2026-09-24
category: "projects"
tags: ["sprint", "ai"]
keywords: ["ai sprint planning", "ai backlog grooming"]
---

Sprint planning meetings have an assembly problem disguised as a judgment problem. A large part of the meeting is mechanical: pull the top of the backlog, check who is out, count the days, slot in the carry-over, notice that three items depend on the same person. The judgment (what actually matters this cycle) is real but usually takes ten minutes of a sixty-minute meeting. The rest is assembling facts the tracker already knows.

## What the agent proposes

Given the backlog, last cycle's outcomes, and the team's actual pace, an agent drafts the cycle:

- **A cut that fits reality.** Capacity from the calendar (two people out Thursday and Friday) crossed with the team's median cycle time per issue size, not the aspirational velocity everyone agrees to and then misses.
- **Themes instead of a heap.** Ten unrelated tickets is a to-do list; a cycle with two themes is a plan. The agent groups the top backlog by outcome and proposes the grouping, which is the step planning meetings skip under time pressure.
- **The warnings.** Carry-over that has slipped three cycles, items blocked by the same external dependency, the issue assigned to the person already at capacity. Every planning meeting has one person whose job is noticing these; the agent notices them all, every time, without social cost.

The draft takes seconds, which changes the meeting it precedes: humans arrive reacting to a concrete proposal instead of assembling one. Reactions are fast; assembly from cold is what eats the hour.

## The veto is the job

What the agent cannot know is the same thing it could never know: the deal that just changed, the customer who is quietly furious, the engineer who needs one easy week. Planning is where the team's private context meets the backlog, and that meeting is the veto. The workable split is blunt: the agent assembles and warns, humans choose. A cycle where every item arrived via agent and left via human decision is a fast cycle; a cycle where the agent also decided is a backlog with better formatting.

The same split holds for grooming between cycles. Agents are good at the continuous version of planning hygiene: splitting oversized issues, flagging stale estimates, proposing reassignments, because each action is small and reviewable as a diff. Batch them into a weekly proposal rather than live-editing the backlog; a PR-sized change is reviewable, a rolling one is not.

## What the tracker owes the agent

None of this works over a read-only API. The agent needs relations (what blocks what), history (how long this kind of issue actually takes), and write access scoped to the cycle draft, so the worst outcome is a bad proposal, not a mangled backlog. Atur's cycles, states, and relations are all exposed through its [built-in MCP server][m], which is what makes the draft-veto loop a Tuesday habit instead of a demo.

For the board mechanics a proposed cycle lands on, read [how WIP limits keep work moving][k]; for the crew-level version (many agents, one tracker, humans reviewing diffs), see [project management for AI agent crews][c].

[k]: /blog/kanban-wip-limits
[m]: /blog/mcp-project-management
[c]: /blog/project-management-for-ai-agents

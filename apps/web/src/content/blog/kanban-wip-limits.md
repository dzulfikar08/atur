---
title: "WIP limits: the kanban habit that keeps work moving"
description: "Work-in-progress limits sound restrictive, but they are how teams finish faster. A practical guide to setting, enforcing, and tuning WIP limits on a kanban board."
pubDate: 2026-08-18
category: "projects"
tags: ["kanban", "workflow"]
keywords: ["kanban wip limits", "work in progress limits", "limit work in progress"]
---

Most kanban boards die the same quiet death. Work flows in from every
direction, every column fills up, and the board becomes a wall of sticky notes
nobody wants to look at. Plenty is _in progress_ — almost nothing is _done_.
Cycle time creeps up, blockers hide in plain sight, and the team's calendar
fills with status meetings that exist only to compensate for a board no one
trusts.

Work-in-progress (WIP) limits are the single habit that prevents this. They
sound like a constraint on the team. In practice they are the opposite: a
mechanism that forces finishing over starting.

## What a WIP limit actually is

A WIP limit is a maximum number of items allowed in a column (or across the
whole board) at once. When the column is full, nobody pulls new work into it.
The rule is blunt on purpose: an over-full column is not a scheduling problem,
it is a signal — of a bottleneck, unclear acceptance criteria, or too much
parallel work for the team's capacity.

The effect is that attention concentrates. Instead of twelve items each
getting a small slice of everyone's week, three items get finished. Lead time
— the number customers and stakeholders actually feel — drops, even though
total throughput stays the same or improves.

## How to pick a number

Don't overthink the starting value. Rules of thumb that work:

- **Per column: number of people who work in that stage, plus one.** A "In
  review" column with two reviewers gets a limit of 2–3.
- **Whole board: roughly 1.5 × team size.** A team of four starts with a
  board-wide limit around six items.
- **Start lower than feels comfortable.** If the limit never bites, it isn't
  doing anything. You want it to occasionally say "no".

The limit is not a promise about velocity. It's a pressure gauge. A column
that sits at its limit for days is telling you exactly where work gets stuck —
that's the diagnostic you bought by setting the limit.

## What to do when you hit the limit

This is where most teams waver, so decide the policy up front:

1. **Swarm.** The whole team helps clear the bottleneck instead of starting
   something new. Two people pairing on a stuck review clears it faster than
   both working separately.
2. **Surface the blocker.** If the item is stuck for an external reason, move
   it to a Blocked state with a note. A blocked item doesn't count against the
   limit — hiding it in "In Progress" does.
3. **Finish, don't start.** The one thing you may _not_ do is pull new work
   into a full column. Every workaround that violates this turns the limit
   into decoration.

## Failure modes to watch for

- **Column inflation.** When a team keeps hitting limits, the tempting fix is
  adding "In Progress 2" or "Almost Done". That's cheating the metric. If a
  limit is genuinely too tight, raise it deliberately — don't route around it.
- **Infinite "done-ish" states.** An item isn't done until a customer could
  use it. Done-ish states are where WIP goes to hide.
- **Limits without ownership.** If nobody feels allowed to say "the column is
  full, help me clear it", the limit is a wall chart, not a working agreement.

## Tune on a cadence

Review limits every few weeks with the team, not top-down. Two questions are
enough: _which column was full most often?_ and _where did items wait the
longest?_ The answers tell you whether to adjust a limit, fix an upstream
problem (unclear specs? slow reviews?), or add capacity to a genuine
bottleneck.

Boards in Atur support custom states per project — so a Blocked state that
keeps WIP honest costs nothing to set up, and limits pair naturally with
[cycles][c] when your team is ready for a timeboxed rhythm. If you're coming
from a tool where every card sat in one giant "In Progress" column, the
[workflow section of our landing page][wf] shows how states, projects, and
cycles fit together in one board.

Start with one limit on your worst column. One week of "finish over start" is
usually enough to sell the team on the rest. Once the board tells the truth,
an agent can read it: [AI standup notes][s] are written from that state, and
[AI sprint planning][sp] drafts the cycle from it.

[c]: /blog/helpdesk-metrics-that-matter
[wf]: /#mcp
[s]: /blog/ai-standup-notes
[sp]: /blog/ai-sprint-planning

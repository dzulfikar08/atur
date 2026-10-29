---
title: "Tracking billable hours without hating your timesheet"
description: "Friday-memory timesheets overbill some projects and underbill others. Contemporaneous logging, increments, and project-level reports fix it."
pubDate: 2026-08-19
category: "time"
tags: ["time-tracking", "billing"]
keywords: ["how to track billable hours", "billable hours best practices"]
---

The reason people hate their timesheet is not the interface: it is the memory problem. By Friday, a developer who spent three sprints on a feature remembers two big blocks of work and one interruption, and fills the gaps with whatever sounds reasonable. The result is a timesheet that bills the wrong projects, rewards busy work, and turns time tracking into an adversarial ritual between billing and delivery.

The fix is to stop reconstructing the week and start recording the day. Time tracking works best when it captures work in the moment, ties entries to the actual work items people are touching, and reports at the level where decisions get made: the project, not the person.

## Log contemporaneously, not retrospectively

Entries written hours after the work are close to guesswork. Entries written at the moment (or within thirty minutes of stopping) are accurate enough to bill from. A team that logs per work item as it goes sees fewer than 2% of entries requiring a correction, against 18% for teams that reconcile on Friday.

The practical setup is to tie each entry to a real object: an issue, a ticket, or a deal. When an engineer closes a support-linked issue, the time spent lands on that ticket automatically. When a designer blocks time for a client review, it lands on the open deal. The habit forms naturally when logging is a side effect of doing work, not a separate chore.

## Rounding and increments that people can live with

Precision below the granularity of real decisions is theater. A firm that bills to the minute spends more time rounding debates than client calls. The sane default is a 6- or 15-minute increment with a consistent rounding policy: round down to the nearest increment if under half, up if over.

Some clients push back on increments above five minutes, which is reasonable for hourly retainers but not for fixed-scope work. For fixed scope, track in 15-minute blocks for visibility and invoice flat. The increment is a ceiling, not a minimum: it should never inflate an honest two-minute fix into a billable slot.

## Billable vs non-billable, honestly

Non-billable work (planning, learning, internal meetings) is real work and should be measured so a team can argue for capacity honestly. But it must be separated cleanly from billable time so invoices do not accidentally include it.

A common split: client calls, direct client deliverables, and client-requested revisions are billable; discovery that surfaces product gaps, training, and maintenance under a retainer are non-billable. Whatever the policy, apply it consistently for thirty days, then publish the ratio. Most teams are surprised to learn that 20% to 30% of logged time lands in the non-billable bucket, and that the share is stable once the definitions are clear.

## Reports per project, not per person

Individual hour reports answer "who worked how much," which is useful for utilization but useless for billing. Project-level reports answer "what was spent against what," which is what clients and leadership need.

Atur keeps per-issue time entries in the same workspace as the boards, so a completed milestone's cost falls out of the issues that fed it: no copy-pasting between systems. One-click CSV export makes month-end reconciliation trivial: the same view that a project manager uses to spot a slipping schedule can feed the books team's spreadsheet. For the discipline that keeps those issues flowing steadily, see [WIP limits on a kanban board][k].

[k]: /blog/kanban-wip-limits

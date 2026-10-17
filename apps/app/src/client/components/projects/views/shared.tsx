import { format, parseISO } from "date-fns";
import type { Issue, State } from "@/lib/api";
import {
  badgeGroup,
  dueBucket,
  productOf,
  stateKeyOf,
  type DueRef,
  type QueryState,
} from "@/lib/issueQuery";
import { productColor } from "@/lib/product";

type Assignee = NonNullable<Issue["assignees"]>[number] & {
  is_bot?: number | boolean | null;
};

/** Issue as the project views see it (lean list row + optional bot flag / decision flag). */
export type ViewIssue = Omit<Issue, "assignees"> & {
  assignees?: Assignee[];
  is_decision?: boolean | number | null;
};

export type ViewState = State & { key?: string | null };

export interface ViewContext {
  states: ViewState[];
  stateById: Map<string, QueryState>;
  dueRef: DueRef;
}

export const issueHref = (slug: string, projectId: string, issue: Issue) =>
  `/${slug}/projects/${projectId}/issues/${issue.sequence_id}`;

export function ProductChip({ name }: { name: string }) {
  const product = productOf(name);
  if (!product) return null;
  return (
    <span
      className="product-chip"
      style={{ "--badge-c": productColor(product) } as React.CSSProperties}
    >
      {product}
    </span>
  );
}

export function PriorityDot({ priority }: { priority: string | null }) {
  const p = priority || "none";
  return <span className="priority-dot" data-priority={p} title={`Priority: ${p}`} />;
}

export function StateBadge({ issue, ctx }: { issue: ViewIssue; ctx: ViewContext }) {
  const st = issue.state_id ? ctx.stateById.get(issue.state_id) : undefined;
  const name = st?.name ?? issue.state?.name;
  if (!name) return <span className="text-xs text-muted-foreground">—</span>;
  const key = stateKeyOf(issue, ctx.stateById);
  const group = st?.group ?? issue.state?.group;
  return (
    <span className="state-badge" data-state-group={badgeGroup(key, group)}>
      {name}
    </span>
  );
}

const sameYear = (d: Date) => d.getFullYear() === new Date().getFullYear();

/** "Oct 16", red when overdue, amber when due today. Empty when undated. */
export function DueLabel({ issue, ctx }: { issue: ViewIssue; ctx: ViewContext }) {
  if (!issue.target_date) return <span className="text-xs text-muted-foreground/60">—</span>;
  const d = parseISO(issue.target_date.slice(0, 10));
  const bucket = dueBucket(issue, ctx.dueRef, ctx.stateById);
  const tone =
    bucket === "overdue"
      ? "text-[var(--priority-urgent)] font-medium"
      : bucket === "today"
        ? "text-[var(--state-amber)] font-medium"
        : "text-muted-foreground";
  return (
    <span
      className={`text-xs tabular-nums ${tone}`}
      title={bucket === "overdue" ? "Overdue" : undefined}
    >
      {format(d, sameYear(d) ? "MMM d" : "MMM d, yyyy")}
    </span>
  );
}

export const assigneeName = (a: { display_name?: string; username?: string; email?: string }) =>
  a.display_name || a.username || a.email || "?";

export function Avatars({ issue }: { issue: ViewIssue }) {
  const list = issue.assignees ?? [];
  if (list.length === 0) return <span className="text-xs text-muted-foreground/60">—</span>;
  return (
    <div className="flex -space-x-1.5">
      {list.slice(0, 3).map((a) => (
        <span
          key={a.id}
          title={assigneeName(a)}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-muted text-xs font-medium text-muted-foreground"
        >
          {assigneeName(a).charAt(0).toUpperCase()}
        </span>
      ))}
      {list.length > 3 && (
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-background bg-muted text-xs text-muted-foreground">
          +{list.length - 3}
        </span>
      )}
    </div>
  );
}

export function LabelChips({ issue, max = 2 }: { issue: ViewIssue; max?: number }) {
  const labels = issue.labels ?? [];
  if (labels.length === 0) return null;
  return (
    <span className="flex items-center gap-1">
      {labels.slice(0, max).map((l) => (
        <span
          key={l.id}
          className="inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-xs text-muted-foreground"
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: l.color || "var(--state-backlog)" }}
          />
          {l.name}
        </span>
      ))}
      {labels.length > max && (
        <span className="text-xs text-muted-foreground">+{labels.length - max}</span>
      )}
    </span>
  );
}

/** "now", "5m", "3h", "3d", "2w", "4mo". Future timestamps read as "now". */
export function shortAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}

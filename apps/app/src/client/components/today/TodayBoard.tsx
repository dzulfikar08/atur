import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { toast } from "sonner";
import { ArrowRight, Check, ChevronDown, ChevronRight } from "@/lib/icons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, type AllIssue } from "@/lib/api";
import { cn } from "@/lib/utils";
import { stateColor } from "@/lib/issueColors";
import { productColor, splitProduct } from "@/lib/product";
import {
  BUCKETS,
  doneStateOf,
  issueKey,
  issueLink,
  removeFromToday,
  useIssuePatch,
  useProjectStates,
  useToday,
  type KeyedState,
  type TodayBucketKey,
} from "@/hooks/useMyWork";

const BUCKET_META: Record<TodayBucketKey, { label: string; color: string; hint: string }> = {
  overdue: {
    label: "Overdue",
    color: "var(--priority-urgent)",
    hint: "Past target date",
  },
  due_today: {
    label: "Due today",
    color: "var(--state-amber)",
    hint: "Target is today",
  },
  needs_you: {
    label: "Needs You",
    color: "var(--state-needs-you)",
    hint: "Waiting on you",
  },
  need_review: {
    label: "Need Review",
    color: "var(--state-review)",
    hint: "Ready for review",
  },
  in_progress: {
    label: "In progress today",
    color: "var(--state-started)",
    hint: "Started, not yet due",
  },
  due_this_week: {
    label: "Upcoming 7 days",
    color: "var(--state-backlog)",
    hint: "Due within a week",
  },
};

const PREVIEW_ROWS = 8;
const PRODUCT_ORDER = ["JoyoRogo", "JoyoFit", "Both", "Threads"];

function dueLabel(target: string | null, today: Date): { text: string; late: boolean } | null {
  if (!target) return null;
  const date = parseISO(target.slice(0, 10));
  const diff = differenceInCalendarDays(date, today);
  if (diff < 0) return { text: `${-diff}d late`, late: true };
  if (diff === 0) return { text: "Today", late: false };
  if (diff === 1) return { text: "Tomorrow", late: false };
  return { text: format(date, diff < 7 ? "EEE" : "MMM d"), late: false };
}

function StateOptions({ issue, onPick }: { issue: AllIssue; onPick: (s: KeyedState) => void }) {
  const { data: states = [] } = useProjectStates(issue.workspace_slug, issue.project_id);
  if (states.length === 0) {
    return <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading states…</div>;
  }
  return (
    <>
      {states.map((s) => (
        <DropdownMenuItem key={s.id} onSelect={() => onPick(s)} className="gap-2 text-[13px]">
          <span className="size-2 rounded-full" style={{ background: stateColor(s) }} />
          <span className="flex-1">{s.name}</span>
          {s.id === issue.state_id && <Check className="size-3.5" />}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function IssueRow({ issue, compact }: { issue: AllIssue; compact: boolean }) {
  const qc = useQueryClient();
  const patch = useIssuePatch();
  const today = useMemo(() => new Date(), []);
  const { product, title } = splitProduct(issue.name);
  const due = dueLabel(issue.target_date, today);

  const apply = (body: Parameters<typeof patch.mutate>[0]["patch"], message: string) => {
    removeFromToday(qc, issue.id);
    patch.mutate({ issue, patch: body }, { onSuccess: () => toast.success(message) });
  };

  const markDone = async () => {
    try {
      const states = await qc.fetchQuery({
        queryKey: ["states", issue.workspace_slug, issue.project_id],
        queryFn: () => api.listStates(issue.workspace_slug, issue.project_id),
      });
      const done = doneStateOf(states as KeyedState[]);
      if (!done) return void toast.error("This project has no Done state");
      apply({ state_id: done.id }, `Done: ${title}`);
    } catch {
      toast.error("Failed to update issue");
    }
  };

  const tomorrow = format(addDays(today, 1), "yyyy-MM-dd");
  const actionVisibility = compact
    ? ""
    : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";

  return (
    <div className="group flex min-h-10 items-center gap-2.5 border-t border-border px-3 py-1.5 first:border-t-0 hover:bg-[var(--surface-card-hover)]">
      <span
        className="priority-dot"
        data-priority={issue.priority ?? "none"}
        title={`Priority: ${issue.priority ?? "none"}`}
      />
      {product && (
        <span
          className="product-chip shrink-0"
          style={{ "--badge-c": productColor(product) } as React.CSSProperties}
        >
          {product}
        </span>
      )}
      <Link
        to={issueLink(issue)}
        className="min-w-0 flex-1 truncate text-[length:var(--text-row)] font-medium text-foreground hover:underline"
        title={issue.name}
      >
        {title}
      </Link>
      {!compact && (
        <span className="hidden w-[76px] shrink-0 font-ops-mono text-[length:var(--text-meta)] text-muted-foreground lg:inline">
          {issueKey(issue)}
        </span>
      )}
      {(due || !compact) && (
        <span
          className={cn(
            "shrink-0 text-right text-[length:var(--text-meta)] tabular-nums",
            !compact && "w-16",
            due?.late ? "font-semibold text-[var(--priority-urgent)]" : "text-muted-foreground",
          )}
        >
          {due?.text}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "state-badge shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            !compact && "w-[108px]",
          )}
          style={{ "--badge-c": stateColor(issue.state) } as React.CSSProperties}
          aria-label={`Change state (currently ${issue.state?.name ?? "none"})`}
        >
          {issue.state?.name ?? "No state"}
          <ChevronDown className="ml-auto size-3 opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <StateOptions
            issue={issue}
            onPick={(s) => apply({ state_id: s.id }, `Moved to ${s.name}`)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <div
        className={cn("flex shrink-0 items-center gap-0.5 transition-opacity", actionVisibility)}
      >
        <button
          onClick={markDone}
          title="Mark done"
          aria-label="Mark done"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-[var(--state-completed)]"
        >
          <Check className="size-4" />
        </button>
        <button
          onClick={() => apply({ target_date: tomorrow }, "Moved to tomorrow")}
          title="Snooze to tomorrow"
          aria-label="Snooze to tomorrow"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

function Bucket({
  bucket,
  issues,
  compact,
}: {
  bucket: TodayBucketKey;
  issues: AllIssue[];
  compact: boolean;
}) {
  const meta = BUCKET_META[bucket];
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  if (issues.length === 0) return null;
  const rows = all ? issues : issues.slice(0, PREVIEW_ROWS);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-[var(--surface-elevated)]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Chevron className="size-3.5 text-muted-foreground" />
        <span className="size-2 rounded-full" style={{ background: meta.color }} />
        <h2 className="text-sm font-semibold text-foreground">{meta.label}</h2>
        <span
          className="rounded-full px-1.5 text-[length:var(--text-meta)] font-semibold tabular-nums"
          style={{
            color: meta.color,
            background: `color-mix(in oklab, ${meta.color} 14%, transparent)`,
          }}
        >
          {issues.length}
        </span>
        <span className="hidden text-[length:var(--text-meta)] text-muted-foreground sm:inline">
          {meta.hint}
        </span>
      </button>
      {open && (
        <div className="border-t border-border">
          {rows.map((issue) => (
            <IssueRow key={issue.id} issue={issue} compact={compact} />
          ))}
          {issues.length > PREVIEW_ROWS && (
            <button
              onClick={() => setAll((a) => !a)}
              className="w-full border-t border-border px-3 py-1.5 text-left text-[length:var(--text-meta)] font-medium text-muted-foreground hover:bg-[var(--surface-card-hover)] hover:text-foreground"
            >
              {all ? "Show fewer" : `Show ${issues.length - PREVIEW_ROWS} more`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default function TodayBoard({ slug, compact = false }: { slug: string; compact?: boolean }) {
  const { data, isPending, isError } = useToday(slug);
  const [params, setParams] = useSearchParams();
  const product = params.get("product");

  const productCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (data) {
      for (const key of BUCKETS) {
        for (const issue of data[key]) {
          const p = splitProduct(issue.name).product;
          if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort(([a], [b]) => {
      const ia = PRODUCT_ORDER.indexOf(a);
      const ib = PRODUCT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const out = {} as Record<TodayBucketKey, AllIssue[]>;
    for (const key of BUCKETS) {
      out[key] = product
        ? data[key].filter((i) => splitProduct(i.name).product === product)
        : data[key];
    }
    return out;
  }, [data, product]);

  const setProduct = (next: string | null) => {
    const copy = new URLSearchParams(params);
    if (next) copy.set("product", next);
    else copy.delete("product");
    setParams(copy, { replace: true });
  };

  const total = filtered ? BUCKETS.reduce((n, k) => n + filtered[k].length, 0) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Today</h1>
          <p className="text-[length:var(--text-meta)] text-muted-foreground">
            {format(new Date(), "EEEE, MMMM d")}
          </p>
        </div>
        {filtered && (
          <div className="flex flex-wrap items-center gap-1.5">
            {BUCKETS.filter((k) => filtered[k].length > 0).map((k) => (
              <span
                key={k}
                className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border px-2 text-[length:var(--text-meta)] text-muted-foreground"
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: BUCKET_META[k].color }}
                />
                {BUCKET_META[k].label}
                <b className="font-semibold tabular-nums text-foreground">{filtered[k].length}</b>
              </span>
            ))}
          </div>
        )}
      </header>

      {productCounts.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by product"
        >
          <button
            onClick={() => setProduct(null)}
            aria-pressed={!product}
            className={cn(
              "h-6 rounded-md border px-2 text-[length:var(--text-meta)] font-medium transition-colors",
              !product
                ? "border-foreground/30 bg-accent text-foreground"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
          >
            All
          </button>
          {productCounts.map(([name, n]) => (
            <button
              key={name}
              onClick={() => setProduct(product === name ? null : name)}
              aria-pressed={product === name}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[length:var(--text-meta)] font-medium transition-colors",
                product === name
                  ? "border-foreground/30 bg-accent text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              <span className="size-1.5 rounded-full" style={{ background: productColor(name) }} />
              {name}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
      )}

      {isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
          Could not load today's work. Reload to try again.
        </p>
      ) : total === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">Nothing scheduled for today</p>
          <p className="mt-1 text-[length:var(--text-meta)] text-muted-foreground">
            Issues assigned to you with a start or target date show up here.
          </p>
          <Link
            to={`/${slug}/issues`}
            className="mt-3 inline-flex h-8 items-center rounded-md border border-border px-3 text-[13px] font-medium text-foreground hover:bg-accent"
          >
            Open My Issues
          </Link>
        </div>
      ) : (
        BUCKETS.map((k) => <Bucket key={k} bucket={k} issues={filtered![k]} compact={compact} />)
      )}
    </div>
  );
}

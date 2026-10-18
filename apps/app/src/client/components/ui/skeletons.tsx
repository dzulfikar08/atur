import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

/** Fixed-height rows that match the 36px list density, so loading never jumps. */
export function ListSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("divide-y divide-border rounded-lg border", className)} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 px-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 flex-1" style={{ maxWidth: `${60 - (i % 4) * 8}%` }} />
          <Skeleton className="h-4 w-16 rounded-md" />
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}

/** Board-shaped placeholder: a few columns of cards. */
export function BoardSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden" aria-busy="true">
      {Array.from({ length: columns }, (_, c) => (
        <div key={c} className="w-[280px] shrink-0 space-y-2">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 3 - (c % 2) }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Issue detail placeholder: header, title, description, and the properties rail. */
export function IssueDetailSkeleton() {
  return (
    <div
      className="-m-4 flex h-[calc(100dvh-7rem)] flex-col md:-m-6 md:h-[calc(100dvh-3.5rem)] lg:-m-8"
      aria-busy="true"
      aria-label="Loading issue"
    >
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-4 p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
        <div className="hidden w-[45%] shrink-0 space-y-3 border-l p-4 md:block">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/** Empty state with an optional call to action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-[var(--surface-elevated)] px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="text-sm font-semibold">{title}</p>
      {description ? (
        <p className="max-w-sm text-[0.8125rem] text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

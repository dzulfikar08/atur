import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";

interface MobileIssueCardProps {
  issue: {
    id: string;
    name: string;
    sequence_id: number;
    state_id: string | null;
    priority: string | null;
    created_at: string;
    updated_at: string;
    project_id?: string;
    project_name?: string;
    workspace_name?: string;
    state?: { id: string; name: string; color?: string; group: string } | null;
    labels?: { id: string; name: string; color?: string }[];
    assignees?: {
      id: string;
      email?: string;
      username?: string;
      display_name?: string;
      avatar?: string | null;
    }[];
  };
  slug: string;
  projectId?: string;
  states?: { id: string; name: string; group: string }[];
  /** Nesting depth — 0 = top-level, 1+ = sub-issue. */
  depth?: number;
  /** Number of sub-issues under this card. */
  childCount?: number;
  /** True when the parent is not visible (filtered out) but the row is a sub-issue. */
  isSubIssue?: boolean;
}

export default function MobileIssueCard({
  issue,
  slug,
  projectId,
  states,
  depth = 0,
  childCount = 0,
  isSubIssue = false,
}: MobileIssueCardProps) {
  const navigate = useNavigate();
  const state = issue.state ?? states?.find((s) => s.id === issue.state_id) ?? null;
  const group = state?.group || "backlog";

  const targetProjectId = projectId || issue.project_id;

  return (
    <button
      className="w-full text-left rounded-xl border bg-card p-3.5 active:bg-muted/50 transition-colors"
      onClick={() => {
        if (targetProjectId) {
          navigate(`/${slug}/projects/${targetProjectId}/issues/${issue.sequence_id}`);
        }
      }}
    >
      <div className="flex items-start gap-3">
        {/* State dot */}
        <span className="state-dot mt-1.5 !h-2.5 !w-2.5" data-state-group={group} />

        <div className="flex-1 min-w-0">
          {/* Title — sub-issues indent with a ↳ marker, parents show a sub-count */}
          <div
            className="flex items-start gap-1.5"
            style={{ marginLeft: depth * 16 + (isSubIssue && depth === 0 ? 16 : 0) }}
          >
            {depth > 0 || isSubIssue ? (
              <span className="text-sm leading-tight text-muted-foreground/60 select-none shrink-0">
                ↳
              </span>
            ) : null}
            <p className="text-sm font-medium leading-tight line-clamp-2 flex-1 min-w-0">
              {issue.name}
            </p>
            {childCount > 0 && (
              <Badge variant="secondary" className="text-xs h-4 px-1.5 shrink-0">
                {childCount} sub
              </Badge>
            )}
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground font-mono">
              {String(issue.sequence_id).padStart(4, "0")}
            </span>

            {state && (
              <Badge variant="secondary" className="text-xs h-4 px-1.5">
                {state.name}
              </Badge>
            )}

            {issue.priority && issue.priority !== "none" && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="priority-dot !h-1.5 !w-1.5" data-priority={issue.priority} />
                {issue.priority}
              </span>
            )}

            {issue.project_name && (
              <span className="text-xs text-muted-foreground truncate">{issue.project_name}</span>
            )}
            {issue.workspace_name && (
              <span className="text-xs text-muted-foreground/70 truncate">
                {issue.workspace_name}
              </span>
            )}
          </div>

          {issue.labels && issue.labels.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {issue.labels.slice(0, 2).map((l) => (
                <Badge
                  key={l.id}
                  variant="outline"
                  className="text-xs h-4 px-1.5"
                  style={{ borderColor: l.color || undefined }}
                >
                  {l.name}
                </Badge>
              ))}
              {issue.labels.length > 2 && (
                <span className="text-xs text-muted-foreground">+{issue.labels.length - 2}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

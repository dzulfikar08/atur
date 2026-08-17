import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
}

const STATE_DOT_COLORS: Record<string, string> = {
  backlog: "bg-gray-400",
  unstarted: "bg-blue-400",
  started: "bg-yellow-400",
  completed: "bg-emerald-400",
  cancelled: "bg-red-400",
  triage: "bg-purple-400",
};

const PRIORITY_DOTS: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
  none: "bg-gray-300",
};

export default function MobileIssueCard({ issue, slug, projectId, states }: MobileIssueCardProps) {
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
        <div className={cn("h-2.5 w-2.5 rounded-full mt-1.5 shrink-0", STATE_DOT_COLORS[group])} />

        <div className="flex-1 min-w-0">
          {/* Title */}
          <p className="text-sm font-medium leading-tight line-clamp-2">{issue.name}</p>

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground font-mono">
              {String(issue.sequence_id).padStart(4, "0")}
            </span>

            {state && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {state.name}
              </Badge>
            )}

            {issue.priority && issue.priority !== "none" && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    PRIORITY_DOTS[issue.priority] || PRIORITY_DOTS.none,
                  )}
                />
                {issue.priority}
              </span>
            )}

            {issue.project_name && (
              <span className="text-[10px] text-muted-foreground truncate">
                {issue.project_name}
              </span>
            )}
            {issue.workspace_name && (
              <span className="text-[10px] text-muted-foreground/70 truncate">
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
                  className="text-[9px] h-4 px-1.5"
                  style={{ borderColor: l.color || undefined }}
                >
                  {l.name}
                </Badge>
              ))}
              {issue.labels.length > 2 && (
                <span className="text-[10px] text-muted-foreground">
                  +{issue.labels.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

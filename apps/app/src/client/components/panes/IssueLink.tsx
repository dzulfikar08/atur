import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type AgentSession } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link2 } from "@/lib/icons";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<AgentSession["state"], string> = {
  working: "working",
  done: "done",
  blocked: "needs you",
  idle: "idle",
  unknown: "linked",
};

/** Pane id -> the agent session linked to it, refreshed with the pane list. */
export function useAgentSessions() {
  const query = useQuery({
    queryKey: ["agent-sessions"],
    queryFn: api.listAgentSessions,
    refetchInterval: 10_000,
  });
  const byPane = new Map<string, AgentSession>();
  for (const s of query.data ?? []) byPane.set(s.pane_id, s);
  return byPane;
}

/** In-app path of the linked issue (the sequence number is the key's tail). */
export function issuePath(session: AgentSession): string {
  const seq = session.issue.key.slice(session.issue.key.lastIndexOf("-") + 1);
  return `/${session.issue.workspace_slug}/projects/${session.issue.project_id}/issues/${seq}`;
}

/** Key, title and state of a pane's issue. Plain text: Panes cards are links themselves. */
export function IssueSummary({ session }: { session: AgentSession }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-ops-mono text-[11.5px] leading-[17px]">
      <span className="shrink-0 font-semibold text-foreground">{session.issue.key}</span>
      <span className="truncate text-muted-foreground">{session.issue.name}</span>
      <span
        className={cn(
          "ml-auto shrink-0 text-[10.5px] font-semibold",
          session.state === "blocked" ? "text-[var(--state-amber)]" : "text-muted-foreground",
        )}
      >
        {STATE_LABEL[session.state]}
      </span>
    </span>
  );
}

/** Link to the issue a pane works on, plus a popover to link a pane to an issue by hand. */
export function PaneIssue({ paneId, session }: { paneId: string; session?: AgentSession }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [key, setKey] = useState("");
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });

  const done = () => {
    void client.invalidateQueries({ queryKey: ["agent-sessions"] });
    setOpen(false);
  };
  const link = useMutation({
    mutationFn: () =>
      api.linkAgentSession({ pane_id: paneId, workspace: slug, issue_id: key.trim() }),
    onSuccess: done,
    onError: () =>
      toast.error("Could not link: check the workspace and the issue key (e.g. ATUR-12)."),
  });
  const unlink = useMutation({ mutationFn: () => api.unlinkAgentSession(paneId), onSuccess: done });

  return (
    <div className="flex min-w-0 items-center gap-2">
      {session && (
        <Link
          to={issuePath(session)}
          className="flex min-w-0 max-w-[22rem] items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          title={session.issue.name}
        >
          <span className="font-semibold">{session.issue.key}</span>
          <span className="truncate text-muted-foreground">{session.issue.name}</span>
          <span className={cn("shrink-0", session.state === "blocked" && "text-destructive")}>
            · {STATE_LABEL[session.state]}
          </span>
        </Link>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Link2 className="h-3.5 w-3.5" />
            {session ? "Change" : "Link issue"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="space-y-3">
          <Select value={slug} onValueChange={setSlug}>
            <SelectTrigger aria-label="Workspace">
              <SelectValue placeholder="Workspace" />
            </SelectTrigger>
            <SelectContent>
              {(workspaces.data ?? []).map((w) => (
                <SelectItem key={w.slug} value={w.slug}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Issue key"
            placeholder="Issue key, e.g. ATUR-12"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <div className="flex justify-between gap-2">
            {session ? (
              <Button variant="ghost" size="sm" onClick={() => unlink.mutate()}>
                Unlink
              </Button>
            ) : (
              <span />
            )}
            <Button
              size="sm"
              disabled={!slug || !key.trim() || link.isPending}
              onClick={() => link.mutate()}
            >
              Link
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

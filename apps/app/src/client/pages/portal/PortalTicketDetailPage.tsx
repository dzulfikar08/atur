import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, MessageSquare, Pencil, X, Activity as ActivityIcon } from "@/lib/icons";
import { toast } from "sonner";
import { ApiError, portalApi, type PortalActivity } from "@/lib/portalApi";
import CommentContent from "@/components/editor/CommentContent";
import CommentEditor from "@/components/editor/CommentEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#3b82f6",
  none: "#6b7280",
};

const isEmptyHtml = (html: string) => html.replace(/<[^>]*>/g, "").trim() === "";

// Human-readable rendering of a single activity row.
function activityText(a: PortalActivity): string {
  const actor = a.actor_name || a.actor_email || "Someone";
  const who = `${actor}${a.is_customer ? " (customer)" : " (support)"}`;
  const oldVal = a.old_value || "—";
  const newVal = a.new_value || "—";

  if (a.verb === "created") return `${who} created this ticket`;
  if (a.verb === "commented") return `${who} added a comment`;
  if (a.verb === "updated") {
    switch (a.field) {
      case "state":
        return `${who} changed status from ${oldVal} to ${newVal}`;
      case "priority":
        return `${who} changed priority from ${oldVal} to ${newVal}`;
      case "name":
        return `${who} renamed the ticket to “${newVal}”`;
      case "description_html":
        return `${who} updated the description`;
      default:
        return `${who} updated ${a.field ?? "the ticket"}`;
    }
  }
  return `${who} ${a.verb ?? "acted on"} this ticket`;
}

export default function PortalTicketDetailPage() {
  const { slug, seqId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const seq = Number(seqId);
  // Widget/native reports live in the feedback board's project, not the support
  // project: list links carry ?project= so sequence ids resolve unambiguously.
  const [search] = useSearchParams();
  const projectId = search.get("project");
  const [reply, setReply] = useState("");
  const [editorKey, setEditorKey] = useState(0);

  // Inline edit state for the ticket itself (title / description / priority).
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<string>("none");
  const [editKey, setEditKey] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["portal-ticket", slug, seq, projectId],
    queryFn: () => portalApi.getTicket(slug!, seq, projectId),
    enabled: !!slug && !!seqId,
  });

  const replyMutation = useMutation({
    mutationFn: (html: string) => portalApi.addComment(slug!, seq, html, projectId),
    onSuccess: () => {
      // Refresh this thread and the list (updated_at changes per reply).
      qc.invalidateQueries({ queryKey: ["portal-ticket", slug, seq, projectId] });
      qc.invalidateQueries({ queryKey: ["portal-mine", slug] });
      setReply("");
      setEditorKey((k) => k + 1); // remount editor so it clears
      toast.success("Reply sent");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to send reply"),
  });

  const updateMutation = useMutation({
    mutationFn: (patch: { name?: string; description_html?: string; priority?: string }) =>
      portalApi.updateTicket(slug!, seq, patch, projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-ticket", slug, seq, projectId] });
      qc.invalidateQueries({ queryKey: ["portal-mine", slug] });
      setEditing(false);
      toast.success("Ticket updated");
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Failed to update ticket"),
  });

  const sendReply = () => {
    if (!slug || isEmptyHtml(reply) || replyMutation.isPending) return;
    replyMutation.mutate(reply);
  };

  const startEditing = () => {
    if (!data) return;
    setEditName(data.issue.name);
    setEditDescription(data.issue.description_html ?? "");
    setEditPriority(data.ticket.priority ?? "none");
    setEditKey((k) => k + 1); // remount editor with the current description
    setEditing(true);
  };

  const saveEdit = () => {
    if (!slug || !editName.trim() || updateMutation.isPending) return;
    updateMutation.mutate({
      name: editName.trim(),
      description_html: isEmptyHtml(editDescription) ? "" : editDescription,
      priority: editPriority,
    });
  };

  if (isLoading) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>;
  }

  if (!data) {
    return <div className="text-sm text-muted-foreground">Ticket not found.</div>;
  }

  const { ticket, issue, assignees, comments, activities } = data;
  const thread = [...comments].reverse(); // backend returns newest-first
  const trail = activities; // already newest-first
  const isClosed = ticket.state_group === "completed";

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/portal/${slug}/tickets`)}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        All tickets
      </Button>

      {/* Header: title + status badges, or the inline edit form when editing. */}
      {editing ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">#{ticket.sequence_id}</span>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                <X className="mr-1 h-4 w-4" />
                Cancel
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Subject</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-priority">Priority</Label>
              <Select value={editPriority} onValueChange={setEditPriority}>
                <SelectTrigger id="edit-priority" className="h-9">
                  <SelectValue className="capitalize" />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-description">Details</Label>
              <CommentEditor
                key={editKey}
                value={editDescription}
                onChange={setEditDescription}
                onSubmit={() => {
                  if (editName.trim() && !updateMutation.isPending) saveEdit();
                }}
                uploadUrl={`/portal/${slug}/assets/upload`}
                placeholder="Describe the problem, steps to reproduce, or what you need."
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={saveEdit} disabled={!editName.trim() || updateMutation.isPending}>
                {updateMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">#{ticket.sequence_id}</span>
            <h1 className="flex-1 text-xl font-bold">{issue.name}</h1>
            {!isClosed && (
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Pencil className="mr-1 h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {ticket.state_name && (
              <Badge
                variant="outline"
                style={
                  ticket.state_color
                    ? { borderColor: ticket.state_color, color: ticket.state_color }
                    : undefined
                }
              >
                {ticket.state_name}
              </Badge>
            )}
            <Badge variant="outline" style={{ color: PRIORITY_COLOR[ticket.priority ?? "none"] }}>
              {ticket.priority ?? "none"} priority
            </Badge>
            {assignees.length > 0 && (
              <span className="text-muted-foreground">
                Assigned to {assignees.map((a) => a.display_name || a.email).join(", ")}
              </span>
            )}
          </div>
        </div>
      )}

      {!editing && issue.description_html && (
        <Card>
          <CardContent className="pt-4">
            <CommentContent html={issue.description_html} />
          </CardContent>
        </Card>
      )}

      {/* Conversation thread */}
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <MessageSquare className="h-4 w-4" />
          Conversation ({thread.length})
        </h2>

        {thread.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No replies yet. Use the box below to add details.
          </p>
        ) : (
          <div className="space-y-3">
            {thread.map((c) => (
              <div
                key={c.id}
                className={`rounded-lg border p-3 ${
                  c.is_customer ? "border-primary/30 bg-primary/5" : "border-border bg-background"
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium">
                    {c.actor_name || c.actor_email || "Unknown"}
                    {c.is_customer ? " (you)" : " (support)"}
                  </span>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(c.created_at)}</span>
                </div>
                <CommentContent html={c.comment_html || ""} />
              </div>
            ))}
          </div>
        )}

        <Card>
          <CardContent className="space-y-2 pt-4">
            <CommentEditor
              key={editorKey}
              value={reply}
              onChange={setReply}
              onSubmit={sendReply}
              uploadUrl={`/portal/${slug}/assets/upload`}
              placeholder="Write a reply…"
            />
            <div className="flex justify-end">
              <Button onClick={sendReply} disabled={isEmptyHtml(reply) || replyMutation.isPending}>
                {replyMutation.isPending ? "Sending…" : "Send reply"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activity trail: every recorded event on the ticket (creation, edits,
          comments, status/priority changes) from both customer and support. */}
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <ActivityIcon className="h-4 w-4" />
          Activity ({trail.length})
        </h2>

        {trail.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No activity yet.
          </p>
        ) : (
          <div className="space-y-1">
            {trail.map((a) => (
              <div key={a.id} className="flex items-start gap-3 py-1.5 text-sm">
                <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
                <div className="flex-1 min-w-0">
                  <span className="text-muted-foreground">{activityText(a)}</span>
                  {a.created_at && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {fmtDateTime(a.created_at)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useMemo, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, api, type Module } from "@/lib/api";
import { resolveApiUrl, authHeaders } from "@/lib/native";
import CustomFieldValues from "@/components/issues/CustomFieldValues";
import CommentEditor from "@/components/editor/CommentEditor";
import CommentContent from "@/components/editor/CommentContent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DatePicker } from "@/components/ui/date-picker";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Calendar, MessageSquare, Clock, Link2, GitBranch, Trash2, X, Activity, Paperclip, Upload, FileIcon, Download, Timer, Package, Pencil, Check, ArrowUpDown } from '@/lib/icons';
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useAuthStore } from "@/stores/auth";

interface Issue {
  id: string;
  name: string;
  sequence_id: number;
  description_html: string | null;
  description_stripped: string | null;
  state_id: string | null;
  priority: string | null;
  start_date: string | null;
  target_date: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  estimate_points: number | null;
  external_source?: string | null;
  assignees: any[];
  labels: any[];
  project: string;
  project_detail?: { name: string; identifier: string };
  state?: { id: string; name: string; color: string | null; group: string } | null;
}

interface Comment {
  id: string;
  comment_html: string;
  comment_stripped: string;
  created_at: string;
  updated_at: string;
  actor: string;
  actor_id?: string;
  actor_detail?: { display_name: string; avatar: string };
}

interface State {
  id: string;
  name: string;
  color: string | null;
  group: string;
}

interface IssueRelation {
  id: string;
  issue_id: string;
  related_issue_id: string;
  relation_type: string;
  created_at: string;
}

interface SubIssue {
  id: string;
  name: string;
  sequence_id: number;
  state_id: string | null;
  priority: string | null;
  parent_id: string | null;
  created_at: string;
  project_detail?: { name: string; identifier: string };
}

interface IssueActivity {
  id: string;
  verb: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  issue_comment_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  is_customer: number | null;
  created_at: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  state: "State",
  priority: "Priority",
  name: "Title",
  start_date: "Start Date",
  target_date: "Target Date",
  description_html: "Description",
  parent: "Parent",
};

const PRIORITY_LABELS: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// Tailwind bg classes — kept as a lookup so the select trigger and items stay
// in sync. Matches the FilterBar priority palette.
const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
  none: "bg-gray-400",
};
// Render a single activity row as inline JSX. Handles creation, comments, and
// field changes (with priority/value formatting), attributing each to an actor.
function renderActivityText(a: IssueActivity): ReactNode {
  const actor = a.actor_name || a.actor_email || (a.is_customer ? "Customer" : "Someone");
  const fieldLabel = FIELD_LABELS[a.field || ""] || a.field || "a field";
  const formatVal = (v: string | null) => {
    if (!v) return "—";
    if (a.field === "priority") return PRIORITY_LABELS[v] || v;
    return v;
  };
  if (a.verb === "created") {
    return (
      <>
        {actor} <span className="font-medium text-foreground">created</span> this issue
      </>
    );
  }
  if (a.verb === "commented") {
    return (
      <>
        {actor} <span className="font-medium text-foreground">added a comment</span>
      </>
    );
  }
  if (a.verb === "updated" && a.field === "description_html") {
    return (
      <>
        {actor} updated the <span className="font-medium text-foreground">description</span>
      </>
    );
  }
  if (a.verb === "updated") {
    return (
      <>
        {actor} changed <span className="font-medium text-foreground">{fieldLabel}</span>
        {" from "}
        <span className="font-mono text-xs bg-muted px-1 rounded">{formatVal(a.old_value)}</span>
        {" to "}
        <span className="font-mono text-xs bg-muted px-1 rounded">{formatVal(a.new_value)}</span>
      </>
    );
  }
  return (
    <>
      {actor} {a.verb}
    </>
  );
}

const RELATION_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  blocks: { label: "Blocks", color: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" },
  is_blocked_by: { label: "Blocked by", color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  relates_to: { label: "Relates to", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  duplicates: { label: "Duplicates", color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" },
};

export default function IssueDetail() {
  const { slug, projectId, issueSeqId: issueId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [commentText, setCommentText] = useState("");
  const [commentPublic, setCommentPublic] = useState(false);
  const [commentResetKey, setCommentResetKey] = useState(0);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState("");
  const [commentSort, setCommentSort] = useState<"newest" | "oldest">("newest");
  const [activeTab, setActiveTab] = useState<"comments" | "activity" | "attachments" | "time">("comments");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");

  const { data: issue, isLoading } = useQuery({
    queryKey: ["issue", slug, projectId, issueId],
    queryFn: () => apiFetch<Issue>(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/`),
    enabled: !!slug && !!projectId && !!issueId,
  });

  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: ["comments", slug, projectId, issueId],
    queryFn: () => apiFetch<{ results: Comment[] }>(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/comments/`).then((d) => d.results)
      .catch(() => []),
    enabled: !!slug && !!projectId && !!issueId,
  });

  const sortedComments = useMemo(() => {
    const list = [...comments];
    list.sort((a, b) => {
      const t = (v: string) => new Date(v).getTime();
      return commentSort === "oldest" ? t(a.created_at) - t(b.created_at) : t(b.created_at) - t(a.created_at);
    });
    return list;
  }, [comments, commentSort]);

  const { data: states = [] } = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => apiFetch<{ results: State[] }>(`/workspaces/${slug}/projects/${projectId}/states/`).then((d) => d.results)
      .catch(() => []),
    enabled: !!slug && !!projectId,
  });

  const { data: activitiesData, isLoading: activitiesLoading } = useQuery({
    queryKey: ["activities", slug, projectId, issueId],
    queryFn: () => apiFetch<{ results: IssueActivity[]; total: number }>(
      `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/activities/`
    ).catch(() => ({ results: [], total: 0 })),
    enabled: !!slug && !!projectId && !!issueId,
  });
  const activities = activitiesData?.results ?? [];

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue", slug, projectId, issueId] });
      qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
    },
    onError: () => toast.error("Failed to update issue"),
  });

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const deleteIssueMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      qc.invalidateQueries({ queryKey: ["my-issues"] });
      toast.success("Issue deleted");
      navigate(`/${slug}/projects/${projectId}`);
    },
    onError: () => toast.error("Failed to delete issue"),
  });
  function startEditTitle() {
    setTitleDraft(issue?.name ?? "");
    setEditingTitle(true);
  }
  function saveTitle() {
    const name = titleDraft.trim();
    if (!issue) { setEditingTitle(false); return; }
    if (name && name !== issue.name) updateMutation.mutate({ name });
    setEditingTitle(false);
  }
  function startEditDesc() {
    setDescDraft(issue?.description_html ?? "");
    setEditingDesc(true);
  }
  function saveDesc() {
    if (!issue) { setEditingDesc(false); return; }
    const html = descDraft === "<p></p>" ? "" : descDraft;
    if (html !== (issue.description_html ?? "")) updateMutation.mutate({ description_html: html });
    setEditingDesc(false);
  }

  const commentMutation = useMutation({
    mutationFn: (vars: { comment_html: string; access?: string }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/comments/`, {
        method: "POST",
        body: JSON.stringify({ comment_html: vars.comment_html, access: vars.access }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments", slug, projectId, issueId] });
      setCommentText("");
      setCommentResetKey((k) => k + 1);
      toast.success("Comment added");
    },
    onError: () => toast.error("Failed to add comment"),
  });

  const editCommentMutation = useMutation({
    mutationFn: ({ commentId, comment_html }: { commentId: string; comment_html: string }) =>
      api.updateComment(slug!, projectId!, Number(issueId!), commentId, { comment_html }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments", slug, projectId, issueId] });
      qc.invalidateQueries({ queryKey: ["activities", slug, projectId, issueId] });
      setEditingCommentId(null);
      setEditCommentText("");
      toast.success("Comment updated");
    },
    onError: () => toast.error("Failed to update comment"),
  });

  function startEditComment(c: Comment) {
    setEditingCommentId(c.id);
    setEditCommentText(c.comment_html);
  }

  // --- Relations ---
  const [relationSearch, setRelationSearch] = useState("");
  const [relationType, setRelationType] = useState<string>("relates_to");
  const [selectedRelatedIssue, setSelectedRelatedIssue] = useState<{ id: string; name: string } | null>(null);
  const [showRelationSearch, setShowRelationSearch] = useState(false);

  const { data: relations = [], isLoading: relationsLoading } = useQuery({
    queryKey: ["relations", slug, projectId, issueId],
    queryFn: () => apiFetch<{ results: IssueRelation[] }>(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/relations/`).then((d) => d.results)
      .catch(() => []),
    enabled: !!slug && !!projectId && !!issueId,
  });

  const { data: relationSearchResults = [], isLoading: relationSearchLoading } = useQuery({
    queryKey: ["issue-search", slug, projectId, relationSearch],
    queryFn: () =>
      apiFetch<{ results: { id: string; name: string; sequence_id: number }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?search=${encodeURIComponent(relationSearch)}&limit=10`
      ).then((r) => (Array.isArray(r) ? r : r.results).filter((i) => String(i.sequence_id) !== String(issueId))),
    enabled: !!slug && !!projectId && relationSearch.length >= 2,
  });

  // Fetch related issue details for each relation
  const relatedIssueIds = relations.map((r) => r.related_issue_id);
  const { data: relatedIssues = [] } = useQuery({
    queryKey: ["related-issues", slug, projectId, relatedIssueIds.join(",")],
    queryFn: async () => {
      if (relatedIssueIds.length === 0) return [];
      const all = await apiFetch<{ results: { id: string; name: string; sequence_id: number }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?limit=500`
      ).then((r) => (Array.isArray(r) ? r : r.results));
      return all.filter((i) => relatedIssueIds.includes(i.id));
    },
    enabled: !!slug && !!projectId && relatedIssueIds.length > 0,
  });

  const relatedIssueMap = new Map(relatedIssues.map((i) => [i.id, i]));

  const addRelationMutation = useMutation({
    mutationFn: ({ related_issue_id, relation_type }: { related_issue_id: string; relation_type: string }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/relations/`, {
        method: "POST",
        body: JSON.stringify({ related_issue_id, relation_type }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["relations", slug, projectId, issueId] });
      setSelectedRelatedIssue(null);
      setRelationSearch("");
      setShowRelationSearch(false);
      toast.success("Relation added");
    },
    onError: () => toast.error("Failed to add relation"),
  });

  const deleteRelationMutation = useMutation({
    mutationFn: (relationId: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/relations/${relationId}/`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["relations", slug, projectId, issueId] });
      toast.success("Relation removed");
    },
    onError: () => toast.error("Failed to remove relation"),
  });

  // --- Sub-issues ---
  const { data: subIssues = [], isLoading: subIssuesLoading } = useQuery({
    queryKey: ["sub-issues", slug, projectId, issueId],
    queryFn: () => apiFetch<{ results: SubIssue[] }>(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/sub-issues/`).then((d) => d.results)
      .catch(() => []),
    enabled: !!slug && !!projectId && !!issueId,
  });

  const [newSubIssue, setNewSubIssue] = useState("");
  const createSubIssueMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/`, {
        method: "POST",
        body: JSON.stringify({ name, parent_id: issue?.id, priority: "none" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sub-issues", slug, projectId, issueId] });
      qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      setNewSubIssue("");
      toast.success("Sub-issue created");
    },
    onError: () => toast.error("Failed to create sub-issue"),
  });

  // --- Attachments ---
  const { data: attachments = [], isLoading: attachmentsLoading } = useQuery({
    queryKey: ["attachments", slug, projectId, issueId],
    queryFn: () =>
      apiFetch<{ results: { id: string; issue_id: string; asset: string | null; attributes: { name?: string; size?: number; type?: string } | null; created_at: string | null }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/attachments/`
      ).then((d) => d.results),
    enabled: !!slug && !!projectId && !!issueId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch(resolveApiUrl("/api/assets/upload/"), {
        method: "POST",
        credentials: "include",
        headers: { ...authHeaders() },
        body: form,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const uploaded = await uploadRes.json();
      return apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/attachments/`, {
        method: "POST",
        body: JSON.stringify({
          asset: uploaded.id || uploaded.asset || uploaded.url || String(uploaded),
          attributes: { name: file.name, size: file.size, type: file.type },
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments", slug, projectId, issueId] });
      toast.success("File attached");
    },
    onError: () => toast.error("Failed to upload file"),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attId: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/attachments/${attId}/`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments", slug, projectId, issueId] });
      toast.success("Attachment removed");
    },
    onError: () => toast.error("Failed to remove attachment"),
  });

  // --- Time entries ---
  const [timeHours, setTimeHours] = useState("");
  const [timeMinutes, setTimeMinutes] = useState("");
  const [timeDesc, setTimeDesc] = useState("");

  const { data: timeEntries = [], isLoading: timeEntriesLoading } = useQuery({
    queryKey: ["time-entries", slug, projectId, issueId],
    queryFn: () =>
      apiFetch<{ results: { id: string; duration_seconds: number; description: string | null; created_at: string | null }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/time-entries/`
      ).then((d) => d.results),
    enabled: !!slug && !!projectId && !!issueId,
  });

  const totalTimeSeconds = timeEntries.reduce((sum, e) => sum + e.duration_seconds, 0);

  const logTimeMutation = useMutation({
    mutationFn: ({ duration_seconds, description }: { duration_seconds: number; description?: string }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/time-entries/`, {
        method: "POST",
        body: JSON.stringify({ duration_seconds, description }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries", slug, projectId, issueId] });
      setTimeHours("");
      setTimeMinutes("");
      setTimeDesc("");
      toast.success("Time logged");
    },
    onError: () => toast.error("Failed to log time"),
  });

  const deleteTimeMutation = useMutation({
    mutationFn: (entryId: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/time-entries/${entryId}/`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["time-entries", slug, projectId, issueId] });
      toast.success("Time entry removed");
    },
    onError: () => toast.error("Failed to remove time entry"),
  });

  // Fetch parent issue if parent_id exists
  const { data: parentIssue } = useQuery({
    queryKey: ["parent-issue", slug, projectId, issue?.parent_id],
    queryFn: async () => {
      if (!issue?.parent_id) return null;
      const all = await apiFetch<{ results: { id: string; name: string; sequence_id: number }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?limit=500`
      ).then((r) => (Array.isArray(r) ? r : r.results));
      return all.find((i) => i.id === issue.parent_id) || null;
    },
    enabled: !!slug && !!projectId && !!issue?.parent_id,
  });

  // --- Modules ---
  const { data: issueModules = [], isLoading: issueModulesLoading } = useQuery({
    queryKey: ["issue-modules", slug, projectId, issueId],
    queryFn: () => api.listIssueModules(slug!, projectId!, Number(issueId!)).catch(() => []),
    enabled: !!slug && !!projectId && !!issueId,
  });

  const { data: projectModules = [] } = useQuery({
    queryKey: ["modules", slug, projectId],
    queryFn: () => api.listModules(slug!, projectId!).catch(() => []),
    enabled: !!slug && !!projectId,
  });

  const addModuleMutation = useMutation({
    mutationFn: (moduleId: string) =>
      api.addIssueToModule(slug!, projectId!, Number(issueId!), moduleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue-modules", slug, projectId, issueId] });
      qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      toast.success("Added to module");
    },
    onError: () => toast.error("Failed to add to module"),
  });

  const removeModuleMutation = useMutation({
    mutationFn: (moduleId: string) =>
      api.removeIssueFromModule(slug!, projectId!, Number(issueId!), moduleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue-modules", slug, projectId, issueId] });
      qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      toast.success("Removed from module");
    },
    onError: () => toast.error("Failed to remove from module"),
  });

  const [moduleSelectValue, setModuleSelectValue] = useState("");

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-muted-foreground">Loading issue...</div></div>;
  }

  if (!issue) {
    return <div className="flex items-center justify-center h-64"><p className="text-muted-foreground">Issue not found</p></div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">
          {issue.project_detail?.identifier || "PROJ"}-{String(issue.sequence_id).padStart(4, "0")}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDeleteOpen(true)}
            aria-label="Delete issue"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete issue?</DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              {issue.project_detail?.identifier || "PROJ"}-{String(issue.sequence_id).padStart(4, "0")}{" "}
              "{issue.name}" and all of its data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)} disabled={deleteIssueMutation.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleteIssueMutation.mutate()} disabled={deleteIssueMutation.isPending}>
              {deleteIssueMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {editingTitle ? (
            <div className="flex items-center gap-2 mb-4">
              <Input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                className="text-xl font-semibold h-auto py-1 flex-1"
              />
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={saveTitle} aria-label="Save title">
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditingTitle(false)} aria-label="Cancel">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1 mb-4 group">
              <h1 className="text-xl font-semibold">{issue.name}</h1>
              <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={startEditTitle} aria-label="Edit title">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {editingDesc ? (
            <div className="mb-6">
              <CommentEditor value={descDraft} onChange={setDescDraft} placeholder="Add a description..." />
              <div className="flex items-center gap-2 mt-2">
                <Button size="sm" onClick={saveDesc}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingDesc(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="mb-6 group">
              {issue.description_html ? (
                <div className="text-sm text-foreground max-w-none prose prose-sm">
                  <CommentContent html={issue.description_html} />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm italic">No description provided</p>
              )}
              <Button size="sm" variant="ghost" className="h-6 mt-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={startEditDesc}>
                <Pencil className="h-3 w-3 mr-1" /> Edit
              </Button>
            </div>
          )}

          {/* Relations Section */}
          <Separator className="my-6" />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Link2 className="h-4 w-4" /> Relations ({relations.length})
              </h3>
              {!showRelationSearch && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowRelationSearch(true)}>
                  Add Relation
                </Button>
              )}
            </div>

            {showRelationSearch && (
              <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Search Issue</label>
                  <div className="relative">
                    <Input
                      placeholder="Type to search issues..."
                      value={relationSearch}
                      onChange={(e) => {
                        setRelationSearch(e.target.value);
                        setSelectedRelatedIssue(null);
                      }}
                      className="h-8 text-sm"
                    />
                  </div>
                  {selectedRelatedIssue && (
                    <div className="flex items-center gap-2 mt-2 p-2 bg-muted/50 rounded text-xs">
                      <span className="font-medium">{selectedRelatedIssue.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => {
                          setSelectedRelatedIssue(null);
                          setRelationSearch("");
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  {!selectedRelatedIssue && relationSearch.length >= 2 && (
                    <div className="mt-1 border rounded-md max-h-[200px] overflow-y-auto">
                      {relationSearchLoading ? (
                        <div className="p-2 text-xs text-muted-foreground">Searching...</div>
                      ) : relationSearchResults.length === 0 ? (
                        <div className="p-2 text-xs text-muted-foreground">No issues found</div>
                      ) : (
                        relationSearchResults.map((i) => (
                          <button
                            key={i.id}
                            className="w-full text-left p-2 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
                            onClick={() => {
                              setSelectedRelatedIssue({ id: i.id, name: i.name });
                              setRelationSearch("");
                            }}
                          >
                            <span className="text-muted-foreground text-xs">#{String(i.sequence_id).padStart(4, "0")}</span>
                            <span className="truncate">{i.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Relation Type</label>
                  <Select value={relationType} onValueChange={setRelationType}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(RELATION_TYPE_LABELS).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!selectedRelatedIssue || addRelationMutation.isPending}
                    onClick={() => {
                      if (selectedRelatedIssue) {
                        addRelationMutation.mutate({
                          related_issue_id: selectedRelatedIssue.id,
                          relation_type: relationType,
                        });
                      }
                    }}
                  >
                    {addRelationMutation.isPending ? "Adding..." : "Add"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setShowRelationSearch(false);
                      setSelectedRelatedIssue(null);
                      setRelationSearch("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {relationsLoading ? (
              <div className="animate-pulse text-sm text-muted-foreground">Loading relations...</div>
            ) : relations.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No relations</p>
            ) : (
              <div className="space-y-2">
                {relations.map((rel) => {
                  const relInfo = RELATION_TYPE_LABELS[rel.relation_type] || {
                    label: rel.relation_type,
                    color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
                  };
                  const relIssue = relatedIssueMap.get(rel.related_issue_id);
                  return (
                    <div key={rel.id} className="flex items-center gap-2 p-2 border rounded-md">
                      <Badge variant="secondary" className={`text-[10px] shrink-0 ${relInfo.color}`}>
                        {relInfo.label}
                      </Badge>
                      {relIssue ? (
                        <button
                          className="text-sm hover:underline truncate flex-1 text-left"
                          onClick={() => navigate(`/${slug}/projects/${projectId}/issues/${relIssue.sequence_id}`)}
                        >
                          <span className="text-muted-foreground mr-1">#{String(relIssue.sequence_id).padStart(4, "0")}</span>
                          {relIssue.name}
                        </button>
                      ) : (
                        <span className="text-sm text-muted-foreground flex-1">Loading...</span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={deleteRelationMutation.isPending}
                        onClick={() => deleteRelationMutation.mutate(rel.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sub-issues Section */}
          <Separator className="my-6" />
          <div className="space-y-4">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <GitBranch className="h-4 w-4" /> Sub-issues ({subIssues.length})
            </h3>

            {parentIssue && (
              <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                <span className="text-xs text-muted-foreground">Parent:</span>
                <button
                  className="text-sm hover:underline flex items-center gap-1"
                  onClick={() => navigate(`/${slug}/projects/${projectId}/issues/${parentIssue.sequence_id}`)}
                >
                  <GitBranch className="h-3 w-3" />
                  <span className="text-muted-foreground">#{String(parentIssue.sequence_id).padStart(4, "0")}</span>
                  {parentIssue.name}
                </button>
              </div>
            )}

            {subIssuesLoading ? (
              <div className="animate-pulse text-sm text-muted-foreground">Loading sub-issues...</div>
            ) : subIssues.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No sub-issues</p>
            ) : (
              <div className="space-y-2">
                {subIssues.map((si) => (
                  <div
                    key={si.id}
                    className="flex items-center gap-2 p-2 border rounded-md cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => navigate(`/${slug}/projects/${projectId}/issues/${si.sequence_id}`)}
                  >
                    <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground text-xs">#{String(si.sequence_id).padStart(4, "0")}</span>
                    <span className="text-sm truncate flex-1">{si.name}</span>
                    {si.priority && si.priority !== "none" && (
                      <Badge variant="outline" className="text-[10px] shrink-0">{si.priority}</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newSubIssue.trim()) createSubIssueMutation.mutate(newSubIssue.trim());
              }}
              className="flex items-center gap-2 mt-2"
            >
              <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                placeholder="Add sub-issue..."
                value={newSubIssue}
                onChange={(e) => setNewSubIssue(e.target.value)}
                className="flex-1 bg-transparent text-sm py-1 px-1 border-b border-input outline-none placeholder:text-muted-foreground focus:border-primary"
              />
              <Button type="submit" size="sm" variant="ghost" className="h-6 text-xs" disabled={!newSubIssue.trim() || createSubIssueMutation.isPending}>
                {createSubIssueMutation.isPending ? "..." : "Add"}
              </Button>
            </form>
          </div>

          <Separator className="my-6" />

          {/* Activity / Comments tabs */}
          <div className="space-y-4">
            <div className="flex gap-1 border-b">
              <button
                className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "comments"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("comments")}
              >
                <MessageSquare className="h-3.5 w-3.5 inline mr-1" />
                Comments ({comments.length})
              </button>
              <button
                className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "activity"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("activity")}
              >
                <Activity className="h-3.5 w-3.5 inline mr-1" />
                Activity ({activities.length})
              </button>
              <button
                className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "attachments"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("attachments")}
              >
                <Paperclip className="h-3.5 w-3.5 inline mr-1" />
                Attachments ({attachments.length})
              </button>
              <button
                className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "time"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("time")}
              >
                <Timer className="h-3.5 w-3.5 inline mr-1" />
                Time ({Math.floor(totalTimeSeconds / 3600)}h {Math.floor((totalTimeSeconds % 3600) / 60)}m)
              </button>
            </div>

            {activeTab === "comments" && (
              <>
                <div className="flex gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">Y</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-2">
                    <CommentEditor
                      value={commentText}
                      onChange={(html) => setCommentText(html)}
                      onSubmit={() => {
                        if (commentText.replace(/<[^>]*>/g, '').trim() && !commentMutation.isPending) {
                          commentMutation.mutate({ comment_html: commentText, access: commentPublic ? 'public' : 'internal' });
                        }
                      }}
                      placeholder="Add a comment..."
                      resetKey={commentResetKey}
                    />
                    <div className="flex items-center gap-3">
                      {issue?.external_source === 'portal' && (
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={commentPublic}
                            onChange={(e) => setCommentPublic(e.target.checked)}
                            className="h-3.5 w-3.5"
                          />
                          Visible to customer
                        </label>
                      )}
                      <Button
                        size="sm"
                        disabled={!commentText.replace(/<[^>]*>/g, '').trim() || commentMutation.isPending}
                        onClick={() => commentMutation.mutate({ comment_html: commentText, access: commentPublic ? 'public' : 'internal' })}
                      >
                        {commentMutation.isPending ? "Sending..." : "Comment"}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{sortedComments.length} comments</span>
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5"
                    onClick={() => setCommentSort(commentSort === "newest" ? "oldest" : "newest")}
                    title="Toggle comment order"
                  >
                    <ArrowUpDown className="h-3 w-3" />
                    {commentSort === "newest" ? "Newest first" : "Earliest first"}
                  </button>
                </div>
                {commentsLoading ? (
                  <div className="animate-pulse text-sm text-muted-foreground">Loading comments...</div>
                ) : (
                  <div className="space-y-4">
                    {sortedComments.map((c) => {
                      const isMine = c.actor_id === currentUser?.id;
                      return (
                      <div key={c.id} className="flex gap-3 group">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {c.actor_detail?.display_name?.charAt(0) || "U"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium">{c.actor_detail?.display_name || "User"}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                            </span>
                            {isMine && editingCommentId !== c.id && (
                              <button
                                className="ml-auto p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                                onClick={() => startEditComment(c)}
                                aria-label="Edit comment"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          {editingCommentId === c.id ? (
                            <div className="space-y-2">
                              <CommentEditor
                                value={editCommentText}
                                onChange={setEditCommentText}
                                placeholder="Edit comment..."
                                resetKey={editingCommentId}
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  disabled={!editCommentText.replace(/<[^>]*>/g, '').trim() || editCommentMutation.isPending}
                                  onClick={() => editCommentMutation.mutate({ commentId: c.id, comment_html: editCommentText })}
                                >
                                  {editCommentMutation.isPending ? "Saving..." : "Save"}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setEditingCommentId(null); setEditCommentText(""); }}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm"><CommentContent html={c.comment_html} /></div>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {activeTab === "activity" && (
              <>
                {activitiesLoading ? (
                  <div className="animate-pulse text-sm text-muted-foreground">Loading activity...</div>
                ) : activities.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-4">No activity yet</p>
                ) : (
                  <div className="space-y-1">
                    {activities.map((a) => (
                      <div key={a.id} className="flex items-start gap-3 py-2 text-sm">
                        <div className="h-2 w-2 rounded-full bg-muted-foreground/30 mt-1.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-muted-foreground">{renderActivityText(a)}</span>
                          {a.created_at && (
                            <span className="text-xs text-muted-foreground ml-2">
                              {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTab === "attachments" && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-muted-foreground">
                    {attachments.length} file{attachments.length !== 1 ? "s" : ""}
                  </span>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      onChange={(e) => {
                        const files = e.target.files;
                        if (!files) return;
                        for (let i = 0; i < files.length; i++) {
                          uploadMutation.mutate(files[i]!);
                        }
                        e.target.value = "";
                      }}
                    />
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild>
                      <span>
                        <Upload className="h-3 w-3" /> Upload
                      </span>
                    </Button>
                  </label>
                </div>
                {attachmentsLoading ? (
                  <div className="animate-pulse text-sm text-muted-foreground">Loading attachments...</div>
                ) : attachments.length === 0 ? (
                  <div className="text-center py-8 border border-dashed rounded-lg">
                    <Paperclip className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No attachments yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Upload files or drag & drop here</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {attachments.map((att) => {
                      const name = att.attributes?.name || "File";
                      const size = att.attributes?.size;
                      const type = att.attributes?.type || "";
                      const isImage = type.startsWith("image/");
                      const fmtSize = size
                        ? size > 1024 * 1024
                          ? `${(size / 1024 / 1024).toFixed(1)} MB`
                          : `${(size / 1024).toFixed(0)} KB`
                        : "";
                      return (
                        <div
                          key={att.id}
                          className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/20 transition-colors"
                        >
                          {isImage ? (
                            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                              {att.asset ? (
                                <img src={resolveApiUrl(att.asset)} alt={name} className="h-10 w-10 object-cover" />
                              ) : (
                                <FileIcon className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          ) : (
                            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
                              <FileIcon className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{name}</p>
                            <p className="text-xs text-muted-foreground">
                              {fmtSize}{type && ` · ${type}`}
                              {att.created_at && ` · ${formatDistanceToNow(new Date(att.created_at), { addSuffix: true })}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {att.asset && (
                              <a
                                href={resolveApiUrl(att.asset)}
                                download={name}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                              </a>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => deleteAttachmentMutation.mutate(att.id)}
                              disabled={deleteAttachmentMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {activeTab === "time" && (
              <>
                {/* Log time form */}
                <div className="rounded-lg border p-3 mb-4">
                  <h4 className="text-xs font-semibold mb-2">Log Time</h4>
                  <div className="flex items-center gap-2 mb-2">
                    <Input
                      type="number"
                      min="0"
                      placeholder="Hours"
                      className="h-8 w-20 text-sm"
                      value={timeHours}
                      onChange={(e) => setTimeHours(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">h</span>
                    <Input
                      type="number"
                      min="0"
                      max="59"
                      placeholder="Minutes"
                      className="h-8 w-20 text-sm"
                      value={timeMinutes}
                      onChange={(e) => setTimeMinutes(e.target.value)}
                    />
                    <span className="text-xs text-muted-foreground">m</span>
                  </div>
                  <Input
                    placeholder="Description (optional)"
                    className="h-8 text-sm mb-2"
                    value={timeDesc}
                    onChange={(e) => setTimeDesc(e.target.value)}
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!timeHours && !timeMinutes}
                    onClick={() => {
                      const secs =
                        (parseInt(timeHours || "0") * 3600) +
                        (parseInt(timeMinutes || "0") * 60);
                      if (secs > 0) {
                        logTimeMutation.mutate({
                          duration_seconds: secs,
                          description: timeDesc || undefined,
                        });
                      }
                    }}
                  >
                    {logTimeMutation.isPending ? "Logging..." : "Log Time"}
                  </Button>
                </div>

                {/* Total */}
                <div className="flex items-center gap-2 mb-3">
                  <Timer className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">
                    Total: {Math.floor(totalTimeSeconds / 3600)}h {Math.floor((totalTimeSeconds % 3600) / 60)}m
                  </span>
                </div>

                {/* Entries list */}
                {timeEntriesLoading ? (
                  <div className="animate-pulse text-sm text-muted-foreground">Loading...</div>
                ) : timeEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-4">No time logged yet</p>
                ) : (
                  <div className="space-y-2">
                    {timeEntries.map((entry) => {
                      const hrs = Math.floor(entry.duration_seconds / 3600);
                      const mins = Math.floor((entry.duration_seconds % 3600) / 60);
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/20"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">
                              {hrs}h {mins}m
                            </p>
                            {entry.description && (
                              <p className="text-xs text-muted-foreground truncate">
                                {entry.description}
                              </p>
                            )}
                            {entry.created_at && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => deleteTimeMutation.mutate(entry.id)}
                            disabled={deleteTimeMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-[300px] lg:border-l border-t lg:border-t-0 p-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">State</label>
            <Select
              value={issue.state_id || ""}
              onValueChange={(v) => updateMutation.mutate({ state_id: v })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Set state" />
              </SelectTrigger>
              <SelectContent>
                {states.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color || "#9ca3af" }} />
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Priority</label>
            <Select
              value={issue.priority || "none"}
              onValueChange={(v) => updateMutation.mutate({ priority: v })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["none", "low", "medium", "high", "urgent"].map((p) => (
                  <SelectItem key={p} value={p}>
                    <span className="flex items-center gap-2 capitalize">
                      <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[p]}`} />
                      {PRIORITY_LABELS[p]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Estimate (pts)</label>
            <Select
              value={issue.estimate_points != null ? String(issue.estimate_points) : "__none__"}
              onValueChange={(v) => updateMutation.mutate({ estimate_points: v === "__none__" ? null : Number(v) })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="No estimate" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {[0, 1, 2, 3, 5, 8, 13, 21].map((p) => (
                  <SelectItem key={p} value={String(p)}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Start Date
            </label>
            <DatePicker
              value={issue.start_date}
              onChange={(v) => updateMutation.mutate({ start_date: v })}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Target Date
            </label>
            <DatePicker
              value={issue.target_date}
              onChange={(v) => updateMutation.mutate({ target_date: v })}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Package className="h-3 w-3" /> Modules
            </label>
            {issueModulesLoading ? (
              <p className="text-xs text-muted-foreground animate-pulse">Loading...</p>
            ) : (
              <div className="space-y-1.5">
                {issueModules.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {issueModules.map((m: Module) => (
                      <Badge key={m.id} variant="secondary" className="text-xs gap-1 pr-1">
                        <Package className="h-2.5 w-2.5" />
                        {m.name}
                        <button
                          className="ml-0.5 hover:text-destructive"
                          onClick={() => removeModuleMutation.mutate(m.id)}
                          disabled={removeModuleMutation.isPending}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                {projectModules.length > 0 && (() => {
                  const issueModuleIds = new Set(issueModules.map((m: Module) => m.id));
                  const available = projectModules.filter(m => !issueModuleIds.has(m.id));
                  return available.length > 0 ? (
                    <Select
                      value={moduleSelectValue}
                      onValueChange={(v) => {
                        addModuleMutation.mutate(v);
                        setModuleSelectValue("");
                      }}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="Add to module..." />
                      </SelectTrigger>
                      <SelectContent>
                        {available.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : issueModules.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No modules available</p>
                  ) : null;
                })()}
                {projectModules.length === 0 && issueModules.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No modules in project</p>
                )}
              </div>
            )}
          </div>

          {slug && projectId && issueId && (
            <CustomFieldValues
              slug={slug}
              projectId={projectId}
              issueSeqId={Number(issueId)}
            />
          )}

          </div>
          <Separator className="hidden lg:block" />

          <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Created
            </label>
            <p className="text-sm">{new Date(issue.created_at).toLocaleDateString()}</p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Updated
            </label>
            <p className="text-sm">{formatDistanceToNow(new Date(issue.updated_at), { addSuffix: true })}</p>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

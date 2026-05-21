import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Calendar, MessageSquare, Clock, Link2, GitBranch, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

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
  assignees: any[];
  labels: any[];
  project: string;
  project_detail?: { name: string; identifier: string };
}

interface Comment {
  id: string;
  comment_html: string;
  comment_stripped: string;
  created_at: string;
  updated_at: string;
  actor: string;
  actor_detail?: { display_name: string; avatar: string };
}

interface State {
  id: string;
  name: string;
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
  const [commentText, setCommentText] = useState("");

  const { data: issue, isLoading } = useQuery({
    queryKey: ["issue", slug, projectId, issueId],
    queryFn: () => apiFetch<Issue>(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/`),
    enabled: !!slug && !!projectId && !!issueId,
  });

  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: ["comments", slug, projectId, issueId],
    queryFn: () => apiFetch<Comment[]>(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/comments/`)
      .catch(() => []),
    enabled: !!slug && !!projectId && !!issueId,
  });

  const { data: states = [] } = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => apiFetch<State[]>(`/workspaces/${slug}/projects/${projectId}/states/`)
      .catch(() => []),
    enabled: !!slug && !!projectId,
  });

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
  });

  const commentMutation = useMutation({
    mutationFn: (comment_html: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/comments/`, {
        method: "POST",
        body: JSON.stringify({ comment_html }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comments", slug, projectId, issueId] });
      setCommentText("");
      toast.success("Comment added");
    },
    onError: () => toast.error("Failed to add comment"),
  });

  // --- Relations ---
  const [relationSearch, setRelationSearch] = useState("");
  const [relationType, setRelationType] = useState<string>("relates_to");
  const [selectedRelatedIssue, setSelectedRelatedIssue] = useState<{ id: string; name: string } | null>(null);
  const [showRelationSearch, setShowRelationSearch] = useState(false);

  const { data: relations = [], isLoading: relationsLoading } = useQuery({
    queryKey: ["relations", slug, projectId, issueId],
    queryFn: () => apiFetch<IssueRelation[]>(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/relations/`)
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
    queryFn: () => apiFetch<SubIssue[]>(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/sub-issues/`)
      .catch(() => []),
    enabled: !!slug && !!projectId && !!issueId,
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
      </div>

      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <h1 className="text-xl font-semibold mb-4">{issue.name}</h1>

          {issue.description_stripped ? (
            <div className="text-sm text-foreground whitespace-pre-wrap mb-6 max-w-none">
              {issue.description_stripped}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm mb-6 italic">No description provided</p>
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
          </div>

          <Separator className="my-6" />

          <div className="space-y-4">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Comments ({comments.length})
            </h3>

            {commentsLoading ? (
              <div className="animate-pulse text-sm text-muted-foreground">Loading comments...</div>
            ) : (
              <div className="space-y-4">
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-3">
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
                      </div>
                      <p className="text-sm">{c.comment_stripped}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">Y</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-2">
                <Textarea
                  placeholder="Add a comment..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={3}
                />
                <Button
                  size="sm"
                  disabled={!commentText.trim() || commentMutation.isPending}
                  onClick={() => commentMutation.mutate(commentText)}
                >
                  {commentMutation.isPending ? "Sending..." : "Comment"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-[300px] lg:border-l border-t lg:border-t-0 p-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">State</label>
            <Select
              value={issue.state_id || ""}
              onValueChange={(v) => updateMutation.mutate({ state: v })}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Set state" />
              </SelectTrigger>
              <SelectContent>
                {states.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
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
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Start Date
            </label>
            <Input
              type="date"
              className="h-8 text-sm"
              value={issue.start_date || ""}
              onChange={(e) => updateMutation.mutate({ start_date: e.target.value || null })}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Target Date
            </label>
            <Input
              type="date"
              className="h-8 text-sm"
              value={issue.target_date || ""}
              onChange={(e) => updateMutation.mutate({ target_date: e.target.value || null })}
            />
          </div>

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

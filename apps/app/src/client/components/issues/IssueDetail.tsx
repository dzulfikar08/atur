import { useState, useMemo, useRef, useCallback, type ReactNode } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, api, type Module, type TimeEntry } from "@/lib/api";
import { resolveApiUrl, authHeaders } from "@/lib/native";
import CustomFieldValues from "@/components/issues/CustomFieldValues";
import CommentEditor from "@/components/editor/CommentEditor";
import CommentContent from "@/components/editor/CommentContent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { DatePicker } from "@/components/ui/date-picker";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState, IssueDetailSkeleton } from "@/components/ui/skeletons";
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
import {
  ArrowLeft,
  Calendar,
  MessageSquare,
  Clock,
  Link2,
  GitBranch,
  Trash2,
  X,
  Activity,
  Paperclip,
  Upload,
  FileIcon,
  Download,
  Timer,
  Package,
  Pencil,
  Check,
  CheckCircle2,
  ChevronRight,
  ArrowUpDown,
  User,
  Bell,
} from "@/lib/icons";
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
  project_detail?: { id?: string; name: string; identifier: string };
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
  actor_detail?: { display_name: string; avatar: string | null };
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

// `?include=` makes GET issue return the sub-resources the page needs in one response.
const ISSUE_INCLUDES = "comments,activities,relations,sub_issues,subscribers,modules,custom_values";

interface IssueCounts {
  attachments: number;
  time_seconds: number;
}

interface IssueBundle extends Issue {
  included?: {
    comments: { results: Comment[] };
    activities: { results: IssueActivity[] };
    subscribers: { results: unknown[] };
    relations: { results: IssueRelation[] };
    sub_issues: { results: SubIssue[] };
    modules: { results: Module[] };
    custom_values: unknown[];
    related_issues: { id: string; name: string; sequence_id: number }[];
    counts: IssueCounts;
  };
}

type IssueWithCounts = Issue & { counts?: IssueCounts };

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

// Evidence-first activity: a comment carries proof when it embeds images
// (pasted/dropped/attached shots) or is written up as evidence — those get
// the amber evidence panel; ordinary prose keeps the plain thread look.

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
        <span className="font-ops-mono text-xs bg-muted px-1 rounded">
          {formatVal(a.old_value)}
        </span>
        {" to "}
        <span className="font-ops-mono text-xs bg-muted px-1 rounded">
          {formatVal(a.new_value)}
        </span>
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
  blocks: {
    label: "Blocks",
    color: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  },
  is_blocked_by: {
    label: "Blocked by",
    color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  },
  relates_to: {
    label: "Relates to",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  },
  duplicates: {
    label: "Duplicates",
    color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  },
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
  const [commentSort, setCommentSort] = useState<"newest" | "oldest">("oldest");
  const [activeTab, setActiveTab] = useState<"comments" | "activity" | "attachments" | "time">(
    "comments",
  );
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");

  // Resizable split between detail pane and comments pane (desktop only).
  const SPLIT_KEY = "atur:issue-detail-split";
  const clampSplit = (pct: number) => Math.min(80, Math.max(20, pct));
  const [rightPct, setRightPct] = useState(() => {
    const saved = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(saved) && saved >= 20 && saved <= 80 ? saved : 45;
  });
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const draggingSplitRef = useRef(false);
  const rightPctRef = useRef(rightPct);

  const onSplitPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingSplitRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onSplitPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingSplitRef.current || !splitContainerRef.current) return;
    const rect = splitContainerRef.current.getBoundingClientRect();
    const pct = clampSplit(((rect.right - e.clientX) / rect.width) * 100);
    rightPctRef.current = pct;
    setRightPct(pct);
  }, []);

  const onSplitPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingSplitRef.current) return;
    draggingSplitRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    localStorage.setItem(SPLIT_KEY, String(rightPctRef.current));
  }, []);

  const resetSplit = useCallback(() => {
    rightPctRef.current = 45;
    setRightPct(45);
    localStorage.setItem(SPLIT_KEY, "45");
  }, []);

  // One request returns the issue plus every sub-resource the page shows; seed each
  // standalone query's cache so those hooks render instantly instead of refetching.
  // They stay disabled until `issue` exists, and staleTime keeps them from refetching.
  const { data: issue, isLoading } = useQuery({
    queryKey: ["issue", slug, projectId, issueId],
    queryFn: async (): Promise<IssueWithCounts> => {
      const { included, ...row } = await apiFetch<IssueBundle>(
        `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/?include=${ISSUE_INCLUDES}`,
      );
      if (!included) return row;
      const key = [slug, projectId, issueId];
      qc.setQueryData(["comments", ...key], included.comments.results);
      qc.setQueryData(["activities", ...key], included.activities);
      qc.setQueryData(["subscribers", ...key], included.subscribers);
      qc.setQueryData(["relations", ...key], included.relations.results);
      qc.setQueryData(["sub-issues", ...key], included.sub_issues.results);
      qc.setQueryData(["issue-modules", ...key], included.modules.results);
      qc.setQueryData(["custom-values", slug, projectId, Number(issueId)], included.custom_values);
      const byId = new Map(included.related_issues.map((r) => [r.id, r]));
      const relatedIds = included.relations.results.map((r) => r.related_issue_id);
      if (relatedIds.length > 0) {
        qc.setQueryData(
          ["related-issues", slug, projectId, relatedIds.join(",")],
          relatedIds.flatMap((id) => byId.get(id) ?? []),
        );
      }
      if (row.parent_id) {
        qc.setQueryData(
          ["parent-issue", slug, projectId, row.parent_id],
          byId.get(row.parent_id) ?? null,
        );
      }
      return { ...row, counts: included.counts };
    },
    enabled: !!slug && !!projectId && !!issueId,
  });

  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: ["comments", slug, projectId, issueId],
    queryFn: () =>
      apiFetch<{ results: Comment[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/comments/`,
      )
        .then((d) => d.results)
        .catch(() => []),
    enabled: !!slug && !!projectId && !!issueId && !!issue,
  });

  const sortedComments = useMemo(() => {
    const list = [...comments];
    list.sort((a, b) => {
      const t = (v: string) => new Date(v).getTime();
      return commentSort === "oldest"
        ? t(a.created_at) - t(b.created_at)
        : t(b.created_at) - t(a.created_at);
    });
    return list;
  }, [comments, commentSort]);

  const { data: states = [] } = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () =>
      apiFetch<{ results: State[] }>(`/workspaces/${slug}/projects/${projectId}/states/`)
        .then((d) => d.results)
        .catch(() => []),
    enabled: !!slug && !!projectId,
  });

  const { data: activitiesData, isLoading: activitiesLoading } = useQuery({
    queryKey: ["activities", slug, projectId, issueId],
    queryFn: () =>
      apiFetch<{ results: IssueActivity[]; total: number }>(
        `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/activities/`,
      ).catch(() => ({ results: [], total: 0 })),
    enabled: !!slug && !!projectId && !!issueId && !!issue,
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

  // --- Assignees ---
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", slug, projectId],
    queryFn: () =>
      apiFetch<{
        results: {
          memberId: string;
          username?: string | null;
          email?: string | null;
          displayName?: string | null;
          avatar?: string | null;
        }[];
      }>(`/workspaces/${slug}/projects/${projectId}/members/`)
        .then((d) => d.results)
        .catch(() => []),
    enabled: !!slug && !!projectId,
  });

  const currentAssigneeIds = new Set((issue?.assignees ?? []).map((a) => a.id));

  const addAssigneeMutation = useMutation({
    mutationFn: (assigneeId: string) =>
      api.addAssignee(slug!, projectId!, Number(issueId!), assigneeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue", slug, projectId, issueId] });
      qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      qc.invalidateQueries({ queryKey: ["my-issues"] });
    },
    onError: () => toast.error("Failed to assign user"),
  });

  const removeAssigneeMutation = useMutation({
    mutationFn: (assigneeId: string) =>
      api.removeAssignee(slug!, projectId!, Number(issueId!), assigneeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issue", slug, projectId, issueId] });
      qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      qc.invalidateQueries({ queryKey: ["my-issues"] });
    },
    onError: () => toast.error("Failed to unassign user"),
  });

  const toggleAssignee = (assigneeId: string) => {
    if (currentAssigneeIds.has(assigneeId)) {
      removeAssigneeMutation.mutate(assigneeId);
    } else {
      addAssigneeMutation.mutate(assigneeId);
    }
  };

  // --- Followers ---
  const { data: subscribersData } = useQuery({
    queryKey: ["subscribers", slug, projectId, issueId],
    queryFn: () => api.listSubscribers(slug!, projectId!, issueId!).catch(() => ({ results: [] })),
    enabled: !!slug && !!projectId && !!issueId && !!issue,
  });
  const subscribed = (subscribersData?.results ?? []).some((s) => s.user?.id === currentUser?.id);
  const followerCount = (subscribersData?.results ?? []).length;

  const followMutation = useMutation({
    mutationFn: () => api.followIssue(slug!, projectId!, issueId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscribers", slug, projectId, issueId] });
      toast.success("You'll get notified about activity on this issue");
    },
    onError: () => toast.error("Failed to follow issue"),
  });

  const unfollowMutation = useMutation({
    mutationFn: () => api.unfollowIssue(slug!, projectId!, issueId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscribers", slug, projectId, issueId] });
      toast.success("Unfollowed — you'll no longer get notified");
    },
    onError: () => toast.error("Failed to unfollow issue"),
  });

  // Workspace members in the shape the mention picker expects.
  const mentionMembers = useMemo(
    () =>
      members.map((m) => ({
        id: m.memberId,
        username: m.username || m.email?.split("@")[0] || m.memberId.slice(0, 8),
        display_name: m.displayName,
        email: m.email,
        avatar: m.avatar,
      })),
    [members],
  );

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
    if (!issue) {
      setEditingTitle(false);
      return;
    }
    if (name && name !== issue.name) updateMutation.mutate({ name });
    setEditingTitle(false);
  }
  function startEditDesc() {
    setDescDraft(issue?.description_html ?? "");
    setEditingDesc(true);
  }
  function saveDesc() {
    if (!issue) {
      setEditingDesc(false);
      return;
    }
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
  const [selectedRelatedIssue, setSelectedRelatedIssue] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showRelationSearch, setShowRelationSearch] = useState(false);

  const { data: relations = [], isLoading: relationsLoading } = useQuery({
    queryKey: ["relations", slug, projectId, issueId],
    queryFn: () =>
      apiFetch<{ results: IssueRelation[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/relations/`,
      )
        .then((d) => d.results)
        .catch(() => []),
    enabled: !!slug && !!projectId && !!issueId && !!issue,
  });

  const { data: relationSearchResults = [], isLoading: relationSearchLoading } = useQuery({
    queryKey: ["issue-search", slug, projectId, relationSearch],
    queryFn: () =>
      apiFetch<{ results: { id: string; name: string; sequence_id: number }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?search=${encodeURIComponent(relationSearch)}&limit=10`,
      ).then((r) =>
        (Array.isArray(r) ? r : r.results).filter((i) => String(i.sequence_id) !== String(issueId)),
      ),
    enabled: !!slug && !!projectId && relationSearch.length >= 2,
  });

  // Fetch related issue details for each relation
  const relatedIssueIds = relations.map((r) => r.related_issue_id);
  const { data: relatedIssues = [] } = useQuery({
    queryKey: ["related-issues", slug, projectId, relatedIssueIds.join(",")],
    queryFn: async () => {
      if (relatedIssueIds.length === 0) return [];
      const all = await apiFetch<{ results: { id: string; name: string; sequence_id: number }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?limit=500`,
      ).then((r) => (Array.isArray(r) ? r : r.results));
      return all.filter((i) => relatedIssueIds.includes(i.id));
    },
    enabled: !!slug && !!projectId && relatedIssueIds.length > 0,
  });

  const relatedIssueMap = new Map(relatedIssues.map((i) => [i.id, i]));

  const addRelationMutation = useMutation({
    mutationFn: ({
      related_issue_id,
      relation_type,
    }: {
      related_issue_id: string;
      relation_type: string;
    }) =>
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
      apiFetch(
        `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/relations/${relationId}/`,
        {
          method: "DELETE",
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["relations", slug, projectId, issueId] });
      toast.success("Relation removed");
    },
    onError: () => toast.error("Failed to remove relation"),
  });

  // --- Sub-issues ---
  const { data: subIssues = [], isLoading: subIssuesLoading } = useQuery({
    queryKey: ["sub-issues", slug, projectId, issueId],
    queryFn: () =>
      apiFetch<{ results: SubIssue[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/sub-issues/`,
      )
        .then((d) => d.results)
        .catch(() => []),
    enabled: !!slug && !!projectId && !!issueId && !!issue,
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
  const {
    data: attachments = [],
    isLoading: attachmentsLoading,
    isFetched: attachmentsFetched,
  } = useQuery({
    queryKey: ["attachments", slug, projectId, issueId],
    queryFn: () =>
      apiFetch<{
        results: {
          id: string;
          issue_id: string;
          asset: string | null;
          attributes: { name?: string; size?: number; type?: string } | null;
          created_at: string | null;
        }[];
      }>(`/workspaces/${slug}/projects/${projectId}/issues/${issueId}/attachments/`).then(
        (d) => d.results,
      ),
    enabled: !!slug && !!projectId && !!issueId && activeTab === "attachments",
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
      apiFetch(
        `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/attachments/${attId}/`,
        {
          method: "DELETE",
        },
      ),
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

  const {
    data: timeEntries = [],
    isLoading: timeEntriesLoading,
    isFetched: timeEntriesFetched,
  } = useQuery({
    queryKey: ["time-entries", slug, projectId, issueId],
    queryFn: () =>
      apiFetch<{ results: TimeEntry[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/time-entries/`,
      ).then((d) => d.results),
    enabled: !!slug && !!projectId && !!issueId && activeTab === "time",
  });

  const totalTimeSeconds = timeEntriesFetched
    ? timeEntries.reduce((sum, e) => sum + e.duration_seconds, 0)
    : (issue?.counts?.time_seconds ?? 0);

  // Issue-scoped agent KPI: token totals + USD cost for this issue's agent
  const { data: agentUsage } = useQuery({
    queryKey: ["agent-usage", slug, issue?.id],
    queryFn: () =>
      apiFetch<{
        results: {
          total_tokens: number;
          input_tokens: number;
          output_tokens: number;
          cache_read_tokens: number;
        }[];
        totals: { total_tokens: number; cost_usd: number | null };
      }>(`/workspaces/${slug}/timesheet/agent-usage/?issue_id=${issue?.id}`).then((d) => d),
    enabled: !!slug && !!issue?.id && activeTab === "time",
  });
  const agentTokens = agentUsage?.totals;

  const logTimeMutation = useMutation({
    mutationFn: ({
      duration_seconds,
      description,
    }: {
      duration_seconds: number;
      description?: string;
    }) =>
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
      apiFetch(
        `/workspaces/${slug}/projects/${projectId}/issues/${issueId}/time-entries/${entryId}/`,
        {
          method: "DELETE",
        },
      ),
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
        `/workspaces/${slug}/projects/${projectId}/issues/?limit=500`,
      ).then((r) => (Array.isArray(r) ? r : r.results));
      return all.find((i) => i.id === issue.parent_id) || null;
    },
    enabled: !!slug && !!projectId && !!issue?.parent_id,
  });

  // --- Modules ---
  const { data: issueModules = [], isLoading: issueModulesLoading } = useQuery({
    queryKey: ["issue-modules", slug, projectId, issueId],
    queryFn: () => api.listIssueModules(slug!, projectId!, Number(issueId!)).catch(() => []),
    enabled: !!slug && !!projectId && !!issueId && !!issue,
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

  // State pill: the state's group picks the color family; the dot keeps the
  // state's own color when the project defines one.
  const currentState = issue?.state ?? states.find((s) => s.id === issue?.state_id) ?? null;

  if (isLoading) return <IssueDetailSkeleton />;

  if (!issue) {
    return (
      <EmptyState
        className="m-6"
        title="Issue not found"
        description="It may have been deleted, or the link is wrong."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/${slug}/projects/${projectId}`)}
          >
            Back to project
          </Button>
        }
      />
    );
  }

  const attachmentCount = attachmentsFetched
    ? attachments.length
    : (issue.counts?.attachments ?? 0);

  return (
    <div className="flex flex-col h-[calc(100dvh-7rem)] md:h-[calc(100dvh-3.5rem)] -m-4 md:-m-6 lg:-m-8">
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {/* Breadcrumb: project › issue key (ops-console topbar, mono key) */}
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
          <Link
            to={`/${slug}/projects/${projectId}`}
            className="truncate rounded text-[0.8125rem] text-muted-foreground hover:text-foreground"
          >
            {issue.project_detail?.name || "Project"}
          </Link>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-ops-mono text-[0.8125rem] font-bold whitespace-nowrap">
            {issue.project_detail?.identifier || "PROJ"}-
            {String(issue.sequence_id).padStart(4, "0")}
          </span>
        </nav>
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
              This will permanently delete {issue.project_detail?.identifier || "PROJ"}-
              {String(issue.sequence_id).padStart(4, "0")} "{issue.name}" and all of its data. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={deleteIssueMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteIssueMutation.mutate()}
              disabled={deleteIssueMutation.isPending}
            >
              {deleteIssueMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div ref={splitContainerRef} className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="px-4 md:px-5 lg:px-6 pt-4 md:pt-5 lg:pt-6 pb-6">
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
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={saveTitle}
                  aria-label="Save title"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setEditingTitle(false)}
                  aria-label="Cancel"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1 mb-4 group">
                <h1 className="text-[24px]/[29px] font-extrabold tracking-[-0.6px]">
                  {issue.name}
                </h1>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={startEditTitle}
                  aria-label="Edit title"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {editingDesc ? (
              <div className="mb-6">
                <CommentEditor
                  value={descDraft}
                  onChange={setDescDraft}
                  placeholder="Add a description..."
                  members={mentionMembers}
                />
                <div className="flex items-center gap-2 mt-2">
                  <Button size="sm" onClick={saveDesc}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingDesc(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mb-6 group">
                <div className="rounded-[12px] border border-border bg-[var(--surface-elevated)] py-[18px] px-5">
                  {issue.description_html ? (
                    <div className="text-sm leading-[23px] text-muted-foreground max-w-none prose prose-sm">
                      <CommentContent html={issue.description_html} />
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm italic">No description provided</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 mt-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={startEditDesc}
                >
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowRelationSearch(true)}
                  >
                    Add Relation
                  </Button>
                )}
              </div>

              {showRelationSearch && (
                <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Search Issue
                    </label>
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
                              <span className="font-ops-mono text-muted-foreground text-xs">
                                #{String(i.sequence_id).padStart(4, "0")}
                              </span>
                              <span className="truncate">{i.name}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Relation Type
                    </label>
                    <Select value={relationType} onValueChange={setRelationType}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(RELATION_TYPE_LABELS).map(([key, { label }]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
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
                <div className="animate-pulse text-sm text-muted-foreground">
                  Loading relations...
                </div>
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
                        <Badge variant="secondary" className={`text-xs shrink-0 ${relInfo.color}`}>
                          {relInfo.label}
                        </Badge>
                        {relIssue ? (
                          <button
                            className="text-sm hover:underline truncate flex-1 text-left"
                            onClick={() =>
                              navigate(
                                `/${slug}/projects/${projectId}/issues/${relIssue.sequence_id}`,
                              )
                            }
                          >
                            <span className="font-ops-mono text-muted-foreground mr-1">
                              #{String(relIssue.sequence_id).padStart(4, "0")}
                            </span>
                            {relIssue.name}
                          </button>
                        ) : (
                          <span className="text-sm text-muted-foreground flex-1">Loading...</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-destructive"
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
                    onClick={() =>
                      navigate(`/${slug}/projects/${projectId}/issues/${parentIssue.sequence_id}`)
                    }
                  >
                    <GitBranch className="h-3 w-3" />
                    <span className="font-ops-mono text-muted-foreground">
                      #{String(parentIssue.sequence_id).padStart(4, "0")}
                    </span>
                    {parentIssue.name}
                  </button>
                </div>
              )}

              {subIssuesLoading ? (
                <div className="animate-pulse text-sm text-muted-foreground">
                  Loading sub-issues...
                </div>
              ) : subIssues.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No sub-issues</p>
              ) : (
                <div className="space-y-2">
                  {subIssues.map((si) => (
                    <div
                      key={si.id}
                      className="flex items-center gap-2 p-2 border rounded-md cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() =>
                        navigate(`/${slug}/projects/${projectId}/issues/${si.sequence_id}`)
                      }
                    >
                      <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="font-ops-mono text-muted-foreground text-xs">
                        #{String(si.sequence_id).padStart(4, "0")}
                      </span>
                      <span className="text-sm truncate flex-1">{si.name}</span>
                      {si.priority && si.priority !== "none" && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          {si.priority}
                        </Badge>
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
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  disabled={!newSubIssue.trim() || createSubIssueMutation.isPending}
                >
                  {createSubIssueMutation.isPending ? "..." : "Add"}
                </Button>
              </form>
            </div>
          </div>
        </div>

        {/* Drag handle between detail and comments panes (desktop only) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize detail and comments panes"
          title="Drag to resize · double-click to reset"
          className="hidden md:block w-1.5 shrink-0 cursor-col-resize touch-none bg-border/40 hover:bg-primary/60 active:bg-primary transition-colors"
          onPointerDown={onSplitPointerDown}
          onPointerMove={onSplitPointerMove}
          onPointerUp={onSplitPointerUp}
          onPointerCancel={onSplitPointerUp}
          onDoubleClick={resetSplit}
        />

        {/* Comments / Activity / Attachments / Time */}
        <div className="hidden md:flex flex-col shrink-0" style={{ width: `${rightPct}%` }}>
          {/* Properties: sticky rail above the tabs so state/dates stay in view */}
          <div className="shrink-0 max-h-[50%] overflow-y-auto border-b bg-[var(--surface-card)] px-4 py-3">
            <div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <label className="font-ops-mono text-xs font-medium text-muted-foreground mb-1 block">
                    Follow
                  </label>
                  <Button
                    variant={subscribed ? "secondary" : "outline"}
                    size="sm"
                    className="h-7 w-full text-xs gap-1"
                    onClick={() =>
                      subscribed ? unfollowMutation.mutate() : followMutation.mutate()
                    }
                    disabled={followMutation.isPending || unfollowMutation.isPending}
                  >
                    <Bell className="h-3 w-3" />
                    {subscribed ? "Following" : "Follow"}
                    {followerCount > 0 && (
                      <span className="ml-auto text-muted-foreground text-xs">{followerCount}</span>
                    )}
                  </Button>
                </div>

                <div>
                  <label className="font-ops-mono text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <User className="h-3 w-3" /> Assignee
                  </label>
                  <div className="space-y-1.5">
                    {currentAssigneeIds.size > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(issue.assignees ?? []).map((a) => (
                          <Badge key={a.id} variant="secondary" className="text-xs gap-1 pr-1">
                            <Avatar className="h-4 w-4">
                              {a.avatar ? (
                                <AvatarImage
                                  src={a.avatar}
                                  alt={a.display_name || a.email || "User"}
                                />
                              ) : null}
                              <AvatarFallback className="text-xs">
                                {(a.display_name || a.email || a.username || "?")
                                  .charAt(0)
                                  .toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            {a.display_name || a.email || a.username}
                            <button
                              className="ml-0.5 hover:text-destructive"
                              onClick={() => removeAssigneeMutation.mutate(a.id)}
                              disabled={removeAssigneeMutation.isPending}
                              aria-label="Remove assignee"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <Select value="" onValueChange={(v) => v && toggleAssignee(v)}>
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue
                          placeholder={
                            currentAssigneeIds.size > 0 ? "Add assignee..." : "Assign to someone..."
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map((m) => (
                          <SelectItem key={m.memberId} value={m.memberId}>
                            {m.displayName || m.username || m.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {currentUser && !currentAssigneeIds.has(currentUser.id) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-full text-xs gap-1"
                        onClick={() => addAssigneeMutation.mutate(currentUser.id)}
                        disabled={addAssigneeMutation.isPending}
                      >
                        <User className="h-3 w-3" /> Assign to me
                      </Button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="font-ops-mono text-xs font-medium text-muted-foreground mb-1 block">
                    State
                  </label>
                  <Select
                    value={issue.state_id || ""}
                    onValueChange={(v) => updateMutation.mutate({ state_id: v })}
                  >
                    <SelectTrigger
                      className="state-badge h-6 w-fit cursor-pointer gap-1.5 border-0 shadow-none [&>svg]:h-3 [&>svg]:w-3 [&>svg]:opacity-70"
                      data-state-group={currentState?.group}
                      style={
                        currentState?.color
                          ? ({ "--badge-c": currentState.color } as React.CSSProperties)
                          : undefined
                      }
                    >
                      {currentState ? (
                        currentState.name
                      ) : (
                        <span className="font-normal">Set state</span>
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {states.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: s.color || "var(--state-backlog)" }}
                            />
                            {s.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="font-ops-mono text-xs font-medium text-muted-foreground mb-1 block">
                    Priority
                  </label>
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
                            <span className="priority-dot" data-priority={p} />
                            {PRIORITY_LABELS[p]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="font-ops-mono text-xs font-medium text-muted-foreground mb-1 block">
                    Estimate (pts)
                  </label>
                  <Select
                    value={
                      issue.estimate_points != null ? String(issue.estimate_points) : "__none__"
                    }
                    onValueChange={(v) =>
                      updateMutation.mutate({
                        estimate_points: v === "__none__" ? null : Number(v),
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-sm font-ops-mono">
                      <SelectValue placeholder="No estimate" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {[0, 1, 2, 3, 5, 8, 13, 21].map((p) => (
                        <SelectItem key={p} value={String(p)}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="font-ops-mono text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Start Date
                  </label>
                  <DatePicker
                    value={issue.start_date}
                    onChange={(v) => updateMutation.mutate({ start_date: v })}
                  />
                </div>

                <div>
                  <label className="font-ops-mono text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Target Date
                  </label>
                  <DatePicker
                    value={issue.target_date}
                    onChange={(v) => updateMutation.mutate({ target_date: v })}
                  />
                </div>

                <div>
                  <label className="font-ops-mono text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
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
                      {projectModules.length > 0 &&
                        (() => {
                          const issueModuleIds = new Set(issueModules.map((m: Module) => m.id));
                          const available = projectModules.filter((m) => !issueModuleIds.has(m.id));
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
                                {available.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>
                                    {m.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : issueModules.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">
                              No modules available
                            </p>
                          ) : null;
                        })()}
                      {projectModules.length === 0 && issueModules.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">
                          No modules in project
                        </p>
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
              <Separator className="my-4" />
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <label className="font-ops-mono text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Created
                  </label>
                  <p className="font-ops-mono text-sm">
                    {new Date(issue.created_at).toLocaleDateString()}
                  </p>
                </div>

                <div>
                  <label className="font-ops-mono text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Updated
                  </label>
                  <p className="font-ops-mono text-sm">
                    {formatDistanceToNow(new Date(issue.updated_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-1 border-b px-3 pt-1 overflow-x-auto shrink-0">
            <button
              className={`whitespace-nowrap px-2.5 py-1.5 text-[0.8125rem] font-medium border-b-2 transition-colors ${
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
              className={`whitespace-nowrap px-2.5 py-1.5 text-[0.8125rem] font-medium border-b-2 transition-colors ${
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
              className={`whitespace-nowrap px-2.5 py-1.5 text-[0.8125rem] font-medium border-b-2 transition-colors ${
                activeTab === "attachments"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("attachments")}
            >
              <Paperclip className="h-3.5 w-3.5 inline mr-1" />
              Attachments ({attachmentCount})
            </button>
            <button
              className={`whitespace-nowrap px-2.5 py-1.5 text-[0.8125rem] font-medium border-b-2 transition-colors ${
                activeTab === "time"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("time")}
            >
              <Timer className="h-3.5 w-3.5 inline mr-1" />
              Time ({Math.floor(totalTimeSeconds / 3600)}h{" "}
              {Math.floor((totalTimeSeconds % 3600) / 60)}m)
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === "comments" && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {sortedComments.length} comments
                  </span>
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
                  <div className="animate-pulse text-sm text-muted-foreground">
                    Loading comments...
                  </div>
                ) : (
                  <div className="space-y-4">
                    {sortedComments.map((c) => {
                      const isMine = c.actor_id === currentUser?.id;
                      // Evidence-first: comments that embed images (pasted/dropped
                      // shots) or spell out evidence get the amber proof panel;
                      // plain prose keeps the standard thread look.
                      // comment_stripped is null on this API — read the text
                      // signal out of the HTML instead.
                      const isEvidence =
                        /<img\b/i.test(c.comment_html) ||
                        /evidence/i.test(c.comment_html.replace(/<[^>]*>/g, " "));
                      const body =
                        editingCommentId === c.id ? (
                          <div className="space-y-2">
                            <CommentEditor
                              value={editCommentText}
                              onChange={setEditCommentText}
                              placeholder="Edit comment..."
                              resetKey={editingCommentId}
                              members={mentionMembers}
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                disabled={
                                  !editCommentText.replace(/<[^>]*>/g, "").trim() ||
                                  editCommentMutation.isPending
                                }
                                onClick={() =>
                                  editCommentMutation.mutate({
                                    commentId: c.id,
                                    comment_html: editCommentText,
                                  })
                                }
                              >
                                {editCommentMutation.isPending ? "Saving..." : "Save"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingCommentId(null);
                                  setEditCommentText("");
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={
                              isEvidence
                                ? "text-[13.5px] leading-[21px] text-foreground"
                                : "text-sm"
                            }
                          >
                            <CommentContent html={c.comment_html} />
                          </div>
                        );
                      if (isEvidence) {
                        return (
                          <div
                            key={c.id}
                            className="group rounded-[12px] border px-5 py-[18px]"
                            style={{
                              backgroundColor: "var(--state-amber-soft)",
                              borderColor: "var(--state-amber)",
                            }}
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <CheckCircle2
                                className="h-4 w-4 shrink-0"
                                style={{ color: "var(--state-amber)" }}
                              />
                              <span
                                className="text-sm font-bold truncate"
                                style={{ color: "var(--state-amber)" }}
                              >
                                {c.actor_detail?.display_name || "User"} posted evidence
                              </span>
                              <span className="ml-auto font-ops-mono text-xs text-muted-foreground shrink-0">
                                {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                              </span>
                              {isMine && editingCommentId !== c.id && (
                                <button
                                  className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                                  onClick={() => startEditComment(c)}
                                  aria-label="Edit comment"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            {body}
                          </div>
                        );
                      }
                      return (
                        <div key={c.id} className="flex gap-3 group">
                          <Avatar className="h-8 w-8">
                            {c.actor_detail?.avatar ? (
                              <AvatarImage
                                src={c.actor_detail.avatar}
                                alt={c.actor_detail?.display_name || "User"}
                              />
                            ) : null}
                            <AvatarFallback className="text-xs">
                              {c.actor_detail?.display_name?.charAt(0) || "U"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium">
                                {c.actor_detail?.display_name || "User"}
                              </span>
                              <span className="font-ops-mono text-xs text-muted-foreground">
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
                            {body}
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
                  <div className="animate-pulse text-sm text-muted-foreground">
                    Loading activity...
                  </div>
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
                            <span className="font-ops-mono text-xs text-muted-foreground ml-2">
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
                    {attachmentCount} file{attachmentCount !== 1 ? "s" : ""}
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
                  <div className="animate-pulse text-sm text-muted-foreground">
                    Loading attachments...
                  </div>
                ) : attachments.length === 0 ? (
                  <div className="text-center py-8 border border-dashed rounded-lg">
                    <Paperclip className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No attachments yet</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Upload files or drag & drop here
                    </p>
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
                                <img
                                  src={resolveApiUrl(att.asset)}
                                  alt={name}
                                  className="h-10 w-10 object-cover"
                                />
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
                            <p className="font-ops-mono text-xs text-muted-foreground">
                              {fmtSize}
                              {type && ` · ${type}`}
                              {att.created_at &&
                                ` · ${formatDistanceToNow(new Date(att.created_at), { addSuffix: true })}`}
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
                              className="h-7 w-7 text-destructive"
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
                  <h4 className="font-ops-mono text-xs font-semibold mb-2">Log Time</h4>
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
                        parseInt(timeHours || "0") * 3600 + parseInt(timeMinutes || "0") * 60;
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
                  <span className="font-ops-mono text-sm font-medium">
                    Total: {Math.floor(totalTimeSeconds / 3600)}h{" "}
                    {Math.floor((totalTimeSeconds % 3600) / 60)}m
                  </span>
                  {agentTokens && agentTokens.total_tokens > 0 && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-ops-mono text-xs text-muted-foreground">
                      agent: {(agentTokens.total_tokens / 1000).toFixed(1)}k tokens
                      {agentTokens.cost_usd != null &&
                        ` · $${agentTokens.cost_usd < 0.01 && agentTokens.cost_usd > 0 ? agentTokens.cost_usd.toFixed(4) : agentTokens.cost_usd.toFixed(2)}`}
                    </span>
                  )}
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
                            <p className="font-ops-mono text-sm font-medium">
                              {hrs}h {mins}m
                              {entry.source === "agent" && (
                                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-ops-mono text-xs font-normal text-muted-foreground">
                                  {entry.agent_name ?? "agent"}
                                  {entry.model ? ` · ${entry.model}` : ""}
                                  {(entry.input_tokens != null || entry.output_tokens != null) &&
                                    ` · ${((entry.input_tokens ?? 0) / 1000).toFixed(1)}k in / ${((entry.output_tokens ?? 0) / 1000).toFixed(1)}k out`}
                                  {!!entry.cache_read_tokens &&
                                    ` · ${(entry.cache_read_tokens / 1e6).toFixed(1)}M cached`}
                                </span>
                              )}
                            </p>
                            {entry.description && (
                              <p className="text-xs text-muted-foreground truncate">
                                {entry.description}
                              </p>
                            )}
                            {entry.created_at && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {formatDistanceToNow(new Date(entry.created_at), {
                                  addSuffix: true,
                                })}
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive shrink-0"
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
          {activeTab === "comments" && (
            <div className="shrink-0 border-t p-3">
              <div className="flex gap-3">
                <Avatar className="h-8 w-8">
                  {currentUser?.avatar ? (
                    <AvatarImage
                      src={currentUser.avatar}
                      alt={currentUser.display_name || "User"}
                    />
                  ) : null}
                  <AvatarFallback className="text-xs">
                    {(currentUser?.display_name || currentUser?.username || "Y")
                      .charAt(0)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-2">
                  <CommentEditor
                    value={commentText}
                    onChange={(html) => setCommentText(html)}
                    onSubmit={() => {
                      if (
                        commentText.replace(/<[^>]*>/g, "").trim() &&
                        !commentMutation.isPending
                      ) {
                        commentMutation.mutate({
                          comment_html: commentText,
                          access: commentPublic ? "public" : "internal",
                        });
                      }
                    }}
                    placeholder="Add a comment..."
                    resetKey={commentResetKey}
                    members={mentionMembers}
                  />
                  <div className="flex items-center gap-3">
                    {issue?.external_source === "portal" && (
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
                    {/* Primary action — the design's strong light button ("only
                        humans merge" spirit); this page's human-only action is
                        posting the response. Handler unchanged. */}
                    <Button
                      size="sm"
                      className="h-8 rounded-[11px] bg-primary px-4 text-[13px] font-bold text-primary-foreground shadow-none"
                      disabled={
                        !commentText.replace(/<[^>]*>/g, "").trim() || commentMutation.isPending
                      }
                      onClick={() =>
                        commentMutation.mutate({
                          comment_html: commentText,
                          access: commentPublic ? "public" : "internal",
                        })
                      }
                    >
                      {commentMutation.isPending ? "Sending..." : "Comment"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { api, type Note } from "@/lib/api";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import {
  activeMentionQuery,
  buildCandidates,
  filterCandidates,
  mentionHref,
  parseNoteTokens,
  resolveToken,
  type MentionCandidate,
} from "@/lib/mentions";
import { Button } from "@/components/ui/button";
import { Pencil, StickyNote, Trash2 } from "@/lib/icons";

const NOTES_KEY = ["notes"];

// ── Rendered note text ──────────────────────────────────────────────────────
// @tokens are live links when they resolve against the loaded candidate pool;
// unresolved tokens render as muted text so old notes never break.

function mentionTitle(c: MentionCandidate) {
  return c.sublabel ? `${c.label} — ${c.sublabel}` : c.label;
}

function NoteContent({
  content,
  candidates,
  currentSlug,
}: {
  content: string;
  candidates: MentionCandidate[];
  currentSlug?: string;
}) {
  const tokens = parseNoteTokens(content);
  if (tokens.length === 0) return <>{content}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((t, i) => {
    if (t.at > cursor) parts.push(content.slice(cursor, t.at));
    const resolved = t.kind ? resolveToken(t.token, candidates, currentSlug) : null;
    if (t.kind && resolved) {
      const href = mentionHref(t.kind, resolved);
      const chip = (
        <span className="mention-chip" title={mentionTitle(resolved)}>
          @{t.token}
        </span>
      );
      parts.push(
        href ? (
          <Link key={i} to={href} onClick={(e) => e.stopPropagation()}>
            {chip}
          </Link>
        ) : (
          <span key={i}>{chip}</span>
        ),
      );
    } else {
      parts.push(
        <span key={i} className="text-muted-foreground">
          @{t.token}
        </span>,
      );
    }
    cursor = t.end;
  });
  if (cursor < content.length) parts.push(content.slice(cursor));
  return <>{parts}</>;
}

// ── Page ─────────────────────────────────────────────────────────────────────

interface MentionState {
  query: string;
  start: number;
}

export default function NotesPage() {
  const { slug } = useParams();
  const qc = useQueryClient();

  const notesQuery = useQuery({ queryKey: NOTES_KEY, queryFn: () => api.listNotes() });
  const workspacesQuery = useWorkspaces();
  const projectsQuery = useQuery({
    queryKey: ["me-projects"],
    queryFn: () => api.listAllProjects(),
  });
  // Recent issues only — the picker suggests, it doesn't enumerate the portfolio.
  const issuesQuery = useQuery({
    queryKey: ["me-issues", { limit: 100 }],
    queryFn: () => api.listAllIssues({ limit: 100 }),
  });

  const candidates = useMemo(
    () =>
      buildCandidates(workspacesQuery.data ?? [], projectsQuery.data ?? [], issuesQuery.data ?? []),
    [workspacesQuery.data, projectsQuery.data, issuesQuery.data],
  );

  // ── Composer + mention picker ──
  const [content, setContent] = useState("");
  const [mention, setMention] = useState<MentionState | null>(null);
  const [highlight, setHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const filtered = mention ? filterCandidates(mention.query, candidates) : [];

  function onComposerChange(value: string, caret: number) {
    setContent(value);
    setMention(activeMentionQuery(value.slice(0, caret)));
    setHighlight(0);
  }

  function selectMention(candidate: MentionCandidate) {
    if (!mention) return;
    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? content.length;
    const pos = mention.start + candidate.token.length + 1; // token + trailing space
    const next = `${content.slice(0, mention.start)}${candidate.token} ${content.slice(caret)}`;
    setContent(next);
    setMention(null);
    // Restore focus + caret after React commits the new value.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  const addNote = useMutation({
    mutationFn: (content: string) => api.createNote(content),
    // Optimistic: the note appears immediately, reconciled with the server row.
    onMutate: async (content) => {
      await qc.cancelQueries({ queryKey: NOTES_KEY });
      const prev = qc.getQueryData<Note[]>(NOTES_KEY);
      const tempId = `temp-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      qc.setQueryData<Note[]>(NOTES_KEY, [
        { id: tempId, user_id: "", content, created_at: now, updated_at: now },
        ...(prev ?? []),
      ]);
      return { prev, tempId };
    },
    onError: (_err, _content, ctx) => {
      if (ctx?.prev) qc.setQueryData(NOTES_KEY, ctx.prev);
      toast.error("Couldn't save the note");
    },
    onSuccess: (note, _content, ctx) => {
      qc.setQueryData<Note[]>(NOTES_KEY, (old) => [
        note,
        ...(old ?? []).filter((n) => n.id !== ctx?.tempId),
      ]);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: NOTES_KEY }),
  });

  function submit() {
    const trimmed = content.trim();
    if (!trimmed || addNote.isPending) return;
    addNote.mutate(trimmed);
    setContent("");
    setMention(null);
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const picked = filtered[highlight];
        if (picked) selectMention(picked);
        return;
      }
      if (e.key === "Escape") {
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // ── Edit / delete ──
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const updateNote = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => api.updateNote(id, content),
    onMutate: async ({ id, content }) => {
      await qc.cancelQueries({ queryKey: NOTES_KEY });
      const prev = qc.getQueryData<Note[]>(NOTES_KEY);
      qc.setQueryData<Note[]>(NOTES_KEY, (old) =>
        (old ?? []).map((n) => (n.id === id ? { ...n, content } : n)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(NOTES_KEY, ctx.prev);
      toast.error("Couldn't update the note");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: NOTES_KEY }),
  });

  const deleteNote = useMutation({
    mutationFn: (id: string) => api.deleteNote(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: NOTES_KEY });
      const prev = qc.getQueryData<Note[]>(NOTES_KEY);
      qc.setQueryData<Note[]>(NOTES_KEY, (old) => (old ?? []).filter((n) => n.id !== id));
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(NOTES_KEY, ctx.prev);
      toast.error("Couldn't delete the note");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: NOTES_KEY }),
  });

  const notes = notesQuery.data ?? [];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <StickyNote className="h-5 w-5" />
        <h1 className="text-xl font-bold">Notes</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Your braindump. Type @ to link a workspace, project, or task.
      </p>

      {/* Composer */}
      <div className="relative mb-6">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) =>
            onComposerChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }
          onKeyDown={onComposerKeyDown}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          placeholder="What's on your mind?"
          rows={2}
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {mention && filtered.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-lg border bg-popover shadow-md overflow-hidden">
            {filtered.map((c, i) => (
              <button
                key={`${c.kind}-${c.token}-${c.projectId ?? ""}`}
                type="button"
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                  i === highlight ? "bg-accent" : ""
                }`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  // mousedown, not click — click would blur the textarea first
                  e.preventDefault();
                  selectMention(c);
                }}
              >
                <span className="mention-chip">@{c.token}</span>
                <span className="truncate flex-1">{c.label}</span>
                {c.sublabel && (
                  <span className="text-xs text-muted-foreground truncate">{c.sublabel}</span>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between mt-1.5 px-0.5">
          <span className="text-xs text-muted-foreground">
            Enter to save · Shift+Enter for a new line
          </span>
        </div>
      </div>

      {/* Notes */}
      {notesQuery.isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-pulse text-muted-foreground">Loading notes...</div>
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-16">
          <StickyNote className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-1">No notes yet</h3>
          <p className="text-muted-foreground text-sm">
            Dump a thought above — link it to work with @mentions.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((note) =>
            editingId === note.id ? (
              <div key={note.id} className="rounded-lg border bg-card p-3">
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const trimmed = draft.trim();
                      if (!trimmed) return;
                      updateNote.mutate({ id: note.id, content: trimmed });
                      setEditingId(null);
                    }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  rows={3}
                  className="w-full text-sm bg-transparent resize-none focus:outline-none"
                />
                <div className="flex justify-end gap-2 mt-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      const trimmed = draft.trim();
                      if (!trimmed) return;
                      updateNote.mutate({ id: note.id, content: trimmed });
                      setEditingId(null);
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={note.id}
                className="group rounded-lg border bg-card p-3 hover:bg-accent/40 transition-colors"
              >
                <div className="whitespace-pre-wrap text-sm break-words">
                  <NoteContent content={note.content} candidates={candidates} currentSlug={slug} />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-muted-foreground">
                    {note.created_at
                      ? formatDistanceToNow(new Date(note.created_at), { addSuffix: true })
                      : "saving…"}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      aria-label="Edit note"
                      onClick={() => {
                        setEditingId(note.id);
                        setDraft(note.content);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      aria-label="Delete note"
                      onClick={() => {
                        if (window.confirm("Delete this note?")) deleteNote.mutate(note.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { feedbackApi, FeedbackApiError, type FeedbackItem } from "@/lib/feedbackApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// ── Inline icons (self-contained; avoids hugeicons export guessing) ──
const ThumbsUpIcon = ({
  filled = false,
  ...p
}: { filled?: boolean } & React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M7 10v12" />
    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L14 2a3.13 3.13 0 0 1 3 3.88Z" />
  </svg>
);
const MessageIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const PlusIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const EMAIL_KEY = (token: string) => `atur-fb-email:${token}`;

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function FeedbackPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [search] = useSearchParams();
  const embed = search.get("embed") === "1";
  const qc = useQueryClient();

  const [email, setEmail] = useState<string>(() =>
    token ? (localStorage.getItem(EMAIL_KEY(token)) ?? "") : "",
  );
  const [submitOpen, setSubmitOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const boardKey = ["feedback-board", token, email] as const;

  const boardQ = useQuery({
    queryKey: boardKey,
    queryFn: () => feedbackApi.getBoard(token!, email || undefined),
    enabled: !!token,
    retry: false,
  });

  const storeEmail = (value: string) => {
    const v = value.trim();
    if (token) localStorage.setItem(EMAIL_KEY(token), v);
    setEmail(v);
  };

  const voteMut = useMutation({
    mutationFn: (itemId: string) => feedbackApi.vote(token!, itemId, email || undefined),
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey: boardKey });
      const prev = qc.getQueryData<{ board: unknown; items: FeedbackItem[] }>(boardKey);
      if (prev) {
        qc.setQueryData(boardKey, {
          ...prev,
          items: prev.items.map((it) =>
            it.id === itemId
              ? { ...it, voted: !it.voted, votes: it.votes + (it.voted ? -1 : 1) }
              : it,
          ),
        });
      }
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(boardKey, ctx.prev);
      toast.error("Could not register your vote");
    },
    onSuccess: () => {
      // keep optimistic state; invalidate quietly to reconcile counts
      qc.invalidateQueries({ queryKey: boardKey });
      if (detailId) qc.invalidateQueries({ queryKey: ["feedback-item", token, detailId, email] });
    },
  });

  if (!token) return <Centered>Invalid board link.</Centered>;
  if (boardQ.isLoading) {
    return (
      <Centered>
        <Spinner /> Loading board…
      </Centered>
    );
  }
  if (boardQ.isError) {
    const status = boardQ.error instanceof FeedbackApiError ? boardQ.error.status : 0;
    return (
      <Centered>
        <p className="text-muted-foreground">
          {status === 404
            ? "This feedback board was not found or has been disabled."
            : "Could not load the board."}
        </p>
      </Centered>
    );
  }

  const data = boardQ.data;
  if (!data) return null;
  const { board, items } = data;

  if (board.require_email && !email) {
    return <EmailGate brand={board.brand_color} onSubmit={storeEmail} title={board.title} />;
  }

  return (
    <div
      className={
        embed
          ? "flex h-[100dvh] flex-col bg-background text-foreground"
          : "min-h-[100dvh] bg-background text-foreground"
      }
    >
      <header
        className={embed ? "shrink-0 border-b border-border px-4 py-3" : "border-b border-border"}
        style={embed ? undefined : undefined}
      >
        <div className={embed ? undefined : "mx-auto max-w-2xl px-5 py-10"}>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: board.brand_color }}
            />
            <h1 className={embed ? "text-base font-semibold" : "text-2xl font-bold tracking-tight"}>
              {board.title}
            </h1>
          </div>
          {!embed && board.description && (
            <p className="mt-2 text-sm text-muted-foreground">{board.description}</p>
          )}
          {!embed && (
            <p className="mt-3 text-xs text-muted-foreground">
              Suggest an idea, vote on what matters, and track our progress.
            </p>
          )}
        </div>
      </header>

      <div
        className={
          embed
            ? "min-h-0 flex-1 overflow-y-auto px-4 py-3"
            : "mx-auto w-full max-w-2xl flex-1 px-5 py-6"
        }
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {items.length} {items.length === 1 ? "idea" : "ideas"}
          </span>
          {board.allow_submit && (
            <Button
              size="sm"
              onClick={() => setSubmitOpen(true)}
              style={{ background: board.brand_color, color: "#fff" }}
            >
              <PlusIcon /> New idea
            </Button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="mt-10 text-center text-sm text-muted-foreground">
            No ideas yet. Be the first to suggest one.
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  onClick={() => setDetailId(it.id)}
                  className="flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
                >
                  <VoteButton
                    voted={it.voted}
                    count={it.votes}
                    disabled={!board.allow_voting}
                    brand={board.brand_color}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!board.allow_voting) return;
                      voteMut.mutate(it.id);
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{it.name}</p>
                    {it.description && !embed && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {it.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      {it.state && (
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            background: (it.state.color || "#888") + "22",
                            color: it.state.color || "#888",
                          }}
                        >
                          {it.state.name}
                        </span>
                      )}
                      {board.allow_comments && (
                        <span className="inline-flex items-center gap-1">
                          <MessageIcon /> {it.comment_count}
                        </span>
                      )}
                      {it.author_name && <span>· {it.author_name}</span>}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        token={token}
        email={email}
        requireEmail={board.require_email}
        brand={board.brand_color}
        onCreated={() => {
          setSubmitOpen(false);
          qc.invalidateQueries({ queryKey: boardKey });
          toast.success("Thanks! Your idea was posted.");
        }}
      />

      <DetailDialog
        issueId={detailId}
        onClose={() => setDetailId(null)}
        token={token}
        email={email}
        brand={board.brand_color}
        allowVoting={board.allow_voting}
        allowComments={board.allow_comments}
      />
    </div>
  );
}

// ── Sub-components ──

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6 text-center text-sm text-foreground">
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent align-middle" />
  );
}

function VoteButton({
  voted,
  count,
  disabled,
  brand,
  onClick,
}: {
  voted: boolean;
  count: number;
  disabled?: boolean;
  brand: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={voted}
      className="flex shrink-0 flex-col items-center justify-center rounded-md border px-2 py-1 transition-colors disabled:opacity-40"
      style={
        voted
          ? { background: brand, color: "#fff", borderColor: brand }
          : { borderColor: "var(--border)", color: "var(--muted-foreground)" }
      }
    >
      <ThumbsUpIcon filled={voted} />
      <span className="mt-0.5 text-xs font-semibold">{count}</span>
    </button>
  );
}

function EmailGate({
  brand,
  onSubmit,
  title,
}: {
  brand: string;
  onSubmit: (email: string) => void;
  title: string;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: brand }} />
        <h1 className="mt-2 text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email to view and vote on ideas.
        </p>
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!value.trim()) return;
            onSubmit(value);
          }}
        >
          <Input
            type="email"
            required
            placeholder="you@example.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" className="w-full" style={{ background: brand, color: "#fff" }}>
            Continue
          </Button>
        </form>
      </div>
    </div>
  );
}

function SubmitDialog({
  open,
  onOpenChange,
  token,
  email,
  requireEmail,
  brand,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string;
  email: string;
  requireEmail: boolean;
  brand: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [emailField, setEmailField] = useState(email);

  const mut = useMutation({
    mutationFn: () =>
      feedbackApi.createItem(token, {
        title: title.trim(),
        description: description.trim() || undefined,
        name: name.trim() || undefined,
        email: (requireEmail ? emailField : email || emailField) || undefined,
        source: "portal",
      }),
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setName("");
      onCreated();
    },
    onError: (e) => {
      const msg = e instanceof FeedbackApiError ? e.message : "Could not submit. Try again.";
      toast.error(msg);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share your idea</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim().length < 3) return;
            mut.mutate();
          }}
        >
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <Input
              required
              minLength={3}
              maxLength={120}
              placeholder="A short summary of your idea"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Details (optional)</label>
            <Textarea
              maxLength={4000}
              rows={4}
              placeholder="Describe the problem or what you'd like to see"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name (optional)</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
            {(requireEmail || !email) && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Email {requireEmail ? "" : "(optional)"}
                </label>
                <Input
                  type="email"
                  value={emailField}
                  onChange={(e) => setEmailField(e.target.value)}
                  required={requireEmail}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mut.isPending}
              style={{ background: brand, color: "#fff" }}
            >
              {mut.isPending ? "Posting…" : "Post idea"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({
  issueId,
  onClose,
  token,
  email,
  brand,
  allowVoting,
  allowComments,
}: {
  issueId: string | null;
  onClose: () => void;
  token: string;
  email: string;
  brand: string;
  allowVoting: boolean;
  allowComments: boolean;
}) {
  const qc = useQueryClient();
  const itemKey = ["feedback-item", token, issueId, email] as const;

  const itemQ = useQuery({
    queryKey: itemKey,
    queryFn: () => feedbackApi.getItem(token, issueId!, email || undefined),
    enabled: !!issueId,
    retry: false,
  });

  const commentMut = useMutation({
    mutationFn: (body: string) => feedbackApi.addComment(token, issueId!, body, email || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: itemKey });
      qc.invalidateQueries({ queryKey: ["feedback-board", token, email] });
    },
    onError: () => toast.error("Could not post comment"),
  });

  const voteMut = useMutation({
    mutationFn: () => feedbackApi.vote(token, issueId!, email || undefined),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: itemKey });
      const prev = qc.getQueryData(itemKey);
      if (prev) {
        const p = prev as FeedbackItem & { comments: unknown[] };
        qc.setQueryData(itemKey, {
          ...p,
          voted: !p.voted,
          votes: p.votes + (p.voted ? -1 : 1),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(itemKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: itemKey }),
  });

  return (
    <Dialog open={!!issueId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        {itemQ.isLoading && (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {itemQ.isError && (
          <div className="py-6 text-center text-sm text-muted-foreground">Not found.</div>
        )}
        {itemQ.data && (
          <div>
            <DialogHeader>
              <DialogTitle className="pr-6">{itemQ.data.name}</DialogTitle>
            </DialogHeader>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {itemQ.data.state && (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    background: (itemQ.data.state.color || "#888") + "22",
                    color: itemQ.data.state.color || "#888",
                  }}
                >
                  {itemQ.data.state.name}
                </span>
              )}
              {itemQ.data.author_name && <span>· {itemQ.data.author_name}</span>}
              <span>· {timeAgo(itemQ.data.created_at)}</span>
            </div>

            {itemQ.data.description && (
              <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                {itemQ.data.description}
              </p>
            )}

            <div className="mt-4">
              <button
                type="button"
                disabled={!allowVoting}
                onClick={() => voteMut.mutate()}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-40"
                style={
                  itemQ.data.voted
                    ? { background: brand, color: "#fff", borderColor: brand }
                    : { borderColor: "var(--border)" }
                }
              >
                <ThumbsUpIcon filled={itemQ.data.voted} />
                <span className="font-semibold">{itemQ.data.votes}</span>
                <span className="text-xs opacity-80">{itemQ.data.voted ? "voted" : "vote"}</span>
              </button>
            </div>

            {allowComments && (
              <div className="mt-5 border-t border-border pt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Comments ({itemQ.data.comments.length})
                </h3>
                <ul className="space-y-2">
                  {itemQ.data.comments.map((c) => (
                    <li key={c.id} className="rounded-md bg-muted/50 p-2.5 text-sm">
                      <p className="whitespace-pre-wrap">{c.body}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {timeAgo(c.created_at)}
                      </p>
                    </li>
                  ))}
                  {itemQ.data.comments.length === 0 && (
                    <li className="text-xs text-muted-foreground">No comments yet.</li>
                  )}
                </ul>
                <CommentBox disabled={commentMut.isPending} onPost={(b) => commentMut.mutate(b)} />
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CommentBox({ onPost, disabled }: { onPost: (body: string) => void; disabled: boolean }) {
  const [body, setBody] = useState("");
  return (
    <form
      className="mt-3 flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        onPost(body.trim());
        setBody("");
      }}
    >
      <Textarea
        rows={2}
        maxLength={4000}
        placeholder="Add a comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={disabled || !body.trim()}>
        Send
      </Button>
    </form>
  );
}

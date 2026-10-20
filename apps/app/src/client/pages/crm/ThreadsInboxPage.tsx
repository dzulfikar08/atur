import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { ThreadsInboxItem } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ExternalLink, MessageSquare, Send } from "@/lib/icons";

const TABS: { status: ThreadsInboxItem["status"]; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "done", label: "Done" },
  { status: "hidden", label: "Hidden" },
];

// "Replied" counts answers posted from Atur and from the Threads app itself
// (the sync spots our replies in each conversation).
type Replied = "all" | "no" | "yes";
const REPLIED_FILTERS: { value: Replied; label: string }[] = [
  { value: "all", label: "All" },
  { value: "no", label: "Needs reply" },
  { value: "yes", label: "Replied" },
];
// Threads caps a post at 500 characters.
const MAX_REPLY = 500;

function errorText(err: unknown): string | undefined {
  return err instanceof ApiError ? err.message : undefined;
}

function InboxItem({ slug, item }: { slug: string; item: ThreadsInboxItem }) {
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["threads-inbox", slug] });
  const onError = (title: string) => (err: unknown) =>
    toast.error(title, { description: errorText(err) });

  const replyMut = useMutation({
    mutationFn: () => api.replyThreadsItem(slug, item.id, text.trim()),
    onSuccess: () => {
      toast.success("Reply posted on Threads");
      setReplying(false);
      setText("");
      refresh();
    },
    onError: onError("Reply failed"),
  });
  const leadMut = useMutation({
    mutationFn: () => api.makeThreadsLead(slug, item.id),
    onSuccess: () => {
      toast.success(`@${item.username} is now a lead`);
      refresh();
    },
    onError: onError("Could not create the lead"),
  });
  const statusMut = useMutation({
    mutationFn: (status: "open" | "done") => api.setThreadsItemStatus(slug, item.id, status),
    onSuccess: refresh,
    onError: onError("Could not update the item"),
  });
  const hideMut = useMutation({
    mutationFn: () => api.hideThreadsItem(slug, item.id),
    onSuccess: () => {
      toast.success("Reply hidden on Threads");
      refresh();
    },
    onError: onError("Could not hide the reply"),
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            {item.username ? (
              <a
                href={`https://www.threads.com/@${item.username}`}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
              >
                @{item.username}
              </a>
            ) : (
              <span className="font-medium">Unknown author</span>
            )}
            <Badge variant="outline">
              {item.kind === "mention" ? "mentioned you" : "reply to your post"}
            </Badge>
            {item.replied_at ? (
              <Badge variant="secondary">replied</Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                needs reply
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(item.posted_at), { addSuffix: true })}
          </span>
        </div>
        {item.text && <p className="whitespace-pre-wrap break-words text-sm">{item.text}</p>}

        {replying && (
          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={MAX_REPLY}
              placeholder={`Reply to @${item.username ?? "them"} in public`}
              aria-label="Reply text"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {text.length}/{MAX_REPLY} · posts publicly as your Threads account
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setReplying(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!text.trim() || replyMut.isPending}
                  onClick={() => replyMut.mutate()}
                >
                  <Send className="h-4 w-4 mr-1" />
                  {replyMut.isPending ? "Posting…" : "Post reply"}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!replying && item.status !== "hidden" && (
            <Button size="sm" onClick={() => setReplying(true)}>
              <MessageSquare className="h-4 w-4 mr-1" />
              Reply
            </Button>
          )}
          {item.customer_id ? (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/${slug}/crm/contacts/${item.customer_id}`}>View contact</Link>
            </Button>
          ) : (
            item.username && (
              <Button
                size="sm"
                variant="outline"
                disabled={leadMut.isPending}
                onClick={() => leadMut.mutate()}
              >
                Make lead
              </Button>
            )
          )}
          {item.status === "open" && (
            <Button
              size="sm"
              variant="outline"
              disabled={statusMut.isPending}
              onClick={() => statusMut.mutate("done")}
            >
              Mark done
            </Button>
          )}
          {item.status === "done" && (
            <Button
              size="sm"
              variant="outline"
              disabled={statusMut.isPending}
              onClick={() => statusMut.mutate("open")}
            >
              Reopen
            </Button>
          )}
          {item.kind === "reply" && item.status !== "hidden" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={hideMut.isPending}
              onClick={() => hideMut.mutate()}
            >
              Hide on Threads
            </Button>
          )}
          {item.permalink && (
            <Button size="sm" variant="ghost" asChild>
              <a href={item.permalink} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" />
                Open on Threads
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ThreadsInboxPage() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<ThreadsInboxItem["status"]>("open");
  const [replied, setReplied] = useState<Replied>("all");

  const { data: status, isLoading } = useQuery({
    queryKey: ["threads-status", slug],
    queryFn: () => api.getThreadsStatus(slug!),
    enabled: !!slug,
  });
  const account = status?.account ?? null;
  const { data: inbox } = useQuery({
    queryKey: ["threads-inbox", slug, tab, replied],
    queryFn: () => api.listThreadsInbox(slug!, tab, replied === "all" ? undefined : replied),
    enabled: !!slug && !!account,
  });

  const connectMut = useMutation({
    mutationFn: () => api.getThreadsConnectUrl(slug!),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (err) =>
      toast.error("Could not start the connection", { description: errorText(err) }),
  });
  const syncMut = useMutation({
    mutationFn: () => api.syncThreads(slug!),
    onSuccess: ({ inserted }) => {
      toast.success(inserted ? `${inserted} new on Threads` : "Nothing new on Threads");
      qc.invalidateQueries({ queryKey: ["threads-inbox", slug] });
      qc.invalidateQueries({ queryKey: ["threads-status", slug] });
    },
    onError: (err) => {
      toast.error("Sync failed", { description: errorText(err) });
      qc.invalidateQueries({ queryKey: ["threads-status", slug] });
    },
  });
  const disconnectMut = useMutation({
    mutationFn: () => api.disconnectThreads(slug!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threads-status", slug] }),
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Link
        to={`/${slug}/crm`}
        className="inline-flex items-center text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        CRM
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Threads inbox</h1>
        <p className="text-sm text-muted-foreground">
          Replies to your posts and posts that mention you, checked every 10 minutes. DMs are not
          available: the Threads API has no messaging endpoint, so log DM follow-ups on the contact.
          Posts from private accounts never come through.
        </p>
      </div>

      {!account ? (
        <Card>
          <CardContent className="p-6 space-y-3">
            <p className="font-medium">Connect your Threads account</p>
            <p className="text-sm text-muted-foreground">
              Atur reads replies and mentions, and posts the replies you write here. It never posts
              on its own.
            </p>
            <Button
              disabled={!status?.configured || connectMut.isPending}
              onClick={() => connectMut.mutate()}
            >
              {connectMut.isPending ? "Opening Threads…" : "Connect Threads"}
            </Button>
            {!status?.configured && (
              <p className="text-xs text-muted-foreground">
                Threads is not configured on this server yet.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Connected as @{account.username}</p>
                <p className="text-xs text-muted-foreground">
                  {account.last_sync_at
                    ? `Checked ${formatDistanceToNow(new Date(account.last_sync_at), { addSuffix: true })}`
                    : "Not checked yet"}
                </p>
                {account.last_error && (
                  <p className="mt-1 text-xs text-destructive break-words">
                    Last check failed: {account.last_error}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={syncMut.isPending} onClick={() => syncMut.mutate()}>
                  {syncMut.isPending ? "Checking…" : "Check now"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disconnectMut.isPending}
                  onClick={() => disconnectMut.mutate()}
                >
                  Disconnect
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label="Inbox status" className="flex gap-1">
              {TABS.map((t) => (
                <Button
                  key={t.status}
                  role="tab"
                  aria-selected={tab === t.status}
                  size="sm"
                  variant={tab === t.status ? "secondary" : "ghost"}
                  onClick={() => setTab(t.status)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
            <div role="group" aria-label="Reply filter" className="flex gap-1">
              {REPLIED_FILTERS.map((f) => (
                <Button
                  key={f.value}
                  aria-pressed={replied === f.value}
                  size="sm"
                  variant={replied === f.value ? "secondary" : "ghost"}
                  onClick={() => setReplied(f.value)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {inbox?.results.map((item) => (
              <InboxItem key={item.id} slug={slug!} item={item} />
            ))}
            {inbox && inbox.results.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {tab === "open" ? "Nothing waiting. New replies show up here." : "Nothing here."}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

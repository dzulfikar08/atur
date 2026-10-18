import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type FeedbackBoardConfig, type State, type Label } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Copy, ExternalLink, MessageSquare } from "@/lib/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Position = "bottom-right" | "bottom-left" | "top-right" | "top-left";

const POSITIONS: Position[] = ["bottom-right", "bottom-left", "top-right", "top-left"];

export default function FeedbackBoardSettings({
  slug,
  projectId,
  states,
  labels,
}: {
  slug: string;
  projectId: string;
  states: State[];
  labels: Label[];
}) {
  const qc = useQueryClient();

  const boardQ = useQuery({
    queryKey: ["feedback-board-admin", slug, projectId],
    queryFn: () => api.getFeedbackBoard(slug, projectId),
  });

  const enabled = !!boardQ.data?.enabled;

  const [form, setForm] = useState<Partial<FeedbackBoardConfig>>({});
  useEffect(() => {
    if (boardQ.data) setForm(boardQ.data);
  }, [boardQ.data]);

  const save = useMutation({
    mutationFn: (data: Partial<FeedbackBoardConfig>) =>
      api.saveFeedbackBoard(slug, projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedback-board-admin", slug, projectId] });
      toast.success("Feedback board saved");
    },
    onError: () => toast.error("Failed to save feedback board"),
  });

  // Create/rotate or revoke a board secret; the card re-renders from the refetch.
  const secretMutation = (fn: () => Promise<FeedbackBoardConfig>, done: string) => ({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedback-board-admin", slug, projectId] });
      toast.success(done);
    },
    onError: () => toast.error("Request failed"),
  });
  const rotateIdentify = useMutation(
    secretMutation(
      () => api.rotateFeedbackSecret(slug, projectId, "identify-secret"),
      "Identify secret updated",
    ),
  );
  const revokeIdentify = useMutation(
    secretMutation(
      () => api.revokeFeedbackSecret(slug, projectId, "identify-secret"),
      "Identify secret removed",
    ),
  );
  const rotateIngest = useMutation(
    secretMutation(
      () => api.rotateFeedbackSecret(slug, projectId, "ingest-key"),
      "Ingest key updated",
    ),
  );
  const revokeIngest = useMutation(
    secretMutation(
      () => api.revokeFeedbackSecret(slug, projectId, "ingest-key"),
      "Ingest key revoked",
    ),
  );

  const disable = useMutation({
    mutationFn: () => api.deleteFeedbackBoard(slug, projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feedback-board-admin", slug, projectId] });
      toast.success("Feedback board disabled");
    },
    onError: () => toast.error("Failed to disable board"),
  });

  const set = <K extends keyof FeedbackBoardConfig>(key: K, value: FeedbackBoardConfig[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  if (boardQ.isLoading) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>;
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.diatur.com";
  const snippet = form.public_token
    ? `<script src="${origin}/widget.js" data-atur-token="${form.public_token}" async></script>`
    : "";

  if (!enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Feedback Board
          </CardTitle>
          <CardDescription>
            Let customers submit ideas and vote — on a public board or an embeddable widget on their
            site. Submissions land as tagged issues in this project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => save.mutate({})} disabled={save.isPending}>
            {save.isPending ? "Enabling…" : "Enable feedback board"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const portalHref = `${origin}/portal/${slug}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Feedback Board
          </CardTitle>
          <CardDescription>Public board + embeddable widget settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Board title</label>
            <Input
              value={form.title ?? ""}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Feedback"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <Textarea
              rows={2}
              value={form.description ?? ""}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Help shape our roadmap. Vote on ideas and suggest your own."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium mb-1 block">New ideas land in state</label>
              <Select
                value={form.default_state_id ?? "auto"}
                onValueChange={(v) => set("default_state_id", v === "auto" ? null : v)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (triage / default)</SelectItem>
                  {states.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Tag submissions with label</label>
              <Select
                value={form.submit_label_id ?? "none"}
                onValueChange={(v) => set("submit_label_id", v === "none" ? null : v)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {labels.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            <Toggle
              label="Allow new ideas"
              checked={!!form.allow_submit}
              onChange={(v) => set("allow_submit", v)}
            />
            <Toggle
              label="Allow voting"
              checked={!!form.allow_voting}
              onChange={(v) => set("allow_voting", v)}
            />
            <Toggle
              label="Allow comments"
              checked={!!form.allow_comments}
              onChange={(v) => set("allow_comments", v)}
            />
            <Toggle
              label="Require email"
              checked={!!form.require_email}
              onChange={(v) => set("require_email", v)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Brand color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.brand_color ?? "#6366f1"}
                  onChange={(e) => set("brand_color", e.target.value)}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Input
                  value={form.brand_color ?? "#6366f1"}
                  onChange={(e) => set("brand_color", e.target.value)}
                  className="max-w-32"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Widget position</label>
              <Select
                value={form.position ?? "bottom-right"}
                onValueChange={(v) => set("position", v as Position)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">
                      {p.replace(/-/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="outline" asChild>
              <a href={`/feedback/${form.public_token}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" /> Open board
              </a>
            </Button>
            <Button
              variant="ghost"
              className="text-destructive ml-auto"
              onClick={() => {
                if (
                  confirm(
                    "Disable the feedback board? The public link and widget will stop working. Submitted ideas are kept.",
                  )
                ) {
                  disable.mutate();
                }
              }}
            >
              Disable board
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Embed on your website</CardTitle>
          <CardDescription>
            Paste this snippet before the closing <code>&lt;/body&gt;</code> tag. The bubble opens a
            panel to share an idea, report a bug (with a screenshot) or get help.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
            <code>{snippet}</code>
          </pre>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(snippet);
                toast.success("Snippet copied");
              }}
            >
              <Copy className="h-4 w-4 mr-1" /> Copy snippet
            </Button>
            <span className="self-center text-xs text-muted-foreground">
              Public token: <code>{form.public_token}</code>
            </span>
          </div>
          <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
            <li>
              <code>data-app-version</code> adds your release to every report;{" "}
              <code>data-atur-position</code> moves the bubble (&ldquo;bottom-left&rdquo;,
              &ldquo;top-right&rdquo;, &ldquo;top-left&rdquo;).
            </li>
            <li>
              Reports include the page URL, browser, viewport and the last 20 console errors and
              failed requests. Add <code>data-atur-context=&quot;off&quot;</code> to switch that
              off.
            </li>
            <li>
              Reports from the widget and the Atur app land in this project; bug reports and
              questions become support tickets the reporter can follow in the portal.
            </li>
          </ul>
          {portalHref && (
            <p className="text-xs text-muted-foreground">
              Customer portal (ideas, support, changelog):{" "}
              <a className="underline" href={portalHref} target="_blank" rel="noreferrer">
                {portalHref}
              </a>
            </p>
          )}
        </CardContent>
      </Card>

      <SecretCard
        title="Identify users"
        description="Tell Atur who is reporting so you see their name and email — and so they can follow their tickets in the portal. Without a secret, any typed email is accepted unverified."
        secret={form.identify_secret}
        secretLabel="Identify secret"
        pending={rotateIdentify.isPending || revokeIdentify.isPending}
        onRotate={() => rotateIdentify.mutate()}
        onRevoke={() => revokeIdentify.mutate()}
        confirmRotate="Rotate the identify secret? Signatures made with the old secret stop verifying immediately."
        confirmRevoke="Remove the identify secret? Emails will be accepted unverified again."
        usage={`// Server side: sign the user id with the identify secret
const signature = crypto.createHmac("sha256", IDENTIFY_SECRET).update(user.id).digest("hex");

// Browser, after the widget script
Atur.identify({ id: user.id, email: user.email, name: user.name, signature });`}
      />

      <SecretCard
        title="Log ingest"
        description="Send server errors and log lines from your backend or error logger. Identical errors group into one issue with an occurrence counter, first/last seen and the latest logs."
        secret={form.ingest_key}
        secretLabel="Ingest key"
        pending={rotateIngest.isPending || revokeIngest.isPending}
        onRotate={() => rotateIngest.mutate()}
        onRevoke={() => revokeIngest.mutate()}
        confirmRotate="Rotate the ingest key? Loggers using the old key will get 404 until updated."
        confirmRevoke="Revoke the ingest key? Ingest stops until you create a new one."
        usage={
          form.ingest_key
            ? `curl -X POST ${origin}/api/ingest/${form.ingest_key} \\
  -H 'content-type: application/json' \\
  -d '{"message":"Payment failed","level":"error","service":"api","stack":"Error: ...\\n    at pay (pay.js:10:3)","logs":["charge started","gateway timeout"]}'`
            : undefined
        }
      />
    </div>
  );
}

function SecretCard({
  title,
  description,
  secret,
  secretLabel,
  pending,
  onRotate,
  onRevoke,
  confirmRotate,
  confirmRevoke,
  usage,
}: {
  title: string;
  description: string;
  secret?: string | null;
  secretLabel: string;
  pending: boolean;
  onRotate: () => void;
  onRevoke: () => void;
  confirmRotate: string;
  confirmRevoke: string;
  usage?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {secret ? (
          <>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 text-xs">
                {secret}
              </code>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Copy ${secretLabel.toLowerCase()}`}
                onClick={() => {
                  navigator.clipboard?.writeText(secret);
                  toast.success(`${secretLabel} copied`);
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            {usage && (
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
                <code>{usage}</code>
              </pre>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => confirm(confirmRotate) && onRotate()}
              >
                Rotate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={pending}
                onClick={() => confirm(confirmRevoke) && onRevoke()}
              >
                Remove
              </Button>
            </div>
          </>
        ) : (
          <Button size="sm" disabled={pending} onClick={onRotate}>
            {pending ? "Creating…" : `Create ${secretLabel.toLowerCase()}`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input"
      />
      {label}
    </label>
  );
}

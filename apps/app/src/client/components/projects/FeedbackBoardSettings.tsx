import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type FeedbackBoardConfig, type State, type Label } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Copy, ExternalLink, MessageSquare } from "@/lib/icons";

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
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={form.default_state_id ?? ""}
                onChange={(e) => set("default_state_id", e.target.value || null)}
              >
                <option value="">Auto (triage / default)</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Tag submissions with label</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={form.submit_label_id ?? ""}
                onChange={(e) => set("submit_label_id", e.target.value || null)}
              >
                <option value="">None</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
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
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={form.position ?? "bottom-right"}
                onChange={(e) => set("position", e.target.value as Position)}
              >
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
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
            Paste this snippet before the closing <code>&lt;/body&gt;</code> tag. The bubble opens
            the full board.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="ml-4 list-decimal space-y-1 text-sm text-muted-foreground">
            <li>Copy the snippet below.</li>
            <li>
              Paste it in your site HTML, just before <code>&lt;/body&gt;</code>.
            </li>
            <li>The feedback bubble appears in the corner — click it to open the board.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Move the bubble with <code>data-atur-position</code> (&ldquo;bottom-left&rdquo;,
            &ldquo;top-right&rdquo;, &ldquo;top-left&rdquo;). Preview it first: open{" "}
            <code>examples/feedback-widget-demo.html</code> in this repo, paste your token, and
            click <strong>Load widget</strong>.
          </p>
          <p className="text-xs text-muted-foreground">
            Prefer a plain link? Share <strong>Open board</strong> below — no embed needed.
          </p>
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
        </CardContent>
      </Card>
    </div>
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

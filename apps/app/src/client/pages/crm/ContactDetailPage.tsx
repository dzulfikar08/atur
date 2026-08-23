import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { ContactEmailLogEntry, CrmActivity, Fact, PolarLink } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Mail, ExternalLink } from "@/lib/icons";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { money } from "@/lib/format";

function PolarPanel({ slug, contactId }: { slug: string; contactId: string }) {
  const { data } = useQuery({
    queryKey: ["contact-polar-links", slug, contactId],
    queryFn: () => api.listContactPolarLinks(slug, contactId),
    enabled: !!slug && !!contactId,
  });
  const links: PolarLink[] = data?.results ?? [];

  if (links.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <p className="text-sm font-medium">Polar activity</p>
        <ul className="space-y-1">
          {links.map((l) => {
            let label: string;
            let sub: string;
            if (l.polar_type === "customer") {
              label = "Polar customer";
              sub = l.polar_id;
            } else if (l.polar_type === "subscription") {
              label = "Subscription";
              sub = l.polar_id;
            } else {
              label = "Order";
              sub = l.polar_id;
            }
            return (
              <li key={l.id} className="flex items-center justify-between text-sm">
                <span className="truncate">
                  <Badge variant="outline" className="mr-2">
                    {label}
                  </Badge>
                  <span className="text-muted-foreground">{sub}</span>
                </span>
                <span className="text-muted-foreground ml-2">{l.last_event ?? "—"}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

const PURPOSE_LABELS: Record<string, string> = {
  cold_outreach: "Cold Outreach",
  welcome: "Welcome",
  feedback_request: "Feedback Request",
  follow_up: "Follow-up",
  thank_you: "Thank You",
  win_back: "Win-back",
};

function SendEmailDialog({ slug, contactId }: { slug: string; contactId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState("feedback_request");
  // "default" sentinel = let the server resolve the purpose's default-flagged
  // variant (Radix Select forbids empty-string item values).
  const [variantId, setVariantId] = useState("default");
  const resolveVariantId = () => (variantId === "default" ? undefined : variantId);

  const { data: tpl } = useQuery({
    queryKey: ["email-templates", slug],
    queryFn: () => api.listEmailTemplates(slug!),
    enabled: open && !!slug,
  });
  const purposeVariants = (tpl?.variants ?? []).filter((v) => v.purpose === purpose);

  const {
    data: preview,
    isLoading: previewLoading,
    error: previewError,
  } = useQuery({
    queryKey: ["contact-email-preview", slug, contactId, purpose, variantId],
    queryFn: () => api.previewContactEmail(slug!, contactId, purpose, resolveVariantId()),
    enabled: open && !!slug && !!contactId,
  });

  const errorMsg =
    previewError instanceof ApiError
      ? `${previewError.status}: ${previewError.message}`
      : previewError instanceof Error
        ? previewError.message
        : "Unknown error";

  const copyBody = async () => {
    if (!preview) return;
    const text = `${preview.subject}\n\n${preview.text}`;
    await navigator.clipboard.writeText(text);
    toast.success("Message body copied");
  };

  const sendMut = useMutation({
    mutationFn: () =>
      api.sendContactEmail(slug!, contactId, {
        purpose,
        variant_id: resolveVariantId(),
      }),
    onSuccess: (result) => {
      toast.success("Email sent", {
        description: result.sent
          ? `${PURPOSE_LABELS[purpose] ?? purpose} email sent to ${result.to}.`
          : `Draft ready — SEND_EMAIL binding not configured (local dev).`,
      });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["contact", slug, contactId] });
    },
    onError: (err) =>
      toast.error("Failed to send email", {
        description: err instanceof ApiError ? `${err.status}: ${err.message}` : undefined,
      }),
  });

  const copyEmail = async () => {
    if (preview?.to) {
      await navigator.clipboard.writeText(preview.to);
      toast.success("Email address copied");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Mail className="h-4 w-4 mr-1" />
          Send Email
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send email</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Purpose</label>
            <Select
              value={purpose}
              onValueChange={(v) => {
                setPurpose(v);
                setVariantId("default");
              }}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(tpl?.purposes ?? [{ name: purpose, label: purpose }]).map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Variant</label>
            <Select value={variantId} onValueChange={setVariantId}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Purpose default</SelectItem>
                {purposeVariants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                    {v.is_default === 1 ? " ★" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {previewLoading ? (
          <p className="text-sm text-muted-foreground">Generating preview…</p>
        ) : !preview ? (
          <p className="text-sm text-red-500">Could not load preview: {errorMsg}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <div className="flex items-center gap-2">
                <p className="text-sm">{preview.to || "—"}</p>
                {preview.to && (
                  <Button variant="ghost" size="sm" onClick={copyEmail}>
                    Copy address
                  </Button>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <p className="text-sm">{preview.subject}</p>
            </div>
            {preview.purchase && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Purchase info</label>
                <ul className="text-sm space-y-1">
                  <li className="flex justify-between">
                    <span>Product</span>
                    <span>{preview.purchase.product_name}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Date</span>
                    <span>{new Date(preview.purchase.date).toLocaleDateString()}</span>
                  </li>
                </ul>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Message body</label>
              <div className="mt-1 p-3 bg-muted/50 rounded-md text-sm text-muted-foreground whitespace-pre-wrap">
                {preview.text}
              </div>
              <Button variant="ghost" size="sm" className="mt-2" onClick={copyBody}>
                Copy message
              </Button>
            </div>
            <div className="flex justify-between items-center pt-2 border-t">
              <Link
                to={`/${slug}/crm/email-templates`}
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setOpen(false)}
              >
                Edit templates →
              </Link>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={sendMut.isPending} onClick={() => sendMut.mutate()}>
                  {sendMut.isPending ? "Sending…" : "Send email"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmailHistoryCard({ emails }: { emails: ContactEmailLogEntry[] }) {
  if (emails.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <p className="text-sm font-medium">Email history</p>
        <ul className="space-y-1">
          {emails.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">
                <Badge variant="outline" className="mr-2">
                  {PURPOSE_LABELS[e.purpose] ?? e.purpose}
                </Badge>
                {e.variant_name && (
                  <span className="text-muted-foreground mr-2">{e.variant_name}</span>
                )}
                <span className="text-muted-foreground truncate">{e.subject}</span>
              </span>
              <span
                className="text-muted-foreground shrink-0"
                title={e.sent ? "Sent" : "Not sent (dev)"}
              >
                {new Date(e.sent_at).toLocaleDateString()} {e.sent === 0 && "· draft"}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const ACTIVITY_LABELS: Record<CrmActivity["type"], string> = {
  NOTE: "Note",
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  TASK: "Task",
  STAGE_CHANGE: "Stage change",
  ENRICHMENT: "Enrichment",
};

const ACTIVITY_COLORS: Record<CrmActivity["type"], string> = {
  NOTE: "bg-slate-400",
  CALL: "bg-violet-500",
  EMAIL: "bg-blue-500",
  MEETING: "bg-amber-500",
  TASK: "bg-emerald-500",
  STAGE_CHANGE: "bg-indigo-500",
  ENRICHMENT: "bg-pink-500",
};

function ActivityTimelineCard({ activities }: { activities: CrmActivity[] }) {
  if (activities.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-medium">Activity timeline</p>
        <ul className="space-y-3">
          {activities.map((a) => (
            <li key={a.id} className="flex gap-3 text-sm">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ACTIVITY_COLORS[a.type] ?? "bg-slate-400"}`}
              />
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {ACTIVITY_LABELS[a.type] ?? a.type}
                    {a.subject ? ` — ${a.subject}` : ""}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(a.occurred_at), { addSuffix: true })}
                  </span>
                </div>
                {a.body && <p className="text-muted-foreground truncate">{a.body}</p>}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const BAND_COLORS: Record<string, string> = {
  VERIFIED: "bg-emerald-100 text-emerald-700",
  PROBABLE: "bg-blue-100 text-blue-700",
  POSSIBLE: "bg-amber-100 text-amber-700",
};

function SuggestionsCard({
  slug,
  contactId,
  suggestions,
}: {
  slug: string;
  contactId: string;
  suggestions: Fact[];
}) {
  const qc = useQueryClient();
  if (suggestions.length === 0) return null;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["contact", slug, contactId] });

  const applyMut = useMutation({
    mutationFn: (factId: string) => api.applyFact(slug, contactId, factId),
    onSuccess: () => {
      toast.success("Suggestion applied");
      invalidate();
    },
    onError: (err) =>
      toast.error("Failed to apply", {
        description: err instanceof ApiError ? `${err.status}: ${err.message}` : undefined,
      }),
  });
  const dismissMut = useMutation({
    mutationFn: (factId: string) => api.dismissFact(slug, contactId, factId),
    onSuccess: () => {
      toast.success("Suggestion dismissed");
      invalidate();
    },
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-medium">
          Suggestions <span className="text-muted-foreground">({suggestions.length})</span>
        </p>
        <ul className="space-y-2">
          {suggestions.map((f) => {
            let evidence: { source: string; method: string; url?: string }[] = [];
            try {
              evidence = f.evidence ? JSON.parse(f.evidence) : [];
            } catch {
              evidence = [];
            }
            return (
              <li key={f.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">
                    <span className="font-medium">{f.field}:</span> {f.value}
                  </span>
                  <Badge className={BAND_COLORS[f.band] ?? ""}>{f.band}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>score {f.score.toFixed(1)}</span>
                  {evidence.map((e, i) => (
                    <Badge key={i} variant="outline">
                      {e.method}
                      {e.url && (
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1 inline-flex items-center hover:underline"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={applyMut.isPending}
                    onClick={() => applyMut.mutate(f.id)}
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={dismissMut.isPending}
                    onClick={() => dismissMut.mutate(f.id)}
                  >
                    Dismiss
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// A contact is "stale" when its last activity is older than 30 days.
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export default function ContactDetailPage() {
  const { slug, id } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["contact", slug, id],
    queryFn: () => api.getContact(slug!, id!),
    enabled: !!slug && !!id,
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data) return <p>Not found.</p>;
  const c = data.contact;
  const stale =
    !!c.last_activity_at && Date.now() - Date.parse(c.last_activity_at) > STALE_AFTER_MS;
  const initials = (c.name || c.email || "?").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-4">
      <Link
        to={`/${slug}/crm/contacts`}
        className="inline-flex items-center text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Contacts
      </Link>
      <div className="flex items-start gap-3">
        <Avatar className="h-12 w-12">
          <AvatarImage src={c.image_url ?? undefined} alt={c.name ?? "Contact"} />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{c.name || c.email || "Contact"}</h1>
          <p className="text-muted-foreground text-sm">{c.email || "—"}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="secondary">{c.status}</Badge>
            {c.title && <Badge variant="outline">{c.title}</Badge>}
            {c.seniority && <Badge variant="outline">{c.seniority}</Badge>}
            {c.function && <Badge variant="outline">{c.function}</Badge>}
            {c.company && <Badge variant="outline">{c.company}</Badge>}
            {c.phone && <Badge variant="outline">{c.phone}</Badge>}
            {c.source && <Badge variant="outline">src: {c.source}</Badge>}
            {c.enriched_at && (
              <Badge variant="outline" className="text-emerald-600">
                enriched {formatDistanceToNow(new Date(c.enriched_at), { addSuffix: true })}
              </Badge>
            )}
            {stale && <Badge variant="destructive">stale</Badge>}
          </div>
          {c.linkedin_url && (
            <a
              href={c.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              LinkedIn
            </a>
          )}
        </div>
      </div>

      {slug && id && (
        <div>
          <SendEmailDialog slug={slug} contactId={id} />
        </div>
      )}

      {slug && id && <PolarPanel slug={slug} contactId={id} />}

      {data.company && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-medium">Company</p>
            <Link
              to={`/${slug}/crm/companies/${data.company.id}`}
              className="text-sm text-blue-600 hover:underline"
            >
              {data.company.name}
            </Link>
            {data.company.domain && (
              <p className="text-xs text-muted-foreground">{data.company.domain}</p>
            )}
          </CardContent>
        </Card>
      )}

      {slug && id && (
        <SuggestionsCard slug={slug} contactId={id} suggestions={data.suggestions ?? []} />
      )}

      {slug && id && <ActivityTimelineCard activities={data.activities ?? []} />}

      <EmailHistoryCard emails={data.emails ?? []} />

      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium">Deals</p>
          {data.deals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals.</p>
          ) : (
            <ul className="space-y-1">
              {data.deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">{d.name}</span>
                  <span className="text-muted-foreground ml-2">
                    {money(d.amount_cents, d.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-medium">Support tickets</p>
          {data.tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tickets.</p>
          ) : (
            <ul className="space-y-1">
              {data.tickets.map((t) => (
                <li key={t.id} className="text-sm">
                  #{t.sequence_id} {t.name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { PolarLink } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowLeft, Mail } from "@/lib/icons";
import { toast } from "sonner";

function money(cents: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${cents}`;
  }
}

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

function SendEmailDialog({ slug, contactId }: { slug: string; contactId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: preview, isLoading: previewLoading, error: previewError } = useQuery({
    queryKey: ["contact-email-preview", slug, contactId],
    queryFn: () => api.previewContactEmail(slug!, contactId, "feedback_request"),
    enabled: open && !!slug && !!contactId,
  });

  const errorMsg = previewError instanceof ApiError
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
    mutationFn: () => api.sendContactEmail(slug!, contactId, { template: "feedback_request" }),
    onSuccess: (result) => {
      toast.success("Email sent", {
        description: result.sent
          ? `Feedback request email sent to ${result.to}.`
          : `Draft ready — SEND_EMAIL binding not configured (local dev).`,
      });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["contact", slug, contactId] });
    },
    onError: () => toast.error("Failed to send email"),
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
          <DialogTitle>Send feedback request email</DialogTitle>
        </DialogHeader>
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
                <label className="text-xs font-medium text-muted-foreground">
                  Purchase info
                </label>
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
                Edit template →
              </Link>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={sendMut.isPending}
                  onClick={() => sendMut.mutate()}
                >
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

  return (
    <div className="space-y-4">
      <Link to={`/${slug}/crm/contacts`} className="inline-flex items-center text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="mr-1 h-4 w-4" />
        Contacts
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{c.name || c.email || "Contact"}</h1>
        <p className="text-muted-foreground text-sm">{c.email || "—"}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="secondary">{c.status}</Badge>
          {c.company && <Badge variant="outline">{c.company}</Badge>}
          {c.phone && <Badge variant="outline">{c.phone}</Badge>}
          {c.source && <Badge variant="outline">src: {c.source}</Badge>}
        </div>
      </div>

      {slug && id && (
        <div>
          <SendEmailDialog slug={slug} contactId={id} />
        </div>
      )}

      {slug && id && <PolarPanel slug={slug} contactId={id} />}

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

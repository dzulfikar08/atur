import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { EmailPurpose, EmailVariant } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Pencil, Plus, Star, Trash2, Info } from "@/lib/icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Placeholder variables available in template subject/body.
const TEMPLATE_VARIABLES = [
  { key: "name", label: "Customer name" },
  { key: "email", label: "Customer email" },
  { key: "company", label: "Customer company" },
  { key: "product", label: "Product name (most recent paid purchase)" },
  { key: "date", label: "Purchase date" },
  { key: "amount", label: "Purchase amount" },
  { key: "footer", label: "Email footer signature" },
];

// Create/edit dialog for one variant. mode "create" seeds from the purpose's
// curated default; mode "edit" seeds from the existing variant row.
function VariantEditor({
  slug,
  purpose,
  variant,
  open,
  onOpenChange,
}: {
  slug: string;
  purpose: EmailPurpose;
  variant: EmailVariant | null; // null = create mode
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const isEdit = variant !== null;
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isHtml, setIsHtml] = useState(false);

  useEffect(() => {
    if (open) {
      setName(variant?.name ?? "");
      setSubject(variant?.subject ?? purpose.default.subject);
      setBody(variant?.body ?? purpose.default.body);
      setIsHtml(!!variant?.is_html);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open, variant, purpose]);

  const saveMut = useMutation({
    mutationFn: () =>
      isEdit
        ? api.updateEmailVariant(slug, variant!.id, {
            name,
            subject,
            body,
            is_html: isHtml,
          })
        : api.createEmailVariant(slug, {
            purpose: purpose.name,
            name,
            subject,
            body,
            is_html: isHtml,
          }),
    onSuccess: () => {
      toast.success(isEdit ? "Variant saved" : "Variant created");
      qc.invalidateQueries({ queryKey: ["email-templates", slug] });
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(isEdit ? "Failed to save variant" : "Failed to create variant", {
        description: err instanceof ApiError ? `${err.status}: ${err.message}` : undefined,
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit" : "New"} "{purpose.label}" variant
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Available variables</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {TEMPLATE_VARIABLES.map((v) => (
                <Badge key={v.key} variant="outline" className="font-mono text-xs">
                  {"{{" + v.key + "}}"}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Variables are replaced with the customer's data at send time. Unknown ones stay as-is.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Variant name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              placeholder={isEdit ? "Name" : "e.g. Short v2"}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Subject</label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1"
              placeholder="Hi {{name}}, quick question..."
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Body ({isHtml ? "HTML" : "plain text"})
            </label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mt-1 min-h-[240px] font-mono text-sm"
              placeholder="Hi {{name}},&#10;&#10;…"
            />
            <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={isHtml}
                onChange={(e) => setIsHtml(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Body is HTML — sent as-is (variables still filled), not escaped
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saveMut.isPending || !name || !subject || !body}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? "Saving…" : isEdit ? "Save variant" : "Create variant"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PurposeCard({
  slug,
  purpose,
  variants,
}: {
  slug: string;
  purpose: EmailPurpose;
  variants: EmailVariant[];
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EmailVariant | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["email-templates", slug] });

  const setDefaultMut = useMutation({
    mutationFn: (id: string) => api.setDefaultEmailVariant(slug, id),
    onSuccess: () => {
      toast.success("Default variant set");
      invalidate();
    },
    onError: () => toast.error("Failed to set default"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteEmailVariant(slug, id),
    onSuccess: () => {
      toast.success("Variant deleted");
      invalidate();
    },
    onError: () => toast.error("Failed to delete variant"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>
            {purpose.label}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {purpose.description}
            </span>
          </span>
          <Badge variant="secondary">
            {variants.length} variant{variants.length === 1 ? "" : "s"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {purpose.requires_purchase && (
          <p className="text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 inline mr-1" />
            Fills purchase variables ({"{{product}}"}, {"{{date}}"}) from the customer's most recent
            Polar order.
          </p>
        )}

        <div>
          <span className="text-xs font-medium text-muted-foreground">Curated default</span>
          <p className="text-sm mt-1 font-mono bg-muted/50 p-2 rounded">
            {purpose.default.subject}
          </p>
          <pre className="text-sm mt-1 font-mono bg-muted/50 p-2 rounded whitespace-pre-wrap">
            {purpose.default.body}
          </pre>
        </div>

        {variants.map((v) => (
          <div key={v.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">{v.name}</span>
                {v.is_default === 1 && <Badge>Default</Badge>}
                {v.is_html === 1 && <Badge variant="outline">HTML</Badge>}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setEditing(v)}>
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
                {v.is_default !== 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={setDefaultMut.isPending}
                    onClick={() => setDefaultMut.mutate(v.id)}
                  >
                    <Star className="h-3.5 w-3.5 mr-1" /> Set default
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={deleteMut.isPending}
                  onClick={() => deleteMut.mutate(v.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <p className="text-sm font-mono bg-muted/50 p-2 rounded truncate">{v.subject}</p>
          </div>
        ))}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add variant
          </Button>
        </div>

        {(creating || editing) && (
          <VariantEditor
            slug={slug}
            purpose={purpose}
            variant={editing}
            open={creating || editing !== null}
            onOpenChange={(o) => {
              if (!o) {
                setCreating(false);
                setEditing(null);
              }
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

// Workspace-level {{footer}} signature editor.
function FooterCard({ slug, initial }: { slug: string; initial: string }) {
  const qc = useQueryClient();
  const [footer, setFooter] = useState(initial);

  useEffect(() => setFooter(initial), [initial]);

  const saveMut = useMutation({
    mutationFn: () => api.saveEmailFooter(slug, footer),
    onSuccess: () => {
      toast.success("Footer saved");
      qc.invalidateQueries({ queryKey: ["email-templates", slug] });
    },
    onError: () => toast.error("Failed to save footer"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>Email footer</span>
          <Badge variant="secondary">Workspace</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <span className="text-xs font-medium text-muted-foreground">
            Signature — fills the {"{{footer}}"} variable in every template
          </span>
          <Textarea
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            className="mt-1 min-h-[90px] font-mono text-sm"
            placeholder={"Regards,\nAcme team"}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Empty falls back to "Regards, &lt;workspace name&gt; team".
          </p>
        </div>
        <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
          {saveMut.isPending ? "Saving…" : "Save footer"}
        </Button>
      </CardContent>
    </Card>
  );
}

// One entry in the left rail — footer or a lifecycle purpose.
function RailItem({
  label,
  sub,
  count,
  active,
  onClick,
}: {
  label: string;
  sub?: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{label}</span>
        {sub && <span className="block truncate text-xs opacity-70">{sub}</span>}
      </span>
      {count !== undefined && (
        <Badge variant="secondary" className="shrink-0">
          {count}
        </Badge>
      )}
    </button>
  );
}

export default function EmailTemplatesPage() {
  const { slug } = useParams();
  // "footer" or a purpose name — footer first since it fills every template.
  const [selected, setSelected] = useState("footer");
  // Mobile only: rail and detail alternate. Desktop shows both panes.
  const [showDetail, setShowDetail] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["email-templates", slug],
    queryFn: () => api.listEmailTemplates(slug!),
    enabled: !!slug,
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  const errMsg =
    error instanceof ApiError
      ? `${error.status}: ${error.message}`
      : error instanceof Error
        ? error.message
        : "Unknown error";
  if (!data) return <p className="text-sm text-red-500">Error: {errMsg}</p>;

  const variantsByPurpose = new Map<string, EmailVariant[]>();
  for (const v of data.variants) {
    const list = variantsByPurpose.get(v.purpose) ?? [];
    list.push(v);
    variantsByPurpose.set(v.purpose, list);
  }

  const selectedPurpose = data.purposes.find((p) => p.name === selected) ?? null;

  const pick = (key: string) => {
    setSelected(key);
    setShowDetail(true);
  };

  return (
    <div className="flex h-[calc(100dvh-7rem)] md:h-[calc(100dvh-3.5rem)] -m-4 md:-m-6 lg:-m-8 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Link
          to={`/${slug}/crm`}
          className="inline-flex shrink-0 items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          CRM
        </Link>
        <div className="min-w-0">
          <h1 className="text-base font-semibold leading-tight">Email Templates</h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            One section per lifecycle purpose. Each purpose has a curated default; add variants to
            customize — the starred variant is what sends by default.
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Rail — footer + one entry per purpose. Fits without scrolling. */}
        <nav
          className={cn(
            "w-full shrink-0 space-y-1 overflow-y-auto border-r p-2 md:w-[260px]",
            showDetail ? "hidden md:block" : "block",
          )}
        >
          <RailItem
            label="Email footer"
            sub="Workspace signature"
            active={selected === "footer"}
            onClick={() => pick("footer")}
          />
          {data.purposes.map((p) => (
            <RailItem
              key={p.name}
              label={p.label}
              count={variantsByPurpose.get(p.name)?.length ?? 0}
              active={selected === p.name}
              onClick={() => pick(p.name)}
            />
          ))}
        </nav>

        {/* Detail — the only pane that scrolls */}
        <div
          className={cn("min-w-0 flex-1 overflow-y-auto", showDetail ? "block" : "hidden md:block")}
        >
          <div className="px-4 pt-3 md:hidden">
            <Button variant="ghost" size="sm" onClick={() => setShowDetail(false)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Templates
            </Button>
          </div>
          <div className="max-w-3xl space-y-4 p-4 md:p-6">
            {slug && selected === "footer" && (
              <FooterCard slug={slug} initial={data.footer ?? ""} />
            )}
            {slug && selectedPurpose && (
              <PurposeCard
                slug={slug}
                purpose={selectedPurpose}
                variants={variantsByPurpose.get(selectedPurpose.name) ?? []}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

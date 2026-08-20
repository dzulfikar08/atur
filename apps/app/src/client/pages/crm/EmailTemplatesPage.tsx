import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { ContactEmailTemplate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Pencil, Trash2, RefreshCw, Info } from "@/lib/icons";
import { toast } from "sonner";

// Placeholder variables available in template subject/body.
const TEMPLATE_VARIABLES = [
  { key: "name", label: "Customer name" },
  { key: "email", label: "Customer email" },
  { key: "product", label: "Product name (most recent paid purchase)" },
  { key: "date", label: "Purchase date" },
  { key: "amount", label: "Purchase amount" },
  { key: "footer", label: "Email footer signature" },
];

const TEMPLATE_LABELS: Record<string, string> = {
  feedback_request: "Feedback Request",
};

function TemplateEditor({
  slug,
  template,
  open,
  onOpenChange,
}: {
  slug: string;
  template: ContactEmailTemplate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const isCustom = !template.id.startsWith("default:");
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);

  // Reset form when the dialog opens or the template prop changes.
  useEffect(() => {
    if (open) {
      setSubject(template.subject);
      setBody(template.body);
    }
  }, [open, template]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.saveEmailTemplate(slug!, template.template_name, {
        subject,
        body,
        is_html: !!template.is_html,
      }),
    onSuccess: () => {
      toast.success("Template saved");
      qc.invalidateQueries({ queryKey: ["email-templates", slug] });
      onOpenChange(false);
    },
    onError: () => toast.error("Failed to save template"),
  });

  const resetMut = useMutation({
    mutationFn: () => api.deleteEmailTemplate(slug!, template.template_name),
    onSuccess: () => {
      toast.success("Template reset to default");
      qc.invalidateQueries({ queryKey: ["email-templates", slug] });
      onOpenChange(false);
    },
    onError: () => toast.error("Failed to reset template"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Edit "{TEMPLATE_LABELS[template.template_name] || template.template_name}" template
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
              Insert these variables in the subject or body — they'll be replaced with the
              customer's data at send time.
            </p>
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
            <label className="text-xs font-medium text-muted-foreground">Body (plain text)</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mt-1 min-h-[240px] font-mono text-sm"
              placeholder="Hi {{name}},&#10;&#10;We noticed you purchased {{product}} on {{date}}..."
            />
          </div>

          <div className="flex justify-between items-center pt-2 border-t">
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                This template is used for the feedback request email. The same template is
                sent to every customer with their data auto-filled — no per-customer editing needed.
              </span>
            </div>
            <div className="flex gap-2">
              {isCustom && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resetMut.isPending}
                  onClick={() => resetMut.mutate()}
                >
                  {resetMut.isPending ? "Resetting…" : <><RefreshCw className="h-3.5 w-3.5 mr-1" /> Reset to default</>}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={saveMut.isPending || !subject || !body}
                onClick={() => saveMut.mutate()}
              >
                {saveMut.isPending ? "Saving…" : "Save template"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function EmailTemplatesPage() {
  const { slug } = useParams();
  const [editing, setEditing] = useState<ContactEmailTemplate | null>(null);

  const { data: templates, isLoading, error: templatesError } = useQuery({
    queryKey: ["email-templates", slug],
    queryFn: () => api.listEmailTemplates(slug!),
    enabled: !!slug,
  });

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  const errMsg =
    templatesError instanceof ApiError
      ? `${templatesError.status}: ${templatesError.message}`
      : templatesError instanceof Error
        ? templatesError.message
        : "Unknown error";
  if (!templates) return <p className="text-sm text-red-500">Error: {errMsg}</p>;

  return (
    <div className="space-y-4">
      <Link to={`/${slug}/crm`} className="text-sm text-muted-foreground hover:underline">
        ← CRM
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Email Templates</h1>
        <p className="text-muted-foreground text-sm">
          Pre-fill templates with placeholder variables (e.g. <code className="bg-muted px-1 rounded">{"{{name}}"}</code>).
          They'll be replaced with each customer's data when sent.
        </p>
      </div>

      {templates.map((t) => {
        const isCustom = !t.id.startsWith("default:");
        const label = TEMPLATE_LABELS[t.template_name] || t.template_name;
        return (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>{label}</span>
                {isCustom ? (
                  <Badge variant="default">Customized</Badge>
                ) : (
                  <Badge variant="secondary">Default</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <span className="text-xs font-medium text-muted-foreground">Subject</span>
                <p className="text-sm mt-1 font-mono bg-muted/50 p-2 rounded">{t.subject}</p>
              </div>
              <div>
                <span className="text-xs font-medium text-muted-foreground">Body</span>
                <pre className="text-sm mt-1 font-mono bg-muted/50 p-2 rounded whitespace-pre-wrap">
                  {t.body}
                </pre>
              </div>
              <div className="flex gap-2">
                <TemplateEditor
                  slug={slug!}
                  template={t}
                  open={editing?.id === t.id}
                  onOpenChange={(o) => setEditing(o ? t : null)}
                />
                {isCustom && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await api.deleteEmailTemplate(slug!, t.template_name);
                      toast.success("Template reset to default");
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Reset
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

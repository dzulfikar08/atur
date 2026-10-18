import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "@/lib/icons";
import { toast } from "sonner";
import { ApiError, portalApi } from "@/lib/portalApi";
import CommentEditor from "@/components/editor/CommentEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;

// Empty editor yields "<p></p>"; treat tag-stripped emptiness as no content.
const isEmptyHtml = (html: string) => html.replace(/<[^>]*>/g, "").trim() === "";

export default function PortalNewTicketPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("none");

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description_html?: string; priority?: string }) =>
      portalApi.createTicket(slug!, data),
    onSuccess: (issue) => {
      // Refresh the list so the new ticket appears when the customer returns.
      qc.invalidateQueries({ queryKey: ["portal-mine", slug] });
      toast.success("Ticket created");
      navigate(`/portal/${slug}/tickets/${issue.sequence_id}`, { replace: true });
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Failed to create ticket"),
  });

  const submit = () => {
    if (!slug || !name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      description_html: isEmptyHtml(description) ? undefined : description,
      priority,
    });
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/portal/${slug}/tickets`)}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>New ticket</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Subject</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Briefly describe your request"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Details</Label>
            <CommentEditor
              value={description}
              onChange={setDescription}
              onSubmit={() => {
                if (name.trim() && !createMutation.isPending) submit();
              }}
              uploadUrl={`/portal/${slug}/assets/upload`}
              placeholder="Describe the problem, steps to reproduce, or what you need."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="priority">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger id="priority" className="h-9">
                <SelectValue className="capitalize" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p} className="capitalize">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate(`/portal/${slug}/tickets`)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!name.trim() || createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create ticket"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

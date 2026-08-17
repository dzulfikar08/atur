import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Reused from the onboarding flow but as a controlled dialog so the Sidebar
// workspace switcher can launch it. Backend adds the creator as an admin
// member (role 20), so the new workspace shows up in /api/users/me workspaces
// after a refetch.
export default function CreateWorkspaceDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSlug = slugEdited ? slug : toSlug(name);

  function reset() {
    setName("");
    setSlug("");
    setSlugEdited(false);
    setSubmitting(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const finalSlug = (slugEdited ? slug : toSlug(name)).trim();
    if (!name.trim() || !finalSlug) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/workspaces/", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), slug: finalSlug }),
      });
      // Refresh the shared ['workspaces'] cache (fed to switchers via useWorkspaces).
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Workspace created");
      reset();
      onOpenChange(false);
      navigate(`/${finalSlug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create workspace");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            Workspaces hold their own projects, issues, and members.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Workspace name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Slug</label>
            <Input
              value={effectiveSlug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugEdited(true);
              }}
              placeholder="acme-inc"
            />
            <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and dashes.</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "Creating…" : "Create workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

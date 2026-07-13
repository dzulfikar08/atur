import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// Shown when an authenticated user belongs to no workspace yet. Without this
// the app dead-ends on the root loading spinner (RootRoute only navigates once
// a workspace exists), so a freshly registered user could never proceed.
export default function CreateWorkspace() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSlug = slugEdited ? slug : toSlug(name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const finalSlug = (slugEdited ? slug : toSlug(name)).trim();
    if (!name.trim() || !finalSlug) {
      toast.error('Name is required');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/workspaces/', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), slug: finalSlug }),
      });
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      toast.success('Workspace created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create your workspace</CardTitle>
        </CardHeader>
        <CardContent>
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
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and dashes.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !name.trim()}>
              {submitting ? 'Creating…' : 'Create workspace'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

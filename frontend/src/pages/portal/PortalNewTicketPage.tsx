import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from '@/lib/icons';
import { toast } from 'sonner';
import { ApiError, portalApi } from '@/lib/portalApi';

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

export default function PortalNewTicketPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<string>('none');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!slug || !name.trim()) return;
    setLoading(true);
    try {
      const issue = await portalApi.createTicket(slug, {
        name: name.trim(),
        description_html: description.trim() ? `<p>${description.trim()}</p>` : undefined,
        priority,
      });
      toast.success('Ticket created');
      navigate(`/portal/${slug}/tickets/${issue.sequence_id}`, { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create ticket');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/portal/${slug}`)}>
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
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the problem, steps to reproduce, or what you need."
              rows={8}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="priority">Priority</Label>
            <select
              id="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p} className="capitalize">
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate(`/portal/${slug}`)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!name.trim() || loading}>
              {loading ? 'Creating…' : 'Create ticket'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

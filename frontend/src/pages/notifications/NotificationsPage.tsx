import { useState } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, Check, Archive, Eye, EyeOff } from '@/lib/icons';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: string;
  title: string | null;
  message: any;
  entity_identifier: string | null;
  entity_name: string | null;
  read_at: string | null;
  archived_at: string | null;
  workspace_id: string;
  project_id: string | null;
  triggered_by_id: string | null;
  created_at: string | null;
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', filter],
    queryFn: () => {
      const params = new URLSearchParams({ per_page: '50' });
      if (filter === 'unread') params.set('read', 'false');
      return apiFetch<{ results: Notification[] }>(`/notifications/?${params}`);
    },
  });

  const { data: unreadData } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => apiFetch<{ count: number }>('/notifications/unread-count/'),
  });

  const notifications = data?.results ?? [];
  const unreadCount = unreadData?.count ?? 0;

  const markRead = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) =>
      apiFetch(`/notifications/${id}/`, { method: 'PATCH', body: JSON.stringify({ read }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const archive = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/notifications/${id}/`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => apiFetch('/notifications/mark-all-read/', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All notifications marked as read');
    },
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5" />
          <h1 className="text-xl font-bold">Notifications</h1>
          {unreadCount > 0 && (
            <Badge variant="default" className="text-xs">{unreadCount}</Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()}>
              <Check className="h-3.5 w-3.5 mr-1" /> Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-4">
        <button
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
            filter === 'all'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
            filter === 'unread'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setFilter('unread')}
        >
          Unread {unreadCount > 0 && `(${unreadCount})`}
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-pulse text-muted-foreground">Loading notifications...</div>
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16">
          <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-1">No notifications</h3>
          <p className="text-muted-foreground text-sm">
            {filter === 'unread' ? "You're all caught up!" : "Notifications will appear here when issues are updated."}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {notifications.map((n) => {
            const isUnread = !n.read_at;
            const msgText = typeof n.message === 'string' ? n.message : n.message?.text || n.message?.toString() || '';

            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 p-3 rounded-lg transition-colors border ${
                  isUnread ? 'bg-primary/5 border-primary/20' : 'bg-background border-transparent hover:bg-muted/30'
                }`}
              >
                {/* Unread indicator */}
                <div className="pt-1">
                  {isUnread && <div className="h-2 w-2 rounded-full bg-primary" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{n.title || 'Notification'}</p>
                  {msgText && (
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{msgText}</p>
                  )}
                  {n.entity_name && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {n.entity_name}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {n.created_at && formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {isUnread ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Mark as read"
                      onClick={() => markRead.mutate({ id: n.id, read: true })}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Mark as unread"
                      onClick={() => markRead.mutate({ id: n.id, read: false })}
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Archive"
                    onClick={() => archive.mutate(n.id)}
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

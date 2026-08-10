import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Cached, workspace-scoped list (incl. logo). Single source of truth for the
// workspace switcher / selectors. Invalidation key: ['workspaces'].
export function useWorkspaces(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.listWorkspaces(),
    enabled: options?.enabled,
  });
}

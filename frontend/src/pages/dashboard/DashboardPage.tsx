import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useWindowSize } from '@/hooks/useWindowSize';
import DesktopDashboard from './DesktopDashboard';
import MobileDashboard from '@/components/mobile/MobileDashboard';
import { api } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspace';

export default function DashboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const { width } = useWindowSize();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentSlug = useWorkspaceStore((s) => s.currentSlug);
  const effectiveSlug = slug ?? currentSlug;

  useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => {
      const ws = await api.listWorkspaces();
      useWorkspaceStore.getState().setWorkspaces(ws);
      return ws;
    },
  });

  const workspaceName = workspaces.find((w) => w.slug === effectiveSlug)?.name ?? effectiveSlug ?? 'Workspace';

  if (!effectiveSlug) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No workspace selected.
      </div>
    );
  }

  if (width < 768) {
    return <MobileDashboard slug={effectiveSlug} workspaceName={workspaceName} />;
  }

  return <DesktopDashboard />;
}

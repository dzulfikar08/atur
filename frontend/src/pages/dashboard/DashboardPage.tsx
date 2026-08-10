import { useParams } from 'react-router-dom';
import { useWindowSize } from '@/hooks/useWindowSize';
import DesktopDashboard from './DesktopDashboard';
import MobileDashboard from '@/components/mobile/MobileDashboard';
import { useWorkspaceStore } from '@/stores/workspace';
import { useWorkspaces } from '@/hooks/useWorkspaces';

export default function DashboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const { width } = useWindowSize();
  const { data: workspaces = [] } = useWorkspaces();
  const currentSlug = useWorkspaceStore((s) => s.currentSlug);
  const effectiveSlug = slug ?? currentSlug;


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

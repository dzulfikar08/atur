import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import AppShell from '@/components/layout/AppShell';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import CreateWorkspace from '@/components/onboarding/CreateWorkspace';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';


// Lazy-loaded page components
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const OAuthCallbackPage = lazy(() => import('@/pages/auth/OAuthCallbackPage'));
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const ProjectsPage = lazy(() => import('@/pages/projects/ProjectsPage'));
const ProjectBoardPage = lazy(() => import('@/pages/projects/ProjectBoardPage'));
const IssueDetailPage = lazy(() => import('@/pages/projects/IssueDetailPage'));
const ProjectSettingsPage = lazy(() => import('@/pages/projects/ProjectSettingsPage'));
const ModulesPage = lazy(() => import('@/pages/projects/ModulesPage'));
const ModuleDetailPage = lazy(() => import('@/pages/projects/ModuleDetailPage'));
const CyclesPage = lazy(() => import('@/pages/cycles/CyclesPage'));
const CycleDetailPage = lazy(() => import('@/pages/cycles/CycleDetailPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const ProfilePage = lazy(() => import('@/pages/settings/ProfilePage'));
const MyIssuesPage = lazy(() => import('@/pages/issues/MyIssuesPage'));
const PagesPage = lazy(() => import('@/pages/pages/PagesPage'));
const KnowledgeGraphPage = lazy(() => import('@/pages/pages/KnowledgeGraphPage'));
const GitHubIntegrationPage = lazy(() => import('@/pages/integrations/GitHubIntegrationPage'));
const ClockifyIntegrationPage = lazy(() => import('@/pages/integrations/ClockifyIntegrationPage'));
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage'));
const NotificationsPage = lazy(() => import('@/pages/notifications/NotificationsPage'));
const LandingPage = lazy(() => import('@/pages/LandingPage'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

function RootRoute() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const initialized = useAuthStore(s => s.initialized);
  const fetchUser = useAuthStore(s => s.fetchUser);
  const workspaces = useWorkspaceStore(s => s.workspaces);
  const setWorkspaces = useWorkspaceStore(s => s.setWorkspaces);

  useEffect(() => {
    if (!initialized) {
      fetchUser();
    }
  }, [initialized, fetchUser]);

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => {
      const data = await api.listWorkspaces();
      setWorkspaces(data);
      return data;
    },
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (initialized && isAuthenticated && workspaces.length > 0) {
      navigate(`/${workspaces[0].slug}`, { replace: true });
    }
  }, [initialized, isAuthenticated, workspaces, navigate]);

  if (!initialized) return <PageLoader />;
  if (!isAuthenticated) return <LandingPage />;

  // Authenticated but the workspaces query failed (e.g. transient auth issue) —
  // retry instead of spinning forever.
  if (workspacesQuery.isError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">Couldn&apos;t load workspaces.</p>
        <Button onClick={() => workspacesQuery.refetch()}>Retry</Button>
      </div>
    );
  }

  // Authenticated, query succeeded, but user has no workspace — onboard them.
  // Without this a fresh user dead-ends on the spinner forever.
  if (workspacesQuery.isSuccess && workspaces.length === 0) {
    return <CreateWorkspace />;
  }

  return <PageLoader />;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Root route — auth-aware: shows LandingPage or redirects to workspace */}
        <Route path="/" element={<RootRoute />} />
        <Route path="/dashboard" element={<RootRoute />} />

        {/* Public routes */}
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/register" element={<RegisterPage />} />
        <Route path="/auth/callback/:provider" element={<OAuthCallbackPage />} />

        {/* Protected workspace routes with AppShell layout */}
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route path="/:slug" element={<DashboardPage />} />
          <Route path="/:slug/issues" element={<MyIssuesPage />} />
          <Route path="/:slug/pages/graph" element={<KnowledgeGraphPage />} />
          <Route path="/:slug/pages" element={<PagesPage />} />
          <Route path="/:slug/pages/:pageId" element={<PagesPage />} />
          <Route path="/:slug/projects" element={<ProjectsPage />} />
          <Route path="/:slug/projects/:projectId" element={<ProjectBoardPage />} />
          <Route path="/:slug/projects/:projectId/settings" element={<ProjectSettingsPage />} />
          <Route path="/:slug/projects/:projectId/modules" element={<ModulesPage />} />
          <Route path="/:slug/projects/:projectId/modules/:moduleId" element={<ModuleDetailPage />} />
          <Route
            path="/:slug/projects/:projectId/issues/:issueSeqId"
            element={<IssueDetailPage />}
          />
          <Route path="/:slug/projects/:projectId/cycles" element={<CyclesPage />} />
          <Route
            path="/:slug/projects/:projectId/cycles/:cycleId"
            element={<CycleDetailPage />}
          />
          <Route path="/:slug/integrations/github" element={<GitHubIntegrationPage />} />
          <Route path="/:slug/integrations/clockify" element={<ClockifyIntegrationPage />} />
          <Route path="/:slug/admin" element={<AdminDashboardPage />} />
          <Route path="/:slug/notifications" element={<NotificationsPage />} />
          <Route path="/:slug/settings" element={<SettingsPage />} />
          <Route path="/:slug/me" element={<ProfilePage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import AppShell from '@/components/layout/AppShell';
import ProtectedRoute from '@/components/auth/ProtectedRoute';

// Lazy-loaded page components
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const OAuthCallbackPage = lazy(() => import('@/pages/auth/OAuthCallbackPage'));
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const ProjectsPage = lazy(() => import('@/pages/projects/ProjectsPage'));
const ProjectBoardPage = lazy(() => import('@/pages/projects/ProjectBoardPage'));
const IssueDetailPage = lazy(() => import('@/pages/projects/IssueDetailPage'));
const CyclesPage = lazy(() => import('@/pages/cycles/CyclesPage'));
const CycleDetailPage = lazy(() => import('@/pages/cycles/CycleDetailPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const ProfilePage = lazy(() => import('@/pages/settings/ProfilePage'));
const MyIssuesPage = lazy(() => import('@/pages/issues/MyIssuesPage'));
const PagesPage = lazy(() => import('@/pages/pages/PagesPage'));
const GitHubIntegrationPage = lazy(() => import('@/pages/integrations/GitHubIntegrationPage'));
const ClockifyIntegrationPage = lazy(() => import('@/pages/integrations/ClockifyIntegrationPage'));
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

function RootRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (isAuthenticated) return <Navigate to="/plane-pmo" replace />;
  return <Navigate to="/auth/login" replace />;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
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
          <Route path="/:slug/pages" element={<PagesPage />} />
          <Route path="/:slug/projects" element={<ProjectsPage />} />
          <Route path="/:slug/projects/:projectId" element={<ProjectBoardPage />} />
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
          <Route path="/:slug/settings" element={<SettingsPage />} />
          <Route path="/:slug/me" element={<ProfilePage />} />
        </Route>

        {/* Root redirect */}
        <Route path="/" element={<RootRedirect />} />
      </Routes>
    </Suspense>
  );
}

import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import CreateWorkspace from "@/components/onboarding/CreateWorkspace";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { useWorkspaces } from "@/hooks/useWorkspaces";

// Lazy-loaded page components
const LoginPage = lazy(() => import("@/pages/auth/LoginPage"));
const RegisterPage = lazy(() => import("@/pages/auth/RegisterPage"));
const OAuthCallbackPage = lazy(() => import("@/pages/auth/OAuthCallbackPage"));
const DashboardPage = lazy(() => import("@/pages/dashboard/DashboardPage"));
const ProjectsPage = lazy(() => import("@/pages/projects/ProjectsPage"));
const ProjectBoardPage = lazy(() => import("@/pages/projects/ProjectBoardPage"));
const IssueDetailPage = lazy(() => import("@/pages/projects/IssueDetailPage"));
const ProjectSettingsPage = lazy(() => import("@/pages/projects/ProjectSettingsPage"));
const ModulesPage = lazy(() => import("@/pages/projects/ModulesPage"));
const ModuleDetailPage = lazy(() => import("@/pages/projects/ModuleDetailPage"));
const CyclesPage = lazy(() => import("@/pages/cycles/CyclesPage"));
const CycleDetailPage = lazy(() => import("@/pages/cycles/CycleDetailPage"));
const SettingsPage = lazy(() => import("@/pages/settings/SettingsPage"));
const ProfilePage = lazy(() => import("@/pages/settings/ProfilePage"));
const MyIssuesPage = lazy(() => import("@/pages/issues/MyIssuesPage"));
const NotesPage = lazy(() => import("@/pages/notes/NotesPage"));
const PagesPage = lazy(() => import("@/pages/pages/PagesPage"));
const KnowledgeGraphPage = lazy(() => import("@/pages/pages/KnowledgeGraphPage"));
const GitHubIntegrationPage = lazy(() => import("@/pages/integrations/GitHubIntegrationPage"));
const ClockifyIntegrationPage = lazy(() => import("@/pages/integrations/ClockifyIntegrationPage"));
const McpIntegrationPage = lazy(() => import("@/pages/integrations/McpIntegrationPage"));
const PolarIntegrationPage = lazy(() => import("@/pages/integrations/PolarIntegrationPage"));
const IntegrationsIndexPage = lazy(() => import("@/pages/integrations/IntegrationsIndexPage"));
const AdminDashboardPage = lazy(() => import("@/pages/admin/AdminDashboardPage"));
const WorkspaceBindingsPage = lazy(() => import("@/pages/admin/WorkspaceBindingsPage"));
const NotificationsPage = lazy(() => import("@/pages/notifications/NotificationsPage"));
const TimesheetPage = lazy(() => import("@/pages/timesheet/TimesheetPage"));
const CrmPage = lazy(() => import("@/pages/crm/CrmPage"));
const ContactsListPage = lazy(() => import("@/pages/crm/ContactsListPage"));
const ContactDetailPage = lazy(() => import("@/pages/crm/ContactDetailPage"));
const ThreadsInboxPage = lazy(() => import("@/pages/crm/ThreadsInboxPage"));
const ThreadsCallbackPage = lazy(() => import("@/pages/crm/ThreadsCallbackPage"));
const StrategyPage = lazy(() => import("@/pages/strategy/StrategyPage"));
const CompaniesPage = lazy(() => import("@/pages/crm/CompaniesPage"));
const CompanyDetailPage = lazy(() => import("@/pages/crm/CompanyDetailPage"));
const CrmPipelineListPage = lazy(() => import("@/pages/crm/PipelineListPage"));
const CrmPipelineBoardPage = lazy(() => import("@/pages/crm/PipelineBoardPage"));
const EmailTemplatesPage = lazy(() => import("@/pages/crm/EmailTemplatesPage"));
const FeedbackPortalPage = lazy(() => import("@/pages/feedback/FeedbackPortalPage"));
const PortalLoginPage = lazy(() => import("@/pages/portal/PortalLoginPage"));
const PortalTicketsPage = lazy(() => import("@/pages/portal/PortalTicketsPage"));
const PortalIdeasPage = lazy(() => import("@/pages/portal/PortalIdeasPage"));
const PortalChangelogPage = lazy(() => import("@/pages/portal/PortalChangelogPage"));
const PortalNewTicketPage = lazy(() => import("@/pages/portal/PortalNewTicketPage"));
const PortalTicketDetailPage = lazy(() => import("@/pages/portal/PortalTicketDetailPage"));
const PortalRouteGuard = lazy(() => import("@/components/portal/PortalRouteGuard"));
const PortalLayout = lazy(() => import("@/components/portal/PortalLayout"));
const PanesPage = lazy(() => import("@/pages/panes/PanesPage"));
const PaneViewPage = lazy(() => import("@/pages/panes/PaneViewPage"));
const ScreenPage = lazy(() => import("@/pages/screen/ScreenPage"));
const PlatformPage = lazy(() => import("@/pages/platform/PlatformPage"));
const PlatformUserPage = lazy(() => import("@/pages/platform/PlatformUserPage"));
const PlatformWorkspacePage = lazy(() => import("@/pages/platform/PlatformWorkspacePage"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

function RootRoute() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const initialized = useAuthStore((s) => s.initialized);
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const workspacesQuery = useWorkspaces({ enabled: isAuthenticated });
  const workspaces = workspacesQuery.data ?? [];

  useEffect(() => {
    if (!initialized) {
      fetchUser();
    }
  }, [initialized, fetchUser]);

  const firstSlug = workspaces[0]?.slug;
  useEffect(() => {
    if (initialized && isAuthenticated && firstSlug) {
      navigate(`/${firstSlug}`, { replace: true });
    }
  }, [initialized, isAuthenticated, firstSlug, navigate]);

  if (!initialized) return <PageLoader />;
  // The marketing site owns the public landing. Logged-out visitors on the app
  // origin bounce to https://diatur.com (auth pages like /auth/login still
  // live here on the app origin). Dev keeps you local: the seeded dev user
  // (lib/dev-auth.ts) normally logs you in automatically; if that fails,
  // fall back to the login page instead of shipping you off to prod.
  if (!isAuthenticated) {
    if (import.meta.env.DEV) {
      navigate("/auth/login", { replace: true });
      return null;
    }
    window.location.replace("https://diatur.com");
    return null;
  }

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
        {/* Root route — auth-aware: redirects logged-out visitors to the marketing site */}
        <Route path="/" element={<RootRoute />} />
        <Route path="/dashboard" element={<RootRoute />} />

        {/* Public routes */}
        <Route path="/feedback/:token" element={<FeedbackPortalPage />} />
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/register" element={<RegisterPage />} />
        <Route path="/auth/callback/:provider" element={<OAuthCallbackPage />} />

        {/* Unified portal: Ideas / Support / Changelog under one OTP sign-in.
            Ideas + Changelog are public; Support (and tickets) need a session. */}
        <Route path="/portal/:slug/login" element={<PortalLoginPage />} />
        <Route path="/portal/:slug" element={<PortalLayout />}>
          <Route index element={<Navigate to="ideas" replace />} />
          <Route path="ideas" element={<PortalIdeasPage />} />
          <Route path="changelog" element={<PortalChangelogPage />} />
          <Route element={<PortalRouteGuard />}>
            <Route path="tickets" element={<PortalTicketsPage />} />
            <Route path="tickets/new" element={<PortalNewTicketPage />} />
            <Route path="tickets/:seqId" element={<PortalTicketDetailPage />} />
          </Route>
        </Route>

        {/* Protected workspace routes with AppShell layout */}
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          {/* Pane observation — herdr execution plane via Worker proxy (ATUR-2) */}
          {/* Threads OAuth redirect: one fixed URI, workspace rides in the signed state */}
          <Route path="/integrations/threads/callback" element={<ThreadsCallbackPage />} />
          <Route path="/panes" element={<PanesPage />} />
          <Route path="/panes/:paneId" element={<PaneViewPage />} />
          {/* Desktop sharing (noVNC) — superuser-only, gated again by the Worker */}
          <Route path="/screen" element={<ScreenPage />} />
          {/* Platform console: superuser-only, spans every workspace */}
          <Route path="/admin" element={<PlatformPage />} />
          <Route path="/admin/users/:userId" element={<PlatformUserPage />} />
          <Route path="/admin/workspaces/:wsSlug" element={<PlatformWorkspacePage />} />
          <Route path="/:slug" element={<DashboardPage />} />
          <Route path="/:slug/issues" element={<MyIssuesPage />} />
          <Route path="/:slug/notes" element={<NotesPage />} />
          <Route path="/:slug/pages/graph" element={<KnowledgeGraphPage />} />
          <Route path="/:slug/pages" element={<PagesPage />} />
          <Route path="/:slug/pages/:pageId" element={<PagesPage />} />
          <Route path="/:slug/projects" element={<ProjectsPage />} />
          <Route path="/:slug/projects/:projectId" element={<ProjectBoardPage />} />
          <Route path="/:slug/projects/:projectId/settings" element={<ProjectSettingsPage />} />
          <Route path="/:slug/projects/:projectId/modules" element={<ModulesPage />} />
          <Route
            path="/:slug/projects/:projectId/modules/:moduleId"
            element={<ModuleDetailPage />}
          />
          <Route
            path="/:slug/projects/:projectId/issues/:issueSeqId"
            element={<IssueDetailPage />}
          />
          <Route path="/:slug/projects/:projectId/cycles" element={<CyclesPage />} />
          <Route path="/:slug/projects/:projectId/cycles/:cycleId" element={<CycleDetailPage />} />
          <Route path="/:slug/integrations" element={<IntegrationsIndexPage />} />
          <Route path="/:slug/integrations/github" element={<GitHubIntegrationPage />} />
          <Route path="/:slug/integrations/clockify" element={<ClockifyIntegrationPage />} />
          <Route path="/:slug/integrations/mcp" element={<McpIntegrationPage />} />
          <Route path="/:slug/integrations/polar" element={<PolarIntegrationPage />} />
          <Route path="/:slug/admin" element={<AdminDashboardPage />} />
          <Route path="/:slug/admin/bindings" element={<WorkspaceBindingsPage />} />
          <Route path="/:slug/notifications" element={<NotificationsPage />} />
          <Route path="/:slug/timesheet" element={<TimesheetPage />} />
          <Route path="/:slug/crm" element={<CrmPage />} />
          <Route path="/:slug/crm/contacts" element={<ContactsListPage />} />
          <Route path="/:slug/crm/contacts/:id" element={<ContactDetailPage />} />
          <Route path="/:slug/crm/threads" element={<ThreadsInboxPage />} />
          <Route path="/:slug/crm/companies" element={<CompaniesPage />} />
          <Route path="/:slug/crm/companies/:id" element={<CompanyDetailPage />} />
          <Route path="/:slug/crm/pipelines" element={<CrmPipelineListPage />} />
          <Route path="/:slug/crm/pipelines/:projectId" element={<CrmPipelineBoardPage />} />
          <Route path="/:slug/crm/email-templates" element={<EmailTemplatesPage />} />
          <Route path="/:slug/settings" element={<SettingsPage />} />
          <Route path="/:slug/strategy" element={<StrategyPage />} />
          <Route path="/:slug/me" element={<ProfilePage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

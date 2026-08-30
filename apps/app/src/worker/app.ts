import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { errorMiddleware } from "./middleware/error";
import { snakeCaseMiddleware } from "./middleware/snakecase";
import { authMiddleware } from "./middleware/auth";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { workspaceRoutes } from "./routes/workspaces";
import { projectRoutes } from "./routes/projects";
import { issueRoutes } from "./routes/issues";
import { cycleRoutes } from "./routes/cycles";
import { moduleRoutes } from "./routes/modules";
import { pageRoutes } from "./routes/pages";
import { viewRoutes } from "./routes/views";
import { stateRoutes } from "./routes/states";
import { projectFolderRoutes } from "./routes/projectFolders";
import { labelRoutes } from "./routes/labels";
import { memberRoutes } from "./routes/members";
import { sprintRoutes } from "./routes/sprints";
import { customFieldRoutes } from "./routes/custom_fields";
import { notificationRoutes } from "./routes/notifications";
import { webhookRoutes } from "./routes/webhooks";
import { integrationRoutes } from "./routes/integrations";
import { exportRoutes } from "./routes/exports";
import { importRoutes } from "./routes/imports";
import { searchRoutes } from "./routes/search";
import { analyticsRoutes } from "./routes/analytics";
import { timesheetRoutes } from "./routes/timesheet";
import { assetRoutes } from "./routes/assets";
import { commentRoutes } from "./routes/comments";
import { subscriberRoutes } from "./routes/subscribers";
import { issueExtrasRoutes } from "./routes/issue_extras";
import { relationRoutes } from "./routes/relations";
import { userRoutes } from "./routes/users";
import { mcpRoutes } from "./routes/mcp/index";
import { portalRoutes } from "./routes/portal";
import { portalSettingsRoutes } from "./routes/portal_settings";
import { contactsRoutes } from "./routes/contacts";
import { companiesRoutes } from "./routes/companies";
import { dealsRoutes } from "./routes/deals";
import { feedbackRoutes } from "./routes/feedback";
import { feedbackAdminRoutes } from "./routes/feedback_admin";
import { widgetRoutes } from "./routes/widget";
import { polarWebhookRoutes, polarRoutes } from "./routes/polar";
import { meRoutes } from "./routes/me";
import type { Env } from "./lib/env";

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>({ strict: false });

  app.use("*", cors());
  app.use("*", logger());
  app.use("*", snakeCaseMiddleware);
  app.use("*", errorMiddleware);

  // Asset routes authenticate themselves: POST /upload carries its own
  // authMiddleware, and GET /:id resolves a main-app user (API key or session)
  // OR a portal customer from the portal-session cookie. Mounted before the
  // global /api/* gate below — otherwise authMiddleware 401s portal customers
  // before the handler can see their cookie and their ticket images break.
  app.route("/api/assets", assetRoutes);

  // Every /api/* route requires an authenticated session (cookie or bearer).
  // /auth/* (login/register) and /health are mounted outside /api and stay public.
  app.use("/api/*", authMiddleware);

  app.route("/health", healthRoutes);
  app.route("/auth", authRoutes);
  app.route("/mcp", mcpRoutes);

  // Customer support portal — public OTP auth + ticket routes. Mounted outside
  // /api/* so the global authMiddleware does NOT gate it; portal sessions are
  // isolated in the portal-session cookie (customers.session_token).
  app.route("/portal", portalRoutes);

  // Embeddable feedback widget script (served as application/javascript).
  app.route("/widget.js", widgetRoutes);
  // Public feedback board API — token-keyed, no session.
  app.route("/public/feedback/:token", feedbackRoutes);

  // Polar webhook receiver — per-workspace URL (/webhooks/polar/:slug), each
  // workspace verifies with its own secret from polar_settings. Public.
  app.route("/webhooks/polar", polarWebhookRoutes);

  app.route("/api/users", userRoutes);

  app.route("/api/workspaces", workspaceRoutes);
  app.route("/api/workspaces/:slug/projects", projectRoutes);
  app.route("/api/workspaces/:slug/portal-settings", portalSettingsRoutes);
  app.route("/api/workspaces/:slug/contacts", contactsRoutes);
  app.route("/api/workspaces/:slug/companies", companiesRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/deals", dealsRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/issues", issueRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/cycles", cycleRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/modules", moduleRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/views", viewRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/pages", pageRoutes);
  app.route("/api/workspaces/:slug/pages", pageRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/states", stateRoutes);
  app.route("/api/workspaces/:slug/folders", projectFolderRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/labels", labelRoutes);
  app.route("/api/workspaces/:slug/members", memberRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/sprints", sprintRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/custom-fields", customFieldRoutes);
  app.route("/api/notifications", notificationRoutes);
  app.route("/api/workspaces/:slug/webhooks", webhookRoutes);
  app.route("/api/workspaces/:slug/integrations", integrationRoutes);
  app.route("/api/workspaces/:slug/polar", polarRoutes);
  app.route("/api/workspaces/:slug/exports", exportRoutes);
  app.route("/api/workspaces/:slug/imports", importRoutes);
  app.route("/api/search", searchRoutes);
  app.route("/api/workspaces/:slug/search", searchRoutes);
  app.route("/api/workspaces/:slug/analytics", analyticsRoutes);
  app.route("/api/me", meRoutes);
  app.route("/api/workspaces/:slug/timesheet", timesheetRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments", commentRoutes);
  // Mounted before issueExtrasRoutes so /subscribers isn't swallowed by its
  // generic /:issueId handler.
  app.route(
    "/api/workspaces/:slug/projects/:projectId/issues/:issueId/subscribers",
    subscriberRoutes,
  );
  app.route("/api/workspaces/:slug/projects/:projectId/issues/:issueId", issueExtrasRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/issue-relations", relationRoutes);
  // Feedback board admin config (authed). Scoped under a project.
  app.route("/api/workspaces/:slug/projects/:projectId/feedback-board", feedbackAdminRoutes);

  return app;
}

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { errorMiddleware } from './middleware/error'
import { snakeCaseMiddleware } from './middleware/snakecase'
import { healthRoutes } from './routes/health'
import { authRoutes } from './routes/auth'
import { workspaceRoutes } from './routes/workspaces'
import { projectRoutes } from './routes/projects'
import { issueRoutes } from './routes/issues'
import { cycleRoutes } from './routes/cycles'
import { moduleRoutes } from './routes/modules'
import { pageRoutes } from './routes/pages'
import { viewRoutes } from './routes/views'
import { stateRoutes } from './routes/states'
import { labelRoutes } from './routes/labels'
import { memberRoutes } from './routes/members'
import { sprintRoutes } from './routes/sprints'
import { customFieldRoutes } from './routes/custom_fields'
import { notificationRoutes } from './routes/notifications'
import { webhookRoutes } from './routes/webhooks'
import { integrationRoutes } from './routes/integrations'
import { exportRoutes } from './routes/exports'
import { importRoutes } from './routes/imports'
import { searchRoutes } from './routes/search'
import { analyticsRoutes } from './routes/analytics'
import { assetRoutes } from './routes/assets'
import { commentRoutes } from './routes/comments'
import { issueExtrasRoutes } from './routes/issue_extras'
import { relationRoutes } from './routes/relations'
import { userRoutes } from './routes/users'
import { mcpRoutes } from './routes/mcp/index'
import type { Env } from './lib/env'

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>({ strict: false })

  app.use('*', cors())
  app.use('*', logger())
  app.use('*', snakeCaseMiddleware)
  app.use('*', errorMiddleware)

  app.route('/health', healthRoutes)
  app.route('/auth', authRoutes)
  app.route('/mcp', mcpRoutes)

  app.route('/api/users', userRoutes)

  app.route('/api/workspaces', workspaceRoutes)
  app.route('/api/workspaces/:slug/projects', projectRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/issues', issueRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/cycles', cycleRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/modules', moduleRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/views', viewRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/pages', pageRoutes)
  app.route('/api/workspaces/:slug/pages', pageRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/states', stateRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/labels', labelRoutes)
  app.route('/api/workspaces/:slug/members', memberRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/sprints', sprintRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/custom-fields', customFieldRoutes)
  app.route('/api/notifications', notificationRoutes)
  app.route('/api/workspaces/:slug/webhooks', webhookRoutes)
  app.route('/api/workspaces/:slug/integrations', integrationRoutes)
  app.route('/api/workspaces/:slug/exports', exportRoutes)
  app.route('/api/workspaces/:slug/imports', importRoutes)
  app.route('/api/search', searchRoutes)
  app.route('/api/workspaces/:slug/search', searchRoutes)
  app.route('/api/workspaces/:slug/analytics', analyticsRoutes)
  app.route('/api/assets', assetRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments', commentRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/issues/:issueId', issueExtrasRoutes)
  app.route('/api/workspaces/:slug/projects/:projectId/issue-relations', relationRoutes)

  return app
}

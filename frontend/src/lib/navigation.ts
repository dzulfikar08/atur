/**
 * Compute where to land after switching to another workspace.
 *
 * Keeps the current section (issues / projects / pages / crm / …) when it
 * exists in the new workspace, but detail views (issue, project board, page,
 * contact, pipeline, module, cycle, project settings) fall back to their
 * list page. Anything unrecognized falls back to the dashboard.
 */
export function getWorkspaceSwitchPath(currentPath: string, targetSlug: string): string {
  const segments = currentPath.split('/').filter(Boolean);
  // Drop the leading slug (or 'all') segment.
  segments.shift();

  const [section, ...rest] = segments;
  if (!section) return `/${targetSlug}`;

  switch (section) {
    case 'issues':
      // /:slug/issues/:seqId -> issues list
      return `/${targetSlug}/issues`;
    case 'projects': {
      const projectId = rest[0];
      if (!projectId) return `/${targetSlug}/projects`;
      // projects/:projectId/settings, .../modules[/:moduleId], .../cycles[/:cycleId]
      // -> project list. A project board in another workspace may not exist.
      return `/${targetSlug}/projects`;
    }
    case 'pages':
      // pages/:pageId, pages/graph -> pages list
      return `/${targetSlug}/pages`;
    case 'crm': {
      const sub = rest[0];
      if (sub === 'contacts') return `/${targetSlug}/crm/contacts`;
      if (sub === 'pipelines') return `/${targetSlug}/crm/pipelines`;
      return `/${targetSlug}/crm`;
    }
    case 'integrations':
    case 'admin':
    case 'notifications':
    case 'timesheet':
    case 'settings':
    case 'me':
      return `/${targetSlug}/${section}`;
    default:
      return `/${targetSlug}`;
  }
}

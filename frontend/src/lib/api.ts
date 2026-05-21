const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || `API error: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listWorkspaces: () => apiFetch<Workspace[]>('/workspaces/'),
  analyticsOverview: (slug: string) =>
    apiFetch<AnalyticsOverview>(`/workspaces/${slug}/analytics/overview`),
  completionTrend: (slug: string) =>
    apiFetch<{ trend: CompletionTrendPoint[] }>(`/workspaces/${slug}/analytics/completion-trend`)
      .then(r => r.trend),
  sprintAnalytics: (slug: string) =>
    apiFetch<{ active_sprints: SprintData[] }>(`/workspaces/${slug}/analytics/sprints`)
      .then(r => r.active_sprints),
  listProjects: (slug: string) => apiFetch<Project[]>(`/workspaces/${slug}/projects/`),
  listIssues: (slug: string, projectId: string) =>
    apiFetch<PaginatedResponse<Issue>>(`/workspaces/${slug}/projects/${projectId}/issues/`)
      .then(r => r.results),
  listStates: (slug: string, projectId: string) =>
    apiFetch<State[]>(`/workspaces/${slug}/projects/${projectId}/states/`),
  search: (slug: string, query: string) =>
    apiFetch<SearchResult>(`/workspaces/${slug}/search/?q=${encodeURIComponent(query)}`),
};

// --- Types ---

export interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export interface AnalyticsOverview {
  total_issues: number;
  open_issues: number;
  closed_issues: number;
  overdue_issues: number;
  total_trend: number;
  open_trend: number;
  closed_trend: number;
  overdue_trend: number;
}

export interface CompletionTrendPoint {
  date: string;
  created: number;
  completed: number;
}

export interface SprintAnalyticsResponse {
  sprints: SprintData[];
}

export interface SprintData {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  total_issues: number;
  completed_issues: number;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
}

export interface Issue {
  id: string;
  name: string;
  sequence_id: number;
  state_id: string | null;
  priority: string | null;
  description_html: string | null;
  created_at: string;
  updated_at: string;
  project_id: string;
  workspace_id: string;
  parent_id: string | null;
  is_draft: boolean;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
}

export interface SearchResult {
  issues: Issue[];
  projects: Project[];
}

export interface PaginatedResponse<T> {
  results: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface State {
  id: string;
  name: string;
  group: string;
  sequence: number;
  color?: string;
  slug?: string;
}

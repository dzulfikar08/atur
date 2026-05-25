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
  listIssues: async (slug: string, projectId: string): Promise<Issue[]> => {
    const all: Issue[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const page = await apiFetch<PaginatedResponse<Issue>>(
        `/workspaces/${slug}/projects/${projectId}/issues/?limit=${limit}&offset=${offset}`
      );
      all.push(...page.results);
      if (all.length >= page.total) break;
      offset += limit;
    }
    return all;
  },
  listStates: (slug: string, projectId: string) =>
    apiFetch<State[]>(`/workspaces/${slug}/projects/${projectId}/states/`),
  search: (slug: string, query: string) =>
    apiFetch<SearchResult>(`/workspaces/${slug}/search/?q=${encodeURIComponent(query)}`),

  // Project
  getProject: (slug: string, projectId: string) =>
    apiFetch<ProjectDetail>(`/workspaces/${slug}/projects/${projectId}/`),
  updateProject: (slug: string, projectId: string, data: Partial<ProjectDetail>) =>
    apiFetch<ProjectDetail>(`/workspaces/${slug}/projects/${projectId}/`, {
      method: 'PATCH', body: JSON.stringify(data),
    }),

  // States
  createState: (slug: string, projectId: string, data: { name: string; group: string; color?: string; description?: string }) =>
    apiFetch<State>(`/workspaces/${slug}/projects/${projectId}/states/`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateState: (slug: string, projectId: string, stateId: string, data: Partial<State>) =>
    apiFetch<State>(`/workspaces/${slug}/projects/${projectId}/states/${stateId}/`, {
      method: 'PATCH', body: JSON.stringify(data),
    }),
  deleteState: (slug: string, projectId: string, stateId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/states/${stateId}/`, { method: 'DELETE' }),

  // Labels
  listLabels: (slug: string, projectId: string) =>
    apiFetch<Label[]>(`/workspaces/${slug}/projects/${projectId}/labels/`),
  createLabel: (slug: string, projectId: string, data: { name: string; color?: string; description?: string }) =>
    apiFetch<Label>(`/workspaces/${slug}/projects/${projectId}/labels/`, {
      method: 'POST', body: JSON.stringify(data),
    }),

  // Project members
  listProjectMembers: (slug: string, projectId: string) =>
    apiFetch<ProjectMember[]>(`/workspaces/${slug}/projects/${projectId}/members/`),
  addProjectMember: (slug: string, projectId: string, userId: string, role?: number) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/members/`, {
      method: 'POST', body: JSON.stringify({ user_id: userId, role: role ?? 15 }),
    }),
  removeProjectMember: (slug: string, projectId: string, userId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/members/${userId}/`, { method: 'DELETE' }),

  // Views
  listViews: (slug: string, projectId: string) =>
    apiFetch<View[]>(`/workspaces/${slug}/projects/${projectId}/views/`),
  createView: (slug: string, projectId: string, data: { name: string; query?: unknown; access?: string }) =>
    apiFetch<View>(`/workspaces/${slug}/projects/${projectId}/views/`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  deleteView: (slug: string, projectId: string, viewId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/views/${viewId}/`, { method: 'DELETE' }),

  // Workspace members (for adding to project)
  listWorkspaceMembers: (slug: string) =>
    apiFetch<any[]>(`/workspaces/${slug}/members/`),

  // Custom field definitions
  listCustomFields: (slug: string, projectId: string) =>
    apiFetch<CustomField[]>(`/workspaces/${slug}/projects/${projectId}/custom-fields/`),
  createCustomField: (slug: string, projectId: string, data: Partial<CustomField>) =>
    apiFetch<CustomField>(`/workspaces/${slug}/projects/${projectId}/custom-fields/`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateCustomField: (slug: string, projectId: string, fieldId: string, data: Partial<CustomField>) =>
    apiFetch<CustomField>(`/workspaces/${slug}/projects/${projectId}/custom-fields/${fieldId}/`, {
      method: 'PATCH', body: JSON.stringify(data),
    }),
  deleteCustomField: (slug: string, projectId: string, fieldId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/custom-fields/${fieldId}/`, {
      method: 'DELETE',
    }),

  // Custom field values on issues
  listCustomValues: (slug: string, projectId: string, issueSeqId: number) =>
    apiFetch<CustomFieldValue[]>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/custom-values/`),
  setCustomValues: (slug: string, projectId: string, issueSeqId: number, values: { custom_field_id: string; value_json: unknown }[]) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/custom-values/`, {
      method: 'POST', body: JSON.stringify({ values }),
    }),

  // Attachments
  listAttachments: (slug: string, projectId: string, issueSeqId: number) =>
    apiFetch<Attachment[]>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/attachments/`),
  createAttachment: (slug: string, projectId: string, issueSeqId: number, data: { asset?: string; attributes?: unknown }) =>
    apiFetch<Attachment>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/attachments/`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  deleteAttachment: (slug: string, projectId: string, issueSeqId: number, attachmentId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/attachments/${attachmentId}/`, {
      method: 'DELETE',
    }),
  uploadFile: async (file: File): Promise<{ id: string; asset: string }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/assets/upload/', {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },

  // Time entries
  listTimeEntries: (slug: string, projectId: string, issueSeqId: number) =>
    apiFetch<TimeEntry[]>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/time-entries/`),
  createTimeEntry: (slug: string, projectId: string, issueSeqId: number, data: { duration_seconds: number; description?: string }) =>
    apiFetch<TimeEntry>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/time-entries/`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  deleteTimeEntry: (slug: string, projectId: string, issueSeqId: number, entryId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/time-entries/${entryId}/`, {
      method: 'DELETE',
    }),
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

export interface ProjectDetail {
  id: string;
  name: string;
  identifier: string;
  description?: string;
  cover_image?: string;
  emoji?: string;
  slug?: string;
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
  estimate_points: number | null;
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

export interface Page {
  id: string;
  name: string;
  description_html: string | null;
  description_json: unknown | null;
  parent: string | null;
  workspace: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  is_drawing?: boolean;
}

export type FieldType = 'text' | 'select' | 'multi_select' | 'number' | 'date' | 'checkbox' | 'url' | 'user';

export interface SelectOption {
  id: string;
  value: string;
  color?: string;
}

export interface CustomField {
  id: string;
  name: string;
  field_type: FieldType;
  settings: { options?: SelectOption[] } | null;
  is_required: boolean;
  sort_order: number;
  project_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

export interface CustomFieldValue {
  id: string;
  issue_id: string;
  custom_field_id: string;
  value_json: unknown;
  field_name: string;
  field_type: string;
  field_settings: { options?: SelectOption[] } | null;
}

export interface Label {
  id: string;
  name: string;
  color?: string;
  description?: string;
  parent?: string | null;
  sort_order?: number;
}

export interface ProjectMember {
  id: string;
  member: {
    id: string;
    display_name?: string;
    username?: string;
    email?: string;
  };
  role: number;
}

export interface View {
  id: string;
  name: string;
  description?: string;
  query?: unknown;
  is_locked: boolean;
  access: string;
  is_favorite: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Attachment {
  id: string;
  issue_id: string;
  asset: string | null;
  attributes: {
    name?: string;
    size?: number;
    type?: string;
  } | null;
  created_at: string | null;
}

export interface TimeEntry {
  id: string;
  issue_id: string;
  user_id: string;
  duration_seconds: number;
  description: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string | null;
}

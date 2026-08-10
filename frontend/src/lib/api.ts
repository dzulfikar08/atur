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
  listWorkspaces: async () => {
    const data = await apiFetch<{results: Workspace[]}>('/workspaces/');
    return data.results;
  },
  analyticsOverview: (slug: string) =>
    apiFetch<AnalyticsOverview>(`/workspaces/${slug}/analytics/overview`),
  completionTrend: (slug: string) =>
    apiFetch<{ trend: CompletionTrendPoint[] }>(`/workspaces/${slug}/analytics/completion-trend`)
      .then(r => r.trend),
  sprintAnalytics: (slug: string) =>
    apiFetch<{ active_sprints: SprintData[] }>(`/workspaces/${slug}/analytics/sprints`)
      .then(r => r.active_sprints),
  listProjects: async (slug: string) => {
    const data = await apiFetch<{results: Project[]}>(`/workspaces/${slug}/projects/`);
    return data.results;
  },
  listIssues: async (slug: string, projectId: string): Promise<Issue[]> => {
    const all: Issue[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const page = await apiFetch<PaginatedResponse<Issue>>(
        `/workspaces/${slug}/projects/${projectId}/issues/?limit=${limit}&offset=${offset}`
      );
      all.push(...page.results);
      if (!page.total || page.results.length === 0 || all.length >= page.total) break;
      offset += limit;
    }
    return all;
  },
  listStates: async (slug: string, projectId: string) => {
    const data = await apiFetch<{results: State[]}>(`/workspaces/${slug}/projects/${projectId}/states/`);
    return data.results;
  },
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
  listLabels: async (slug: string, projectId: string) => {
    const data = await apiFetch<{results: Label[]}>(`/workspaces/${slug}/projects/${projectId}/labels/`);
    return data.results;
  },
  createLabel: (slug: string, projectId: string, data: { name: string; color?: string; description?: string }) =>
    apiFetch<Label>(`/workspaces/${slug}/projects/${projectId}/labels/`, {
      method: 'POST', body: JSON.stringify(data),
    }),

  // Project members
  listProjectMembers: async (slug: string, projectId: string) => {
    const data = await apiFetch<{results: ProjectMember[]}>(`/workspaces/${slug}/projects/${projectId}/members/`);
    return data.results;
  },
  addProjectMember: (slug: string, projectId: string, userId: string, role?: number) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/members/`, {
      method: 'POST', body: JSON.stringify({ user_id: userId, role: role ?? 15 }),
    }),
  removeProjectMember: (slug: string, projectId: string, userId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/members/${userId}/`, { method: 'DELETE' }),

  // Views
  listViews: async (slug: string, projectId: string) => {
    const data = await apiFetch<{results: View[]}>(`/workspaces/${slug}/projects/${projectId}/views/`);
    return data.results;
  },
  createView: (slug: string, projectId: string, data: { name: string; query?: unknown; access?: string }) =>
    apiFetch<View>(`/workspaces/${slug}/projects/${projectId}/views/`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  deleteView: (slug: string, projectId: string, viewId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/views/${viewId}/`, { method: 'DELETE' }),

  // Workspace members (for adding to project)
  listWorkspaceMembers: async (slug: string) => {
    const data = await apiFetch<{results: any[]}>(`/workspaces/${slug}/members/`);
    return data.results;
  },

  // Modules
  listModules: async (slug: string, projectId: string) => {
    const data = await apiFetch<{results: Module[]}>(`/workspaces/${slug}/projects/${projectId}/modules/`);
    return data.results;
  },
  listIssueModules: async (slug: string, projectId: string, seqId: number) => {
    const data = await apiFetch<{results: Module[]}>(`/workspaces/${slug}/projects/${projectId}/issues/${seqId}/modules/`);
    return data.results;
  },
  addIssueToModule: (slug: string, projectId: string, seqId: number, moduleId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${seqId}/modules/`, {
      method: 'POST', body: JSON.stringify({ module_id: moduleId }),
    }),
  removeIssueFromModule: (slug: string, projectId: string, seqId: number, moduleId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${seqId}/modules/${moduleId}/`, {
      method: 'DELETE',
    }),

  // Custom field definitions
  listCustomFields: async (slug: string, projectId: string) => {
    const data = await apiFetch<{results: CustomField[]}>(`/workspaces/${slug}/projects/${projectId}/custom-fields/`);
    return data.results;
  },
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
  listAttachments: async (slug: string, projectId: string, issueSeqId: number) => {
    const data = await apiFetch<{results: Attachment[]}>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/attachments/`);
    return data.results;
  },
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
  listTimeEntries: async (slug: string, projectId: string, issueSeqId: number) => {
    const data = await apiFetch<{results: TimeEntry[]}>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/time-entries/`);
    return data.results;
  },
  createTimeEntry: (slug: string, projectId: string, issueSeqId: number, data: { duration_seconds: number; description?: string }) =>
    apiFetch<TimeEntry>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/time-entries/`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  deleteTimeEntry: (slug: string, projectId: string, issueSeqId: number, entryId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/time-entries/${entryId}/`, {
      method: 'DELETE',
    }),
  listTimesheet: (slug: string, params: { from?: string; to?: string; user_id?: string; project_id?: string }) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.user_id) qs.set('user_id', params.user_id);
    if (params.project_id) qs.set('project_id', params.project_id);
    const query = qs.toString();
    return apiFetch<TimesheetResponse>(`/workspaces/${slug}/timesheet/${query ? `?${query}` : ''}`);
  },

  // Feedback board admin config (per project)
  getFeedbackBoard: (slug: string, projectId: string) =>
    apiFetch<FeedbackBoardConfig>(`/workspaces/${slug}/projects/${projectId}/feedback-board/`),
  saveFeedbackBoard: (slug: string, projectId: string, data: Partial<FeedbackBoardConfig>) =>
    apiFetch<FeedbackBoardConfig>(`/workspaces/${slug}/projects/${projectId}/feedback-board/`, {
      method: 'PUT', body: JSON.stringify(data),
    }),
  deleteFeedbackBoard: (slug: string, projectId: string) =>
    apiFetch<{ ok: boolean }>(`/workspaces/${slug}/projects/${projectId}/feedback-board/`, { method: 'DELETE' }),
  // CRM contacts (leads + customers)
  listContacts: async (slug: string, params?: { status?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    const query = qs.toString();
    return apiFetch<PaginatedResponse<Contact>>(`/workspaces/${slug}/contacts/${query ? `?${query}` : ''}`);
  },
  createContact: (slug: string, data: { email: string; name?: string; company?: string; phone?: string; source?: string }) =>
    apiFetch<Contact>(`/workspaces/${slug}/contacts/`, { method: 'POST', body: JSON.stringify(data) }),
  getContact: (slug: string, contactId: string) =>
    apiFetch<ContactDetail>(`/workspaces/${slug}/contacts/${contactId}/`),
  updateContact: (slug: string, contactId: string, data: Partial<Contact>) =>
    apiFetch<Contact>(`/workspaces/${slug}/contacts/${contactId}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteContact: (slug: string, contactId: string) =>
    apiFetch(`/workspaces/${slug}/contacts/${contactId}/`, { method: 'DELETE' }),

  // CRM deals (a pipeline is just a project)
  listDeals: async (slug: string, projectId: string, params?: { state_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.state_id) qs.set('state_id', params.state_id);
    const query = qs.toString();
    return apiFetch<PaginatedResponse<Deal>>(`/workspaces/${slug}/projects/${projectId}/deals/${query ? `?${query}` : ''}`);
  },
  createDeal: (slug: string, projectId: string, data: { name: string; customer_id?: string; amount_cents?: number; currency?: string; expected_close_at?: string; state_id?: string }) =>
    apiFetch<Deal>(`/workspaces/${slug}/projects/${projectId}/deals/`, { method: 'POST', body: JSON.stringify(data) }),
  updateDeal: (slug: string, projectId: string, issueId: string, data: Record<string, unknown>) =>
    apiFetch<Deal>(`/workspaces/${slug}/projects/${projectId}/deals/${issueId}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  moveDealStage: (slug: string, projectId: string, issueId: string, stateId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/deals/${issueId}/move/`, { method: 'POST', body: JSON.stringify({ state_id: stateId }) }),
  listDealStats: (slug: string, projectId: string) =>
    apiFetch<{ results: DealStat[] }>(`/workspaces/${slug}/projects/${projectId}/deals/stats/`).then(r => r.results),

  // --- Cross-workspace ("All Workspaces") endpoints — /api/me/* ---
  listAllIssues: async (params?: { state?: string; priority?: string; search?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.state) qs.set('state', params.state);
    if (params?.priority) qs.set('priority', params.priority);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    const data = await apiFetch<{ results: AllIssue[]; total: number }>(`/me/issues/${query ? `?${query}` : ''}`);
    return data.results;
  },
  listAllProjects: async () => {
    const data = await apiFetch<{ results: AllProject[] }>(`/me/projects/`);
    return data.results;
  },
  listAllPages: async () => {
    const data = await apiFetch<{ results: AllPage[] }>(`/me/pages/`);
    return data.results;
  },
  listAllContacts: async (params?: { status?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    const query = qs.toString();
    return apiFetch<PaginatedResponse<AllContact>>(`/me/contacts/${query ? `?${query}` : ''}`);
  },
  allAnalyticsOverview: () =>
    apiFetch<AnalyticsOverview>(`/me/analytics/overview`),
  allCompletionTrend: () =>
    apiFetch<{ trend: CompletionTrendPoint[] }>(`/me/analytics/completion-trend`)
      .then(r => r.trend),
  allSprintAnalytics: () =>
    apiFetch<{ active_sprints: SprintData[] }>(`/me/analytics/sprints`)
      .then(r => r.active_sprints),
};

// --- Types ---

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
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
  external_source?: string | null;
  module_ids?: string[];
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

export interface Module {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  start_date: string | null;
  target_date: string | null;
  project_id: string;
  workspace_id: string;
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


export interface TimesheetRow {
  user_id: string;
  issue_id: string;
  issue_name: string;
  sequence_id: number;
  project_id: string;
  user_name: string | null;
  user_email: string | null;
  total_seconds: number;
  entry_count: number;
}

export interface TimesheetByUser {
  user_id: string;
  user_name: string | null;
  total_seconds: number;
}

export interface TimesheetTotals {
  total_seconds: number;
  total_entries: number;
  by_user: TimesheetByUser[];
}

export interface TimesheetResponse {
  results: TimesheetRow[];
  totals: TimesheetTotals;
}

export interface FeedbackBoardConfig {
  enabled: boolean;
  id?: string;
  public_token?: string;
  title?: string;
  description?: string | null;
  allow_submit?: boolean;
  allow_voting?: boolean;
  require_email?: boolean;
  allow_comments?: boolean;
  default_state_id?: string | null;
  submit_label_id?: string | null;
  brand_color?: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

export interface Contact {
  id: string;
  workspace_id: string;
  user_id: string | null;
  email: string | null;
  name: string | null;
  company: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  session_token: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// Cross-workspace row variants — base type + parent workspace/project context
// so the "All Workspaces" views can group rows and build nav links into each
// row's own workspace.
export type AllIssue = Issue & {
  project_name: string;
  project_identifier: string | null;
  workspace_slug: string;
  workspace_name: string;
};
export type AllProject = Project & {
  identifier?: string | null;
  emoji?: string | null;
  workspace_slug: string;
  workspace_name: string;
};
export type AllPage = Page & {
  workspace_slug: string;
  workspace_name: string;
};
export type AllContact = Contact & {
  username?: string | null;
  workspace_slug: string;
  workspace_name: string;
};

export interface Deal {
  id: string;
  issue_id: string;
  customer_id: string | null;
  workspace_id: string;
  amount_cents: number;
  currency: string;
  expected_close_at: string | null;
  sequence_id: number;
  name: string;
  state_id: string | null;
  state_name: string | null;
  state_color: string | null;
  state_group: string | null;
  priority: string | null;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface DealStat {
  state_id: string | null;
  total_cents: number;
  count: number;
}

export interface ContactDetail {
  contact: Contact;
  deals: Deal[];
  tickets: { id: string; issue_id: string; sequence_id: number; name: string; state_name: string | null; created_at: string | null }[];
}

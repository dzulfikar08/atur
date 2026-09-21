import { apiOrigin, authHeaders } from "./native";

const API_BASE = apiOrigin ? `${apiOrigin}/api` : "/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...authHeaders(), ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || `API error: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listWorkspaces: async () => {
    const data = await apiFetch<{ results: Workspace[] }>("/workspaces/");
    return data.results;
  },
  analyticsOverview: (slug: string) =>
    apiFetch<AnalyticsOverview>(`/workspaces/${slug}/analytics/overview`),
  completionTrend: (slug: string) =>
    apiFetch<{ trend: CompletionTrendPoint[] }>(
      `/workspaces/${slug}/analytics/completion-trend`,
    ).then((r) => r.trend),
  sprintAnalytics: (slug: string) =>
    apiFetch<{ active_sprints: SprintData[] }>(`/workspaces/${slug}/analytics/sprints`).then(
      (r) => r.active_sprints,
    ),
  listProjects: async (slug: string, params?: { is_pipeline?: 1 }) => {
    const qs = new URLSearchParams();
    if (params?.is_pipeline) qs.set("is_pipeline", "1");
    const query = qs.toString();
    const data = await apiFetch<{ results: Project[] }>(
      `/workspaces/${slug}/projects/${query ? `?${query}` : ""}`,
    );
    return data.results;
  },
  listIssues: async (slug: string, projectId: string): Promise<Issue[]> => {
    const all: Issue[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const page = await apiFetch<PaginatedResponse<Issue>>(
        `/workspaces/${slug}/projects/${projectId}/issues/?limit=${limit}&offset=${offset}`,
      );
      all.push(...page.results);
      if (!page.total || page.results.length === 0 || all.length >= page.total) break;
      offset += limit;
    }
    return all;
  },
  createIssue: (
    slug: string,
    projectId: string,
    data: {
      name: string;
      description_html?: string;
      priority?: string;
      state_id?: string;
      parent_id?: string | null;
    },
  ) =>
    apiFetch<Issue>(`/workspaces/${slug}/projects/${projectId}/issues`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listStates: async (slug: string, projectId: string) => {
    const data = await apiFetch<{ results: State[] }>(
      `/workspaces/${slug}/projects/${projectId}/states/`,
    );
    return data.results;
  },
  deleteIssue: (slug: string, projectId: string, seqId: number | string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${seqId}/`, { method: "DELETE" }),
  addAssignee: (slug: string, projectId: string, seqId: number | string, assigneeId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${seqId}/assignees`, {
      method: "POST",
      body: JSON.stringify({ assignee_id: assigneeId }),
    }),
  removeAssignee: (slug: string, projectId: string, seqId: number | string, assigneeId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${seqId}/assignees/${assigneeId}/`, {
      method: "DELETE",
    }),
  // Followers (issue subscribers)
  listSubscribers: (slug: string, projectId: string, issueSeqId: number | string) =>
    apiFetch<{ results: Subscriber[] }>(
      `/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/subscribers/`,
    ),
  followIssue: (slug: string, projectId: string, issueSeqId: number | string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/subscribers/`, {
      method: "POST",
    }),
  unfollowIssue: (slug: string, projectId: string, issueSeqId: number | string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/subscribers/`, {
      method: "DELETE",
    }),
  updateComment: (
    slug: string,
    projectId: string,
    seqId: number | string,
    commentId: string,
    data: { comment_html: string; access?: string },
  ) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${seqId}/comments/${commentId}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  search: (slug: string, query: string) =>
    apiFetch<SearchResult>(`/workspaces/${slug}/search/?q=${encodeURIComponent(query)}`),

  // Project
  getProject: (slug: string, projectId: string) =>
    apiFetch<ProjectDetail>(`/workspaces/${slug}/projects/${projectId}/`),
  listFolders: (slug: string) =>
    apiFetch<{ results: ProjectFolder[] }>(`/workspaces/${slug}/folders/`).then(
      (d) => d.results ?? [],
    ),
  createFolder: (slug: string, data: { name: string; color?: string; sort_order?: number }) =>
    apiFetch<ProjectFolder>(`/workspaces/${slug}/folders/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateFolder: (
    slug: string,
    folderId: string,
    data: Partial<{ name: string; color: string; sort_order: number }>,
  ) =>
    apiFetch<ProjectFolder>(`/workspaces/${slug}/folders/${folderId}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteFolder: (slug: string, folderId: string) =>
    apiFetch(`/workspaces/${slug}/folders/${folderId}/`, { method: "DELETE" }),
  updateProject: (slug: string, projectId: string, data: Partial<ProjectDetail>) =>
    apiFetch<ProjectDetail>(`/workspaces/${slug}/projects/${projectId}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteProject: (slug: string, projectId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/`, { method: "DELETE" }),

  // States
  createState: (
    slug: string,
    projectId: string,
    data: { name: string; group: string; color?: string; description?: string },
  ) =>
    apiFetch<State>(`/workspaces/${slug}/projects/${projectId}/states/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateState: (slug: string, projectId: string, stateId: string, data: Partial<State>) =>
    apiFetch<State>(`/workspaces/${slug}/projects/${projectId}/states/${stateId}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteState: (slug: string, projectId: string, stateId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/states/${stateId}/`, { method: "DELETE" }),

  // Labels
  listLabels: async (slug: string, projectId: string) => {
    const data = await apiFetch<{ results: Label[] }>(
      `/workspaces/${slug}/projects/${projectId}/labels/`,
    );
    return data.results;
  },
  createLabel: (
    slug: string,
    projectId: string,
    data: { name: string; color?: string; description?: string },
  ) =>
    apiFetch<Label>(`/workspaces/${slug}/projects/${projectId}/labels/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Project members
  listProjectMembers: async (slug: string, projectId: string) => {
    const data = await apiFetch<{ results: ProjectMember[] }>(
      `/workspaces/${slug}/projects/${projectId}/members/`,
    );
    return data.results;
  },
  addProjectMember: (slug: string, projectId: string, userId: string, role?: number) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/members/`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, role: role ?? 15 }),
    }),
  removeProjectMember: (slug: string, projectId: string, userId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/members/${userId}/`, { method: "DELETE" }),

  // Views
  listViews: async (slug: string, projectId: string) => {
    const data = await apiFetch<{ results: View[] }>(
      `/workspaces/${slug}/projects/${projectId}/views/`,
    );
    return data.results;
  },
  createView: (
    slug: string,
    projectId: string,
    data: { name: string; query?: unknown; access?: string },
  ) =>
    apiFetch<View>(`/workspaces/${slug}/projects/${projectId}/views/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteView: (slug: string, projectId: string, viewId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/views/${viewId}/`, { method: "DELETE" }),

  // Workspace members (for adding to project)
  listWorkspaceMembers: async (slug: string) => {
    const data = await apiFetch<{ results: any[] }>(`/workspaces/${slug}/members/`);
    return data.results;
  },

  // Modules
  listModules: async (slug: string, projectId: string) => {
    const data = await apiFetch<{ results: Module[] }>(
      `/workspaces/${slug}/projects/${projectId}/modules/`,
    );
    return data.results;
  },
  listIssueModules: async (slug: string, projectId: string, seqId: number) => {
    const data = await apiFetch<{ results: Module[] }>(
      `/workspaces/${slug}/projects/${projectId}/issues/${seqId}/modules/`,
    );
    return data.results;
  },
  addIssueToModule: (slug: string, projectId: string, seqId: number, moduleId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${seqId}/modules/`, {
      method: "POST",
      body: JSON.stringify({ module_id: moduleId }),
    }),
  removeIssueFromModule: (slug: string, projectId: string, seqId: number, moduleId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${seqId}/modules/${moduleId}/`, {
      method: "DELETE",
    }),

  // Custom field definitions
  listCustomFields: async (slug: string, projectId: string) => {
    const data = await apiFetch<{ results: CustomField[] }>(
      `/workspaces/${slug}/projects/${projectId}/custom-fields/`,
    );
    return data.results;
  },
  createCustomField: (slug: string, projectId: string, data: Partial<CustomField>) =>
    apiFetch<CustomField>(`/workspaces/${slug}/projects/${projectId}/custom-fields/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCustomField: (
    slug: string,
    projectId: string,
    fieldId: string,
    data: Partial<CustomField>,
  ) =>
    apiFetch<CustomField>(`/workspaces/${slug}/projects/${projectId}/custom-fields/${fieldId}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteCustomField: (slug: string, projectId: string, fieldId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/custom-fields/${fieldId}/`, {
      method: "DELETE",
    }),

  // Custom field values on issues
  listCustomValues: (slug: string, projectId: string, issueSeqId: number) =>
    apiFetch<CustomFieldValue[]>(
      `/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/custom-values/`,
    ),
  setCustomValues: (
    slug: string,
    projectId: string,
    issueSeqId: number,
    values: { custom_field_id: string; value_json: unknown }[],
  ) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/custom-values/`, {
      method: "POST",
      body: JSON.stringify({ values }),
    }),

  // Attachments
  listAttachments: async (slug: string, projectId: string, issueSeqId: number) => {
    const data = await apiFetch<{ results: Attachment[] }>(
      `/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/attachments/`,
    );
    return data.results;
  },
  createAttachment: (
    slug: string,
    projectId: string,
    issueSeqId: number,
    data: { asset?: string; attributes?: unknown },
  ) =>
    apiFetch<Attachment>(
      `/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/attachments/`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
  deleteAttachment: (slug: string, projectId: string, issueSeqId: number, attachmentId: string) =>
    apiFetch(
      `/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/attachments/${attachmentId}/`,
      {
        method: "DELETE",
      },
    ),
  uploadFile: async (file: File): Promise<{ id: string; asset: string }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${apiOrigin || ""}/api/assets/upload/`, {
      method: "POST",
      credentials: "include",
      headers: { ...authHeaders() },
      body: form,
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },

  // Time entries
  listTimeEntries: async (slug: string, projectId: string, issueSeqId: number) => {
    const data = await apiFetch<{ results: TimeEntry[] }>(
      `/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/time-entries/`,
    );
    return data.results;
  },
  createTimeEntry: (
    slug: string,
    projectId: string,
    issueSeqId: number,
    data: { duration_seconds: number; description?: string },
  ) =>
    apiFetch<TimeEntry>(
      `/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/time-entries/`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
  deleteTimeEntry: (slug: string, projectId: string, issueSeqId: number, entryId: string) =>
    apiFetch(
      `/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/time-entries/${entryId}/`,
      {
        method: "DELETE",
      },
    ),
  listTimesheet: (
    slug: string,
    params: { from?: string; to?: string; user_id?: string; project_id?: string },
  ) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.user_id) qs.set("user_id", params.user_id);
    if (params.project_id) qs.set("project_id", params.project_id);
    const query = qs.toString();
    return apiFetch<TimesheetResponse>(`/workspaces/${slug}/timesheet/${query ? `?${query}` : ""}`);
  },
  listAgentUsage: (slug: string, params: { from?: string; to?: string; project_id?: string }) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.project_id) qs.set("project_id", params.project_id);
    const query = qs.toString();
    return apiFetch<AgentUsageResponse>(
      `/workspaces/${slug}/timesheet/agent-usage${query ? `?${query}` : ""}`,
    );
  },

  // Feedback board admin config (per project)
  getFeedbackBoard: (slug: string, projectId: string) =>
    apiFetch<FeedbackBoardConfig>(`/workspaces/${slug}/projects/${projectId}/feedback-board/`),
  saveFeedbackBoard: (slug: string, projectId: string, data: Partial<FeedbackBoardConfig>) =>
    apiFetch<FeedbackBoardConfig>(`/workspaces/${slug}/projects/${projectId}/feedback-board/`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteFeedbackBoard: (slug: string, projectId: string) =>
    apiFetch<{ ok: boolean }>(`/workspaces/${slug}/projects/${projectId}/feedback-board/`, {
      method: "DELETE",
    }),
  // CRM contacts (leads + customers)
  // Fetches ALL pages — the deal-form customer combobox must see every
  // contact, not just the first server page (server default 50, cap 100).
  listContacts: async (
    slug: string,
    params?: { status?: string; search?: string },
  ): Promise<Contact[]> => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.search) qs.set("search", params.search);
    const all: Contact[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const page = await apiFetch<PaginatedResponse<Contact>>(
        `/workspaces/${slug}/contacts/?limit=${limit}&offset=${offset}&${qs.toString()}`,
      );
      all.push(...page.results);
      if (!page.total || page.results.length === 0 || all.length >= page.total) break;
      offset += limit;
    }
    return all;
  },

  // Polar (payments → CRM import)
  getPolarSettings: (slug: string) => apiFetch<PolarSettings>(`/workspaces/${slug}/polar/settings`),
  savePolarSettings: (slug: string, data: Partial<PolarSettings>) =>
    apiFetch<PolarSettings>(`/workspaces/${slug}/polar/settings`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  syncPolar: (slug: string) =>
    apiFetch<{ ok: boolean; customers: number; subscriptions: number; orders: number }>(
      `/workspaces/${slug}/polar/sync`,
      { method: "POST" },
    ),
  listPolarLinks: (slug: string) =>
    apiFetch<{ results: PolarLink[] }>(`/workspaces/${slug}/polar/links`),
  listContactPolarLinks: (slug: string, contactId: string) =>
    apiFetch<{ results: PolarLink[] }>(`/workspaces/${slug}/polar/contacts/${contactId}/links`),
  createContact: (
    slug: string,
    data: { email: string; name?: string; company?: string; phone?: string; source?: string },
  ) =>
    apiFetch<Contact>(`/workspaces/${slug}/contacts/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getContact: (slug: string, contactId: string) =>
    apiFetch<ContactDetail>(`/workspaces/${slug}/contacts/${contactId}/`),
  updateContact: (slug: string, contactId: string, data: Partial<Contact>) =>
    apiFetch<Contact>(`/workspaces/${slug}/contacts/${contactId}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteContact: (slug: string, contactId: string) =>
    apiFetch(`/workspaces/${slug}/contacts/${contactId}/`, { method: "DELETE" }),

  // Evidence ledger (facts) for a contact
  listContactFacts: (slug: string, contactId: string, status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return apiFetch<PaginatedResponse<Fact>>(
      `/workspaces/${slug}/contacts/${contactId}/facts/${qs}`,
    );
  },
  applyFact: (slug: string, contactId: string, factId: string) =>
    apiFetch<Fact>(`/workspaces/${slug}/contacts/${contactId}/facts/${factId}/apply/`, {
      method: "POST",
    }),
  dismissFact: (slug: string, contactId: string, factId: string) =>
    apiFetch<Fact>(`/workspaces/${slug}/contacts/${contactId}/facts/${factId}/dismiss/`, {
      method: "POST",
    }),

  // CRM companies (accounts)
  listCompanies: async (slug: string, params?: { search?: string }): Promise<Company[]> => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set("search", params.search);
    const all: Company[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const page = await apiFetch<PaginatedResponse<Company>>(
        `/workspaces/${slug}/companies/?limit=${limit}&offset=${offset}&${qs.toString()}`,
      );
      all.push(...page.results);
      if (!page.total || page.results.length === 0 || all.length >= page.total) break;
      offset += limit;
    }
    return all;
  },
  createCompany: (
    slug: string,
    data: {
      name: string;
      domain?: string;
      industry?: string;
      website?: string;
      logo_url?: string;
      brand_color?: string;
      description?: string;
    },
  ) =>
    apiFetch<Company>(`/workspaces/${slug}/companies/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getCompany: (slug: string, companyId: string) =>
    apiFetch<Company>(`/workspaces/${slug}/companies/${companyId}/`),
  updateCompany: (slug: string, companyId: string, data: Partial<Company>) =>
    apiFetch<Company>(`/workspaces/${slug}/companies/${companyId}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteCompany: (slug: string, companyId: string) =>
    apiFetch(`/workspaces/${slug}/companies/${companyId}/`, { method: "DELETE" }),

  // CRM customer email (e.g. feedback-request templates)
  // CRM customer email (purpose + optional variant)
  previewContactEmail: (slug: string, contactId: string, purpose: string, variantId?: string) => {
    const qs = new URLSearchParams({ purpose });
    if (variantId) qs.set("variant_id", variantId);
    return apiFetch<ContactEmailPreview>(
      `/workspaces/${slug}/contacts/${contactId}/email-preview?${qs.toString()}`,
    );
  },
  sendContactEmail: (
    slug: string,
    contactId: string,
    data: { purpose: string; variant_id?: string },
  ) =>
    apiFetch<ContactEmailResult>(`/workspaces/${slug}/contacts/${contactId}/send-email/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // CRM email templates: purpose registry + per-purpose variants
  listEmailTemplates: async (slug: string) => {
    const data = await apiFetch<{
      purposes: EmailPurpose[];
      variants: EmailVariant[];
      footer: string;
    }>(`/workspaces/${slug}/contacts/email-templates/`);
    return data;
  },
  // Workspace-level {{footer}} signature (stored on the workspace).
  saveEmailFooter: (slug: string, footer: string) =>
    apiFetch<{ footer: string }>(`/workspaces/${slug}/contacts/email-templates/footer/`, {
      method: "PUT",
      body: JSON.stringify({ footer }),
    }),
  createEmailVariant: (
    slug: string,
    data: { purpose: string; name: string; subject: string; body: string; is_html?: boolean },
  ) =>
    apiFetch<EmailVariant>(`/workspaces/${slug}/contacts/email-templates/variants/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateEmailVariant: (
    slug: string,
    variantId: string,
    data: { name?: string; subject?: string; body?: string; is_html?: boolean },
  ) =>
    apiFetch(`/workspaces/${slug}/contacts/email-templates/variants/${variantId}/`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteEmailVariant: (slug: string, variantId: string) =>
    apiFetch(`/workspaces/${slug}/contacts/email-templates/variants/${variantId}/`, {
      method: "DELETE",
    }),
  setDefaultEmailVariant: (slug: string, variantId: string) =>
    apiFetch(`/workspaces/${slug}/contacts/email-templates/variants/${variantId}/default/`, {
      method: "PUT",
    }),

  // CRM deals (a pipeline is a project flagged is_pipeline)
  // Fetches ALL pages — boards with >50 deals must not silently truncate.
  listDeals: async (
    slug: string,
    projectId: string,
    params?: { state_id?: string },
  ): Promise<Deal[]> => {
    const qs = new URLSearchParams();
    if (params?.state_id) qs.set("state_id", params.state_id);
    const all: Deal[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const page = await apiFetch<PaginatedResponse<Deal>>(
        `/workspaces/${slug}/projects/${projectId}/deals/?limit=${limit}&offset=${offset}&${qs.toString()}`,
      );
      all.push(...page.results);
      if (!page.total || page.results.length === 0 || all.length >= page.total) break;
      offset += limit;
    }
    return all;
  },
  createDeal: (
    slug: string,
    projectId: string,
    data: {
      name: string;
      customer_id?: string;
      amount_cents?: number;
      currency?: string;
      expected_close_at?: string;
      state_id?: string;
    },
  ) =>
    apiFetch<Deal>(`/workspaces/${slug}/projects/${projectId}/deals/`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateDeal: (
    slug: string,
    projectId: string,
    issueId: string,
    data: Partial<{
      name: string;
      amount_cents: number;
      currency: string;
      expected_close_at: string | null;
      customer_id: string | null;
    }>,
  ) =>
    apiFetch<Deal>(`/workspaces/${slug}/projects/${projectId}/deals/${issueId}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  moveDealStage: (slug: string, projectId: string, issueId: string, stateId: string) =>
    apiFetch(`/workspaces/${slug}/projects/${projectId}/deals/${issueId}/move/`, {
      method: "POST",
      body: JSON.stringify({ state_id: stateId }),
    }),
  listDealStats: (slug: string, projectId: string) =>
    apiFetch<{ results: DealStats }>(`/workspaces/${slug}/projects/${projectId}/deals/stats/`).then(
      (r) => r.results,
    ),
  // Flag/unflag a project as a CRM pipeline. Never touches the project's states.
  setProjectPipeline: (slug: string, projectId: string, isPipeline: boolean) =>
    apiFetch<ProjectDetail>(`/workspaces/${slug}/projects/${projectId}/`, {
      method: "PATCH",
      body: JSON.stringify({ isPipeline }),
    }),

  // --- Cross-workspace ("All Workspaces") endpoints — /api/me/* ---
  listAllIssues: async (params?: {
    state?: string;
    state_key?: string;
    group?: string;
    priority?: string;
    search?: string;
    workspace?: string;
    project?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.state) qs.set("state", params.state);
    if (params?.state_key) qs.set("state_key", params.state_key);
    if (params?.group) qs.set("group", params.group);
    if (params?.priority) qs.set("priority", params.priority);
    if (params?.search) qs.set("search", params.search);
    if (params?.workspace) qs.set("workspace", params.workspace);
    if (params?.project) qs.set("project", params.project);
    if (params?.limit) qs.set("limit", String(params.limit));
    // The endpoint paginates (offset/limit, capped server-side). Callers that
    // pass an explicit limit get a single page; without one we walk every page
    // so list views keep their full dataset.
    const singlePage = params?.limit != null;
    const all: AllIssue[] = [];
    let offset = 0;
    const limit = params?.limit ?? 100;
    while (true) {
      qs.set("offset", String(offset));
      qs.set("limit", String(limit));
      const page = await apiFetch<{
        results: AllIssue[];
        total: number;
        next_offset: number | null;
      }>(`/me/issues/?${qs.toString()}`);
      all.push(...page.results);
      if (singlePage || page.next_offset == null || page.results.length === 0) break;
      offset = page.next_offset;
    }
    return all;
  },
  listAllProjects: async (params?: { is_pipeline?: 1 }) => {
    const qs = new URLSearchParams();
    if (params?.is_pipeline) qs.set("is_pipeline", "1");
    const query = qs.toString();
    const data = await apiFetch<{ results: AllProject[] }>(
      `/me/projects/${query ? `?${query}` : ""}`,
    );
    return data.results;
  },
  listAllPages: async () => {
    const data = await apiFetch<{ results: AllPage[] }>(`/me/pages/`);
    return data.results;
  },
  listNotes: async () => {
    const data = await apiFetch<{ results: Note[] }>(`/me/notes/`);
    return data.results;
  },
  createNote: (content: string) =>
    apiFetch<Note>(`/me/notes/`, { method: "POST", body: JSON.stringify({ content }) }),
  updateNote: (noteId: string, content: string) =>
    apiFetch<Note>(`/me/notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  deleteNote: (noteId: string) => apiFetch<void>(`/me/notes/${noteId}`, { method: "DELETE" }),
  listAllContacts: async (params?: { status?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.search) qs.set("search", params.search);
    const all: AllContact[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const query = qs.toString();
      const page = await apiFetch<PaginatedResponse<AllContact>>(
        `/me/contacts/?limit=${limit}&offset=${offset}${query ? `&${query}` : ""}`,
      );
      all.push(...page.results);
      if (!page.total || page.results.length === 0 || all.length >= page.total) break;
      offset += limit;
    }
    return all;
  },
  allAnalyticsOverview: () => apiFetch<AnalyticsOverview>(`/me/analytics/overview`),
  allCompletionTrend: () =>
    apiFetch<{ trend: CompletionTrendPoint[] }>(`/me/analytics/completion-trend`).then(
      (r) => r.trend,
    ),
  allSprintAnalytics: () =>
    apiFetch<{ active_sprints: SprintData[] }>(`/me/analytics/sprints`).then(
      (r) => r.active_sprints,
    ),
  // ── Portfolio strategy (DEV-22) — cross-workspace /api/me/* ──
  listStrategy: async () => {
    const data = await apiFetch<{ results: WorkspaceStrategy[] }>("/me/strategy/");
    return data.results;
  },
  listDecisions: async () => {
    const data = await apiFetch<{ results: DecisionItem[] }>("/me/decisions/");
    return data.results;
  },
  updateWorkspaceStrategy: (slug: string, data: WorkspaceStrategyPatch) =>
    apiFetch(`/workspaces/${slug}/`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  // ── Panes (herdr execution plane, proxied by the Worker; see ATUR-2) ──
  listPanes: () => apiFetch<PanesListResponse>("/panes"),
  // ── Workspace links (DEV-29 control-plane bindings; /admin/bindings) ──
  listWorkspaceLinks: () => apiFetch<{ results: WorkspaceLink[] }>("/workspaces/links"),
  updateWorkspaceLink: (workspace: string, data: WorkspaceLinkPatch) =>
    apiFetch<WorkspaceLink>(`/workspaces/${workspace}/links`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteWorkspaceLink: (workspace: string) =>
    apiFetch<void>(`/workspaces/${workspace}/links`, { method: "DELETE" }),
};

// --- Types ---

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
}

// ── Panes (herdr execution plane; snake_case wire format, proxied verbatim) ──
export interface PaneListItem {
  pane_id: string;
  workspace_id: string;
  workspace_label: string;
  tab_id: string;
  cwd: string | null;
  agent: string | null;
  agent_status: string | null;
  title: string | null;
  revision: number;
}

export interface PanesListResponse {
  panes: PaneListItem[];
}

// ── Workspace link (DEV-29 control-plane binding; snake_case wire format) ──
// One row of workspace_links: which repo(s), local checkout, branch, and
// herdr workspace back a given Atur workspace (see services/workspaceLinks.ts).
export interface WorkspaceLink {
  workspace: string;
  repo_urls: string[] | null;
  local_path: string | null;
  default_branch: string | null;
  herdr_workspace: string | null;
  notes: string | null;
  mode: "local-only" | "direct-PR" | null;
  auto_merge: "yolo" | null;
  updated_at: string | null;
}

// PUT body mirrors upsertLinkSchema (all fields optional, at least one).
export interface WorkspaceLinkPatch {
  repo_urls?: string[] | null;
  local_path?: string | null;
  default_branch?: string | null;
  herdr_workspace?: string | null;
  notes?: string | null;
  mode?: "local-only" | "direct-PR" | null;
  auto_merge?: "yolo" | null;
}

// ── Portfolio strategy (DEV-22) ──
export type StrategyVerdict = "invest" | "harden" | "harvest" | "kill" | "needs-review";

export interface StrategyScoreHistoryEntry {
  moat_score: number | null;
  ai_proof_score: number | null;
  strategy_verdict: string | null;
  strategy_note: string | null;
  created_at: string | null;
}

// One workspace as scored by the monthly Moat × AI-proof portfolio review.
// history carries the two newest workspace_score_history rows (trend arrows).
// Read-side fields are snake_case — D1/drizzle rows come back with raw column
// names app-wide (see Issue/Contact types). The PATCH body is camelCase to
// match services/workspaces.ts zod schema.
export interface WorkspaceStrategy {
  id: string;
  slug: string;
  name: string;
  logo?: string | null;
  moat_score: number | null;
  ai_proof_score: number | null;
  strategy_verdict: StrategyVerdict | null;
  strategy_note: string | null;
  reviewed_at: string | null;
  history: StrategyScoreHistoryEntry[];
}

export interface WorkspaceStrategyPatch {
  moatScore?: number | null;
  aiProofScore?: number | null;
  strategyVerdict?: StrategyVerdict | null;
  strategyNote?: string | null;
}

// Open is_decision=1 issue across all workspaces (decision inbox).
// Wire format is snake_case (snakeCaseMiddleware).
export interface DecisionItem {
  id: string;
  name: string;
  sequence_id: number;
  priority: string | null;
  target_date: string | null;
  updated_at: string | null;
  project_id: string;
  project_name: string;
  project_identifier: string;
  workspace_slug: string;
  workspace_name: string;
  state_name: string | null;
  state_color: string | null;
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
  is_pipeline?: number;
}

export interface ProjectDetail {
  id: string;
  name: string;
  identifier: string;
  description?: string;
  cover_image?: string;
  emoji?: string;
  slug?: string;
  is_pipeline?: number;
  folder_id?: string | null;
}

export interface ProjectFolder {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  workspace_id: string;
  created_at: string | null;
  updated_at: string | null;
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
  // Enriched fields returned by list endpoints (issues.ts / me.ts):
  state?: { id: string; name: string; color?: string; group: string; key?: string | null } | null;
  labels?: { id: string; name: string; color?: string }[];
  assignees?: {
    id: string;
    email?: string;
    username?: string;
    display_name?: string;
    avatar?: string | null;
  }[];
}

export interface SearchResult {
  issues: Issue[];
  projects: Project[];
}

// Issue follower (issue_subscribers row + nested user).
export interface Subscriber {
  id: string;
  subscriber_id: string;
  created_at: string | null;
  user: {
    id: string;
    email: string;
    username: string;
    display_name: string | null;
    avatar: string | null;
  } | null;
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

export type FieldType =
  | "text"
  | "select"
  | "multi_select"
  | "number"
  | "date"
  | "checkbox"
  | "url"
  | "user"
  | "currency";

export interface SelectOption {
  id: string;
  value: string;
  color?: string;
}

export interface CustomField {
  id: string;
  name: string;
  field_type: FieldType;
  settings: { options?: SelectOption[]; currency?: string } | null;
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
  field_settings: { options?: SelectOption[]; currency?: string } | null;
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
  // Agent telemetry — present on source="agent" entries.
  source?: "human" | "agent";
  agent_name?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  reasoning_tokens?: number | null;
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

export interface AgentUsageRow {
  agent_name: string;
  model: string;
  issue_id: string;
  issue_name: string;
  sequence_id: number;
  project_id: string;
  total_seconds: number;
  entry_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
}

export interface AgentUsageByAgent {
  agent_name: string;
  model: string;
  entry_count: number;
  issue_count: number;
  total_seconds: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

export interface AgentUsageResponse {
  results: AgentUsageRow[];
  totals: {
    total_tokens: number;
    total_seconds: number;
    cost_usd: number | null;
    by_agent: AgentUsageByAgent[];
  };
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
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
}

export interface Contact {
  id: string;
  workspace_id: string;
  user_id: string | null;
  email: string | null;
  name: string | null;
  company: string | null;
  company_id: string | null;
  title: string | null;
  seniority: string | null;
  function: string | null;
  linkedin_url: string | null;
  image_url: string | null;
  last_activity_at: string | null;
  enriched_at: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  session_token: string | null;
  // Joined from companies (nullable when unlinked).
  company_name: string | null;
  company_domain: string | null;
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
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  is_pipeline?: number;
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

export interface Note {
  id: string;
  user_id: string;
  content: string;
  created_at: string | null;
  updated_at: string | null;
}

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
  // Enriched board fields (customer join + issue freshness).
  customer_name: string | null;
  issue_updated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface DealStageStat {
  state_id: string | null;
  currency: string;
  total_cents: number;
  count: number;
}

export interface DealCurrencyTotal {
  currency: string;
  total_cents: number;
  count: number;
}

export interface DealStats {
  by_stage: DealStageStat[];
  totals: {
    open: DealCurrencyTotal[];
    won_this_month: DealCurrencyTotal[];
    lost: DealCurrencyTotal[];
  };
}

export interface ContactEmailLogEntry {
  id: string;
  purpose: string;
  variant_id: string | null;
  variant_name: string | null;
  subject: string;
  sent_at: string;
  sent: number;
}

export interface Company {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  website: string | null;
  logo_url: string | null;
  brand_color: string | null;
  description: string | null;
  owner_id: string | null;
  primary_contact_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface FactEvidenceEntry {
  source: string;
  method: string;
  url?: string;
}

export interface Fact {
  id: string;
  workspace_id: string;
  customer_id: string;
  company_id: string | null;
  field: string;
  value: string;
  score: number;
  band: "VERIFIED" | "PROBABLE" | "POSSIBLE";
  evidence: string | null;
  method: string | null;
  source_url: string | null;
  status: "PROPOSED" | "APPLIED" | "DISMISSED" | "SUPERSEDED";
  decided_by: string | null;
  decided_at: string | null;
  observed_at: string;
  superseded_at: string | null;
  created_at: string | null;
}

export interface CrmActivity {
  id: string;
  workspace_id: string;
  customer_id: string | null;
  deal_id: string | null;
  type: "NOTE" | "CALL" | "EMAIL" | "MEETING" | "TASK" | "STAGE_CHANGE" | "ENRICHMENT";
  subject: string | null;
  body: string | null;
  occurred_at: string;
  created_by: string | null;
  created_at: string | null;
}

export interface ContactDetail {
  contact: Contact;
  company: Company | null;
  deals: Deal[];
  tickets: {
    id: string;
    issue_id: string;
    sequence_id: number;
    name: string;
    state_name: string | null;
    created_at: string | null;
  }[];
  emails: ContactEmailLogEntry[];
  activities: CrmActivity[];
  facts: Fact[];
  suggestions: Fact[];
}

export interface ContactEmailResult {
  subject: string;
  sent: boolean;
  to: string | null;
}

export interface ContactEmailPurchase {
  date: string;
  amount_cents: number;
  currency: string;
  product_name: string;
}

export interface ContactEmailPreview {
  subject: string;
  text: string;
  html: string;
  to: string | null;
  purchase: ContactEmailPurchase | null;
  variant_id: string | null;
  variant_name: string | null;
}

// A lifecycle purpose (cold_outreach, welcome, …) with its curated default.
export interface EmailPurpose {
  name: string;
  label: string;
  description: string;
  requires_purchase: boolean;
  default: { subject: string; body: string };
}

// A user-saved variant of a purpose's template.
export interface EmailVariant {
  id: string;
  purpose: string;
  name: string;
  subject: string;
  body: string;
  is_html: number;
  is_default: number;
  created_at: string | null;
  updated_at: string | null;
}

// ── Polar (payments → CRM import) ──

export interface PolarSettings {
  workspace_id: string;
  access_token: string | null;
  webhook_secret: string | null;
  pipeline_project_id: string | null;
  default_state_id: string | null;
  webhook_enabled: number;
  last_synced_at: string | null;
}

export interface PolarLink {
  id: string;
  workspace_id: string;
  service: string;
  polar_type: "customer" | "subscription" | "order";
  polar_id: string;
  customer_id: string | null;
  deal_id: string | null;
  raw: string | null;
  last_event: string | null;
  created_at: string | null;
  updated_at: string | null;
}

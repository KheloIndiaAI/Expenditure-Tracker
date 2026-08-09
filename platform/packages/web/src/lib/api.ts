/**
 * API client — the SPA's only channel to the Application layer.
 *
 * 02 §2 golden rule: the Presentation layer only ever talks to the Application
 * layer over the Published store. There is no other data source in this app,
 * and nothing here reads a spreadsheet.
 */

import type {
  AuthedUser,
  BreakdownDim,
  BreakdownResponse,
  DatasetVersion,
  ExceptionQueue,
  FilterState,
  HealthScore,
  InsightCard,
  Measure,
  OverviewResponse,
  SearchResponse,
  SubCategory,
  Transaction,
  TransactionsResponse,
  ValidationReport,
  VersionDiff,
  AuditEvent,
  PlatformSettings,
  ReconciliationPanel,
  ValidationFinding,
  DataQualityObservation,
  BudgetAllocation,
} from '@efip/shared';

const TOKEN_KEY = 'efip.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`/api${path}`, { ...init, headers });

  if (res.status === 401) {
    setToken(null);
    if (!location.pathname.startsWith('/login')) location.href = '/login';
    throw new ApiError(401, 'Session expired — please sign in again.');
  }

  const text = await res.text();
  const body: unknown = text ? safeParse(text) : null;

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'message' in body && String((body as { message: unknown }).message)) ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Filter state travels in the URL so any view is shareable (04 §3, FR-EX-07). */
function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function encodeFilters(f: FilterState): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (v === '') continue;
    clean[k] = v;
  }
  return Object.keys(clean).length ? JSON.stringify(clean) : '';
}

export function decodeFilters(s: string | null | undefined): FilterState {
  if (!s) return {};
  try {
    return JSON.parse(s) as FilterState;
  } catch {
    return {};
  }
}

export interface QualityResponse {
  version_id: number;
  reconciliation: ReconciliationPanel;
  findings: ValidationFinding[];
  observations: DataQualityObservation[];
}

export interface BudgetResponse {
  version_id: number;
  allocations: BudgetAllocation[];
  scheme_totals: {
    be_allocation_total_cr: number;
    assigned_to_sai_total_cr: number;
    be_allocation_recurring_cr: number;
    be_allocation_non_recurring_cr: number;
    assigned_to_sai_recurring_cr: number;
    assigned_to_sai_non_recurring_cr: number;
  };
  /** Honesty flag — the source tracker's component grain is not yet populated. */
  component_grain_populated: boolean;
  weekly_grain_populated: boolean;
}

export interface UploadResult {
  version_id: number;
  report: ValidationReport;
  diff: VersionDiff;
  duplicate_of?: number;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: AuthedUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<AuthedUser>('/auth/me'),

  overview: (filters?: FilterState) =>
    request<OverviewResponse>(`/overview${qs({ filters: encodeFilters(filters ?? {}) })}`),

  breakdown: (dim: BreakdownDim, measure: Measure = 'net_amount', filters?: FilterState) =>
    request<BreakdownResponse>(
      `/breakdown${qs({ dim, measure, filters: encodeFilters(filters ?? {}) })}`,
    ),

  pareto: (dim: BreakdownDim, filters?: FilterState) =>
    request<{ version_id: number; rows: Array<BreakdownResponse['rows'][number] & { cumulative_pct: number }> }>(
      `/analysis/pareto${qs({ dim, filters: encodeFilters(filters ?? {}) })}`,
    ),

  heatmap: (rowDim: BreakdownDim, colDim: BreakdownDim, filters?: FilterState) =>
    request<{
      version_id: number;
      rows: string[];
      cols: string[];
      cells: Array<{ row: string; col: string; net_amount: number; utilisation_pct: number; txn_count: number }>;
    }>(`/analysis/heatmap${qs({ row: rowDim, col: colDim, filters: encodeFilters(filters ?? {}) })}`),

  waterfall: (filters?: FilterState) =>
    request<{ version_id: number; steps: Array<{ label: string; value: number; kind: string }> }>(
      `/analysis/waterfall${qs({ filters: encodeFilters(filters ?? {}) })}`,
    ),

  treemap: (filters?: FilterState) =>
    request<{ version_id: number; tree: TreeNode }>(
      `/analysis/treemap${qs({ filters: encodeFilters(filters ?? {}) })}`,
    ),

  transactions: (opts: {
    filters?: FilterState;
    page?: number;
    page_size?: number;
    sort?: string;
    dir?: 'asc' | 'desc';
  }) =>
    request<TransactionsResponse>(
      `/transactions${qs({
        filters: encodeFilters(opts.filters ?? {}),
        page: opts.page ?? 1,
        page_size: opts.page_size ?? 50,
        sort: opts.sort,
        dir: opts.dir,
      })}`,
    ),

  transaction: (id: string) => request<Transaction>(`/transactions/${encodeURIComponent(id)}`),

  exceptions: (type?: string) => request<ExceptionQueue[]>(`/exceptions${qs({ type })}`),
  insights: () => request<InsightCard[]>('/insights'),
  healthScore: () => request<HealthScore>('/health-score'),
  search: (q: string) => request<SearchResponse>(`/search${qs({ q })}`),
  taxonomy: () => request<SubCategory[]>('/taxonomy'),
  quality: () => request<QualityResponse>('/quality'),
  budget: () => request<BudgetResponse>('/budget'),

  versions: () => request<DatasetVersion[]>('/versions'),
  versionDiff: (id: number) => request<VersionDiff>(`/versions/${id}/diff`),
  rollback: (id: number) => request<{ ok: true; version_id: number }>(`/versions/${id}/rollback`, { method: 'POST' }),

  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<UploadResult>('/uploads', { method: 'POST', body: fd });
  },
  validation: (id: number) => request<ValidationReport>(`/uploads/${id}/validation`),
  submitUpload: (id: number) => request<{ ok: true }>(`/uploads/${id}/submit`, { method: 'POST' }),
  publishUpload: (id: number) => request<{ ok: true; version_id: number }>(`/uploads/${id}/publish`, { method: 'POST' }),
  rejectUpload: (id: number, reason: string) =>
    request<{ ok: true }>(`/uploads/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

  audit: (opts: { action?: string; limit?: number; offset?: number } = {}) =>
    request<AuditEvent[]>(`/audit${qs(opts)}`),

  settings: () => request<PlatformSettings>('/settings'),
  saveSettings: (s: PlatformSettings) =>
    request<PlatformSettings>('/settings', { method: 'PUT', body: JSON.stringify(s) }),

  savedViews: () => request<SavedView[]>('/saved-views'),
  createSavedView: (v: Omit<SavedView, 'id' | 'created_at'>) =>
    request<SavedView>('/saved-views', { method: 'POST', body: JSON.stringify(v) }),
  deleteSavedView: (id: string) => request<{ ok: true }>(`/saved-views/${id}`, { method: 'DELETE' }),
};

export interface TreeNode {
  name: string;
  value: number;
  utilisation?: number;
  children?: TreeNode[];
}

export interface SavedView {
  id: string;
  name: string;
  page: string;
  state: string;
  created_at: string;
}

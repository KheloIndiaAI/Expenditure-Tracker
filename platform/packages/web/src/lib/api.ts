/**
 * API client for the login / administration SPA.
 *
 * Auth uses an httpOnly cookie, so every request sends `credentials: 'include'`
 * and no token is ever stored in JS. Nothing here is a permission check: the
 * admin calls below are authorised on the server, and this client only decides
 * what to render.
 */

import type { AuthedUser, ModuleAccess, Role, User } from '@efip/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');

  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
  const text = await res.text();
  const body: unknown = text ? safeParse(text) : null;

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (body && typeof body === 'object' && 'message' in body) {
      message = String((body as { message: unknown }).message);
    }
    throw new ApiError(res.status, message);
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

const json = (body: unknown) => JSON.stringify(body);

/** A user row as the admin list returns it — the record plus its resolved access. */
export type AdminUser = User & { modules: ModuleAccess };

export interface NewUserInput {
  username: string;
  name: string;
  designation?: string;
  email?: string;
  phone?: string;
  role: Role;
  password: string;
  is_active?: boolean;
}

export type EditUserInput = Partial<Omit<NewUserInput, 'username' | 'password'>>;

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: AuthedUser }>('/auth/login', {
      method: 'POST',
      body: json({ username, password }),
    }),
  me: () => request<AuthedUser>('/auth/me'),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  // ── Self-service ───────────────────────────────────────────────────────────
  updateProfile: (patch: { name?: string; designation?: string; email?: string; phone?: string }) =>
    request<AuthedUser>('/me', { method: 'PATCH', body: json(patch) }),
  changePassword: (current: string, next: string) =>
    request<{ ok: true }>('/me/password', { method: 'POST', body: json({ current, next }) }),

  // ── Super Admin ────────────────────────────────────────────────────────────
  listUsers: () => request<AdminUser[]>('/admin/users'),
  createUser: (input: NewUserInput) => request<User>('/admin/users', { method: 'POST', body: json(input) }),
  editUser: (id: string, patch: EditUserInput) =>
    request<User>(`/admin/users/${id}`, { method: 'PATCH', body: json(patch) }),
  setUserPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/admin/users/${id}/password`, { method: 'POST', body: json({ password }) }),
  getAccess: (id: string) => request<ModuleAccess>(`/admin/users/${id}/access`),
  setAccess: (id: string, access: ModuleAccess) =>
    request<ModuleAccess>(`/admin/users/${id}/access`, { method: 'PUT', body: json(access) }),
};

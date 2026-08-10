/**
 * API client for the login SPA.
 *
 * Scope: this build's only server calls are the three auth endpoints. The
 * dashboard itself (served after login) reads its data live from the Google
 * Sheet, so there are no data endpoints here. Auth uses an httpOnly cookie, so
 * every request sends `credentials: 'include'` and no token is stored in JS.
 */

import type { AuthedUser } from '@efip/shared';

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
    const message =
      (body && typeof body === 'object' && 'message' in body && String((body as { message: unknown }).message)) ||
      `Request failed (${res.status})`;
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

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: AuthedUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<AuthedUser>('/auth/me'),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
};

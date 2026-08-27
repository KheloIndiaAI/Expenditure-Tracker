/**
 * API client for the sign-in page.
 *
 * Auth uses an httpOnly cookie, so every request sends `credentials: 'include'`
 * and no token is ever stored in JS.
 *
 * The administration and profile calls that used to live here have gone with the
 * screens that made them: those are dashboard panels now and talk to the same
 * endpoints from `public/index.html`. What remains is what the sign-in page
 * itself needs.
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

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: AuthedUser }>('/auth/login', {
      method: 'POST',
      body: json({ username, password }),
    }),
  me: () => request<AuthedUser>('/auth/me'),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
};

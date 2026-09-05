import type { SessionResponse } from '@finstat/shared';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);

const ACCESS_KEY = 'finstat.access';
const REFRESH_KEY = 'finstat.refresh';
const USER_KEY = 'finstat.user';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

export const tokens = {
  access(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  refresh(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  user(): SessionResponse['user'] | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionResponse['user'];
    } catch {
      return null;
    }
  },
  save(session: SessionResponse): void {
    window.localStorage.setItem(ACCESS_KEY, session.accessToken);
    window.localStorage.setItem(REFRESH_KEY, session.refreshToken);
    window.localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  },
  clear(): void {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(USER_KEY);
  },
};

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * One refresh at a time.
 *
 * A page usually fires several queries at once, and without this every one of
 * them would try to refresh with the same token. The first rotates it and the
 * rest fail, signing the user out mid-session for no reason.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = tokens.refresh();
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;

      tokens.save((await response.json()) as SessionResponse);
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all see it.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set for endpoints that return a file rather than JSON. */
  raw?: boolean;
  skipAuth?: boolean;
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `Something went wrong (${response.status}).`;
  let details: string[] | undefined;

  try {
    const body = await response.json();
    if (typeof body?.message === 'string') {
      message = body.message;
    } else if (Array.isArray(body?.message)) {
      // Validation pipe returns one line per failed rule.
      details = body.message;
      message = body.message[0] ?? message;
    }
  } catch {
    // A non-JSON error body tells us nothing useful; the status already did.
  }

  if (response.status === 401) message = message || 'Please sign in again.';
  return new ApiError(message, response.status, details);
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, raw, skipAuth, headers, ...rest } = options;

  const send = async (): Promise<Response> => {
    const isFormData = body instanceof FormData;
    const accessToken = tokens.access();

    return fetch(`${API_URL}/api${path}`, {
      ...rest,
      headers: {
        ...(isFormData || body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(!skipAuth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(headers ?? {}),
      },
      body: isFormData ? (body as FormData) : body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let response = await send();

  if (response.status === 401 && !skipAuth && tokens.refresh()) {
    if (await refreshSession()) {
      response = await send();
    }
  }

  if (!response.ok) {
    const error = await parseError(response);
    if (error.status === 401 && typeof window !== 'undefined') {
      tokens.clear();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    throw error;
  }

  if (response.status === 204) return undefined as T;
  if (raw) return (await response.blob()) as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return (await response.text()) as T;

  return (await response.json()) as T;
}

export const api = {
  get: <T,>(path: string) => apiFetch<T>(path),
  post: <T,>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body }),
  put: <T,>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T,>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  delete: <T,>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  upload: <T,>(path: string, form: FormData) => apiFetch<T>(path, { method: 'POST', body: form }),
};

/**
 * Download a file the API produced.
 *
 * The endpoint needs an Authorization header, so the browser cannot simply
 * follow a link to it. Fetching it and handing the browser an object URL is
 * what makes the save dialog appear with the right file name.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const blob = await apiFetch<Blob>(path, { raw: true });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

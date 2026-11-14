/** Thin fetch wrapper for the FinVista REST API. */

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details; // per-field validation messages, e.g. { email: '...' }
  }
}

/**
 * request('/health') -> parsed JSON. Throws ApiError on network or HTTP
 * failure, using the server's `{ error: { code, message } }` shape if present.
 */
export async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection.');
  }

  const payload = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = payload?.error;
    throw new ApiError(e?.message || `Request failed (${res.status}).`, { status: res.status, code: e?.code || 'HTTP_ERROR', details: e?.details });
  }
  return payload;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, body, opts) => request(path, { ...opts, method: 'DELETE', body }),
};

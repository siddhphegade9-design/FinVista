/** Client-side session helpers. The server is the authority; these only read state and redirect. */
import { api } from './api.js';
import { setCurrency } from './format.js';

export const AFTER_LOGIN = '/dashboard.html';

/**
 * Accepts a post-login redirect target only if it is a same-site path ("/dashboard.html?x=1"),
 * so a crafted ?next=https://evil.example link cannot bounce users to another site.
 */
export function safeNextPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || /[\\\r\n]/.test(raw)) return AFTER_LOGIN;
  try {
    const url = new URL(raw, 'http://placeholder.invalid');
    return url.host === 'placeholder.invalid' ? raw : AFTER_LOGIN;
  } catch {
    return AFTER_LOGIN;
  }
}

/** Current user ({ id, email, fullName }) or null when logged out. Throws ApiError if the server is unreachable. */
export async function getSessionUser() {
  const { user } = await api.get('/auth/session');
  if (user) setCurrency(user.currency); // every page formats money in the user's currency
  return user;
}

/** For protected pages: returns the user, or redirects to the login page (remembering where to return) and returns null. */
export async function requireLogin() {
  const user = await getSessionUser();
  if (!user) {
    const here = location.pathname + location.search;
    location.replace(`/login.html?next=${encodeURIComponent(here)}`);
    return null;
  }
  return user;
}

export async function logout() {
  try {
    await api.post('/auth/logout');
  } finally {
    location.assign('/');
  }
}

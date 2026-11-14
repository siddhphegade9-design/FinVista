/**
 * Public pages: show "Open dashboard" instead of "Log in / Get started" when signed in.
 * Elements opt in with data-guest-only / data-user-only. Failures leave the default (guest) view.
 */
import { qsa } from '../core/dom.js';
import { getSessionUser } from '../core/auth.js';

export async function applyAuthState() {
  const guest = qsa('[data-guest-only]');
  const member = qsa('[data-user-only]');
  if (guest.length + member.length === 0) return;
  let user = null;
  try { user = await getSessionUser(); } catch { return; }
  if (!user) return;
  guest.forEach((n) => n.classList.add('hidden'));
  member.forEach((n) => n.classList.remove('hidden'));
}

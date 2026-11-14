import { qs } from '../core/dom.js';

/** Mobile navigation toggle for the public site header. */
export function initNav() {
  const toggle = qs('.nav-toggle');
  const nav = qs('#site-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) { nav.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); }
  });
}

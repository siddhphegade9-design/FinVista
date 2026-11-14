/**
 * Sidebar + mobile drawer for the authenticated app. The navigation is defined
 * once here so every app page shows the same menu. Pages that do not exist yet
 * are grouped by area, each with an icon.
 */
import { el, qs } from '../core/dom.js';
import { logout } from '../core/auth.js';
import { currencySymbol, localizeLabel } from '../core/format.js';

/** Stroke icons (24x24) for the sidebar. Paths only; drawn with currentColor. */
const ICONS = {
  dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  transactions: 'M7 7h13M17 3l4 4-4 4M17 17H4M7 13l-4 4 4 4',
  categories: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z',
  analytics: 'M4 19V10M10 19V5M16 19v-6M22 19H2',
  budgets: 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5A9 9 0 0 1 20.5 9H15z',
  forecast: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  investments: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9.5c-.6-1-1.7-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.3 0-2.4-.5-3-1.5M12 6v2M12 16v2',
  insurance: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  simulator: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  advisor: 'M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z',
  tax: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3',
  reports: 'M4 4h16v16H4zM8 16v-3M12 16V9M16 16v-5',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
};

export function icon(name, cls = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  return svg;
}

export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard.html', group: 'Overview' },
  { key: 'analytics', label: 'Analytics', href: '/analytics.html', group: 'Overview' },
  { key: 'reports', label: 'Reports', href: '/reports.html', group: 'Overview' },
  { key: 'transactions', label: 'Transactions', href: '/transactions.html', group: 'Money' },
  { key: 'categories', label: 'Categories', href: '/categories.html', group: 'Money' },
  { key: 'budgets', label: 'Budgets', href: '/budgets.html', group: 'Money' },
  { key: 'forecast', label: 'Forecast', href: '/forecast.html', group: 'Planning' },
  { key: 'simulator', label: 'What-if', href: '/simulator.html', group: 'Planning' },
  { key: 'investments', label: 'Investments (SIP)', href: '/investments.html', group: 'Planning' },
  { key: 'insurance', label: 'Insurance', href: '/insurance.html', group: 'Planning' },
  { key: 'tax', label: 'Tax (India)', href: '/tax.html', group: 'Planning' },
  { key: 'advisor', label: 'AI Advisor', href: '/advisor.html', group: 'Assistant', badge: 'AI' },
  { key: 'account', label: 'Account', href: '/account.html', group: 'Settings' },
];

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** The signed-in user block at the bottom of the sidebar (or a login prompt in sample-preview mode). */
function userBlock(user) {
  if (!user) {
    return el('div', { class: 'sidebar__user' }, [
      el('span', { class: 'avatar avatar--muted', 'aria-hidden': 'true' }, '?'),
      el('div', { class: 'sidebar__user-info' }, [el('div', { class: 'sidebar__user-name' }, 'Sample preview'), el('div', { class: 'sidebar__user-email' }, 'Not signed in')]),
      el('a', { class: 'btn btn--primary btn--sm', href: '/login.html' }, 'Log in'),
    ]);
  }
  return el('div', { class: 'sidebar__user' }, [
    el('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(user.fullName)),
    el('div', { class: 'sidebar__user-info' }, [
      el('div', { class: 'sidebar__user-name', id: 'sidebar-user-name' }, user.fullName),
      el('div', { class: 'sidebar__user-email' }, user.email),
    ]),
    el('button', { class: 'btn btn--ghost btn--icon sidebar__logout', type: 'button', id: 'logout-btn', title: 'Log out', 'aria-label': 'Log out', onclick: () => logout() }, [icon('logout'), el('span', { class: 'sr-only' }, 'Log out')]),
  ]);
}

/** Adds the section name above the page title, e.g. "Planning" over "Forecast". */
function decorateTopbar(item) {
  const h1 = qs('.topbar__title h1');
  if (!h1 || !item || h1.parentElement.classList.contains('topbar__heading')) return;
  const wrap = el('div', { class: 'topbar__heading' }, [el('span', { class: 'topbar__eyebrow' }, item.group)]);
  h1.replaceWith(wrap);
  wrap.append(h1);
}

/** Renders the sidebar. `user` is the signed-in user, or null for the sample preview. */
export function renderSidebar(activeKey, user = null) {
  const host = qs('#sidebar');
  host.replaceChildren();
  // Indian income tax is only for INR accounts: for any other currency the Tax item is removed completely.
  const visible = NAV_ITEMS.filter((item) => item.key !== 'tax' || !user || user.currency === 'INR');
  const groups = [];
  for (const item of visible) {
    let g = groups.find((x) => x.name === item.group);
    if (!g) { g = { name: item.group, items: [] }; groups.push(g); }
    g.items.push(item);
  }
  const nav = el('nav', { class: 'side-nav', 'aria-label': 'App' }, groups.map((g) => el('div', { class: 'side-group' }, [
    el('div', { class: 'side-label' }, g.name),
    ...g.items.map((item) => el('a', { class: 'side-link', href: item.href, 'aria-current': item.key === activeKey ? 'page' : null }, [
      icon(item.key, 'side-link__icon'), el('span', { class: 'side-link__text' }, item.label),
      item.badge ? el('span', { class: 'side-link__badge' }, item.badge) : '',
    ].filter(Boolean))),
  ])));
  host.append(
    el('a', { class: 'brand sidebar__brand', href: '/', 'aria-label': 'FinVista home' }, el('img', { class: 'brand__logo', src: '/assets/brand/finvista-wordmark.png', alt: 'FinVista', width: '451', height: '144' })),
    nav,
    userBlock(user),
    el('div', { class: 'sidebar__foot' }, 'Estimates only. Not financial or tax advice.'),
  );
  decorateTopbar(NAV_ITEMS.find((i) => i.key === activeKey));
  localizeStaticLabels();
}

/** Static page labels are written with the rupee sign; show the user's own currency symbol instead. */
function localizeStaticLabels() {
  if (currencySymbol() === '₹') return;
  for (const label of document.querySelectorAll('label')) {
    if (label.textContent.includes('₹')) for (const node of label.childNodes) if (node.nodeType === 3) node.textContent = localizeLabel(node.textContent);
  }
}

/** Wires the hamburger button, scrim and Esc key for the mobile drawer. */
export function initDrawer() {
  const sidebar = qs('#sidebar');
  const scrim = qs('#scrim');
  const button = qs('#menu-btn');
  const set = (open) => {
    sidebar.classList.toggle('is-open', open);
    scrim.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => set(!sidebar.classList.contains('is-open')));
  scrim.addEventListener('click', () => set(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
}

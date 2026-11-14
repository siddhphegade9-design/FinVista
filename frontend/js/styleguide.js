/** Wires up the design-system reference page. Sample data here is illustrative only. */
import { qs, qsa, el } from './core/dom.js';
import { formatCurrency, formatDate, parseAmount } from './core/format.js';
import { api } from './core/api.js';
import { toast } from './core/toast.js';
import { applyChartTheme, chartPalette } from './core/chartTheme.js';
import { confirmDialog } from './ui/modal.js';

// Colour swatches, labelled with the CSS variable that defines them.
const SWATCHES = ['--bg-0', '--bg-2', '--bg-3', '--purple-500', '--cyan-500', '--positive', '--negative', '--warning'];
const swatchHost = qs('#swatches');
for (const name of SWATCHES) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  swatchHost.append(el('div', { class: 'card' }, [
    el('div', { class: 'swatch-chip', 'data-color': value }),
    el('code', {}, name), el('div', { class: 'text-muted num' }, value),
  ]));
}
// Colours are applied through CSSOM (inline style attributes are blocked by our CSP).
qsa('.swatch-chip').forEach((chip) => {
  chip.style.cssText = `height:44px;border-radius:8px;margin-bottom:8px;border:1px solid var(--border);background:${chip.dataset.color}`;
});

qs('#fmt-demo').textContent = `Sample formatting: ${formatCurrency(1234567.5)} · ${formatDate('2026-11-14')}`;
qsa('[data-sample]').forEach((n) => { n.textContent = formatCurrency(Number(n.dataset.sample), { whole: true }); });
qsa('.progress__bar[data-value]').forEach((n) => n.style.setProperty('--value', n.dataset.value));

const SAMPLE_ROWS = [
  ['2026-11-12', 'Sample: grocery store', 'Food & Dining', -2340.5],
  ['2026-11-10', 'Sample: metro recharge', 'Transport', -500],
  ['2026-11-01', 'Sample: salary credit', 'Income', 85000],
];
qs('#sample-rows').append(...SAMPLE_ROWS.map(([d, desc, cat, amt]) => el('tr', {}, [
  el('td', {}, formatDate(d)), el('td', {}, desc), el('td', {}, el('span', { class: 'badge' }, cat)),
  el('td', { class: `num ${amt < 0 ? 'text-negative' : 'text-positive'}` }, formatCurrency(amt)),
])));

// Interactions
qs('#btn-toast').addEventListener('click', () => toast('This is a success toast.', 'success'));
qs('#btn-confirm').addEventListener('click', async () => {
  const ok = await confirmDialog({ title: 'Delete transaction?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
  toast(ok ? 'Confirmed.' : 'Cancelled.', ok ? 'success' : 'info');
});
qs('#demo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = qs('#amount');
  const parsed = parseAmount(input.value);
  const bad = parsed === null;
  input.setAttribute('aria-invalid', String(bad));
  qs('#amount-error').textContent = bad ? 'Enter a valid amount with at most two decimals.' : '';
  if (!bad) toast(`Valid amount: ${formatCurrency(parsed)}`, 'success');
});

// Charts
if (window.Chart) {
  applyChartTheme(window.Chart);
  const [c1, c2] = chartPalette();
  const months = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
  new window.Chart(qs('#chart-bar'), {
    type: 'bar',
    data: { labels: months, datasets: [
      { label: 'Income', data: [82000, 85000, 85000, 91000, 85000, 88000], backgroundColor: c1, borderRadius: 6 },
      { label: 'Expenses', data: [54000, 61000, 58000, 66000, 59000, 62000], backgroundColor: c2, borderRadius: 6 },
    ] },
    options: { scales: { x: { grid: { display: false } } } },
  });
  new window.Chart(qs('#chart-doughnut'), {
    type: 'doughnut',
    data: { labels: ['Food', 'Transport', 'Bills', 'Shopping', 'Other'], datasets: [{ data: [18000, 7000, 14000, 12000, 6000], backgroundColor: chartPalette().slice(0, 5), borderWidth: 0 }] },
    options: { cutout: '68%', plugins: { legend: { position: 'bottom' } } },
  });
}

// Backend connectivity check
(async () => {
  const badge = qs('#health-badge');
  const detail = qs('#health-detail');
  try {
    const h = await api.get('/health');
    badge.className = 'badge badge--positive'; badge.textContent = 'Online';
    detail.textContent = `${h.service} v${h.version}, up ${h.uptimeSeconds}s`;
  } catch (err) {
    badge.className = 'badge badge--negative'; badge.textContent = 'Offline';
    detail.textContent = err.message;
  }
})();

/**
 * Applies the FinVista theme to Chart.js. Colours are read from the CSS
 * variables in tokens.css so charts and UI can never drift apart.
 */
import { formatCompact, formatCurrency } from './format.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Ordered categorical palette: [--chart-1 ... --chart-8]. */
export function chartPalette() {
  return Array.from({ length: 8 }, (_, i) => css(`--chart-${i + 1}`));
}

/** Meaning-bearing colours, so income/expense never depend on palette order. */
export function chartColors() {
  return { positive: css('--positive'), negative: css('--negative'), estimate: css('--highlight'), muted: css('--slate-light') };
}

/** Same colour at a given opacity, e.g. for filled areas. Accepts #rrggbb. */
export function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Call once per page after the Chart.js script has loaded. */
export function applyChartTheme(Chart) {
  const d = Chart.defaults;
  d.font.family = css('--font-sans');
  d.font.size = 12;
  d.color = css('--text-2');
  d.maintainAspectRatio = false;
  d.responsive = true;
  d.plugins.legend.labels.usePointStyle = true;
  d.plugins.legend.labels.boxWidth = 8;
  d.plugins.tooltip.backgroundColor = css('--bg-3');
  d.plugins.tooltip.borderColor = css('--border-strong');
  d.plugins.tooltip.borderWidth = 1;
  d.plugins.tooltip.titleColor = css('--text-1');
  d.plugins.tooltip.bodyColor = css('--text-2');
  d.plugins.tooltip.padding = 10;
  d.plugins.tooltip.callbacks.label = (ctx) => {
    const v = ctx.parsed?.y ?? ctx.parsed;
    return `${ctx.dataset.label ?? ctx.label}: ${formatCurrency(v)}`;
  };
  if (d.scales?.linear) d.scales.linear.ticks.callback = (v) => formatCompact(v);
  // Quiet, editorial defaults shared by every chart (pages can still override).
  d.borderColor = withAlpha(css('--ivory'), 0.07);   // gridlines
  d.scale.ticks.color = css('--text-3');
  d.plugins.legend.labels.color = css('--text-2');
  d.plugins.tooltip.cornerRadius = 6;
  d.plugins.tooltip.padding = 12;
  d.plugins.tooltip.boxPadding = 4;
  d.plugins.tooltip.usePointStyle = true;
  d.plugins.legend.labels.padding = 16;
  d.elements.bar.borderRadius = 3;
  d.elements.bar.borderSkipped = false;
  d.elements.line.tension = 0.35;
  d.elements.line.borderWidth = 2;
  d.elements.point.radius = 0;
  d.elements.point.hoverRadius = 5;
  d.elements.point.hitRadius = 12;
  d.elements.arc.borderWidth = 2;
  d.elements.arc.borderColor = css('--bg-2');   // slice separators match the card
  d.elements.arc.hoverOffset = 6;
  d.interaction = { mode: 'index', intersect: false };
  d.animation = { duration: 700, easing: 'easeOutQuart' };
}

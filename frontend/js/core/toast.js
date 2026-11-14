import { el } from './dom.js';

let region;
function getRegion() {
  if (!region) {
    region = el('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  return region;
}

/** toast('Saved', 'success') - types: info | success | warning | error */
export function toast(message, type = 'info', durationMs = 4000) {
  const node = el('div', { class: `toast toast--${type}` }, message);
  getRegion().append(node);
  setTimeout(() => node.remove(), durationMs);
}

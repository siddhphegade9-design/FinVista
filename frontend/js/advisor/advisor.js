/** AI advisor page. Answers are plain text from the server and are only ever inserted with textContent. */
import { qs, el } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { requireLogin } from '../core/auth.js';
import { parseAnswer } from './answerText.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';

initDrawer();
let busy = false;

const renderAnswer = (text) => parseAnswer(text).map((b) => (b.type === 'ul' ? el('ul', {}, b.items.map((i) => el('li', {}, i))) : el('p', {}, b.text)));

async function ask(body) {
  if (busy) return;
  busy = true;
  qs('#question-error').textContent = '';
  qs('#page-error').replaceChildren();
  qs('#ask-btn').disabled = true;
  for (const b of document.querySelectorAll('.adv-presets button')) b.disabled = true;
  qs('#thinking').classList.remove('hidden');
  qs('#answer-box').classList.add('hidden');
  try {
    const r = await api.post('/advisor/ask', body);
    qs('#answer').replaceChildren(...renderAnswer(r.answer));
    qs('#answer-meta').textContent = `Model: ${r.model}. Based on ${r.basedOn.completeMonths} complete month(s) of your records${r.truncated ? '. The answer was cut short.' : '.'}`;
    qs('#answer-label').textContent = r.label;
    qs('#answer-box').classList.remove('hidden');
  } catch (err) {
    if (err instanceof ApiError && err.details?.question) qs('#question-error').textContent = err.details.question;
    else qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, err.message || 'Something went wrong. Please try again.'));
  } finally {
    busy = false;
    qs('#thinking').classList.add('hidden');
    qs('#ask-btn').disabled = false;
    for (const b of document.querySelectorAll('.adv-presets button')) b.disabled = false;
  }
}

async function toggleData() {
  const pre = qs('#data-pre');
  const btn = qs('#data-btn');
  if (!pre.classList.contains('hidden')) { pre.classList.add('hidden'); btn.textContent = 'Show the figures'; btn.setAttribute('aria-expanded', 'false'); return; }
  try {
    const { facts } = await api.get('/advisor/data');
    pre.textContent = JSON.stringify(facts, null, 2);
    pre.classList.remove('hidden');
    btn.textContent = 'Hide the figures';
    btn.setAttribute('aria-expanded', 'true');
  } catch (err) { qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load the figures: ${err.message}`)); }
}

(async function init() {
  let user;
  try { user = await requireLogin(); }
  catch (err) { renderSidebar('advisor', null); qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not verify your session: ${err.message}`)); return; }
  if (!user) return;
  renderSidebar('advisor', user);
  qs('#data-btn').addEventListener('click', toggleData);
  qs('#question').addEventListener('input', (e) => { qs('#count').textContent = String(e.target.value.length); });
  let status;
  try { status = await api.get('/advisor/status'); }
  catch (err) { qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load the advisor: ${err.message}`)); return; }
  qs('#presets').replaceChildren(...status.presets.map((p) => el('button', { class: 'btn btn--secondary btn--sm', type: 'button', dataset: { preset: p.id }, onclick: () => ask({ preset: p.id }) }, p.label)));
  qs('#ask-form').addEventListener('submit', (e) => { e.preventDefault(); ask({ question: qs('#question').value }); });
  if (!status.configured) {
    qs('#not-configured').classList.remove('hidden');
    qs('#ask-btn').disabled = true; qs('#question').disabled = true;
    for (const b of document.querySelectorAll('.adv-presets button')) b.disabled = true;
  }
  // A question passed from another page (e.g. the dashboard) is filled in but never sent automatically.
  const prefill = new URLSearchParams(location.search).get('q');
  if (prefill && status.configured) {
    qs('#question').value = prefill.slice(0, 500);
    qs('#count').textContent = String(qs('#question').value.length);
    qs('#question').focus();
  }
  qs('#adv').setAttribute('aria-busy', 'false');
})();

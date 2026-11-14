/** Login / register page controller. The server validates everything again; this gives faster feedback. */
import { qs, qsa } from './core/dom.js';
import { api, ApiError } from './core/api.js';
import { getSessionUser, safeNextPath } from './core/auth.js';
import { CURRENCIES } from './core/format.js';

const form = qs('#auth-form');
const mode = form.dataset.mode; // 'login' | 'register'
const submitBtn = qs('button[type="submit"]', form);
const formError = qs('#form-error');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const next = safeNextPath(new URLSearchParams(location.search).get('next'));

// Registration offers the supported currencies (INR by default).
const currencySelect = qs('#currency', form);
if (currencySelect) for (const [code, c] of Object.entries(CURRENCIES)) currencySelect.append(Object.assign(document.createElement('option'), { value: code, textContent: `${code} - ${c.name}` }));

// Already signed in? Skip straight to the app.
getSessionUser().then((u) => { if (u) location.replace(next); }).catch(() => {});

function setFieldError(name, message) {
  const input = qs(`[name="${name}"]`, form);
  const out = qs(`#${name}-error`);
  if (!input || !out) return;
  out.textContent = message || '';
  input.setAttribute('aria-invalid', String(Boolean(message)));
}

function setFormError(message) {
  formError.textContent = message || '';
  formError.classList.toggle('hidden', !message);
}

function validate(v) {
  const problems = {};
  if (mode === 'register' && v.fullName.trim().length < 2) problems.fullName = 'Enter your name.';
  if (!EMAIL_RE.test(v.email.trim())) problems.email = 'Enter a valid email address.';
  if (mode === 'register') {
    if (v.password.length < 10) problems.password = 'Use at least 10 characters.';
    else if (v.confirm !== v.password) problems.confirm = 'Passwords do not match.';
  } else if (!v.password) problems.password = 'Enter your password.';
  return problems;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setFormError('');
  const values = Object.fromEntries(new FormData(form).entries());
  const problems = validate(values);
  ['fullName', 'email', 'password', 'confirm', 'currency'].forEach((f) => setFieldError(f, problems[f]));
  if (Object.keys(problems).length) return;

  submitBtn.disabled = true;
  try {
    const body = mode === 'register'
      ? { fullName: values.fullName, email: values.email, password: values.password, currency: values.currency }
      : { email: values.email, password: values.password };
    await api.post(`/auth/${mode}`, body);
    location.assign(next);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.status === 400 && err.details) Object.entries(err.details).forEach(([f, m]) => setFieldError(f, m));
    else if (err.status === 409) setFieldError('email', err.message);
    else setFormError(err.message);
    submitBtn.disabled = false;
  }
});

qsa('.input', form).forEach((input) => input.addEventListener('input', () => { setFieldError(input.name, ''); setFormError(''); }));

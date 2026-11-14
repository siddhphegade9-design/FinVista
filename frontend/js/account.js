/** Account page: edit profile, change password, delete account. */
import { qs } from './core/dom.js';
import { api, ApiError } from './core/api.js';
import { requireLogin } from './core/auth.js';
import { toast } from './core/toast.js';
import { renderSidebar, initDrawer } from './ui/appShell.js';
import { CURRENCIES } from './core/format.js';
import { confirmDialog } from './ui/modal.js';

initDrawer();

/** Shows server field errors under their inputs. `prefix` maps field -> element id (e.g. "pw-" + field + "-error"). */
function showErrors(prefix, fields, details = {}) {
  fields.forEach((f) => {
    const out = qs(`#${prefix}-${f}-error`);
    out.textContent = details[f] || '';
    out.closest('.field').querySelector('.input, .select')?.setAttribute('aria-invalid', String(Boolean(details[f])));
  });
}

/** Runs an API action, disabling the form's button and turning errors into field messages or a toast. */
async function submit(form, prefix, fields, action) {
  const button = qs('button[type="submit"]', form);
  button.disabled = true;
  showErrors(prefix, fields);
  try {
    await action();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.status === 400 && err.details) showErrors(prefix, fields, err.details);
    else if (err.status === 401 && fields.includes('password')) showErrors(prefix, fields, { password: err.message });
    else toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

(async function init() {
  let user;
  try {
    user = await requireLogin();
  } catch (err) {
    qs('.account-grid').replaceChildren(Object.assign(document.createElement('div'), { className: 'alert alert--danger', textContent: `Could not verify your session: ${err.message}` }));
    return;
  }
  if (!user) return;
  renderSidebar('account', user);
  qs('#p-email').value = user.email;
  qs('#p-name').value = user.fullName;

  const select = qs('#c-currency');
  for (const [code, c] of Object.entries(CURRENCIES)) select.append(Object.assign(document.createElement('option'), { value: code, textContent: `${code} - ${c.name}` }));
  select.value = user.currency;
  const currencyForm = qs('#currency-form');
  currencyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(currencyForm, 'currency', ['currency'], async () => {
      const next = select.value;
      if (next === user.currency) { toast('That is already your currency.', 'info'); return; }
      const leavingIndia = user.currency === 'INR';
      const ok = await confirmDialog({
        title: `Switch to ${CURRENCIES[next].name} (${next})?`,
        message: `Amounts you have already entered are not converted: ${leavingIndia ? 'a figure entered as rupees' : `a figure entered in ${user.currency}`} will simply be shown in ${next}.${leavingIndia ? ' The Indian tax tool will be closed for your account until you switch back to INR.' : next === 'INR' ? ' The Indian tax tool will open again.' : ''}`,
        confirmLabel: 'Switch currency',
      });
      if (!ok) { select.value = user.currency; return; }
      await api.patch('/auth/currency', { currency: next });
      toast('Currency updated.', 'success');
      location.reload();
    });
  });

  const profileForm = qs('#profile-form');
  profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(profileForm, 'profile', ['fullName'], async () => {
      const { user: updated } = await api.patch('/auth/profile', { fullName: qs('#p-name').value });
      qs('#p-name').value = updated.fullName;
      qs('#sidebar-user-name').textContent = updated.fullName;
      toast('Name updated.', 'success');
    });
  });

  const passwordForm = qs('#password-form');
  passwordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(passwordForm, 'pw', ['currentPassword', 'newPassword'], async () => {
      await api.post('/auth/change-password', { currentPassword: qs('#pw-current').value, newPassword: qs('#pw-new').value });
      passwordForm.reset();
      toast('Password changed. Other devices were signed out.', 'success');
    });
  });

  const deleteForm = qs('#delete-form');
  deleteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = qs('#del-password').value;
    if (!password) { showErrors('del', ['password'], { password: 'Enter your password to confirm.' }); return; }
    const sure = await confirmDialog({ title: 'Delete your account?', message: 'All of your data will be permanently deleted. This cannot be undone.', confirmLabel: 'Delete everything', danger: true });
    if (!sure) return;
    submit(deleteForm, 'del', ['password'], async () => {
      await api.del('/auth/account', { password });
      location.assign('/');
    });
  });
})();

import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNextPath, AFTER_LOGIN } from '../js/core/auth.js';

test('safeNextPath keeps same-site paths', () => {
  assert.equal(safeNextPath('/dashboard.html'), '/dashboard.html');
  assert.equal(safeNextPath('/account.html?tab=1#x'), '/account.html?tab=1#x');
});

test('safeNextPath rejects anything that could leave the site', () => {
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'evil.example', '', '/ok\r\nSet-Cookie: x=1', '/\t/evil.example', undefined, null, 42]) {
    assert.equal(safeNextPath(bad), AFTER_LOGIN, `should reject ${JSON.stringify(bad)}`);
  }
});

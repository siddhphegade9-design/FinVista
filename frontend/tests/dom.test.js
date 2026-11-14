import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../js/core/dom.js';

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml("it's & ok"), 'it&#39;s &amp; ok');
});

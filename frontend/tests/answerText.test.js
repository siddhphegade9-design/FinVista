import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnswer } from '../js/advisor/answerText.js';

test('parseAnswer: paragraphs and bullets, markdown markers removed', () => {
  const blocks = parseAnswer('You spent **₹6,000**.\n\n- Food is high\n- `Rent` is steady\nDone.');
  assert.deepEqual(blocks, [
    { type: 'p', text: 'You spent ₹6,000.' },
    { type: 'ul', items: ['Food is high', 'Rent is steady'] },
    { type: 'p', text: 'Done.' },
  ]);
});

test('parseAnswer: HTML stays plain text (the page inserts it with textContent)', () => {
  const [b] = parseAnswer('<img src=x onerror=alert(1)>');
  assert.equal(b.type, 'p');
  assert.equal(b.text, '<img src=x onerror=alert(1)>');
});

test('parseAnswer: empty or missing input gives no blocks', () => {
  assert.deepEqual(parseAnswer(''), []);
  assert.deepEqual(parseAnswer(undefined), []);
});

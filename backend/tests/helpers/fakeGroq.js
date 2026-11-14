'use strict';
/**
 * A stand-in for the Groq API for tests (also runnable: `node fakeGroq.js 4010`).
 * It answers from the FACTS block it receives, so tests can prove that real figures reached the model.
 * Control endpoints: GET /__requests, POST /__mode {"mode":...}, POST /__reset.
 * Modes: ok, error500, error400, error404, error413, error429, empty, length, slow.
 */
const http = require('node:http');

function createFakeGroq() {
  const state = { mode: 'ok', requests: [] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const json = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
      if (req.url === '/__requests') return json(200, state.requests);
      if (req.url === '/__reset') { state.requests = []; state.mode = 'ok'; return json(200, {}); }
      if (req.url === '/__mode') { state.mode = JSON.parse(raw).mode; return json(200, { mode: state.mode }); }
      if (req.url !== '/openai/v1/chat/completions' || req.method !== 'POST') return json(404, {});
      const body = JSON.parse(raw);
      const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
      const prompt = body.messages.find((m) => m.role === 'user')?.content ?? '';
      state.requests.push({ url: req.url, auth: req.headers.authorization, body, system, prompt });
      const err = (code, message, headers) => json(code, { error: { message: `${message} (SECRET details)` } }, headers);
      if (state.mode === 'error500') return err(500, 'boom');
      if (state.mode === 'error400') return err(400, 'Invalid API Key');
      if (state.mode === 'error404') return err(404, 'The model `x` does not exist');
      if (state.mode === 'error413') return err(413, 'Request too large for model on tokens per minute (TPM): Limit 8000');
      if (state.mode === 'error429') return err(429, 'Rate limit reached for model', { 'retry-after': '7' });
      const reply = () => {
        if (state.mode === 'empty') return json(200, { choices: [{ message: { role: 'assistant', content: '', reasoning: 'thinking only' }, finish_reason: 'length' }] });
        const facts = JSON.parse(/<facts>\n([\s\S]*?)\n<\/facts>/.exec(prompt)[1]);
        const last = facts.recordedMonths[facts.recordedMonths.length - 1];
        const text = last
          ? `In ${last.month} you recorded income of ₹${last.income} and spending of ₹${last.expenses}.\n\n- This is a recorded actual, not a forecast.\n- **Fake model** answer for testing.`
          : 'There are no complete months recorded yet, so I cannot compare months.';
        json(200, { choices: [{ message: { role: 'assistant', content: text, reasoning: 'PRIVATE-REASONING-SHOULD-NOT-APPEAR' }, finish_reason: state.mode === 'length' ? 'length' : 'stop' }] });
      };
      if (state.mode === 'slow') return setTimeout(reply, 1500);
      reply();
    });
  });
  const api = { server, state, base: '' };
  const listen = (port = 0) => new Promise((resolve) => server.listen(port, '127.0.0.1', () => { api.base = `http://127.0.0.1:${server.address().port}`; resolve(api.base); }));
  return Object.assign(api, { listen, close: () => new Promise((r) => server.close(r)) });
}

module.exports = { createFakeGroq };
if (require.main === module) createFakeGroq().listen(Number(process.argv[2]) || 4010).then((u) => console.log('fake groq on', u));

'use strict';
/** Tiny HTTP client with a cookie jar, so tests behave like one browser. */
function createClient(base) {
  const jar = new Map();
  async function request(method, path, { body, headers = {}, rawBody, cookies = true } = {}) {
    const h = { ...headers };
    if (cookies && jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload;
    if (rawBody !== undefined) payload = rawBody;
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] ??= 'application/json'; }
    const res = await fetch(`${base}${path}`, { method, headers: h, body: payload });
    const setCookie = res.headers.getSetCookie();
    for (const line of setCookie) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (/expires=thu, 01 jan 1970/i.test(line) || value === '') jar.delete(name); else jar.set(name, value);
    }
    let json = null;
    try { json = await res.clone().json(); } catch { /* not JSON */ }
    return { status: res.status, json, headers: res.headers, setCookie, text: await res.text() };
  }
  return {
    jar,
    get: (p, o) => request('GET', p, o),
    post: (p, body, o) => request('POST', p, { ...o, body }),
    put: (p, body, o) => request('PUT', p, { ...o, body }),
    patch: (p, body, o) => request('PATCH', p, { ...o, body }),
    del: (p, body, o) => request('DELETE', p, { ...o, body }),
    request,
  };
}

/** Starts the app on a random port. Call after setting env vars and requiring in the test file. */
async function startApp(createApp) {
  const server = await new Promise((resolve) => { const s = createApp().listen(0, () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { createClient, startApp };

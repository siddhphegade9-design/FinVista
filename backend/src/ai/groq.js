'use strict';
/**
 * Minimal Groq client (OpenAI-compatible chat completions, model openai/gpt-oss-120b by default).
 * Backend-only: the API key comes from the environment and is sent in the Authorization header, never in a URL,
 * a log line, an error message or a response to the browser. `fetchImpl` is injectable so tests need no network.
 * Free plan only: nothing here adds billing; hitting a free-plan limit just returns a friendly error.
 */
const config = require('../config/env');
const { HttpError } = require('../utils/httpError');

const isConfigured = (cfg = config.groq) => Boolean(cfg.apiKey);

function assertConfigured(cfg = config.groq) {
  if (!isConfigured(cfg)) throw new HttpError(503, 'AI_NOT_CONFIGURED', 'The AI advisor is not set up on this server. An administrator needs to add a Groq API key.');
}

function extractText(data) {
  const choice = data?.choices?.[0];
  if (!choice) throw new HttpError(502, 'AI_EMPTY', 'The AI service returned no answer. Please try again.');
  // Only message.content is used. gpt-oss returns its reasoning in a separate field, which is deliberately ignored.
  const text = typeof choice.message?.content === 'string' ? choice.message.content.trim() : '';
  const truncated = choice.finish_reason === 'length';
  if (!text) {
    throw new HttpError(502, 'AI_EMPTY', truncated ? 'The AI service ran out of room before finishing its answer. Please try again.' : 'The AI service returned an empty answer. Please try again.');
  }
  return { text, truncated };
}

const retryHint = (res) => {
  const s = Number.parseInt(res.headers?.get?.('retry-after') ?? '', 10);
  return Number.isInteger(s) && s > 0 ? ` Try again in about ${s < 90 ? `${s} seconds` : `${Math.ceil(s / 60)} minutes`}.` : ' Please try again in a minute.';
};

/**
 * @param {{system: string, prompt: string}} input
 * @param {{cfg?: object, fetchImpl?: Function}} [opts]
 * @returns {Promise<{text: string, truncated: boolean, model: string}>}
 */
async function generate({ system, prompt }, { cfg = config.groq, fetchImpl = globalThis.fetch } = {}) {
  assertConfigured(cfg);
  const url = `${cfg.baseUrl}/chat/completions`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        temperature: 0.3,
        max_completion_tokens: cfg.maxOutputTokens,
        reasoning_effort: cfg.reasoningEffort,
        stream: false,
      }),
      signal: ctl.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new HttpError(504, 'AI_TIMEOUT', 'The AI service took too long to answer. Please try again.');
    throw new HttpError(502, 'AI_UNAVAILABLE', 'Could not reach the AI service. Please try again later.');
  } finally { clearTimeout(timer); }

  if (!res.ok) {
    // Upstream error bodies are never forwarded to the browser. The status and Groq's short message are
    // logged on the server (key redacted) so an administrator can see why a call failed.
    let detail = '';
    try { detail = String((await res.json())?.error?.message ?? '').split(cfg.apiKey).join('[key]').slice(0, 300); } catch { /* no body */ }
    console.error(`[groq] upstream ${res.status} for model ${cfg.model}${detail ? `: ${detail}` : ''}`);
    if (res.status === 404) throw new HttpError(502, 'AI_MODEL_NOT_FOUND', `The AI model "${cfg.model}" was not found. The server's GROQ_MODEL setting needs to be a model your key can use.`);
    if (res.status === 429) throw new HttpError(503, 'AI_BUSY', `The free AI plan's usage limit was reached for now.${retryHint(res)}`);
    if (res.status === 413) throw new HttpError(503, 'AI_BUSY', `This question needed more tokens than the free AI plan allows per minute.${retryHint(res)}`);
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new HttpError(502, 'AI_REJECTED', 'The AI service rejected the request. The server\'s API key or model setting may be wrong.');
    throw new HttpError(502, 'AI_UNAVAILABLE', 'The AI service had a problem. Please try again later.');
  }
  let data;
  try { data = await res.json(); } catch { throw new HttpError(502, 'AI_UNAVAILABLE', 'The AI service sent an unreadable answer. Please try again.'); }
  return { ...extractText(data), model: cfg.model };
}

module.exports = { generate, isConfigured, assertConfigured, extractText };

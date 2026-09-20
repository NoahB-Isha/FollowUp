import { jotformKey } from './config.js';

const BASE = 'https://api.jotform.com';

/**
 * Minimal JotForm API client. The key is sent only as a request header to
 * api.jotform.com — never logged, never in URLs, never sent to the browser.
 */
async function apiGet(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { APIKEY: jotformKey() } });
  if (!res.ok) throw new Error(`JotForm API ${path} → HTTP ${res.status}`);
  const body = await res.json();
  if (body.responseCode !== 200) throw new Error(`JotForm API ${path} → ${body.responseCode} ${body.message}`);
  return body.content;
}

export async function getQuestions(formId) {
  return apiGet(`/form/${formId}/questions`);
}

export async function getAllSubmissions(formId, { sinceCreatedAt } = {}) {
  const all = [];
  const limit = 1000;
  const params = { limit, orderby: 'created_at' };
  // Incremental sync: let JotForm filter server-side instead of re-sending
  // the whole history on every cron run.
  if (sinceCreatedAt) params.filter = JSON.stringify({ 'created_at:gt': sinceCreatedAt });
  for (let offset = 0; ; offset += limit) {
    const page = await apiGet(`/form/${formId}/submissions`, { ...params, offset });
    all.push(...page);
    if (page.length < limit) break;
  }
  return all;
}

/**
 * Fetch a JotForm-hosted upload (photos) server-side so the browser never
 * needs the API key. Only jotform.com hosts are allowed.
 */
export async function fetchUpload(rawUrl) {
  const url = new URL(rawUrl);
  if (!/(^|\.)jotform\.com$/.test(url.hostname)) throw new Error('refusing non-JotForm URL');
  url.protocol = 'https:';
  const res = await fetch(url, { headers: { APIKEY: jotformKey() } });
  if (!res.ok) {
    // Some upload URLs only honor the key as a query param.
    url.searchParams.set('apiKey', jotformKey());
    const retry = await fetch(url);
    if (!retry.ok) throw new Error(`upload fetch failed: HTTP ${retry.status}`);
    return retry;
  }
  return res;
}

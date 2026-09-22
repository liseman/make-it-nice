// make it nice — API client. Everything here fails soft: if the Worker is unreachable,
// the site keeps working in local-only mode (localStorage) and says so.

import { defaultModel, normalizeModel } from './engine.js';

const cfg = (typeof window !== 'undefined' && window.MAKE_IT_NICE) || {};
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export { LS };

export function apiBase() {
  const b = (cfg.API_BASE || '').replace(/\/+$/, '');
  if (b) return b;
  if (typeof location !== 'undefined' && /^https?:/.test(location.protocol)) return location.origin;
  return '';
}

let online = null; // null = unknown, true/false after first health check
export function isOnline() { return online === true; }

async function req(path, opts = {}, timeoutMs = 6000) {
  const base = apiBase();
  if (!base) { online = false; throw new Error('no api'); }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, { ...opts, signal: ctrl.signal, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
    if (!res.ok) { const text = await res.text().catch(() => ''); const err = new Error(`api ${res.status}: ${text.slice(0, 200)}`); err.status = res.status; throw err; }
    online = true;
    return await res.json();
  } catch (e) {
    if (!e.status) online = false;
    throw e;
  } finally { clearTimeout(t); }
}

export async function health() {
  try { const h = await req('/api/health', {}, 4000); return !!h.ok; } catch { return false; }
}

// Model: fetched from the API, cached for an hour, falling back to the built-in default.
export async function getModel() {
  const cached = LS.get('min.model');
  if (cached && cached.at && Date.now() - cached.at < 60 * 60 * 1000 && cached.model) return normalizeModel(cached.model);
  try {
    const m = await req('/api/model', {}, 4000);
    const model = normalizeModel(m);
    LS.set('min.model', { at: Date.now(), model });
    return model;
  } catch {
    return cached && cached.model ? normalizeModel(cached.model) : defaultModel();
  }
}

export async function postSession(payload) {
  try { return await req('/api/sessions', { method: 'POST', body: JSON.stringify(payload) }); } catch { return null; }
}
export async function postRating(id, stars) {
  try { return await req(`/api/sessions/${encodeURIComponent(id)}/rating`, { method: 'POST', body: JSON.stringify({ stars }) }); } catch { return null; }
}
export async function postEvent(type, data = {}) {
  try { return await req('/api/events', { method: 'POST', body: JSON.stringify({ type, ...data }) }, 4000); } catch { return null; }
}
export async function getPublicStats() {
  try { return await req('/api/stats', {}, 4000); } catch { return null; }
}
export async function getAdminStats(token) {
  return req('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } }, 15000);
}
export async function adminRecompute(token) {
  return req('/api/admin/recompute', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' }, 30000);
}

// ---- local mirror of sessions (so the dashboard has something in local-only mode) ----
export function localSessions() { return LS.get('min.sessions', []); }
export function saveLocalSession(rec) {
  const all = localSessions().filter((s) => s.id !== rec.id);
  all.push(rec);
  while (all.length > 200) all.shift();
  LS.set('min.sessions', all);
}
export function updateLocalSession(id, patch) {
  const all = localSessions();
  const i = all.findIndex((s) => s.id === id);
  if (i >= 0) { all[i] = { ...all[i], ...patch }; LS.set('min.sessions', all); }
}

// make it nice — Cloudflare Worker API (+ optionally serves the static site)
// Storage: D1 (SQLite). No other dependencies. The taste engine is shared with the site.

import { AXES, N, ARCHETYPES, defaultModel, normalizeModel, recomputeModel } from '../../site/engine.js';

const ID_RE = /^[a-z0-9]{6,16}$/;
const EVENT_TYPES = new Set(['start', 'view_shared', 'copy_prompt', 'download_prompt', 'share', 'start_fresh', 'evolve']);
const MAX_BODY = 64 * 1024;
const now = () => new Date().toISOString();

// ---------- helpers ----------
function corsHeaders(env, req) {
  const allowed = (env.ALLOWED_ORIGINS || '*').trim();
  const origin = req.headers.get('origin') || '';
  let allow = '*';
  if (allowed !== '*') {
    const list = allowed.split(',').map((s) => s.trim()).filter(Boolean);
    allow = list.includes(origin) ? origin : list[0] || 'null';
  }
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } });
const err = (msg, status = 400, extra = {}) => json({ ok: false, error: msg }, status, extra);

async function readJson(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new Error('body too large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Error('body too large');
  return text ? JSON.parse(text) : {};
}
const num = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const str = (v, max, d = null) => (typeof v === 'string' ? v.slice(0, max) : d);
const vec = (v, lo, hi) => (Array.isArray(v) && v.length === N && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? v.map((x) => Math.max(lo, Math.min(hi, Math.round(x * 1000) / 1000))) : null);

function cleanHistory(h) {
  if (!Array.isArray(h)) return [];
  const axisIds = new Set(AXES.map((a) => a.id));
  return h.slice(0, 80).map((e) => {
    if (!e || typeof e !== 'object') return null;
    let axis = null;
    if (typeof e.axis === 'string' && axisIds.has(e.axis)) axis = e.axis;
    else if (Array.isArray(e.axis) && e.axis.length === 2 && e.axis.every((a) => axisIds.has(a))) axis = e.axis.slice();
    if (!axis) return null;
    const kind = ['single', 'intensity', 'tradeoff'].includes(e.kind) ? e.kind : 'single';
    const pick = ['A', 'B', 'tie'].includes(e.pick) ? e.pick : 'tie';
    const archetype = ARCHETYPES.includes(e.archetype) ? e.archetype : null;
    const dir = e.dir === 'hi' || e.dir === 'lo' ? e.dir : undefined;
    return { axis, kind, pick, archetype, ...(dir ? { dir } : {}) };
  }).filter(Boolean);
}

function isAdmin(req, env) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return !!env.ADMIN_TOKEN && token.length > 0 && token === env.ADMIN_TOKEN;
}

// ---------- model ----------
let modelCache = { at: 0, model: null, row: null };
async function currentModel(env, fresh = false) {
  if (!fresh && modelCache.model && Date.now() - modelCache.at < 60 * 1000) return modelCache;
  const row = await env.DB.prepare('SELECT version, created_at, json, n_sessions, n_rated FROM model ORDER BY version DESC LIMIT 1').first();
  let model = defaultModel();
  if (row) { try { model = normalizeModel(JSON.parse(row.json)); model.version = row.version; } catch { /* keep default */ } }
  modelCache = { at: Date.now(), model, row };
  return modelCache;
}

async function recompute(env, reason = 'auto') {
  const { model: prev, row } = await currentModel(env, true);
  const rows = (await env.DB.prepare('SELECT w, s, n, ties, rating, history, model_version FROM sessions WHERE n >= 5 ORDER BY created_at DESC LIMIT 2500').all()).results || [];
  const sessions = rows.map((r) => {
    try { return { profile: { w: JSON.parse(r.w), s: JSON.parse(r.s), n: r.n, ties: r.ties }, rating: r.rating, history: r.history ? JSON.parse(r.history) : [], modelVersion: r.model_version }; } catch { return null; }
  }).filter(Boolean);
  const next = recomputeModel(sessions, prev);
  next.version = (row ? row.version : 0) + 1;
  next.reason = reason;
  await env.DB.prepare('INSERT INTO model (version, json, n_sessions, n_rated) VALUES (?, ?, ?, ?)')
    .bind(next.version, JSON.stringify(next), next.nSessions, next.nRated).run();
  modelCache = { at: 0, model: null, row: null };
  return next;
}

// Recompute when enough new signal has arrived since the last version.
async function maybeRecompute(env) {
  const { row } = await currentModel(env, true);
  const counts = await env.DB.prepare('SELECT COUNT(*) AS total, SUM(rating IS NOT NULL) AS rated FROM sessions WHERE n >= 5').first();
  const total = counts?.total || 0, rated = counts?.rated || 0;
  const lastSessions = row ? row.n_sessions : 0, lastRated = row ? row.n_rated : 0;
  if ((!row && total >= 5) || rated >= lastRated + 10 || total >= lastSessions + 50) return recompute(env, 'auto');
  return null;
}

// ---------- handlers ----------
async function handleApi(req, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = req.method.toUpperCase();

  if (path === '/api/health') return json({ ok: true, time: now(), engine: (await currentModel(env)).model.engine });

  if (path === '/api/model' && method === 'GET') {
    const { model } = await currentModel(env);
    return json(model, 200, { 'cache-control': 'public, max-age=60' });
  }

  if (path === '/api/stats' && method === 'GET') {
    const t = await env.DB.prepare('SELECT COUNT(*) AS completed, SUM(rating IS NOT NULL) AS rated, AVG(rating) AS avg_rating FROM sessions WHERE n >= 5').first();
    const { model } = await currentModel(env);
    return json({ ok: true, completed: t?.completed || 0, rated: t?.rated || 0, avgRating: t?.avg_rating ? Math.round(t.avg_rating * 100) / 100 : null, modelVersion: model.version }, 200, { 'cache-control': 'public, max-age=60' });
  }

  if (path === '/api/sessions' && method === 'POST') {
    let b; try { b = await readJson(req); } catch (e) { return err(e.message); }
    const id = str(b.id, 16);
    if (!id || !ID_RE.test(id)) return err('bad id');
    const w = vec(b.w, -1, 1), s = vec(b.s, 0, 1);
    if (!w || !s) return err('bad vectors');
    const parent = b.parent && ID_RE.test(String(b.parent)) ? String(b.parent) : null;
    const rec = {
      id, mode: b.mode === 'evolve' ? 'evolve' : 'fresh', parent, seed: Math.floor(num(b.seed, 0, 4294967295)),
      n: Math.floor(num(b.n, 0, 255)), ties: Math.floor(num(b.ties, 0, 255)), w: JSON.stringify(w), s: JSON.stringify(s),
      history: JSON.stringify(cleanHistory(b.history)), niceName: str(b.niceName, 120, ''), modelVersion: Math.floor(num(b.modelVersion, 0, 65535)),
      durationMs: Math.floor(num(b.durationMs, 0, 86400000)), device: str(b.device, 16, ''), lang: str(b.lang, 16, ''), ref: str(b.ref, 100, ''),
    };
    await env.DB.prepare(`INSERT INTO sessions (id, mode, parent_id, seed, n, ties, w, s, history, nice_name, model_version, duration_ms, device, lang, ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET n = excluded.n, ties = excluded.ties, w = excluded.w, s = excluded.s, history = excluded.history, nice_name = excluded.nice_name, duration_ms = excluded.duration_ms`)
      .bind(rec.id, rec.mode, rec.parent, rec.seed, rec.n, rec.ties, rec.w, rec.s, rec.history, rec.niceName, rec.modelVersion, rec.durationMs, rec.device, rec.lang, rec.ref).run();
    ctx.waitUntil(maybeRecompute(env).catch(() => {}));
    return json({ ok: true, id });
  }

  const ratingMatch = path.match(/^\/api\/sessions\/([a-z0-9]{6,16})\/rating$/);
  if (ratingMatch && method === 'POST') {
    let b; try { b = await readJson(req); } catch (e) { return err(e.message); }
    const stars = typeof b.stars === 'number' ? Math.round(b.stars) : 0;
    if (stars < 1 || stars > 5) return err('stars must be 1-5');
    const r = await env.DB.prepare('UPDATE sessions SET rating = ?, rated_at = ? WHERE id = ?').bind(stars, now(), ratingMatch[1]).run();
    if (!r.meta || !r.meta.changes) return err('unknown session', 404);
    ctx.waitUntil(maybeRecompute(env).catch(() => {}));
    return json({ ok: true });
  }

  if (path === '/api/events' && method === 'POST') {
    let b; try { b = await readJson(req); } catch (e) { return err(e.message); }
    const type = str(b.type, 32, '');
    if (!EVENT_TYPES.has(type)) return err('unknown event type');
    const session = b.session && ID_RE.test(String(b.session)) ? String(b.session) : null;
    const meta = {};
    for (const k of ['mode', 'parent', 'how']) if (typeof b[k] === 'string') meta[k] = b[k].slice(0, 40);
    await env.DB.prepare('INSERT INTO events (type, session_id, meta) VALUES (?, ?, ?)').bind(type, session, JSON.stringify(meta)).run();
    if (type === 'view_shared' && session) ctx.waitUntil(env.DB.prepare('UPDATE sessions SET share_views = share_views + 1 WHERE id = ?').bind(session).run().catch(() => {}));
    return json({ ok: true });
  }

  if (path.startsWith('/api/admin/')) {
    if (!env.ADMIN_TOKEN) return err('ADMIN_TOKEN is not configured on the Worker (wrangler secret put ADMIN_TOKEN)', 503);
    if (!isAdmin(req, env)) return err('unauthorized', 401);
    if (path === '/api/admin/stats' && method === 'GET') return json(await adminStats(env));
    if (path === '/api/admin/recompute' && method === 'POST') { const m = await recompute(env, 'manual'); return json({ ok: true, model: m }); }
    if (path === '/api/admin/sessions' && method === 'GET') {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)));
      const rows = (await env.DB.prepare('SELECT id, created_at, mode, parent_id, n, ties, w, s, nice_name, model_version, rating, rated_at, duration_ms, device, lang, ref, share_views FROM sessions ORDER BY created_at DESC LIMIT ?').bind(limit).all()).results;
      return json({ ok: true, sessions: rows });
    }
  }
  return err('not found', 404);
}

async function adminStats(env) {
  const DB = env.DB;
  const [totals, starts, byType, ratingDist, byDay, byVersion, recent, models, rowsForAxes] = await Promise.all([
    DB.prepare('SELECT COUNT(*) AS total, SUM(n >= 5) AS completed, SUM(rating IS NOT NULL) AS rated, AVG(rating) AS avg_rating, SUM(mode = \'evolve\') AS evolved, SUM(share_views) AS share_views, AVG(duration_ms) AS avg_duration, AVG(ties) AS avg_ties FROM sessions').first(),
    DB.prepare("SELECT COUNT(*) AS c FROM events WHERE type = 'start'").first(),
    DB.prepare('SELECT type, COUNT(*) AS c FROM events GROUP BY type').all(),
    DB.prepare('SELECT rating, COUNT(*) AS c FROM sessions WHERE rating IS NOT NULL GROUP BY rating ORDER BY rating').all(),
    DB.prepare("SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c, SUM(rating IS NOT NULL) AS rated, AVG(rating) AS r FROM sessions WHERE created_at >= datetime('now', '-30 days') GROUP BY d ORDER BY d").all(),
    DB.prepare('SELECT model_version AS v, COUNT(*) AS c, SUM(rating IS NOT NULL) AS rated, AVG(rating) AS r, SUM(rating >= 4) AS good FROM sessions GROUP BY model_version ORDER BY model_version').all(),
    DB.prepare('SELECT id, created_at, mode, parent_id, n, ties, rating, nice_name, model_version, device, duration_ms, share_views FROM sessions ORDER BY created_at DESC LIMIT 40').all(),
    DB.prepare('SELECT version, created_at, n_sessions, n_rated, json FROM model ORDER BY version').all(),
    DB.prepare('SELECT w, s, rating, history FROM sessions WHERE n >= 5 ORDER BY created_at DESC LIMIT 800').all(),
  ]);
  const startsByDay = (await DB.prepare("SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c FROM events WHERE type = 'start' AND created_at >= datetime('now', '-30 days') GROUP BY d ORDER BY d").all()).results;

  // axis + archetype stats computed in JS from recent sessions
  const rows = rowsForAxes.results || [];
  const axes = AXES.map((a, i) => {
    let asked = 0, sum = 0, sumAbs = 0, hi = 0;
    for (const r of rows) {
      let w, s; try { w = JSON.parse(r.w); s = JSON.parse(r.s); } catch { continue; }
      if (s[i] < 0.7) { asked++; sum += w[i]; sumAbs += Math.abs(w[i]); if (w[i] > 0) hi++; }
    }
    return { id: a.id, lo: a.lo, hi: a.hi, asked, askedShare: rows.length ? asked / rows.length : 0, mean: asked ? sum / asked : 0, meanAbs: asked ? sumAbs / asked : 0, hiShare: asked ? hi / asked : 0.5 };
  });
  const arch = Object.fromEntries(ARCHETYPES.map((a) => [a, { sessions: 0, rated: 0, sumRating: 0, good: 0 }]));
  for (const r of rows) {
    let h; try { h = r.history ? JSON.parse(r.history) : []; } catch { continue; }
    const used = new Set(h.map((e) => e.archetype).filter(Boolean));
    for (const a of used) { if (!arch[a]) continue; arch[a].sessions++; if (typeof r.rating === 'number') { arch[a].rated++; arch[a].sumRating += r.rating; if (r.rating >= 4) arch[a].good++; } }
  }
  const archetypes = Object.entries(arch).map(([id, v]) => ({ id, ...v, avgRating: v.rated ? v.sumRating / v.rated : null }));
  const modelRows = (models.results || []).map((m) => { let j = {}; try { j = JSON.parse(m.json); } catch { /* ignore */ } return { version: m.version, createdAt: m.created_at, nSessions: m.n_sessions, nRated: m.n_rated, reason: j.reason || '', explore: j.explore, priorWeight: j.prior?.weight }; });
  const { model } = await currentModel(env);
  return {
    ok: true, generatedAt: now(),
    totals: { ...totals, starts: starts?.c || 0 },
    events: Object.fromEntries((byType.results || []).map((r) => [r.type, r.c])),
    ratingDist: Object.fromEntries((ratingDist.results || []).map((r) => [r.rating, r.c])),
    byDay: byDay.results || [], startsByDay: startsByDay || [], byVersion: byVersion.results || [], recent: recent.results || [],
    models: modelRows, axes, archetypes, model, sampleSize: rows.length,
  };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      const cors = corsHeaders(env, req);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      try {
        const res = await handleApi(req, env, ctx, url);
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(cors)) headers.set(k, v);
        return new Response(res.body, { status: res.status, headers });
      } catch (e) {
        const msg = String(e && e.message || e);
        const hint = /no such table/i.test(msg) ? ' — run the D1 migration (npm run migrate)' : '';
        return json({ ok: false, error: 'server error: ' + msg + hint }, 500, cors);
      }
    }
    // everything else: the static site, if this Worker is configured to serve it
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response('make it nice API. Site is hosted elsewhere; see /api/health', { status: 200, headers: { 'content-type': 'text/plain' } });
  },
};

// Integration test against a running Worker (default: wrangler dev on 127.0.0.1:8787).
//   npm run migrate:local && npm run dev   (in worker/)   then   node --test tests/api.test.mjs
// Set API_BASE to test a deployed Worker, ADMIN_TOKEN to exercise the admin endpoints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AXES, ROUNDS_PER_PASS, newProfile, applyChoice, planProbe, niceName, rng, defaultModel, shortId } from '../site/engine.js';

const BASE = (process.env.API_BASE || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const ADMIN = process.env.ADMIN_TOKEN || 'devtoken123';
const j = async (path, opts = {}) => {
  const res = await fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, headers: res.headers };
};

function simulateSession(seed, model, rating) {
  const truth = AXES.map((_, i) => Math.sin(seed * 7 + i));
  let p = newProfile(model);
  const r = rng(seed);
  for (let round = 0; round < ROUNDS_PER_PASS; round++) {
    const pair = planProbe(p, model, seed, round);
    const score = (smp) => smp.x.reduce((a, v, i) => a + v * truth[i], 0) + r.range(-0.2, 0.2);
    p = applyChoice(p, pair, score(pair.A) > score(pair.B) ? 'A' : 'B', model);
  }
  return {
    payload: { id: p.id, parent: null, mode: 'fresh', seed, n: p.n, ties: p.ties, w: p.w, s: p.s, history: p.history, niceName: niceName(p), modelVersion: model.version, durationMs: 40000 + seed * 100, device: 'desktop', lang: 'en-US', ref: '' },
    rating,
  };
}

test('health + model + cors', async () => {
  const h = await j('/api/health');
  assert.equal(h.status, 200); assert.equal(h.body.ok, true);
  const m = await j('/api/model', { headers: { origin: 'https://example.com' } });
  assert.equal(m.status, 200);
  assert.ok(m.body.axisValue && m.body.prior);
  assert.equal(m.headers.get('access-control-allow-origin'), '*');
  const pre = await fetch(BASE + '/api/sessions', { method: 'OPTIONS', headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
});

test('rejects garbage', async () => {
  assert.equal((await j('/api/sessions', { method: 'POST', body: JSON.stringify({ id: 'x' }) })).status, 400);
  assert.equal((await j('/api/sessions', { method: 'POST', body: JSON.stringify({ id: 'abcdefgh', w: [1, 2], s: [] }) })).status, 400);
  assert.equal((await j('/api/sessions/abcdefgh/rating', { method: 'POST', body: JSON.stringify({ stars: 9 }) })).status, 400);
  assert.equal((await j('/api/sessions/zzzzzzzz/rating', { method: 'POST', body: JSON.stringify({ stars: 4 }) })).status, 404);
  assert.equal((await j('/api/events', { method: 'POST', body: JSON.stringify({ type: 'hack' }) })).status, 400);
  assert.equal((await j('/api/nope')).status, 404);
  assert.equal((await j('/api/admin/stats')).status, 401);
  assert.equal((await j('/api/admin/stats', { headers: { authorization: 'Bearer wrong' } })).status, 401);
});

test('sessions, ratings, events flow; model evolves; admin stats', async () => {
  const model0 = (await j('/api/model')).body;
  const ids = [];
  for (let seed = 1; seed <= 24; seed++) {
    const { payload, rating } = simulateSession(seed, defaultModel(), seed % 6 === 0 ? 2 : 5);
    await j('/api/events', { method: 'POST', body: JSON.stringify({ type: 'start', mode: 'fresh' }) });
    const r = await j('/api/sessions', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    ids.push(payload.id);
    const rr = await j(`/api/sessions/${payload.id}/rating`, { method: 'POST', body: JSON.stringify({ stars: rating }) });
    assert.equal(rr.status, 200, JSON.stringify(rr.body));
  }
  // idempotent re-post of the same session
  const { payload } = simulateSession(1, defaultModel(), 5);
  assert.equal((await j('/api/sessions', { method: 'POST', body: JSON.stringify(payload) })).status, 200);
  // shared view increments share_views
  const ev = await j('/api/events', { method: 'POST', body: JSON.stringify({ type: 'view_shared', session: ids[0] }) });
  assert.equal(ev.status, 200);
  await new Promise((r) => setTimeout(r, 1500)); // let waitUntil recompute run

  const stats = await j('/api/stats');
  assert.equal(stats.status, 200);
  assert.ok(stats.body.completed >= 24);
  const model1 = (await j('/api/model')).body;
  assert.ok(model1.version > model0.version, `model should have evolved: ${model0.version} -> ${model1.version}`);
  assert.ok(model1.nSessions >= 24);

  const admin = await j('/api/admin/stats', { headers: { authorization: `Bearer ${ADMIN}` } });
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  const b = admin.body;
  assert.ok(b.totals.completed >= 24 && b.totals.rated >= 24);
  assert.ok(b.totals.starts >= 24);
  assert.ok(b.ratingDist['5'] >= 15);
  assert.ok(Array.isArray(b.byVersion) && b.byVersion.length >= 1);
  assert.equal(b.axes.length, AXES.length);
  assert.ok(b.archetypes.length === 5);
  assert.ok(b.recent.length >= 24);
  assert.ok(b.recent.some((s) => s.id === ids[0] && s.share_views >= 1));
  assert.ok(b.models.length >= 1);

  const rc = await j('/api/admin/recompute', { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` }, body: '{}' });
  assert.equal(rc.status, 200);
  assert.equal(rc.body.model.version, model1.version + 1);
  const list = await j('/api/admin/sessions?limit=5', { headers: { authorization: `Bearer ${ADMIN}` } });
  assert.equal(list.body.sessions.length, 5);
});

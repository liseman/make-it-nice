import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AXES, N, AXIS_INDEX, ROUNDS_PER_PASS, defaultModel, normalizeModel, newProfile, evolveProfile,
  applyChoice, planProbe, encodeProfile, decodeProfile, niceName, describeProfile, aiPrompt,
  recomputeModel, rng, hashString,
} from '../site/engine.js';

// simulate a person with a hidden taste vector answering probes
function simulate(truth, seed, rounds = ROUNDS_PER_PASS, model = defaultModel(), start = null) {
  let p = start || newProfile(model);
  const r = rng(seed);
  for (let round = 0; round < rounds; round++) {
    const pair = planProbe(p, model, seed, round);
    const score = (smp) => smp.x.reduce((a, v, i) => a + v * truth[i], 0) + r.range(-0.15, 0.15);
    const pick = score(pair.A) > score(pair.B) ? 'A' : 'B';
    p = applyChoice(p, pair, pick, model);
  }
  return p;
}

test('rng is deterministic', () => {
  const a = rng(42), b = rng(42);
  assert.equal(a(), b()); assert.equal(a(), b());
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});

test('new profile starts uncertain', () => {
  const p = newProfile();
  assert.equal(p.w.length, N); assert.equal(p.s.length, N);
  assert.ok(p.s.every((s) => s === 1)); assert.equal(p.n, 0);
});

test('10 rounds recover a strong hidden taste in direction', () => {
  const truth = AXES.map((_, i) => (i % 2 ? 0.9 : -0.9));
  let agree = 0, tested = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const p = simulate(truth, seed);
    assert.equal(p.n, 10);
    p.w.forEach((w, i) => { if (p.s[i] < 0.7) { tested++; if (Math.sign(w) === Math.sign(truth[i])) agree++; } });
  }
  assert.ok(tested >= 20 * 7, `should test at least 7 axes per pass, tested ${tested / 20}`);
  assert.ok(agree / tested > 0.9, `direction agreement ${agree / tested}`);
});

test('probe plan covers distinct axes first, then refines', () => {
  const model = defaultModel();
  let p = newProfile(model);
  const seen = new Set();
  for (let round = 0; round < 7; round++) {
    const pair = planProbe(p, model, 123, round);
    assert.equal(pair.kind, 'single');
    assert.ok(!seen.has(pair.axis), `axis ${pair.axis} repeated in early rounds`);
    seen.add(pair.axis);
    // A and B differ only on the probed axis
    const ai = AXIS_INDEX[pair.axis];
    pair.A.x.forEach((v, i) => { if (i !== ai) assert.equal(v, pair.B.x[i]); });
    assert.equal(Math.abs(pair.A.x[ai] - pair.B.x[ai]), 2);
    p = applyChoice(p, pair, 'A', model);
  }
  const kinds = new Set();
  for (let round = 7; round < 10; round++) { const pair = planProbe(p, model, 123, round); kinds.add(pair.kind); p = applyChoice(p, pair, 'B', model); }
  assert.ok([...kinds].every((k) => ['single', 'intensity', 'tradeoff'].includes(k)));
});

test('ties soften rather than move', () => {
  const model = defaultModel();
  let p = newProfile(model);
  const pair = planProbe(p, model, 5, 0);
  const q = applyChoice(p, pair, 'tie', model);
  assert.equal(q.n, 0); assert.equal(q.ties, 1);
  const ai = AXIS_INDEX[pair.axis];
  assert.ok(q.s[ai] < 1 && q.s[ai] > 0.5);
});

test('share code round-trips', () => {
  const truth = AXES.map((_, i) => Math.sin(i));
  const p = simulate(truth, 7);
  const code = encodeProfile(p);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const q = decodeProfile(code);
  assert.ok(q);
  assert.equal(q.n, p.n); assert.equal(q.id, p.id);
  q.w.forEach((w, i) => assert.ok(Math.abs(w - p.w[i]) < 0.01));
  q.s.forEach((s, i) => assert.ok(Math.abs(s - p.s[i]) < 0.01));
  assert.equal(decodeProfile('garbage!!'), null);
  const e = evolveProfile(p); e.n = 20;
  const q2 = decodeProfile(encodeProfile(e));
  assert.equal(q2.parent, p.id);
});

test('names, descriptions and prompts are produced for random profiles', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const r = rng(seed);
    const truth = AXES.map(() => r.range(-1, 1));
    const p = simulate(truth, seed);
    const name = niceName(p);
    assert.ok(name.length > 3, name);
    const d = describeProfile(p);
    assert.ok(d.paras.length >= 1);
    const prompt = aiPrompt(p, { url: 'https://example.com/#/result/abc' });
    assert.ok(prompt.includes('MY TASTE'));
    assert.ok(prompt.includes('machine-readable'));
    assert.ok(prompt.includes(`${p.n} pairwise choices`));
  }
  assert.equal(niceName(newProfile()), 'hard to pin down');
});

test('evolve keeps knowledge and adds 10 more choices', () => {
  const truth = AXES.map((_, i) => (i < 6 ? 0.8 : -0.8));
  const p = simulate(truth, 11);
  const e = evolveProfile(p);
  assert.equal(e.parent, p.id); assert.notEqual(e.id, p.id);
  const p2 = simulate(truth, 12, ROUNDS_PER_PASS, defaultModel(), e);
  assert.equal(p2.n, 20);
  const tested = p2.s.filter((s) => s < 0.7).length;
  assert.ok(tested >= 10, `tested ${tested} axes after two passes`);
});

test('model recompute learns a population prior and stays sane', () => {
  const sessions = [];
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed * 99);
    // population: everyone likes warm (+temp) and airy (-density); rest random
    const truth = AXES.map((a) => (a.id === 'temp' ? 0.9 : a.id === 'density' ? -0.9 : r.range(-1, 1)));
    const p = simulate(truth, seed);
    sessions.push({ profile: p, rating: seed % 5 === 0 ? 2 : 5, history: p.history, modelVersion: 0 });
  }
  const m = recomputeModel(sessions, defaultModel());
  assert.equal(m.version, 1);
  assert.ok(m.prior.mean.temp > 0.3, `prior temp ${m.prior.mean.temp}`);
  assert.ok(m.prior.mean.density < -0.3, `prior density ${m.prior.mean.density}`);
  for (const a of AXES) assert.ok(m.axisValue[a.id] >= 0.2 && m.axisValue[a.id] <= 2.5);
  for (const k of Object.keys(m.archetypeWeight)) assert.ok(m.archetypeWeight[k] >= 0.3 && m.archetypeWeight[k] <= 2);
  // a fresh profile under the new model starts leaning the population way
  const np = newProfile(m);
  assert.ok(np.w[AXIS_INDEX.temp] > 0);
  // axes everyone agrees on are less valuable to ask about than contested ones
  assert.ok(m.axisValue.temp < m.axisValue.mood, `temp ${m.axisValue.temp} vs mood ${m.axisValue.mood}`);
  // too few sessions keeps previous params
  const m2 = recomputeModel(sessions.slice(0, 3), m);
  assert.equal(m2.version, 2); assert.deepEqual(m2.axisValue, m.axisValue);
  assert.ok(normalizeModel({ explore: 99 }).explore <= 0.5);
});

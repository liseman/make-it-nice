// make it nice — taste engine
// Shared by the site (browser, ES module) and the Cloudflare Worker (bundled).
// No dependencies. Everything here is deterministic given a seed.

export const ENGINE_VERSION = 1;
export const ROUNDS_PER_PASS = 10;

// Each axis runs from -1 (lo) to +1 (hi). A person's profile is a vector w on these axes
// plus a per-axis uncertainty s (1 = we know nothing, 0 = certain).
export const AXES = [
  { id: 'temp',     group: 'color',  lo: 'cool',        hi: 'warm',           loAdj: 'cool',          hiAdj: 'warm',           loPhrase: 'cool colors',                 hiPhrase: 'warm colors' },
  { id: 'sat',      group: 'color',  lo: 'muted',       hi: 'saturated',      loAdj: 'muted',         hiAdj: 'vivid',          loPhrase: 'muted, dusty color',           hiPhrase: 'saturated, punchy color' },
  { id: 'light',    group: 'color',  lo: 'dark',        hi: 'light',          loAdj: 'dark',          hiAdj: 'light',          loPhrase: 'dark backgrounds',             hiPhrase: 'light backgrounds' },
  { id: 'contrast', group: 'color',  lo: 'soft',        hi: 'high-contrast',  loAdj: 'soft',          hiAdj: 'high-contrast',  loPhrase: 'gentle, low contrast',         hiPhrase: 'hard, high contrast' },
  { id: 'ornament', group: 'form',   lo: 'minimal',     hi: 'ornate',         loAdj: 'minimal',       hiAdj: 'ornate',         loPhrase: 'almost no decoration',         hiPhrase: 'borders, flourishes and pattern',   loNoun: 'minimalism', hiNoun: 'maximalism' },
  { id: 'corner',   group: 'form',   lo: 'sharp',       hi: 'rounded',        loAdj: 'sharp',         hiAdj: 'rounded',        loPhrase: 'crisp, square edges',          hiPhrase: 'soft, rounded edges' },
  { id: 'form',     group: 'form',   lo: 'geometric',   hi: 'organic',        loAdj: 'geometric',     hiAdj: 'organic',        loPhrase: 'geometric shapes on a grid',   hiPhrase: 'organic, hand-drawn shapes',        loNoun: 'modernism',  hiNoun: 'naturalism' },
  { id: 'depth',    group: 'form',   lo: 'flat',        hi: 'dimensional',    loAdj: 'flat',          hiAdj: 'dimensional',    loPhrase: 'flat color, no shadows',       hiPhrase: 'depth, shadow and gradients' },
  { id: 'serif',    group: 'type',   lo: 'sans',        hi: 'serif',          loAdj: 'sans-serif',    hiAdj: 'serif',          loPhrase: 'clean modern sans-serif type', hiPhrase: 'classic serif type' },
  { id: 'density',  group: 'type',   lo: 'airy',        hi: 'dense',          loAdj: 'airy',          hiAdj: 'dense',          loPhrase: 'lots of breathing room',       hiPhrase: 'packed, information-dense layouts' },
  { id: 'symmetry', group: 'type',   lo: 'asymmetric',  hi: 'symmetric',      loAdj: 'asymmetric',    hiAdj: 'symmetric',      loPhrase: 'off-center, editorial balance', hiPhrase: 'centered, symmetric balance' },
  { id: 'mood',     group: 'mood',   lo: 'serious',     hi: 'playful',        loAdj: 'serious',       hiAdj: 'playful',        loPhrase: 'calm, serious tone',           hiPhrase: 'playful, energetic tone',           loNoun: 'restraint',  hiNoun: 'whimsy' },
];
export const N = AXES.length;
export const AXIS_INDEX = Object.fromEntries(AXES.map((a, i) => [a.id, i]));

export const ARCHETYPES = ['poster', 'card', 'pattern', 'hero', 'specimen'];

// ---------- small utilities ----------
export const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
export const round2 = (v) => Math.round(v * 100) / 100;

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// mulberry32 — tiny seeded PRNG
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.range = (lo, hi) => lo + next() * (hi - lo);
  return next;
}

export function randomSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const u = new Uint32Array(1); crypto.getRandomValues(u); return u[0] >>> 0;
  }
  return (Math.random() * 4294967296) >>> 0;
}

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function shortId(len = 8) {
  let out = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const u = new Uint8Array(len); crypto.getRandomValues(u);
    for (let i = 0; i < len; i++) out += ID_ALPHABET[u[i] % ID_ALPHABET.length];
  } else {
    for (let i = 0; i < len; i++) out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return out;
}

// ---------- the global model (what evolves across users) ----------
// axisValue: how much asking about an axis has paid off (drives which axes get probed first)
// prior: population mean per axis, and how much to trust it as a starting point
// archetypeWeight: which sample renderers produce results people rate well
export function defaultModel() {
  return {
    version: 0,
    engine: ENGINE_VERSION,
    createdAt: null,
    nSessions: 0,
    nRated: 0,
    axisValue: Object.fromEntries(AXES.map((a) => [a.id, 1])),
    prior: { mean: Object.fromEntries(AXES.map((a) => [a.id, 0])), weight: 0.15 },
    archetypeWeight: Object.fromEntries(ARCHETYPES.map((a) => [a, 1])),
    explore: 0.15,
    // learning-rate knobs the recompute can nudge
    lr: 0.5,
    shrink: 0.55,
  };
}

export function normalizeModel(m) {
  const d = defaultModel();
  if (!m || typeof m !== 'object') return d;
  const out = { ...d, ...m };
  out.axisValue = { ...d.axisValue, ...(m.axisValue || {}) };
  out.prior = { mean: { ...d.prior.mean, ...((m.prior && m.prior.mean) || {}) }, weight: (m.prior && typeof m.prior.weight === 'number') ? clamp(m.prior.weight, 0, 0.6) : d.prior.weight };
  out.archetypeWeight = { ...d.archetypeWeight, ...(m.archetypeWeight || {}) };
  out.explore = typeof m.explore === 'number' ? clamp(m.explore, 0.02, 0.5) : d.explore;
  out.lr = typeof m.lr === 'number' ? clamp(m.lr, 0.2, 0.8) : d.lr;
  out.shrink = typeof m.shrink === 'number' ? clamp(m.shrink, 0.3, 0.8) : d.shrink;
  return out;
}

// ---------- profiles ----------
export function newProfile(model = defaultModel()) {
  const m = normalizeModel(model);
  return {
    v: ENGINE_VERSION,
    id: shortId(),
    w: AXES.map((a) => clamp(m.prior.mean[a.id] * m.prior.weight)),
    s: AXES.map(() => 1),
    n: 0,           // decisive choices so far
    ties: 0,
    history: [],    // [{axis, kind, pick:'A'|'B'|'tie', d:[...]}]
    parent: null,
    modelVersion: m.version,
  };
}

// Start an "evolve" pass from an existing profile: keep what we know, loosen it a little.
export function evolveProfile(prev) {
  return {
    ...prev,
    id: shortId(),
    parent: prev.id,
    s: prev.s.map((s) => clamp(Math.max(s, 0.18) * 1.15, 0.05, 1)),
    history: [],
  };
}

export function applyChoice(profile, pair, pick, model = defaultModel()) {
  const m = normalizeModel(model);
  const p = { ...profile, w: profile.w.slice(), s: profile.s.slice(), history: profile.history.slice() };
  const entry = { axis: pair.axis, kind: pair.kind, pick, archetype: pair.archetype };
  if (pick === 'tie') {
    // A tie on an isolating probe is information too: this axis doesn't move them much.
    const d = pair.A.x.map((v, i) => v - pair.B.x[i]);
    d.forEach((di, i) => { const e = Math.abs(di) / 2; if (e > 0.05) { p.w[i] = p.w[i] * (1 - 0.35 * e); p.s[i] = clamp(p.s[i] * (1 - 0.25 * e), 0.05, 1); } });
    p.ties += 1;
  } else {
    const chosen = pick === 'A' ? pair.A : pair.B;
    const other = pick === 'A' ? pair.B : pair.A;
    const d = chosen.x.map((v, i) => v - other.x[i]);
    if (typeof pair.axis === 'string') {
      const ai = AXIS_INDEX[pair.axis];
      if (ai !== undefined) entry.dir = d[ai] >= 0 ? 'hi' : 'lo';
    }
    d.forEach((di, i) => {
      const e = di / 2; // -1..1
      if (Math.abs(e) < 0.02) return;
      p.w[i] = clamp(p.w[i] + m.lr * p.s[i] * e);
      p.s[i] = clamp(p.s[i] * (1 - m.shrink * Math.abs(e)), 0.05, 1);
    });
    p.n += 1;
  }
  p.history.push(entry);
  return p;
}

export function strength(profile) {
  return profile.w.map((w, i) => Math.abs(w) * Math.sqrt(1 - profile.s[i]));
}

// ---------- probe planning (which pair to show next) ----------
// kind: 'single'    — identical designs, one axis pushed to opposite extremes
//       'intensity' — same side of an axis, mild vs extreme (how much do you want this?)
//       'tradeoff'  — two axes traded against each other (which matters more?)
export function planProbe(profile, model, seed, round, opts = {}) {
  const m = normalizeModel(model);
  const r = rng(hashString(`probe:${seed}:${round}`));
  const hist = profile.history;
  const lastArch = hist.length ? hist[hist.length - 1].archetype : null;
  const probedCount = (i) => hist.filter((h) => h.axis === AXES[i].id || (Array.isArray(h.axis) && h.axis.includes(AXES[i].id))).length;

  // score axes: uncertain + valuable + a little exploration noise
  const scores = AXES.map((a, i) => ({ i, score: (profile.s[i] ** 2) * (m.axisValue[a.id] ?? 1) * (1 + r() * m.explore * 2) }));
  scores.sort((x, y) => y.score - x.score);

  let kind = 'single';
  const strong = strength(profile);
  const unprobed = scores.filter((o) => profile.s[o.i] > 0.6);
  const inPassRound = round % ROUNDS_PER_PASS; // 0..9

  if (opts.kind) kind = opts.kind;
  else if (unprobed.length && inPassRound < 7) kind = 'single';
  else if (inPassRound === 9 || (inPassRound >= 7 && r() < 0.4)) kind = 'tradeoff';
  else if (inPassRound >= 7) kind = 'intensity';
  // guards
  const knownAxes = AXES.map((_, i) => i).filter((i) => profile.s[i] < 0.6 && Math.abs(profile.w[i]) > 0.25);
  if (kind === 'tradeoff' && knownAxes.length < 2) kind = knownAxes.length ? 'intensity' : 'single';
  if (kind === 'intensity' && !knownAxes.length) kind = 'single';

  // choose archetype: weighted, avoid immediate repeats
  const archPool = ARCHETYPES.filter((a) => a !== lastArch);
  const weights = archPool.map((a) => Math.max(0.05, m.archetypeWeight[a] ?? 1) * (1 + r() * m.explore * 3));
  let pickIdx = 0, acc = 0; const total = weights.reduce((a, b) => a + b, 0); const t = r() * total;
  for (let i = 0; i < weights.length; i++) { acc += weights[i]; if (t <= acc) { pickIdx = i; break; } }
  const archetype = archPool[pickIdx];

  // shared jitter on axes we know little about, so samples aren't all bland (identical in A and B)
  const base = profile.w.map((w, i) => (profile.s[i] > 0.5 ? clamp(w + r.range(-0.35, 0.35)) : w));
  const xA = base.slice(), xB = base.slice();
  let axis;

  if (kind === 'single') {
    const i = unprobed.length ? unprobed[0].i : scores[0].i;
    axis = AXES[i].id;
    xA[i] = 1; xB[i] = -1;
  } else if (kind === 'intensity') {
    // most-preferred axis whose magnitude we haven't pinned down yet
    const cands = knownAxes.slice().sort((a, b) => (profile.s[b] * strong[b]) - (profile.s[a] * strong[a]));
    const i = cands[0];
    axis = AXES[i].id;
    const sign = Math.sign(profile.w[i]) || 1;
    xA[i] = sign * 1.0; xB[i] = sign * 0.3;
  } else {
    const cands = knownAxes.slice().sort((a, b) => strong[b] - strong[a]);
    const i = cands[0], j = cands[1];
    axis = [AXES[i].id, AXES[j].id];
    const si = Math.sign(profile.w[i]) || 1, sj = Math.sign(profile.w[j]) || 1;
    // A keeps your first love, gives up the second; B the reverse
    xA[i] = si * 0.9; xA[j] = -sj * 0.6;
    xB[i] = -si * 0.6; xB[j] = sj * 0.9;
  }

  const flip = r() < 0.5; // randomize left/right
  const sampleSeed = hashString(`sample:${seed}:${round}`);
  const A = { x: flip ? xB : xA, seed: sampleSeed };
  const B = { x: flip ? xA : xB, seed: sampleSeed };
  return { round, kind, axis, archetype, A, B, seed: sampleSeed };
}

// ---------- encode / decode share codes ----------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b === undefined ? '' : B64[(n >> 6) & 63]) + (c === undefined ? '' : B64[n & 63]);
  }
  return s;
}
function fromB64url(s) {
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch); if (v < 0) continue;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
  }
  return out;
}

export function encodeProfile(p) {
  const bytes = [ENGINE_VERSION, Math.min(255, p.n), Math.min(255, p.ties)];
  for (const w of p.w) bytes.push((Math.round(clamp(w) * 127) + 128) & 255);
  for (const s of p.s) bytes.push(Math.round(clamp(s, 0, 1) * 255) & 255);
  const id = (p.id || '').slice(0, 8).padEnd(8, 'a');
  for (const ch of id) bytes.push(ch.charCodeAt(0) & 255);
  const parent = (p.parent || '').slice(0, 8).padEnd(8, '\0');
  for (const ch of parent) bytes.push(ch.charCodeAt(0) & 255);
  bytes.push((p.modelVersion || 0) & 255, ((p.modelVersion || 0) >> 8) & 255);
  return toB64url(bytes);
}

export function decodeProfile(code) {
  try {
    const b = fromB64url(code);
    if (b.length < 3 + N * 2 + 8) return null;
    if (b[0] !== ENGINE_VERSION) return null;
    let k = 3;
    const w = []; for (let i = 0; i < N; i++) w.push(clamp((b[k++] - 128) / 127));
    const s = []; for (let i = 0; i < N; i++) s.push(clamp(b[k++] / 255, 0.05, 1));
    let id = ''; for (let i = 0; i < 8; i++) id += String.fromCharCode(b[k++]);
    let parent = ''; for (let i = 0; i < 8 && k < b.length; i++) parent += String.fromCharCode(b[k++]);
    parent = parent.replace(/\0+$/, '');
    const modelVersion = k + 1 < b.length ? b[k] | (b[k + 1] << 8) : 0;
    return { v: ENGINE_VERSION, id, w, s, n: b[1], ties: b[2], history: [], parent: parent || null, modelVersion };
  } catch { return null; }
}

// ---------- words ----------
const CONF_WORDS = [[0.6, 'strongly'], [0.35, 'clearly'], [0.15, 'slightly'], [0, 'barely']];
export function confidenceWord(st) { return CONF_WORDS.find(([t]) => st >= t)[1]; }

export function rankedAxes(profile) {
  const st = strength(profile);
  return AXES.map((a, i) => ({ axis: a, i, w: profile.w[i], s: profile.s[i], st: st[i], side: profile.w[i] >= 0 ? 'hi' : 'lo' }))
    .sort((a, b) => b.st - a.st);
}

// "warm, airy minimalism with soft edges"
export function niceName(profile) {
  const ranked = rankedAxes(profile).filter((r) => r.st > 0.12);
  if (!ranked.length) return 'hard to pin down';
  const adj = (r) => (r.side === 'hi' ? r.axis.hiAdj : r.axis.loAdj);
  const phrase = (r) => (r.side === 'hi' ? r.axis.hiPhrase : r.axis.loPhrase);
  const nounR = ranked.find((r) => (r.side === 'hi' ? r.axis.hiNoun : r.axis.loNoun));
  const noun = nounR ? (nounR.side === 'hi' ? nounR.axis.hiNoun : nounR.axis.loNoun) : 'style';
  const rest = ranked.filter((r) => r !== nounR);
  if (rest.length === 0) return noun;
  if (rest.length === 1) return `${adj(rest[0])} ${noun}`;
  if (rest.length === 2) return `${adj(rest[0])}, ${adj(rest[1])} ${noun}`;
  return `${adj(rest[0])}, ${adj(rest[1])} ${noun} with ${phrase(rest[2])}`;
}

export function describeProfile(profile) {
  const ranked = rankedAxes(profile);
  const groups = { color: [], form: [], type: [], mood: [] };
  for (const r of ranked) groups[r.axis.group].push(r);
  const sentence = (r) => {
    const cw = confidenceWord(r.st);
    const p = r.side === 'hi' ? r.axis.hiPhrase : r.axis.loPhrase;
    const q = r.side === 'hi' ? r.axis.loPhrase : r.axis.hiPhrase;
    if (r.s > 0.75) return null; // never really asked
    if (r.st < 0.1) return `${r.axis.lo} vs ${r.axis.hi} doesn't seem to move you much`;
    return `you ${cw} prefer ${p} over ${q}`;
  };
  const paras = [];
  const titles = { color: 'Color', form: 'Shape & form', type: 'Type & layout', mood: 'Mood' };
  for (const g of Object.keys(groups)) {
    const parts = groups[g].map(sentence).filter(Boolean);
    if (!parts.length) continue;
    let text = parts.join('; ');
    text = text.charAt(0).toUpperCase() + text.slice(1) + '.';
    paras.push({ title: titles[g], text });
  }
  const unasked = ranked.filter((r) => r.s > 0.75).map((r) => `${r.axis.lo}/${r.axis.hi}`);
  return { paras, unasked, strongest: ranked.slice(0, 3) };
}

// Concrete tokens an AI (or a stylesheet) can act on, derived from the vector.
export function tokensFromVector(x) {
  const g = (id) => x[AXIS_INDEX[id]];
  const temp = g('temp'), sat = g('sat'), light = g('light'), contrast = g('contrast');
  const hue = temp >= 0 ? Math.round(30 - temp * 18) : Math.round(215 + (-temp) * 30); // warm: 12..30, cool: 215..245
  const satPct = Math.round(45 + sat * 40);          // 5..85
  const bgL = light >= 0 ? Math.round(93 + light * 5) : Math.round(18 - (-light) * 10); // 88..98 or 8..18
  const radius = Math.round(2 + (g('corner') + 1) * 11); // 2..24
  const fonts = g('serif') >= 0
    ? { heading: 'Fraunces, "Iowan Old Style", Georgia, serif', body: '"Source Serif 4", Georgia, serif' }
    : { heading: '"Space Grotesk", Inter, Helvetica, Arial, sans-serif', body: 'Inter, Helvetica, Arial, sans-serif' };
  return {
    hue, saturation: satPct, backgroundLightness: bgL, dark: light < 0,
    contrast: contrast >= 0 ? 'high' : 'soft',
    radius, fonts,
    ornament: g('ornament') >= 0.2 ? 'ornate' : g('ornament') <= -0.2 ? 'minimal' : 'moderate',
    density: g('density') >= 0.2 ? 'dense' : g('density') <= -0.2 ? 'airy' : 'balanced',
    form: g('form') >= 0 ? 'organic' : 'geometric',
    depth: g('depth') >= 0.2 ? 'shadows and gradients' : g('depth') <= -0.2 ? 'flat' : 'subtle depth',
    mood: g('mood') >= 0.2 ? 'playful' : g('mood') <= -0.2 ? 'serious' : 'neutral',
    symmetry: g('symmetry') >= 0 ? 'centered' : 'asymmetric',
  };
}

export function aiPrompt(profile, opts = {}) {
  const name = niceName(profile);
  const desc = describeProfile(profile);
  const t = tokensFromVector(profile.w);
  const ranked = rankedAxes(profile);
  const lines = desc.paras.map((p) => `- ${p.title}: ${p.text}`);
  const avoid = ranked.filter((r) => r.st > 0.3).slice(0, 4).map((r) => (r.side === 'hi' ? r.axis.loPhrase : r.axis.hiPhrase));
  const vec = AXES.map((a, i) => `${a.id}:${profile.w[i] >= 0 ? '+' : ''}${profile.w[i].toFixed(2)}`).join(' ');
  const imageWords = ranked.filter((r) => r.st > 0.2).slice(0, 5).map((r) => (r.side === 'hi' ? r.axis.hiAdj : r.axis.loAdj));
  const url = opts.url ? `\nProfile link: ${opts.url}` : '';
  return `Please save this to memory as my visual taste profile, and apply it by default whenever you make anything I'll look at: web pages, apps, slides, documents, charts, diagrams, images, generated art, logos.

MY TASTE — "${name}" (make it nice, from ${profile.n} pairwise choices)
${lines.join('\n')}${desc.unasked.length ? `\n- Not yet tested: ${desc.unasked.join(', ')} — use your judgment there.` : ''}

CONCRETE DEFAULTS
- Palette: hues around ${t.hue}° (${t.hue < 90 ? 'warm' : 'cool'}), saturation about ${t.saturation}%, ${t.dark ? 'dark' : 'light'} backgrounds (~${t.backgroundLightness}% lightness), ${t.contrast} contrast.
- Type: headings in ${t.fonts.heading.split(',')[0].replace(/"/g, '')}-like faces, body in ${t.fonts.body.split(',')[0].replace(/"/g, '')}-like faces. ${t.density === 'airy' ? 'Generous line-height and margins.' : t.density === 'dense' ? 'Tight spacing, more on screen.' : 'Moderate spacing.'}
- Shape: corner radius about ${t.radius}px, ${t.form} forms, ${t.ornament} ornamentation, ${t.depth}.
- Layout: ${t.symmetry}; mood ${t.mood}.
${avoid.length ? `- Avoid: ${avoid.join('; ')}.` : ''}
- For image generation, add to the style part of the prompt: "${imageWords.join(', ')}".

RULES
1. Use these defaults without asking. If a brief conflicts, follow the brief but lean this way in the details.
2. When you have a choice between two treatments, pick the one closer to this profile.
3. If I say "make it nicer", move further in this direction, not toward generic defaults.

machine-readable (make-it-nice v${ENGINE_VERSION}): ${vec}${url}`;
}

// ---------- model evolution (runs on the server, pure function so it can be tested) ----------
// sessions: [{profile:{w,s,n}, rating (1-5|null), archetypes:[...], history:[{axis,pick,kind}], modelVersion}]
export function recomputeModel(sessions, prevModel = defaultModel()) {
  const prev = normalizeModel(prevModel);
  const m = defaultModel();
  m.version = prev.version + 1;
  m.createdAt = new Date().toISOString();
  const done = sessions.filter((s) => s && s.profile && Array.isArray(s.profile.w) && s.profile.w.length === N && (s.profile.n || 0) >= 5);
  m.nSessions = done.length;
  const rated = done.filter((s) => typeof s.rating === 'number' && s.rating >= 1);
  m.nRated = rated.length;
  if (done.length < 5) { return { ...m, axisValue: prev.axisValue, prior: prev.prior, archetypeWeight: prev.archetypeWeight, note: 'not enough sessions yet; keeping previous parameters' }; }

  // weight sessions by how well they went: good ratings count more, bad ratings less, unrated in between
  const wt = (s) => (typeof s.rating !== 'number' ? 0.5 : s.rating >= 4 ? 1 : s.rating === 3 ? 0.5 : 0.15);
  const W = done.reduce((a, s) => a + wt(s), 0);

  // population prior: rating-weighted mean of finished profiles
  const mean = AXES.map((_, i) => done.reduce((a, s) => a + wt(s) * s.profile.w[i], 0) / W);
  m.prior.mean = Object.fromEntries(AXES.map((a, i) => [a.id, round2(mean[i])]));
  m.prior.weight = clamp(0.15 + Math.min(0.25, done.length / 400), 0.15, 0.4);

  // contested: among people actually asked about an axis, how split are they?
  // 0 = everyone leans the same way (not worth many questions), 1 = an even split (very worth asking)
  const contested = AXES.map((_, i) => {
    const asked = done.filter((s) => Array.isArray(s.profile.s) && s.profile.s[i] < 0.7);
    if (asked.length < 5) return 0.6;
    const Wa = asked.reduce((a, s) => a + wt(s), 0);
    const mu = asked.reduce((a, s) => a + wt(s) * s.profile.w[i], 0) / Wa;
    const mag = asked.reduce((a, s) => a + wt(s) * Math.abs(s.profile.w[i]), 0) / Wa;
    return mag < 0.05 ? 0.6 : clamp(1 - Math.abs(mu) / mag, 0, 1);
  });

  // axis value = how contested it is x how consistently the probes read it (+ any rating lift)
  // consistency: within a session, repeated probes of the same axis should agree in direction
  const consistency = AXES.map((a) => {
    let agree = 0, total = 0;
    for (const s of done) {
      const picks = (s.history || []).filter((h) => h.axis === a.id && h.kind === 'single' && h.pick !== 'tie').map((h) => h.dir);
      for (let k = 1; k < picks.length; k++) { total++; if (picks[k] === picks[k - 1]) agree++; }
    }
    return total >= 5 ? agree / total : 0.7;
  });
  // rating lift: sessions that probed this axis vs. those that didn't
  const lift = AXES.map((a) => {
    const withA = rated.filter((s) => (s.history || []).some((h) => h.axis === a.id || (Array.isArray(h.axis) && h.axis.includes(a.id))));
    const without = rated.filter((s) => !withA.includes(s));
    if (withA.length < 8 || without.length < 8) return 0;
    const avg = (arr) => arr.reduce((x, s) => x + s.rating, 0) / arr.length;
    return clamp((avg(withA) - avg(without)) / 2, -0.5, 0.5);
  });
  m.axisValue = Object.fromEntries(AXES.map((a, i) => [a.id, round2(clamp(0.4 + contested[i] * 1.2 + (consistency[i] - 0.5) + lift[i], 0.2, 2.5))]));

  // archetype weight: Bayesian-ish success rate (rating >= 4) with a prior
  const archStats = Object.fromEntries(ARCHETYPES.map((a) => [a, { ok: 2, n: 4 }]));
  for (const s of rated) {
    const archs = new Set((s.history || []).map((h) => h.archetype).filter(Boolean));
    for (const a of archs) { if (!archStats[a]) continue; archStats[a].n++; if (s.rating >= 4) archStats[a].ok++; }
  }
  m.archetypeWeight = Object.fromEntries(ARCHETYPES.map((a) => [a, round2(clamp((archStats[a].ok / archStats[a].n) * 2, 0.3, 2))]));

  // exploration decays as we learn, but never to zero
  m.explore = round2(clamp(0.25 - Math.min(0.15, done.length / 1000), 0.08, 0.3));
  m.lr = prev.lr; m.shrink = prev.shrink;
  // if people who rated low had unusually many ties, the probes were too subtle — nudge learning rate
  const avgTiesLow = (arr) => (arr.length ? arr.reduce((x, s) => x + (s.profile.ties || 0), 0) / arr.length : 0);
  const low = rated.filter((s) => s.rating <= 2), high = rated.filter((s) => s.rating >= 4);
  if (low.length >= 10 && high.length >= 10 && avgTiesLow(low) > avgTiesLow(high) + 1) m.lr = round2(clamp(prev.lr + 0.05, 0.2, 0.8));
  return m;
}

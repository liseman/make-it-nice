// make it nice — procedural design samples
// Turns a 12-axis style vector + a seed into a small, self-contained piece of design
// (a poster, a UI card, a pattern tile, a landing hero, a type specimen).
// Two samples rendered with the same seed differ ONLY where their vectors differ.

import { AXIS_INDEX, rng, clamp, hashString } from './engine.js';

const u = (x, id) => (x[AXIS_INDEX[id]] + 1) / 2; // 0..1

export function styleFromVector(x, seed = 1) {
  const r = rng((seed ^ 0x9e3779b9) >>> 0);
  const rHue = rng((seed ^ 0x1b873593) >>> 0);
  const temp = x[AXIS_INDEX.temp], sat = u(x, 'sat'), light = u(x, 'light'), contrast = u(x, 'contrast');
  const ornament = u(x, 'ornament'), corner = u(x, 'corner'), organic = u(x, 'form'), depth = u(x, 'depth');
  const serif = u(x, 'serif'), density = u(x, 'density'), symmetric = u(x, 'symmetry'), playful = u(x, 'mood');

  const jitter = rHue.range(-8, 8);
  const spreadRand = rHue(), spreadSign = rHue() < 0.5 ? 1 : -1;
  const hue = temp >= 0 ? 42 - 30 * temp + jitter : 178 + 72 * -temp + jitter;
  const S = 10 + 80 * sat;                       // accent saturation
  const dark = light < 0.5;
  const bgL = dark ? 8 + 16 * (light * 2) : 88 + 10 * ((light - 0.5) * 2);
  const bgS = Math.min(S, dark ? 22 : 30) * (0.35 + 0.65 * sat);
  // contrast: how far text and accents sit from the background
  const fgL = dark ? 70 + 28 * contrast : 42 - 36 * contrast;
  const accentL = dark ? 62 + 10 * contrast : 48 - 14 * contrast + 8 * (1 - contrast);
  const spread = playful > 0.5 ? 140 + 40 * spreadRand : 24 + 24 * spreadRand;      // accent2 hue distance
  const hue2 = (hue + spreadSign * spread + 360) % 360;
  const hsl = (h, s, l, a = 1) => `hsl(${Math.round(h)} ${Math.round(clamp(s, 0, 100))}% ${Math.round(clamp(l, 0, 100))}%${a < 1 ? ` / ${a}` : ''})`;

  const fontH = serif >= 0.5
    ? (playful >= 0.5 ? '"Fraunces", "Iowan Old Style", Georgia, serif' : '"Playfair Display", "Iowan Old Style", Georgia, serif')
    : (playful >= 0.5 ? '"Nunito", "Space Grotesk", Inter, system-ui, sans-serif' : '"Space Grotesk", Inter, system-ui, sans-serif');
  const fontB = serif >= 0.5 ? '"Fraunces", Georgia, serif' : (playful >= 0.5 ? '"Nunito", Inter, system-ui, sans-serif' : 'Inter, system-ui, sans-serif');

  return {
    hue, hue2, S, dark, bgL, contrast, ornament, corner, organic, depth, serif, density, symmetric, playful, sat, light, temp,
    bg: hsl(hue, bgS, bgL),
    bg2: hsl(hue, bgS * 1.2, dark ? bgL + 6 : bgL - 5),
    fg: hsl(hue, Math.min(35, S * 0.5), fgL),
    muted: hsl(hue, Math.min(25, S * 0.4), dark ? 40 + 18 * contrast : 66 - 22 * contrast),
    accent: hsl(hue, S, accentL),
    accent2: hsl(hue2, S * 0.9, dark ? 60 + 10 * contrast : 50 - 8 * contrast),
    accentSoft: hsl(hue, S * 0.7, dark ? 28 : 84),
    line: hsl(hue, Math.min(30, S * 0.5), dark ? 26 + 10 * contrast : 78 - 12 * contrast),
    radius: Math.round(28 * corner ** 1.4),                        // 0..28 px
    pad: Math.round(26 - 14 * density),                             // 26..12
    gap: Math.round(16 - 9 * density),
    lh: (1.65 - 0.4 * density).toFixed(2),
    scale: (1.08 - 0.22 * density).toFixed(3),                      // type scale
    shadow: depth > 0.35 ? `0 ${Math.round(6 + 14 * depth)}px ${Math.round(14 + 26 * depth)}px hsl(${Math.round(hue)} 40% ${dark ? 2 : 25}% / ${(0.12 + 0.28 * depth).toFixed(2)})` : 'none',
    shadowSm: depth > 0.35 ? `0 ${Math.round(2 + 4 * depth)}px ${Math.round(6 + 10 * depth)}px hsl(${Math.round(hue)} 40% ${dark ? 2 : 25}% / ${(0.10 + 0.2 * depth).toFixed(2)})` : 'none',
    grad: depth > 0.5 ? `linear-gradient(160deg, ${hsl(hue, S, accentL + 8)}, ${hsl(hue2, S * 0.9, accentL - 6)})` : hsl(hue, S, accentL),
    fontH, fontB,
    hsl, r,
    tilt: playful > 0.5 ? (playful - 0.5) * 2 : 0,                 // 0..1
    align: symmetric >= 0.5 ? 'center' : 'left',
  };
}

// ---------- shapes ----------
function blobPath(r, cx, cy, rad, wobble = 0.35, points = 7) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = rad * (1 - wobble / 2 + r() * wobble);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  // Catmull-Rom → cubic Bézier for a smooth closed curve
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < points; i++) {
    const p0 = pts[(i - 1 + points) % points], p1 = pts[i], p2 = pts[(i + 1) % points], p3 = pts[(i + 2) % points];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + ' Z';
}

function shape(st, r, kind, cx, cy, size, fill, extra = '') {
  cx = Number(cx); cy = Number(cy); size = Number(size);
  const rotv = r(); // always consume, so A/B stay in step whether or not they tilt
  const rot = st.tilt ? ` transform="rotate(${((rotv - 0.5) * 30 * st.tilt).toFixed(1)} ${cx} ${cy})"` : '';
  if (st.organic > 0.5) {
    return `<path d="${blobPath(r, cx, cy, size / 2, 0.25 + 0.5 * (st.organic - 0.5) * 2)}" fill="${fill}"${rot} ${extra}/>`;
  }
  const rx = Math.round((size / 2) * st.corner * 0.9);
  if (kind === 'circle') return `<circle cx="${cx}" cy="${cy}" r="${size / 2}" fill="${fill}"${rot} ${extra}/>`;
  if (kind === 'tri') { const h = size * 0.87; return `<polygon points="${cx},${cy - h / 2} ${cx + size / 2},${cy + h / 2} ${cx - size / 2},${cy + h / 2}" fill="${fill}"${rot} ${extra} stroke-linejoin="round" stroke="${fill}" stroke-width="${rx / 2}"/>`; }
  return `<rect x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" rx="${rx}" fill="${fill}"${rot} ${extra}/>`;
}

// a small composition of shapes; symmetric → mirrored/centred, asymmetric → scattered
function composition(st, S, w, h, count) {
  const kinds = ['rect', 'circle', 'tri'];
  const fills = [st.accent, st.accent2, st.accentSoft, st.fg];
  let out = '';
  const n = Math.max(1, count);
  for (let i = 0; i < n; i++) {
    const q = S('shape' + i);
    const size = (h * (0.28 + q() * 0.3)) * (1 - 0.35 * (i / n));
    const jy = q(), jx = q(), jy2 = q();
    let cx, cy;
    if (st.symmetric >= 0.5) { const k = i - (n - 1) / 2; cx = w / 2 + k * (w / (n + 0.4)); cy = h / 2 + (jy - 0.5) * h * 0.15; }
    else { cx = w * (0.12 + jx * 0.76); cy = h * (0.15 + jy2 * 0.7); }
    const fill = st.depth > 0.5 && i === 0 ? `url(#${st.gid})` : fills[i % fills.length];
    const opv = q();
    const op = st.depth > 0.35 ? ` opacity="${(0.72 + 0.28 * opv).toFixed(2)}"` : '';
    const kind = kinds[(i + (q() < 0.5 ? 1 : 0)) % kinds.length];
    out += shape(st, q, kind, cx.toFixed(1), cy.toFixed(1), size.toFixed(1), fill, op);
  }
  return out;
}

function svgDefs(st) {
  return `<defs><linearGradient id="${st.gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${st.accent}"/><stop offset="1" stop-color="${st.accent2}"/></linearGradient></defs>`;
}

// ornament pieces: rules, double borders, corner flourishes, dot/stripe textures
function ornamentBorder(st) {
  if (st.ornament < 0.35) return '';
  if (st.ornament < 0.7) return `<div class="mn-rule" style="border-top:1.5px solid ${st.line}"></div>`;
  return `<div class="mn-frame" style="border:1.5px solid ${st.accent};border-radius:calc(var(--radius) * .6);outline:1px solid ${st.line};outline-offset:4px"></div>`;
}
function ornamentTexture(st) {
  if (st.ornament < 0.55) return '';
  const id = `${st.gid}t`;
  const dot = st.organic > 0.5 ? `<circle cx="4" cy="4" r="1.2" fill="${st.line}"/>` : `<rect x="3" y="3" width="2" height="2" fill="${st.line}"/>`;
  return `<svg class="mn-texture" aria-hidden="true"><defs><pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse">${dot}</pattern></defs><rect width="100%" height="100%" fill="url(#${id})" opacity="${(0.35 + 0.6 * (st.ornament - 0.55)).toFixed(2)}"/></svg>`;
}
function flourish(st) {
  if (st.ornament < 0.75) return '';
  const path = st.organic > 0.5
    ? 'M2 12 C 8 2, 16 2, 22 12 S 36 22, 42 12'
    : 'M2 12 H 14 L 20 4 L 26 20 L 32 12 H 44';
  return `<svg class="mn-flourish" viewBox="0 0 46 24" width="46" height="24"><path d="${path}" fill="none" stroke="${st.accent}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// ---------- copy ----------
const POSTER_TITLES = ['Night Market', 'Open Studio', 'Harbor Jazz', 'Field Notes', 'Winter Salon', 'The Long Table', 'Tide & Timber', 'Paper Moon', 'Small Hours', 'North Light', 'Summer Reading', 'Kiln & Kettle'];
const POSTER_SUBS = ['Saturday, 7pm · Pier 9', 'Three weekends in October', 'Talks, tools, and tea', 'A season of small shows', 'Doors at six', 'Free · All ages', 'Music by the water', 'One night only'];
const CARD_TITLES = ['Weekly summary', 'Sleep', 'Orders', 'Storage', 'Energy', 'Rainfall', 'Reading', 'Visitors'];
const HERO_H = ['Make things people keep.', 'Plan less. Build more.', 'Quiet tools for loud days.', 'Your week, in one place.', 'Good defaults, few decisions.', 'Everything, gently organized.'];
const HERO_P = ['A calm workspace for notes, plans and the odd wild idea.', 'One home for the things you make and the people you make them with.', 'Set it up once. It stays out of your way.'];
const SPEC_LINES = ['Sphinx of black quartz, judge my vow.', 'The quick brown fox jumps over the lazy dog.', 'Pack my box with five dozen liquor jugs.', 'How vexingly quick daft zebras jump.'];
const CTA = ['Get started', 'See the plan', 'Try it free', 'Read more'];

// ---------- renderers ----------
function poster(st, S) {
  const c = S('copy');
  const title = c.pick(POSTER_TITLES), sub = c.pick(POSTER_SUBS);
  const count = 2 + Math.round(st.density * 3) + (st.ornament > 0.6 ? 1 : 0);
  const tilt = st.tilt ? `transform:rotate(${((c() - 0.5) * 6 * st.tilt).toFixed(1)}deg)` : '';
  return `
  <div class="mn mn-poster" style="${vars(st)}">
    ${ornamentTexture(st)}${ornamentBorder(st)}
    <svg class="mn-art" viewBox="0 0 200 150" preserveAspectRatio="xMidYMid slice">${svgDefs(st)}${composition(st, S, 200, 150, count)}</svg>
    <div class="mn-poster-text" style="text-align:var(--align)">
      ${flourish(st)}
      <div class="mn-kicker">${st.playful > 0.5 ? 'You’re invited!' : 'Presenting'}</div>
      <h1 class="mn-title" style="${tilt}">${title}${st.playful > 0.6 ? '!' : ''}</h1>
      <div class="mn-sub">${sub}</div>
      ${st.density > 0.55 ? `<div class="mn-meta"><span>Tickets at the door</span><span>·</span><span>Bring a friend</span>${st.density > 0.8 ? '<span>·</span><span>Rain or shine</span>' : ''}</div>` : ''}
    </div>
  </div>`;
}

function card(st, S) {
  const c = S('copy');
  const title = c.pick(CARD_TITLES), bigNum = 12 + c() * 80, unit = c.pick(['h', 'k', '%', 'mm']), cta = c.pick(CTA);
  const bars = 5 + Math.round(st.density * 5);
  const heights = Array.from({ length: bars }, (_, i) => 25 + S('bar' + i)() * 70);
  const barW = 100 / bars;
  const barsSvg = heights.map((h, i) => {
    const x = i * barW + barW * 0.18, w = barW * 0.64;
    const rx = Math.min(w / 2, (w / 2) * st.corner);
    const fill = i === bars - 2 ? st.accent2 : (st.depth > 0.5 ? `url(#${st.gid})` : st.accent);
    if (st.organic > 0.5) return `<path d="M${x.toFixed(1)} 100 L${x.toFixed(1)} ${(100 - h).toFixed(1)} Q${(x + w / 2).toFixed(1)} ${(100 - h - 8).toFixed(1)} ${(x + w).toFixed(1)} ${(100 - h).toFixed(1)} L${(x + w).toFixed(1)} 100 Z" fill="${fill}"/>`;
    return `<rect x="${x.toFixed(1)}" y="${(100 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx.toFixed(1)}" fill="${fill}"/>`;
  }).join('');
  const rows = Math.round(st.density * 3);
  const rowHtml = Array.from({ length: rows }, (_, i) => { const q = S('row' + i); return `<div class="mn-row"><span>${['Mon', 'Tue', 'Wed'][i]}</span><span class="mn-row-bar"><i style="width:${(30 + q() * 60).toFixed(0)}%"></i></span><span>${Math.round(20 + q() * 80)}%</span></div>`; }).join('');
  return `
  <div class="mn mn-card" style="${vars(st)}">
    ${ornamentTexture(st)}
    <div class="mn-card-inner">
      ${ornamentBorder(st)}
      <div class="mn-card-head" style="justify-content:${st.symmetric >= 0.5 ? 'center' : 'space-between'};text-align:var(--align)">
        <div><div class="mn-kicker">${title}</div><div class="mn-big">${bigNum.toFixed(st.density > 0.5 ? 1 : 0)}<span class="mn-unit">${unit}</span></div></div>
        ${st.symmetric < 0.5 ? `<div class="mn-avatar" style="background:${st.grad}"></div>` : ''}
      </div>
      <svg class="mn-chart" viewBox="0 0 100 100" preserveAspectRatio="none">${svgDefs(st)}${barsSvg}</svg>
      ${rowHtml}
      <div class="mn-actions" style="justify-content:${st.symmetric >= 0.5 ? 'center' : 'flex-start'}">
        <button class="mn-btn mn-btn-primary">${cta}</button>
        ${st.density > 0.35 ? '<button class="mn-btn">Details</button>' : ''}
      </div>
    </div>
  </div>`;
}

function pattern(st, S) {
  const cols = 3 + Math.round(st.density * 4), rows = cols;
  const cell = 100 / cols;
  let cells = '';
  const fills = [st.accent, st.accent2, st.accentSoft, st.fg];
  const kinds = ['rect', 'circle', 'tri'];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    const q = S(`cell${x},${y}`);
    const sym = st.symmetric >= 0.5;
    const q1 = q(), q2 = q(), q3 = q(), q4 = q(), q5 = q(), q6 = q();
    const k = sym ? kinds[(x + y) % 2 === 0 ? 0 : 1] : kinds[Math.floor(q1 * 3)];
    const fill = sym ? fills[(x + y) % 2] : fills[Math.floor(q2 * (st.sat > 0.5 ? 4 : 3))];
    const size = cell * (sym ? 0.62 : 0.4 + q3 * 0.5);
    const cx = x * cell + cell / 2 + (sym ? 0 : (q4 - 0.5) * cell * 0.3);
    const cy = y * cell + cell / 2 + (sym ? 0 : (q5 - 0.5) * cell * 0.3);
    if (st.ornament > 0.6 && (x + y) % 3 === 0 && !sym) cells += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(size * 0.62).toFixed(1)}" fill="none" stroke="${st.line}" stroke-width="0.8"/>`;
    cells += shape(st, q, k, cx.toFixed(1), cy.toFixed(1), size.toFixed(1), (st.depth > 0.5 && i % 4 === 0) ? `url(#${st.gid})` : fill, st.depth > 0.35 ? `opacity="${(0.75 + 0.25 * q6).toFixed(2)}"` : '');
  }
  const stripes = st.ornament > 0.75 ? `<rect x="0" y="0" width="100" height="100" fill="none" stroke="${st.accent}" stroke-width="2"/><rect x="3" y="3" width="94" height="94" fill="none" stroke="${st.line}" stroke-width="0.6"/>` : '';
  return `
  <div class="mn mn-pattern" style="${vars(st)}">
    <svg class="mn-art-full" viewBox="0 0 100 100">${svgDefs(st)}<rect width="100" height="100" fill="${st.bg}"/>${cells}${stripes}</svg>
  </div>`;
}

function hero(st, S) {
  const c = S('copy');
  const h = c.pick(HERO_H), p = c.pick(HERO_P), cta = c.pick(CTA);
  const navItems = 2 + Math.round(st.density * 3);
  const nav = Array.from({ length: navItems }, (_, i) => `<span>${['Product', 'Pricing', 'Docs', 'Blog', 'About'][i]}</span>`).join('');
  return `
  <div class="mn mn-hero" style="${vars(st)}">
    ${ornamentTexture(st)}
    <div class="mn-nav" style="justify-content:${st.symmetric >= 0.5 ? 'center' : 'space-between'}"><b class="mn-logo"><i style="background:${st.grad}"></i>${st.serif > 0.5 ? 'Lumen' : 'lumen'}</b><nav>${nav}</nav></div>
    <div class="mn-hero-body" style="align-items:${st.symmetric >= 0.5 ? 'center' : 'flex-start'};text-align:var(--align)">
      ${flourish(st)}
      ${st.ornament > 0.4 ? `<div class="mn-pill">${st.playful > 0.5 ? '✦ New' : 'Now available'}</div>` : ''}
      <h1 class="mn-h1">${h}</h1>
      <p class="mn-p">${p}</p>
      <div class="mn-actions" style="justify-content:${st.symmetric >= 0.5 ? 'center' : 'flex-start'}"><button class="mn-btn mn-btn-primary">${cta}</button>${st.density > 0.3 ? '<button class="mn-btn">Learn more</button>' : ''}</div>
    </div>
    <svg class="mn-hero-art" viewBox="0 0 200 110" preserveAspectRatio="xMidYMax slice">${svgDefs(st)}${composition(st, S, 200, 110, 2 + Math.round(st.density * 2))}</svg>
  </div>`;
}

function specimen(st, S) {
  const line = S('copy').pick(SPEC_LINES);
  const letters = st.serif > 0.5 ? 'Ag' : 'Aa';
  const rows = 1 + Math.round(st.density * 2);
  const sizes = ['1.15em', '0.95em', '0.8em'];
  const paras = Array.from({ length: rows }, (_, i) => `<p class="mn-spec-line" style="font-size:${sizes[i]}">${line}</p>`).join('');
  return `
  <div class="mn mn-specimen" style="${vars(st)};text-align:var(--align)">
    ${ornamentTexture(st)}${ornamentBorder(st)}
    <div class="mn-spec-top" style="justify-content:${st.symmetric >= 0.5 ? 'center' : 'space-between'}"><span class="mn-kicker">${st.serif > 0.5 ? 'Serif' : 'Sans'} · ${st.playful > 0.5 ? 'Display' : 'Text'}</span>${st.density > 0.5 ? '<span class="mn-kicker">400 / 700</span>' : ''}</div>
    <div class="mn-spec-big" style="background:${st.depth > 0.5 ? st.grad : 'transparent'};-webkit-background-clip:${st.depth > 0.5 ? 'text' : 'border-box'};color:${st.depth > 0.5 ? 'transparent' : st.accent}">${letters}</div>
    ${flourish(st)}
    <div class="mn-spec-num">${st.serif > 0.5 ? '1234567890' : '0123456789'}</div>
    ${paras}
  </div>`;
}

const RENDERERS = { poster, card, pattern, hero, specimen };
export const ARCHETYPE_LABEL = { poster: 'poster', card: 'app card', pattern: 'pattern', hero: 'landing page', specimen: 'type specimen' };

function vars(st) {
  return [
    `--bg:${st.bg}`, `--bg2:${st.bg2}`, `--fg:${st.fg}`, `--muted:${st.muted}`, `--accent:${st.accent}`, `--accent2:${st.accent2}`,
    `--accent-soft:${st.accentSoft}`, `--line:${st.line}`, `--radius:${st.radius}px`, `--pad:${st.pad}px`, `--gap:${st.gap}px`,
    `--lh:${st.lh}`, `--scale:${st.scale}`, `--shadow:${st.shadow}`, `--shadow-sm:${st.shadowSm}`, `--grad:${st.grad}`,
    `--font-h:${st.fontH}`, `--font-b:${st.fontB}`, `--align:${st.align}`, `--weight:${st.contrast > 0.5 ? 700 : 500}`,
    `--track:${st.density > 0.5 ? '-0.01em' : '0.01em'}`,
  ].join(';');
}

let uid = 0;
export function renderSampleHTML(archetype, x, seed) {
  const st = styleFromVector(x, seed);
  st.gid = `mn${(seed >>> 0).toString(36)}x${(uid++).toString(36)}`; // unique per render: SVG ids are document-global
  const S = (tag) => rng(hashString(`${seed}:${archetype}:${tag}`));
  return (RENDERERS[archetype] || poster)(st, S);
}

export function renderSample(archetype, x, seed) {
  ensureStyles();
  const wrap = document.createElement('div');
  wrap.className = 'mn-wrap';
  wrap.innerHTML = renderSampleHTML(archetype, x, seed);
  return wrap;
}

let stylesInjected = false;
export function ensureStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.id = 'mn-sample-styles';
  s.textContent = SAMPLE_CSS;
  document.head.appendChild(s);
}

export const SAMPLE_CSS = `
.mn-wrap{container-type:inline-size;width:100%}
.mn{position:relative;overflow:hidden;background:var(--bg);color:var(--fg);font-family:var(--font-b);border-radius:var(--radius);box-shadow:var(--shadow);width:100%;aspect-ratio:4/5;box-sizing:border-box;line-height:var(--lh);letter-spacing:var(--track)}
.mn *{box-sizing:border-box}
.mn-texture{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.mn-frame{position:absolute;inset:calc(var(--pad) * .5);pointer-events:none}
.mn-rule{position:absolute;left:var(--pad);right:var(--pad);top:calc(var(--pad) * .8);pointer-events:none}
.mn-flourish{display:block;margin:0 0 .6em;margin-inline:calc(var(--align) == center ? auto : 0)}
.mn-kicker{font-size:calc(3.2cqw * var(--scale));text-transform:uppercase;letter-spacing:.14em;color:var(--muted);font-weight:600}
.mn-title{font-family:var(--font-h);font-weight:var(--weight);font-size:calc(11.5cqw * var(--scale));line-height:1.02;margin:.25em 0 .3em;color:var(--fg);text-wrap:balance}
.mn-sub{font-size:calc(4.2cqw * var(--scale));color:var(--fg);opacity:.85}
.mn-meta{display:flex;gap:.5em;flex-wrap:wrap;margin-top:.9em;font-size:calc(3.3cqw * var(--scale));color:var(--muted)}
.mn-poster .mn-art{position:absolute;left:0;right:0;top:0;height:56%;width:100%}
.mn-poster-text{position:absolute;left:var(--pad);right:var(--pad);bottom:var(--pad)}
.mn-poster-text .mn-flourish{margin-inline:inherit}
.mn-card{aspect-ratio:4/5;padding:var(--pad);background:var(--bg2)}
.mn-card-inner{position:relative;background:var(--bg);border-radius:var(--radius);padding:var(--pad);height:100%;box-shadow:var(--shadow);border:1px solid var(--line);display:flex;flex-direction:column;gap:var(--gap)}
.mn-card-inner .mn-frame{inset:calc(var(--pad) * .35)}
.mn-card-inner .mn-rule{display:none}
.mn-card-head{display:flex;align-items:flex-start;gap:var(--gap)}
.mn-big{font-family:var(--font-h);font-size:calc(12cqw * var(--scale));font-weight:var(--weight);line-height:1;margin-top:.15em}
.mn-unit{font-size:.4em;color:var(--muted);margin-left:.15em;font-family:var(--font-b)}
.mn-avatar{width:calc(10cqw);height:calc(10cqw);border-radius:calc(var(--radius) * .6 + 2px);box-shadow:var(--shadow-sm)}
.mn-chart{width:100%;height:30%;flex:1 1 auto}
.mn-row{display:grid;grid-template-columns:2.6em 1fr 2.6em;align-items:center;gap:.6em;font-size:calc(3.3cqw * var(--scale));color:var(--muted)}
.mn-row-bar{height:.55em;background:var(--accent-soft);border-radius:var(--radius);overflow:hidden}
.mn-row-bar i{display:block;height:100%;background:var(--accent)}
.mn-actions{display:flex;gap:calc(var(--gap) * .6);flex-wrap:wrap;margin-top:auto}
.mn-btn{font:inherit;font-family:var(--font-b);font-size:calc(3.6cqw * var(--scale));font-weight:600;padding:.6em 1.1em;border-radius:var(--radius);border:1.5px solid var(--line);background:transparent;color:var(--fg);box-shadow:var(--shadow-sm);letter-spacing:var(--track)}
.mn-btn-primary{background:var(--grad);color:var(--bg);border-color:transparent}
.mn-pattern{aspect-ratio:4/5}
.mn-art-full{width:100%;height:100%;display:block}
.mn-hero{display:flex;flex-direction:column;padding:var(--pad)}
.mn-nav{display:flex;align-items:center;gap:var(--gap);font-size:calc(3.3cqw * var(--scale));color:var(--muted);margin-bottom:var(--gap)}
.mn-nav nav{display:flex;gap:calc(var(--gap) * .9)}
.mn-logo{display:flex;align-items:center;gap:.4em;color:var(--fg);font-family:var(--font-h);font-size:1.25em}
.mn-logo i{width:.9em;height:.9em;border-radius:calc(var(--radius) * .35);display:inline-block}
.mn-hero-body{display:flex;flex-direction:column;gap:calc(var(--gap) * .5);padding-top:calc(var(--gap) * .6);position:relative;z-index:1}
.mn-pill{font-size:calc(2.9cqw * var(--scale));padding:.35em .8em;border:1px solid var(--line);border-radius:var(--radius);color:var(--accent);width:max-content;font-weight:600}
.mn-h1{font-family:var(--font-h);font-size:calc(9.5cqw * var(--scale));line-height:1.05;margin:0;font-weight:var(--weight);text-wrap:balance}
.mn-p{margin:0;font-size:calc(3.8cqw * var(--scale));color:var(--muted);max-width:32ch}
.mn-hero .mn-actions{margin-top:.5em}
.mn-hero-art{position:absolute;left:0;right:0;bottom:0;width:100%;height:36%}
.mn-specimen{padding:var(--pad);display:flex;flex-direction:column;gap:calc(var(--gap) * .4)}
.mn-spec-top{display:flex}
.mn-spec-big{font-family:var(--font-h);font-size:calc(38cqw * var(--scale));line-height:.95;font-weight:var(--weight);margin:.05em 0}
.mn-spec-num{font-family:var(--font-h);font-size:calc(6cqw * var(--scale));letter-spacing:.06em;color:var(--muted)}
.mn-spec-line{margin:0;font-size:calc(3.9cqw * var(--scale))}
.mn-specimen .mn-flourish{margin:0 0 .3em}
`;

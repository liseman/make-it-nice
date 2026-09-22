// make it nice — the site (home → 10 picks → result). Hash-routed so it runs on any static host.
import {
  AXES, ROUNDS_PER_PASS, newProfile, evolveProfile, applyChoice, planProbe, encodeProfile, decodeProfile,
  niceName, describeProfile, aiPrompt, tokensFromVector, rankedAxes, randomSeed, strength, hashString,
} from './engine.js';
import { renderSample, styleFromVector, ensureStyles, ARCHETYPE_LABEL } from './samples.js';
import { LS, getModel, postSession, postRating, postEvent, getPublicStats, health, apiBase, isOnline, saveLocalSession, updateLocalSession } from './api.js';

const app = document.getElementById('app');
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SS = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); return true; } catch { return false; } finally { ta.remove(); }
  }
}

// ---------- theme: the result page wears the visitor's taste ----------
const THEME_VARS = ['bg', 'bg2', 'fg', 'muted', 'accent', 'accent2', 'accentSoft', 'line', 'radius', 'pad', 'gap', 'lh', 'fontH', 'fontB', 'shadow', 'align'];
function applyTheme(profile, seed = 7) {
  const root = document.documentElement;
  if (!profile) { root.removeAttribute('style'); document.body.classList.remove('themed'); return; }
  const st = styleFromVector(profile.w, seed);
  const map = {
    bg: st.bg, bg2: st.dark ? st.bg2 : '#ffffff', fg: st.fg, muted: st.muted, accent: st.accent, accent2: st.accent2,
    'accent-soft': st.accentSoft, line: st.line, radius: `${Math.max(4, st.radius)}px`, pad: `${st.pad + 4}px`, gap: `${st.gap}px`, lh: st.lh,
    'font-h': st.fontH, 'font-b': st.fontB, shadow: st.shadow === 'none' ? 'none' : st.shadow, align: st.align, weight: st.contrast > 0.5 ? 700 : 600,
  };
  for (const [k, v] of Object.entries(map)) root.style.setProperty(`--${k}`, v);
  document.body.classList.add('themed');
}

// ---------- state ----------
let model = null;
const state = { pick: null }; // { profile, seed, round, startRound, mode, startedAt, pair }

async function ensureModel() { if (!model) model = await getModel(); return model; }

function resultUrl(code) { return `${location.origin}${location.pathname}#/result/${code}`; }

// ---------- routing ----------
function route() {
  const hash = location.hash || '#/';
  const [path, query] = hash.slice(1).split('?');
  const params = new URLSearchParams(query || '');
  window.scrollTo({ top: 0 });
  if (path === '/' || path === '') return renderHome();
  if (path === '/about') return renderAbout();
  if (path === '/pick') return renderPicker(params);
  if (path.startsWith('/result/')) return renderResult(path.slice('/result/'.length));
  if (path.startsWith('/r/')) return renderResult(path.slice(3));
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

// ---------- home ----------
async function renderHome() {
  applyTheme(null);
  app.innerHTML = `
    <section class="hero">
      <h1>make it nice</h1>
      <p class="lede">You can't describe what you like. But you can pick.</p>
      <p style="max-width:52ch">Ten pairs of designs. Choose the one that looks nicer. You get your taste back three ways: a page built in your style, a plain-English description, and a prompt you paste into your AI so it makes nicer things for you.</p>
      <div class="btn-row">
        <a class="btn big" href="#/pick">Show me two things</a>
        <a class="link-btn" href="#/about">how it works</a>
      </div>
      <p class="stat-line" id="stat-line"></p>
    </section>
    <section class="teaser" id="teaser" aria-hidden="true"></section>
    <section class="steps">
      <div class="step"><b>1 · Pick</b><p>Two designs, same layout, one difference. Tap the nicer one. Ten times. No wrong answers.</p></div>
      <div class="step"><b>2 · Read</b><p>Your result page is rendered in your taste, describes it in words, and gives you a prompt to save to your AI's memory.</p></div>
      <div class="step"><b>3 · Evolve</b><p>Rate the result. Good ratings teach the next version which questions matter. Then make it nicer with ten more picks.</p></div>
    </section>`;
  // a decorative pair: the same poster, two tastes
  const teaser = $('#teaser');
  const a = AXES.map(() => 0), b = AXES.map(() => 0);
  const r = hashString(String(new Date().getUTCDate()));
  const set = (x, id, v) => { x[AXES.findIndex((ax) => ax.id === id)] = v; };
  set(a, 'temp', 0.8); set(a, 'ornament', -0.8); set(a, 'corner', 0.7); set(a, 'serif', -0.8); set(a, 'light', 0.8); set(a, 'sat', -0.3);
  set(b, 'temp', -0.8); set(b, 'ornament', 0.6); set(b, 'corner', -0.7); set(b, 'serif', 0.9); set(b, 'light', -0.8); set(b, 'sat', 0.4); set(b, 'depth', 0.6);
  teaser.appendChild(renderSample('poster', a, r)); teaser.appendChild(renderSample('poster', b, r));
  getPublicStats().then((s) => { if (s && s.completed) $('#stat-line').textContent = `${s.completed.toLocaleString()} nices found so far · model v${s.modelVersion}`; });
}

function renderAbout() {
  applyTheme(null);
  app.innerHTML = `
    <div class="wrap narrow" style="padding-top:24px">
      <h1>How it works</h1>
      <p>People are bad at describing what they like and good at choosing between two things. So that's all you do here.</p>
      <h2>The pairs</h2>
      <p>Every pair is the same little piece of design — a poster, an app card, a pattern, a landing page, a type specimen — rendered twice from the same seed, differing on one dimension of taste (or, later, trading two off against each other). Nothing is a stock image; everything is drawn on the fly from a 12-axis style vector:</p>
      <div class="tags">${AXES.map((a) => `<span class="tag">${a.lo} ↔ ${a.hi}</span>`).join('')}</div>
      <h2>The picks</h2>
      <p>Each pick nudges your vector and shrinks the uncertainty on the axis it tested. The next pair is chosen to be maximally informative: uncertain axes first, then how strongly you feel, then which of your preferences wins when they conflict. Ten picks is a sketch; "Make it nicer" adds ten more and refines it.</p>
      <h2>The learning</h2>
      <p>Anonymous results and star ratings feed a small population model: which axes people actually disagree on (worth asking about), which they don't (skip), what a typical starting point looks like, and which kinds of samples lead to results people rate highly. The model is versioned, so you can see whether it's getting better on the dashboard.</p>
      <h2>Privacy</h2>
      <p>No accounts, no cookies, no tracking pixels. Your picks, your final vector, and your rating are stored anonymously so the model can improve. Your last result is kept in this browser so "Make it nicer" works later. Share links contain your taste vector in the URL — nothing else.</p>
      <p><a href="https://github.com/liseman/make-it-nice">Source on GitHub</a> · MIT licensed.</p>
      <p style="margin-top:28px"><a class="btn" href="#/pick">Show me two things</a></p>
    </div>`;
}

// ---------- picker ----------
async function renderPicker(params) {
  applyTheme(null);
  await ensureModel();
  const from = params.get('from');
  let pick = SS.get('min.pick');
  const wantsEvolve = !!from;
  if (wantsEvolve) {
    const base = decodeProfile(from);
    if (!base) { location.hash = '#/'; return; }
    if (!pick || pick.mode !== 'evolve' || pick.profile.parent !== base.id) {
      const local = LS.get(`min.result.${base.id}`);
      const src = local && local.profile ? local.profile : base;
      pick = { profile: evolveProfile(src), seed: randomSeed(), round: ROUNDS_PER_PASS, startRound: ROUNDS_PER_PASS, mode: 'evolve', startedAt: Date.now() };
      postEvent('start', { mode: 'evolve', parent: base.id });
    }
  } else if (!pick || pick.mode !== 'fresh' || pick.round - pick.startRound >= ROUNDS_PER_PASS) {
    pick = { profile: newProfile(model), seed: randomSeed(), round: 0, startRound: 0, mode: 'fresh', startedAt: Date.now() };
    postEvent('start', { mode: 'fresh' });
  }
  state.pick = pick;
  SS.set('min.pick', pick);
  drawPair(true);
}

function drawPair(first = false) {
  const pick = state.pick;
  const done = pick.round - pick.startRound;
  if (done >= ROUNDS_PER_PASS) return finishPass();
  const pair = planProbe(pick.profile, model, pick.seed, pick.round);
  pick.pair = pair;
  const progress = Array.from({ length: ROUNDS_PER_PASS }, (_, i) => `<i class="${i < done ? 'done' : i === done ? 'now' : ''}"></i>`).join('');
  app.innerHTML = `
    <div class="picker-head">
      <h2>Which looks nicer?</h2>
      <div class="progress" aria-label="${done + 1} of ${ROUNDS_PER_PASS}" title="${done + 1} of ${ROUNDS_PER_PASS}">${progress}</div>
    </div>
    <div class="pair ${first ? '' : 'fade'}" id="pair">
      <button class="choice" data-pick="A" aria-label="Left ${ARCHETYPE_LABEL[pair.archetype]}"><span class="key">← left</span></button>
      <button class="choice" data-pick="B" aria-label="Right ${ARCHETYPE_LABEL[pair.archetype]}"><span class="key">right →</span></button>
    </div>
    <div class="picker-foot">
      <span>${pick.mode === 'evolve' ? 'Refining' : 'Pick'} ${done + 1} of ${ROUNDS_PER_PASS} · ${esc(ARCHETYPE_LABEL[pair.archetype])}</span>
      <span class="hint-keys"><kbd>←</kbd> <kbd>→</kbd> to pick · <kbd>T</kbd> if it's a toss-up</span>
      <button class="link-btn" data-pick="tie">honestly, it's a toss-up</button>
    </div>`;
  const [ba, bb] = app.querySelectorAll('.choice');
  ba.appendChild(renderSample(pair.archetype, pair.A.x, pair.A.seed));
  bb.appendChild(renderSample(pair.archetype, pair.B.x, pair.B.seed));
  app.querySelectorAll('[data-pick]').forEach((el) => el.addEventListener('click', () => choose(el.dataset.pick)));
}

let choosing = false;
function choose(which) {
  if (choosing || !state.pick || !state.pick.pair) return;
  choosing = true;
  const pick = state.pick;
  const btns = app.querySelectorAll('.choice');
  if (which === 'A' || which === 'B') {
    btns.forEach((b) => b.classList.add(b.dataset.pick === which ? 'picked' : 'dim'));
  } else { btns.forEach((b) => b.classList.add('dim')); }
  pick.profile = applyChoice(pick.profile, pick.pair, which, model);
  pick.round += 1;
  SS.set('min.pick', pick);
  setTimeout(() => { choosing = false; drawPair(); }, which === 'tie' ? 150 : 260);
}

document.addEventListener('keydown', (e) => {
  if (!location.hash.startsWith('#/pick') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowLeft' || e.key === '1') { e.preventDefault(); choose('A'); }
  else if (e.key === 'ArrowRight' || e.key === '2') { e.preventDefault(); choose('B'); }
  else if (e.key.toLowerCase() === 't' || e.key === '0') { e.preventDefault(); choose('tie'); }
});

async function finishPass() {
  const pick = state.pick;
  const profile = pick.profile;
  profile.modelVersion = model.version;
  const code = encodeProfile(profile);
  const name = niceName(profile);
  const rec = {
    id: profile.id, parent: profile.parent, mode: pick.mode, seed: pick.seed, code, profile, niceName: name,
    createdAt: new Date().toISOString(), durationMs: Date.now() - (pick.startedAt || Date.now()), rating: null, modelVersion: model.version,
  };
  LS.set(`min.result.${profile.id}`, rec);
  LS.set('min.last', profile.id);
  saveLocalSession({ id: rec.id, parent: rec.parent, mode: rec.mode, createdAt: rec.createdAt, n: profile.n, ties: profile.ties, niceName: name, rating: null, w: profile.w, s: profile.s, modelVersion: model.version, code });
  SS.del('min.pick'); state.pick = null;
  postSession({
    id: profile.id, parent: profile.parent, mode: pick.mode, seed: pick.seed, n: profile.n, ties: profile.ties, w: profile.w, s: profile.s,
    history: profile.history, niceName: name, modelVersion: model.version, durationMs: rec.durationMs,
    device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop', lang: navigator.language, ref: document.referrer ? new URL(document.referrer).hostname : '',
  });
  location.hash = `#/result/${code}`;
}

// ---------- result ----------
async function renderResult(code) {
  const decoded = decodeProfile(code);
  if (!decoded) { app.innerHTML = `<div class="wrap narrow" style="padding-top:40px"><h1>That link doesn't decode.</h1><p>It may be from a different version. <a href="#/pick">Find your nice from scratch →</a></p></div>`; return; }
  const local = LS.get(`min.result.${decoded.id}`);
  const profile = local && local.profile ? local.profile : decoded;
  const mine = !!local;
  if (!mine) postEvent('view_shared', { session: decoded.id });
  const seed = hashString(profile.id);
  applyTheme(profile, seed);
  ensureStyles();
  const name = niceName(profile);
  const desc = describeProfile(profile);
  const url = resultUrl(code);
  const prompt = aiPrompt(profile, { url });
  const ranked = rankedAxes(profile);
  const st = styleFromVector(profile.w, seed);
  const strong = strength(profile);
  const axesHtml = AXES.map((a, i) => {
    const w = profile.w[i], s = profile.s[i];
    const conf = 1 - s;
    const untested = s > 0.75;
    const left = w < 0 ? 50 + w * 50 : 50, width = Math.abs(w) * 50;
    return `<div class="axis ${untested ? 'untested' : ''}" title="${untested ? 'not tested yet' : `${Math.round(Math.abs(w) * 100)}% toward ${w >= 0 ? a.hi : a.lo}, ${Math.round(conf * 100)}% confident`}">
      <span class="lo ${!untested && w < -0.15 ? 'on' : ''}">${a.lo}</span>
      <span class="bar"><b></b><i style="left:${left}%;width:${untested ? 0 : Math.max(2, width)}%;opacity:${(0.35 + 0.65 * conf).toFixed(2)}"></i></span>
      <span class="hi ${!untested && w > 0.15 ? 'on' : ''}">${a.hi}</span>
    </div>`;
  }).join('');
  const rating = local ? local.rating : null;

  app.innerHTML = `
    <div class="result">
      ${mine ? '' : `<div class="banner"><span>This is someone else's nice. Want yours?</span><span class="btn-row"><a class="btn secondary" href="#/pick?from=${esc(code)}">Start from theirs</a><a class="btn" href="#/pick">Start fresh</a></span></div>`}
      <section class="result-hero">
        <div class="based">based on ${profile.n} choice${profile.n === 1 ? '' : 's'}${profile.ties ? ` (and ${profile.ties} toss-up${profile.ties === 1 ? '' : 's'})` : ''},</div>
        <h1>my nice is <em>${esc(name)}</em></h1>
        <p class="muted">${profile.parent ? 'Evolved from an earlier profile · ' : ''}${desc.strongest.length ? 'Strongest signals: ' + desc.strongest.filter((r) => r.st > 0.1).map((r) => (r.side === 'hi' ? r.axis.hiAdj : r.axis.loAdj)).join(', ') : ''}</p>
      </section>

      <div class="result-grid">
        <div>
          <div class="panel">
            <h2>Things in your nice</h2>
            <p class="note">Rendered from your profile, not picked from a library. This whole page is wearing it too.</p>
            <div class="samples-row" id="my-samples"></div>
          </div>
          <div class="panel" style="margin-top:20px">
            <h2>In words</h2>
            ${desc.paras.map((p) => `<h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>`).join('')}
            ${desc.unasked.length ? `<p class="note">Not tested yet: ${esc(desc.unasked.join(', '))}. <a href="#/pick?from=${esc(code)}">Make it nicer</a> asks about those.</p>` : ''}
            <h3>Your palette</h3>
            <div class="swatches" aria-label="palette"><i style="background:${st.bg}"></i><i style="background:${st.fg}"></i><i style="background:${st.accent}"></i><i style="background:${st.accent2}"></i><i style="background:${st.accentSoft}"></i></div>
            <div class="axes">${axesHtml}</div>
          </div>
        </div>
        <div>
          <div class="panel">
            <h2>Your taste, as a prompt</h2>
            <p class="note">Paste into Claude, ChatGPT, Gemini — whatever you use. It asks the AI to remember this and apply it whenever it makes something you'll look at.</p>
            <textarea class="prompt-box" id="prompt" readonly spellcheck="false">${esc(prompt)}</textarea>
            <div class="btn-row" style="margin-top:10px"><button class="btn" id="copy-prompt">Copy prompt</button><button class="btn secondary" id="download-prompt">Download .txt</button></div>
          </div>
          <div class="panel" style="margin-top:20px">
            <h2>${mine ? 'How well does this describe you?' : 'Rate this nice'}</h2>
            <div class="rating-row">
              <div class="stars" id="stars" role="radiogroup" aria-label="rating">${[1, 2, 3, 4, 5].map((n) => `<button role="radio" aria-checked="${rating === n}" aria-label="${n} star${n > 1 ? 's' : ''}" data-star="${n}" class="${rating && n <= rating ? 'on' : ''}">★</button>`).join('')}</div>
              <span class="note" id="rating-note">${rating ? 'Thanks — this teaches the next version.' : 'Ratings are what the model learns from.'}</span>
            </div>
          </div>
          <div class="panel" style="margin-top:20px">
            <h2>Share it</h2>
            <p class="note">The link carries your taste vector, nothing else. Friends can start from your nice.</p>
            <div class="share-row"><input class="share-url" id="share-url" readonly value="${esc(url)}"><button class="btn secondary" id="copy-link">Copy link</button>${navigator.share ? '<button class="btn secondary" id="native-share">Share…</button>' : ''}</div>
          </div>
        </div>
      </div>

      <div class="next-steps">
        <a class="btn secondary big" href="#/pick" id="start-fresh">Start fresh</a>
        <a class="btn big" href="#/pick?from=${esc(code)}" id="evolve">Make it nicer →</a>
      </div>
      <p class="note" style="text-align:var(--align);margin-top:10px">Start fresh forgets this and asks ten new questions. Make it nicer keeps this as the seed and asks ten more to refine it.</p>
    </div>`;

  const samples = $('#my-samples');
  samples.appendChild(renderSample('poster', profile.w, seed + 1));
  samples.appendChild(renderSample('card', profile.w, seed + 2));

  $('#copy-prompt').addEventListener('click', async () => { if (await copyText(prompt)) { toast('Prompt copied'); postEvent('copy_prompt', { session: profile.id }); } });
  $('#download-prompt').addEventListener('click', () => {
    const blob = new Blob([prompt], { type: 'text/plain' }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `my-nice-${profile.id}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    postEvent('download_prompt', { session: profile.id });
  });
  $('#copy-link').addEventListener('click', async () => { if (await copyText(url)) { toast('Link copied'); postEvent('share', { session: profile.id, how: 'copy' }); } });
  const ns = $('#native-share');
  if (ns) ns.addEventListener('click', async () => { try { await navigator.share({ title: `my nice is ${name}`, text: `based on ${profile.n} choices, my nice is ${name}`, url }); postEvent('share', { session: profile.id, how: 'native' }); } catch { /* cancelled */ } });
  $('#start-fresh').addEventListener('click', () => { SS.del('min.pick'); postEvent('start_fresh', { session: profile.id }); });
  $('#evolve').addEventListener('click', () => { SS.del('min.pick'); postEvent('evolve', { session: profile.id }); });

  const stars = $('#stars');
  const starBtns = [...stars.querySelectorAll('button')];
  const paint = (n) => starBtns.forEach((b) => b.classList.toggle('hover-on', Number(b.dataset.star) <= n));
  starBtns.forEach((b) => {
    b.addEventListener('mouseenter', () => paint(Number(b.dataset.star)));
    b.addEventListener('mouseleave', () => paint(0));
    b.addEventListener('click', async () => {
      const n = Number(b.dataset.star);
      starBtns.forEach((x) => { x.classList.toggle('on', Number(x.dataset.star) <= n); x.setAttribute('aria-checked', String(Number(x.dataset.star) === n)); });
      if (local) { local.rating = n; LS.set(`min.result.${profile.id}`, local); }
      updateLocalSession(profile.id, { rating: n });
      $('#rating-note').textContent = n >= 4 ? 'Thanks — this teaches the next version.' : n === 3 ? 'Noted. Ten more picks usually sharpen it.' : 'Fair. That gets fed back in too.';
      postRating(profile.id, n);
    });
  });
}

// ---------- boot ----------
(async function boot() {
  ensureStyles();
  route();
  // wake the API early so the first result can be recorded; harmless if absent
  health().then((ok) => { if (!ok && apiBase()) console.info('make it nice: API not reachable, running local-only'); });
})();

// make it nice — Luke's analytics dashboard. Token-gated; talks to /api/admin/*.
// Falls back to a local-only view (sessions stored in this browser) when there is no API.
import { AXES, ARCHETYPES, encodeProfile } from '../engine.js';
import { LS, apiBase, getAdminStats, adminRecompute, localSessions, health } from '../api.js';

const app = document.getElementById('app');
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => (n == null || Number.isNaN(Number(n)) ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (n) => (n == null ? '–' : `${Math.round(n * 100)}%`);
const ago = (iso) => { if (!iso) return '–'; const s = (Date.now() - new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime()) / 1000; if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`; return `${Math.round(s / 86400)}d ago`; };
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800); }

// ---------- tiny SVG charts ----------
function barChart(series, opts = {}) {
  // series: [{ label, values: [{x, y}], cls }]; grouped bars, shared categories from the first series
  const W = 560, H = opts.height || 200, padL = 34, padB = 28, padT = 14, padR = 8;
  const cats = series[0].values.map((v) => v.x);
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v.y || 0)));
  const iw = (W - padL - padR) / Math.max(1, cats.length);
  const bw = Math.min(28, (iw * 0.7) / series.length);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'chart')}">`;
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) { const v = (max / ticks) * t; out += `<line class="axis-line" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v, max < 10 ? 1 : 0)}</text>`; }
  cats.forEach((c, i) => {
    const gx = padL + i * iw + (iw - bw * series.length) / 2;
    series.forEach((s, k) => { const v = s.values[i]?.y || 0; const yy = y(v); out += `<rect class="bar ${s.cls || ''}" x="${gx + k * bw}" y="${yy}" width="${bw - 2}" height="${Math.max(0, H - padB - yy)}" rx="2"><title>${esc(s.label)} · ${esc(c)}: ${fmt(v, 2)}</title></rect>`; });
    if (cats.length <= 16 || i % Math.ceil(cats.length / 10) === 0) out += `<text x="${padL + i * iw + iw / 2}" y="${H - padB + 16}" text-anchor="middle">${esc(opts.fmtX ? opts.fmtX(c) : c)}</text>`;
  });
  return out + '</svg>';
}

function lineOverBars(bars, line, opts = {}) {
  // bars: [{x, y}] counts on the left axis; line: [{x, y}] on a fixed 1..5 right axis
  const W = 560, H = opts.height || 220, padL = 34, padB = 28, padT = 14, padR = 30;
  const max = Math.max(1, ...bars.map((v) => v.y || 0));
  const iw = (W - padL - padR) / Math.max(1, bars.length);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const yr = (v) => padT + (H - padT - padB) * (1 - (v - 1) / 4);
  let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'chart')}">`;
  for (let t = 0; t <= 4; t++) { const v = (max / 4) * t; out += `<line class="axis-line" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }
  for (let s = 1; s <= 5; s++) out += `<text x="${W - padR + 6}" y="${yr(s) + 4}" style="fill:#2f6df6">${s}★</text>`;
  bars.forEach((b, i) => { const x = padL + i * iw + iw * 0.15, yy = y(b.y || 0); out += `<rect class="bar alt" x="${x}" y="${yy}" width="${iw * 0.7}" height="${Math.max(0, H - padB - yy)}" rx="2"><title>${esc(b.x)}: ${fmt(b.y)} sessions</title></rect>`; out += `<text x="${padL + i * iw + iw / 2}" y="${H - padB + 16}" text-anchor="middle">${esc(opts.fmtX ? opts.fmtX(b.x) : b.x)}</text>`; });
  const pts = line.filter((p) => p.y != null).map((p) => { const i = bars.findIndex((b) => b.x === p.x); return i < 0 ? null : [padL + i * iw + iw / 2, yr(p.y), p]; }).filter(Boolean);
  if (pts.length > 1) out += `<path class="line" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')}"/>`;
  for (const p of pts) out += `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="3.5"><title>${esc(p[2].x)}: avg ${fmt(p[2].y, 2)}★ (${p[2].n || 0} rated)</title></circle>`;
  return out + '</svg>';
}

// ---------- views ----------
function renderGate(msg = '') {
  app.innerHTML = `
    <div class="gate card">
      <h1 style="font-size:1.5rem">Dashboard</h1>
      <p class="muted">Paste the admin token (the ADMIN_TOKEN secret on the Worker). It's kept in this browser only.</p>
      <input id="tok" type="password" placeholder="admin token" autocomplete="off">
      ${msg ? `<p class="note" style="color:#a12b2b">${esc(msg)}</p>` : ''}
      <div class="btn-row"><button class="btn" id="go">Connect</button><button class="btn secondary" id="local">Just show local data</button></div>
      <p class="note" style="margin-top:14px">API: <code>${esc(apiBase() || '(none configured)')}</code></p>
    </div>`;
  $('#go').addEventListener('click', () => { const t = $('#tok').value.trim(); if (!t) return; LS.set('min.admin', t); load(); });
  $('#tok').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#go').click(); });
  $('#local').addEventListener('click', () => renderLocal());
}

function renderLocal(reason = '') {
  const ss = localSessions().slice().reverse();
  const rated = ss.filter((s) => s.rating);
  app.innerHTML = `
    <div class="dash-head"><h1>Dashboard · local only</h1><span class="meta"><button class="link-btn" id="retry">connect to API</button></span></div>
    <div class="mode-local">${esc(reason || 'No API reachable, so this is just what this browser has stored.')} Deploy the Worker (docs/deploy-cloudflare.md) and set an admin token to see everyone's data.</div>
    <div class="kpis">
      <div class="kpi"><div class="v">${ss.length}</div><div class="l">results in this browser</div></div>
      <div class="kpi"><div class="v">${rated.length}</div><div class="l">rated</div></div>
      <div class="kpi"><div class="v">${rated.length ? fmt(rated.reduce((a, s) => a + s.rating, 0) / rated.length, 2) : '–'}</div><div class="l">avg rating</div></div>
    </div>
    <div class="card"><h2>Recent results</h2><div class="table-wrap"><table><thead><tr><th>when</th><th>mode</th><th class="num">choices</th><th>rating</th><th>nice</th><th></th></tr></thead><tbody>
      ${ss.map((s) => `<tr><td>${esc(ago(s.createdAt))}</td><td>${esc(s.mode)}</td><td class="num">${s.n}</td><td>${s.rating ? `<span class="stars-inline">${'★'.repeat(s.rating)}</span>` : '–'}</td><td>${esc(s.niceName)}</td><td><a href="../#/result/${esc(s.code)}">open</a></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing yet — go make a nice.</td></tr>'}
    </tbody></table></div></div>`;
  $('#retry').addEventListener('click', () => { LS.del('min.admin'); renderGate(); });
}

async function load() {
  const token = LS.get('min.admin');
  if (!apiBase()) return renderLocal('No API_BASE configured in config.js.');
  if (!token) return renderGate();
  app.innerHTML = '<p class="muted">Loading…</p>';
  let data;
  try { data = await getAdminStats(token); } catch (e) {
    if (e.status === 401) { LS.del('min.admin'); return renderGate('That token was rejected.'); }
    if (e.status === 503) return renderGate('The Worker has no ADMIN_TOKEN secret yet (npm run secret:admin in worker/).');
    const ok = await health();
    return ok ? renderGate(`API error: ${e.message}`) : renderLocal(`Couldn't reach the API at ${apiBase()}.`);
  }
  let sessions = [];
  try { const r = await fetch(`${apiBase()}/api/admin/sessions?limit=40`, { headers: { authorization: `Bearer ${token}` } }); sessions = (await r.json()).sessions || []; } catch { /* optional */ }
  renderDash(data, sessions, token);
}

function renderDash(d, sessions, token) {
  const t = d.totals || {};
  const completion = t.starts ? Math.min(1, (t.completed || 0) / t.starts) : null;
  const days = []; for (let i = 29; i >= 0; i--) { const dt = new Date(Date.now() - i * 86400000); days.push(dt.toISOString().slice(0, 10)); }
  const byDay = Object.fromEntries((d.byDay || []).map((r) => [r.d, r]));
  const startsByDay = Object.fromEntries((d.startsByDay || []).map((r) => [r.d, r.c]));
  const md = (s) => s.slice(5).replace('-', '/');
  const rd = d.ratingDist || {};
  const versions = d.byVersion || [];
  const modelInfo = Object.fromEntries((d.models || []).map((m) => [m.version, m]));
  const axisValue = (d.model && d.model.axisValue) || {};
  const archW = (d.model && d.model.archetypeWeight) || {};

  app.innerHTML = `
    <div class="dash-head">
      <h1>Dashboard</h1>
      <span class="meta">model v${d.model?.version ?? 0} · ${esc(d.sampleSize)} sessions in axis stats · updated ${esc(ago(d.generatedAt))} ·
        <button class="link-btn" id="refresh">refresh</button> · <button class="link-btn" id="recompute">recompute model now</button> · <button class="link-btn" id="logout">disconnect</button></span>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="v">${fmt(t.starts)}</div><div class="l">starts</div></div>
      <div class="kpi"><div class="v">${fmt(t.completed)}</div><div class="l">completed (≥5 picks)</div><div class="sub">${completion == null ? '' : pct(completion) + ' completion'}</div></div>
      <div class="kpi"><div class="v">${fmt(t.rated)}</div><div class="l">rated</div><div class="sub">${t.completed ? pct((t.rated || 0) / t.completed) + ' of completed' : ''}</div></div>
      <div class="kpi"><div class="v">${t.avg_rating ? fmt(t.avg_rating, 2) + '★' : '–'}</div><div class="l">average rating</div><div class="sub">${t.rated ? pct(((rd['4'] || 0) + (rd['5'] || 0)) / t.rated) + ' gave 4–5★' : ''}</div></div>
      <div class="kpi"><div class="v">${fmt(t.evolved)}</div><div class="l">made it nicer</div><div class="sub">${t.completed ? pct((t.evolved || 0) / t.completed) + ' of results' : ''}</div></div>
      <div class="kpi"><div class="v">${fmt(t.share_views)}</div><div class="l">shared-link views</div><div class="sub">${fmt(d.events?.share)} shares · ${fmt(d.events?.copy_prompt)} prompts copied</div></div>
      <div class="kpi"><div class="v">${t.avg_duration ? fmt(t.avg_duration / 1000) + 's' : '–'}</div><div class="l">avg time to result</div><div class="sub">${t.avg_ties != null ? fmt(t.avg_ties, 2) + ' toss-ups avg' : ''}</div></div>
    </div>

    <div class="grid2">
      <div class="card"><h2>Last 30 days</h2><p class="sub">Starts vs completed results per day.</p>
        ${barChart([{ label: 'starts', cls: 'alt', values: days.map((x) => ({ x, y: startsByDay[x] || 0 })) }, { label: 'completed', values: days.map((x) => ({ x, y: byDay[x]?.c || 0 })) }], { fmtX: md, label: 'sessions per day' })}
        <div class="legend"><span><i style="background:var(--accent-soft);border:1px solid var(--line)"></i>starts</span><span><i style="background:var(--fg)"></i>completed</span></div>
      </div>
      <div class="card"><h2>Is the model getting better?</h2><p class="sub">Sessions per model version (bars) and their average rating (line). Up and to the right = the evolution is working.</p>
        ${versions.length ? lineOverBars(versions.map((v) => ({ x: `v${v.v}`, y: v.c })), versions.map((v) => ({ x: `v${v.v}`, y: v.r, n: v.rated })), { label: 'rating by model version' }) : '<p class="muted">No sessions yet.</p>'}
      </div>
    </div>

    <div class="grid2">
      <div class="card"><h2>Ratings</h2><p class="sub">How well people said the result described them.</p>
        ${barChart([{ label: 'ratings', cls: 'accent', values: [1, 2, 3, 4, 5].map((s) => ({ x: `${s}★`, y: rd[String(s)] || 0 })) }], { height: 180, label: 'rating distribution' })}
      </div>
      <div class="card"><h2>Sample types</h2><p class="sub">Which kinds of design led to results people liked. Weight is what the model currently uses when choosing what to show.</p>
        <div class="table-wrap"><table><thead><tr><th>type</th><th class="num">sessions</th><th class="num">rated</th><th class="num">avg ★</th><th class="num">4–5★</th><th class="num">weight</th></tr></thead><tbody>
          ${(d.archetypes || []).map((a) => `<tr><td>${esc(a.id)}</td><td class="num">${fmt(a.sessions)}</td><td class="num">${fmt(a.rated)}</td><td class="num">${a.avgRating ? fmt(a.avgRating, 2) : '–'}</td><td class="num">${a.rated ? pct(a.good / a.rated) : '–'}</td><td class="num">${fmt(archW[a.id], 2)}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px"><h2>The axes</h2><p class="sub">Where people land on each axis (dark bar: average lean of those asked; blue: how strongly, on average). "Asked" is the share of sessions that probed it; "value" is how much the model now wants to ask about it (contested axes score high, axes everyone agrees on score low).</p>
      <div class="axis-row axis-head"><span></span><span style="text-align:center">← lean →</span><span></span><span class="num">asked</span><span class="num">value</span></div>
      ${(d.axes || []).map((a) => { const left = a.mean < 0 ? 50 + a.mean * 50 : 50, width = Math.abs(a.mean) * 50; const uw = a.meanAbs * 50; return `<div class="axis-row"><span class="lo">${esc(a.lo)}</span><span class="bar"><b></b><u style="left:${50 - uw}%;width:${uw * 2}%"></u><i style="left:${left}%;width:${Math.max(1, width)}%"></i></span><span class="hi">${esc(a.hi)}</span><span class="num">${pct(a.askedShare)}</span><span class="num">${fmt(axisValue[a.id], 2)}</span></div>`; }).join('')}
    </div>

    <div class="card" style="margin-bottom:18px"><h2>Recent results</h2><p class="sub">Latest 40. Open a result to see it exactly as they did.</p>
      <div class="table-wrap"><table><thead><tr><th>when</th><th>mode</th><th class="num">picks</th><th class="num">ties</th><th>rating</th><th>nice</th><th>device</th><th class="num">secs</th><th class="num">views</th><th>model</th><th></th></tr></thead><tbody>
        ${(sessions.length ? sessions : d.recent || []).map((s) => { let code = ''; try { code = s.w ? encodeProfile({ id: s.id, parent: s.parent_id, n: s.n, ties: s.ties, w: JSON.parse(s.w), s: JSON.parse(s.s), modelVersion: s.model_version }) : ''; } catch { /* ignore */ } return `<tr><td title="${esc(s.created_at)}">${esc(ago(s.created_at))}</td><td>${esc(s.mode)}${s.parent_id ? ` <span class="pill" title="parent ${esc(s.parent_id)}">↳</span>` : ''}</td><td class="num">${s.n}</td><td class="num">${s.ties || 0}</td><td>${s.rating ? `<span class="stars-inline">${'★'.repeat(s.rating)}</span>` : '<span class="muted">–</span>'}</td><td>${esc(s.nice_name)}</td><td>${esc(s.device || '')}</td><td class="num">${s.duration_ms ? fmt(s.duration_ms / 1000) : '–'}</td><td class="num">${s.share_views || 0}</td><td>v${s.model_version}</td><td>${code ? `<a href="../#/result/${esc(code)}" target="_blank" rel="noopener">open</a>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="11" class="muted">No sessions yet.</td></tr>'}
      </tbody></table></div>
    </div>

    <div class="grid2">
      <div class="card"><h2>Model versions</h2><p class="sub">A new version is cut after every ~10 new ratings or ~50 new sessions, or when you hit "recompute".</p>
        <div class="table-wrap"><table><thead><tr><th>v</th><th>when</th><th class="num">sessions</th><th class="num">rated</th><th>why</th><th class="num">explore</th><th class="num">prior wt</th><th class="num">avg ★ under it</th></tr></thead><tbody>
          ${(d.models || []).slice().reverse().map((m) => { const v = versions.find((x) => x.v === m.version); return `<tr><td>v${m.version}</td><td>${esc(ago(m.createdAt))}</td><td class="num">${fmt(m.nSessions)}</td><td class="num">${fmt(m.nRated)}</td><td>${esc(m.reason)}</td><td class="num">${fmt(m.explore, 2)}</td><td class="num">${fmt(m.priorWeight, 2)}</td><td class="num">${v && v.r ? fmt(v.r, 2) : '–'}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">Still on the built-in default model (v0). It starts learning after 5 completed sessions.</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card"><h2>Current model</h2><p class="sub">What the site fetches at /api/model.</p>
        <details open><summary>JSON</summary><pre class="json">${esc(JSON.stringify(d.model, null, 2))}</pre></details>
      </div>
    </div>`;

  $('#refresh').addEventListener('click', load);
  $('#logout').addEventListener('click', () => { LS.del('min.admin'); renderGate(); });
  $('#recompute').addEventListener('click', async () => {
    try { const r = await adminRecompute(token); toast(`Model recomputed → v${r.model.version}`); load(); } catch (e) { toast(`Recompute failed: ${e.message}`); }
  });
}

load();

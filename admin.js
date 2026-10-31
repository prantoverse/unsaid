// UNSAID admin dashboard. Data comes from the admin_stats() RPC,
// which only answers when the admin key matches the hash stored in Supabase.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { Background } from './gl.js';
import { paletteFor, paletteFromString } from './palette.js';
import { isSafeArt } from './song.js';
import { renderStatsStory, toBlob, shareImage } from './story.js';

const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const root = document.documentElement;
const DEFAULT_PALETTE = ['#0a0618', '#7b5cff', '#ff3d81'];
const REFRESH_MS = 30_000;

const bg = new Background($('#bg'));
addEventListener('pointermove', (e) => bg.mouse(e.clientX, e.clientY), { passive: true });

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let key = store.get('unsaid:adminkey');
let days = 30;
let stats = null;
let lastMessages = null;
let timer = null;

// ── helpers ──────────────────────────────────────────────────────
function el(tag, cls, t) { const e = document.createElement(tag); if (cls) e.className = cls; if (t != null) e.textContent = t; return e; }
const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : n.toLocaleString('en-US'));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function setPalette(p) {
  const pal = p && p.length >= 3 ? p : DEFAULT_PALETTE;
  bg.setPalette(pal);
  root.style.setProperty('--accent', pal[2]);
  root.style.setProperty('--accent2', pal[1]);
}
setPalette(DEFAULT_PALETTE);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function countUp(node, to) {
  const from = Number(node.dataset.v || 0);
  node.dataset.v = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { node.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 900;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function afterimage() { document.body.classList.remove('afterimage'); void document.body.offsetWidth; document.body.classList.add('afterimage'); }

function show(id) { for (const v of ['gate', 'dash', 'loading']) $('#' + v).hidden = v !== id; $('#controls').hidden = id !== 'dash'; }

// ── gate ─────────────────────────────────────────────────────────
$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  key = $('#keyInput').value.trim();
  $('#gateMsg').textContent = 'checking…';
  const ok = await load(true);
  if (ok) { store.set('unsaid:adminkey', key); $('#keyInput').value = ''; $('#gateMsg').textContent = ''; }
});

function lock(msg) {
  key = null; stats = null;
  store.set('unsaid:adminkey', null);
  clearInterval(timer);
  show('gate');
  $('#gateMsg').textContent = msg || '';
  $('#keyInput').focus();
}
$('#lockBtn').addEventListener('click', () => lock('locked.'));

// ── data ─────────────────────────────────────────────────────────
async function load(fromGate = false) {
  const { data, error } = await sb.rpc('admin_stats', { p_key: key, p_days: days });
  if (error) {
    if (error.code === '42501' || /not authorized/i.test(error.message)) {
      if (fromGate) { $('#gateMsg').textContent = 'that key doesn’t match.'; $('#keyInput').classList.remove('shake'); void $('#keyInput').offsetWidth; $('#keyInput').classList.add('shake'); }
      else lock('session expired. enter the key again.');
    } else toast('couldn’t load: ' + error.message);
    return false;
  }
  const grew = lastMessages != null && data.totals.messages > lastMessages;
  lastMessages = data.totals.messages;
  stats = data;
  show('dash');
  render();
  if (grew) { bg.pulse(innerWidth / 2, innerHeight * 0.3, 1); toast('new song just landed ✦'); }
  if (fromGate) { afterimage(); bg.pulse(); }
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  return true;
}

$('#refreshBtn').addEventListener('click', () => { load(); bg.pulse(); });
for (const b of $$('.seg button')) {
  b.addEventListener('click', () => {
    days = Number(b.dataset.days);
    for (const x of $$('.seg button')) x.setAttribute('aria-pressed', String(x === b));
    load();
  });
}

// ── render ───────────────────────────────────────────────────────
function render() {
  const t = stats.totals;
  $('#updated').textContent = `updated ${new Date(stats.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · refreshes every 30s`;

  renderKpis(t);
  const daily = stats.daily || [];
  barChart($('#sendsChart'), daily, 'sends', 'songs');
  lineChart($('#visitorsChart'), daily, 'visitors', 'visitors');
  $('#sendsTotal').textContent = `${fmt(t.messages_range)} in ${stats.days} days`;
  $('#visitorsTotal').textContent = `${fmt(t.visitors_range)} unique in ${stats.days} days`;
  renderHours(stats.hours || []);
  renderActions(t);
  renderTops();
  renderMod();

  const top = stats.top_songs?.[0];
  if (top) paletteFor(isSafeArt(top.art) ? top.art : null, top.title).then(setPalette);
}

function renderKpis(t) {
  const items = [
    ['visitors', t.visitors, `+${fmt(t.visitors_today)} today`],
    ['songs sent', t.messages, `+${fmt(t.messages_today)} today`],
    ['people got a song', t.recipients, `${pct(t.with_handle, t.messages)}% sent to an @handle`],
    ['visitors who sent', pct(t.senders, t.visitors), `${fmt(t.senders)} of ${fmt(t.visitors)} devices`, '%'],
    ['story shares', t.story_shares, `${fmt(t.request_cards)} request cards made`],
  ];
  const box = $('#kpis');
  if (box.children.length !== items.length) {
    box.replaceChildren(...items.map(() => {
      const k = el('div', 'kpi');
      k.append(el('p', 'kpi-label'), el('p', 'kpi-num ghost-text'), el('p', 'kpi-sub'));
      return k;
    }));
  }
  items.forEach(([label, n, sub, unit], i) => {
    const k = box.children[i];
    k.querySelector('.kpi-label').textContent = label;
    const num = k.querySelector('.kpi-num');
    let span = num.querySelector('span');
    if (!span) { span = el('span'); num.append(span); if (unit) num.append(el('small', null, unit)); }
    countUp(span, n);
    k.querySelector('.kpi-sub').textContent = sub;
  });
}

// ── charts (hand-rolled SVG, one axis each) ──────────────────────
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
function niceMax(v) { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
const dayLabel = (d) => new Date(d + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' });

function frame(box, data, k) {
  const W = Math.max(280, box.clientWidth), H = 190;
  const P = { l: 30, r: 10, t: 12, b: 24 };
  const max = niceMax(Math.max(1, ...data.map((d) => d[k])));
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const y = (v) => P.t + ih - (v / max) * ih;
  for (const v of [0, max / 2, max]) {
    svg.append(svgEl('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
    const tl = svgEl('text', { x: P.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }); tl.textContent = fmt(v); svg.append(tl);
  }
  const n = data.length, step = iw / Math.max(1, n);
  const xi = (i) => P.l + step * i + step / 2;
  const labelIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  for (const i of labelIdx) {
    const tl = svgEl('text', { x: xi(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', class: 'tick' });
    if (i === 0) tl.setAttribute('x', P.l); if (i === n - 1 && n > 1) tl.setAttribute('x', W - P.r);
    tl.textContent = dayLabel(data[i].day); svg.append(tl);
  }
  return { svg, W, H, P, iw, ih, y, xi, step };
}

function hover(box, svg, f, data, k, unit, onIdx) {
  const tip = $('#tip');
  const hit = svgEl('rect', { x: f.P.l, y: f.P.t, width: f.iw, height: f.ih, fill: 'transparent' });
  svg.append(hit);
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (f.W / r.width);
    const i = Math.max(0, Math.min(data.length - 1, Math.floor((sx - f.P.l) / f.step)));
    onIdx(i);
    tip.hidden = false;
    tip.replaceChildren(el('strong', null, `${fmt(data[i][k])} ${unit}`), el('span', null, dayLabel(data[i].day)));
    const tx = Math.min(innerWidth - tip.offsetWidth - 12, Math.max(12, e.clientX - tip.offsetWidth / 2));
    tip.style.left = tx + 'px';
    tip.style.top = (r.top + (f.y(data[i][k]) * r.height) / f.H - tip.offsetHeight - 12) + 'px';
  };
  const leave = () => { tip.hidden = true; onIdx(-1); };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', leave);
}

function barChart(box, data, k, unit) {
  const f = frame(box, data, k);
  const gap = f.step > 6 ? 2 : 1;
  const bw = Math.max(1, f.step - gap);
  const bars = data.map((d, i) => {
    const h = f.y(0) - f.y(d[k]);
    const x = f.P.l + f.step * i + gap / 2;
    const r = Math.min(4, bw / 2, h);
    // rounded top, square base on the axis
    const path = h <= 0 ? '' : `M${x},${f.y(0)} V${f.y(d[k]) + r} Q${x},${f.y(d[k])} ${x + r},${f.y(d[k])} H${x + bw - r} Q${x + bw},${f.y(d[k])} ${x + bw},${f.y(d[k]) + r} V${f.y(0)} Z`;
    const p = svgEl('path', { d: path, class: 'bar' });
    f.svg.append(p);
    return p;
  });
  hover(box, f.svg, f, data, k, unit, (i) => bars.forEach((b, j) => b.classList.toggle('dim', i >= 0 && j !== i)));
  box.replaceChildren(f.svg);
}

function lineChart(box, data, k, unit) {
  const f = frame(box, data, k);
  const pts = data.map((d, i) => [f.xi(i), f.y(d[k])]);
  if (pts.length) {
    const defs = svgEl('defs');
    const g = svgEl('linearGradient', { id: 'areaFill', x1: 0, y1: 0, x2: 0, y2: 1 });
    g.append(svgEl('stop', { offset: '0%', class: 'area-top' }), svgEl('stop', { offset: '100%', class: 'area-bottom' }));
    defs.append(g); f.svg.append(defs);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    f.svg.append(svgEl('path', { d: `${line} L${pts.at(-1)[0]},${f.y(0)} L${pts[0][0]},${f.y(0)} Z`, fill: 'url(#areaFill)' }));
    f.svg.append(svgEl('path', { d: line, class: 'line' }));
    f.svg.append(svgEl('circle', { cx: pts.at(-1)[0], cy: pts.at(-1)[1], r: 4.5, class: 'end' }));
  }
  const cross = svgEl('line', { y1: f.P.t, y2: f.y(0), class: 'cross', visibility: 'hidden' });
  const dot = svgEl('circle', { r: 5, class: 'end', visibility: 'hidden' });
  f.svg.append(cross, dot);
  hover(box, f.svg, f, data, k, unit, (i) => {
    const vis = i >= 0 ? 'visible' : 'hidden';
    cross.setAttribute('visibility', vis); dot.setAttribute('visibility', vis);
    if (i >= 0) { cross.setAttribute('x1', pts[i][0]); cross.setAttribute('x2', pts[i][0]); dot.setAttribute('cx', pts[i][0]); dot.setAttribute('cy', pts[i][1]); }
  });
  box.replaceChildren(f.svg);
}

function renderHours(hours) {
  const max = Math.max(1, ...hours);
  const box = $('#hours');
  box.replaceChildren(...hours.map((n, h) => {
    const c = el('div', 'hour');
    c.style.setProperty('--v', (n / max).toFixed(3));
    const label = `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? 'am' : 'pm'}`;
    c.title = `${label}: ${n} song${n === 1 ? '' : 's'}`;
    c.setAttribute('aria-label', c.title);
    return c;
  }));
}

function renderActions(t) {
  const rows = [
    ['page visits', t.visits], ['songs opened', t.views], ['previews played', t.plays], ['name searches', t.searches],
    ['request cards made', t.request_cards], ['story shares', t.story_shares],
    ['delivered by app', t.deliveries ?? 0], ['emailed anonymously', t.emailed ?? 0], ['sent private', t.private ?? 0],
    ['guide opened', t.guides],
  ];
  const max = Math.max(1, ...rows.map((r) => r[1]));
  $('#actions').replaceChildren(...rows.map(([label, n]) => {
    const li = el('li');
    const bar = el('span', 'bar-fill'); bar.style.setProperty('--w', (n / max * 100).toFixed(1) + '%');
    li.append(el('span', 'bar-label', label), el('span', 'bar-track'), el('span', 'bar-num', fmt(n)));
    li.querySelector('.bar-track').append(bar);
    return li;
  }));
}

function toplist(node, rows, render) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) { node.replaceChildren(el('li', 'empty-row', 'nothing yet')); return; }
  node.replaceChildren(...rows.map((r) => {
    const li = el('li');
    li.style.setProperty('--w', (r.n / max * 100).toFixed(1) + '%');
    render(li, r);
    li.append(el('span', 'top-n', fmt(r.n)));
    return li;
  }));
}

function renderTops() {
  toplist($('#topSongs'), stats.top_songs || [], (li, r) => {
    const art = el('span', 'top-art');
    if (isSafeArt(r.art)) { const i = el('img'); i.src = r.art; i.alt = ''; i.referrerPolicy = 'no-referrer'; art.append(i); }
    else { const p = paletteFromString(r.title); art.style.background = `linear-gradient(135deg, ${p[1]}, ${p[2]})`; }
    const m = el('span', 'top-meta'); m.append(el('strong', null, r.title), el('small', null, r.artist || ''));
    li.append(art, m);
  });
  toplist($('#topArtists'), stats.top_artists || [], (li, r) => { const m = el('span', 'top-meta'); m.append(el('strong', null, r.artist)); li.append(m); });
  toplist($('#topRecipients'), stats.top_recipients || [], (li, r) => {
    const m = el('span', 'top-meta'); m.append(el('strong', null, r.name), el('small', null, r.handle ? '@' + r.handle : ''));
    li.append(m);
  });
}

function renderMod() {
  const rows = stats.recent || [];
  const flagged = rows.filter((r) => r.reports > 0 || r.hidden).length;
  $('#modHint').textContent = flagged ? `${flagged} need a look` : 'latest 30 · nothing flagged';
  $('#modBody').replaceChildren(...rows.map((r) => {
    const tr = el('tr');
    if (r.hidden || r.reports) tr.className = 'flag';
    const status = r.hidden ? 'hidden' : r.reports ? `${r.reports} report${r.reports > 1 ? 's' : ''}` : r.private ? 'private' : 'live';
    const to = el('td'); to.append(el('strong', null, r.to_name), el('small', null, r.to_handle ? '@' + r.to_handle : ''));
    const msg = el('td', 'msg-cell', r.message);
    const song = el('td', 'song-cell', r.song_title + (r.song_artist ? ' — ' + r.song_artist : ''));
    const when = el('td', 'nowrap', timeAgo(r.created_at));
    const st = el('td'); st.append(el('span', 'pill ' + (r.hidden ? 'pill-hidden' : r.reports ? 'pill-warn' : 'pill-ok'), status));
    const act = el('td', 'nowrap');
    const open = el('a', 'link', 'open'); open.href = `./?m=${r.id}`; open.target = '_blank'; open.rel = 'noopener';
    const toggle = el('button', 'link', r.hidden ? 'unhide' : 'hide'); toggle.type = 'button';
    toggle.addEventListener('click', () => moderate(r.id, r.hidden ? 'unhide' : 'hide'));
    const del = el('button', 'link danger', 'delete'); del.type = 'button';
    del.addEventListener('click', () => {
      if (del.dataset.armed) return moderate(r.id, 'delete');
      del.dataset.armed = '1'; del.textContent = 'sure?';
      setTimeout(() => { delete del.dataset.armed; del.textContent = 'delete'; }, 3000);
    });
    act.append(open, toggle, del);
    tr.append(to, msg, song, when, st, act);
    return tr;
  }));
}

async function moderate(id, action) {
  const { data, error } = await sb.rpc('admin_moderate', { p_key: key, p_id: id, p_action: action });
  if (error || !data) return toast(error ? error.message : 'nothing changed');
  toast(action === 'delete' ? 'deleted' : action === 'hide' ? 'hidden from the site' : 'back on the site');
  load();
}

// ── stats story ──────────────────────────────────────────────────
let story = null;
$('#storyBtn').addEventListener('click', async () => {
  if (!stats) return;
  toast('rendering…');
  try {
    const blob = await toBlob(await renderStatsStory(stats, bg.palette));
    if (story?.url) URL.revokeObjectURL(story.url);
    story = { blob, url: URL.createObjectURL(blob) };
    $('#storyPreview').src = story.url;
    $('#storyDownload').href = story.url;
    $('#storyDownload').download = 'unsaid-stats.png';
    $('#storyDialog').showModal();
    bg.pulse();
  } catch (e) { console.warn(e); toast('couldn’t render the card'); }
});
$('#storyShare').addEventListener('click', async () => {
  if (!story) return;
  const r = await shareImage(story.blob, 'unsaid-stats.png');
  if (r === 'downloaded') toast('saved. post it from your phone');
});
for (const b of $$('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());
for (const d of $$('dialog')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });

let rT;
addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => stats && render(), 200); });

// ── go ───────────────────────────────────────────────────────────
if (key) { show('loading'); if (!(await load()) && $('#gate').hidden) { show('gate'); $('#gateMsg').textContent = 'couldn’t reach the database. try again.'; } }
else lock();

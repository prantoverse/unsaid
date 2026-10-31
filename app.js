import { SUPABASE_URL, SUPABASE_ANON_KEY, LIMITS, SEND_COOLDOWN_MS, EMAIL_DELIVERY } from './config.js';
import { Background } from './gl.js';
import { Preview } from './audio.js';
import { searchSongs, normalizeLink, fetchLinkMeta, embedFor, isSafeArt, isSafePreview } from './song.js';
import { paletteFor, paletteFromString } from './palette.js';
import { renderMessageStory, renderRequestStory, toBlob, shareImage } from './story.js';

// ── basics ───────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const root = document.documentElement;
const DEFAULT_PALETTE = ['#0a0618', '#7b5cff', '#ff3d81'];
const DEFAULT_PROMPT = 'send me a song that reminds you of me';
const COLS = 'id,to_name,to_handle,message,lyric,song_title,song_artist,artwork_url,preview_url,song_url,palette,created_at';
const PAGE = 24;

const configured = /^https:\/\//.test(SUPABASE_URL) && !SUPABASE_URL.includes('YOUR-PROJECT');
// No keys yet → demo mode with sample data, so the UI can be explored.
const demo = configured ? null : await import('./demo.js');
const sb = configured
  ? (await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm')).createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  : demo.demoClient();
const findSongs = demo ? demo.demoSearch : searchSongs;
if (demo) $('#demoBadge').hidden = false;

const bg = new Background($('#bg'));
const player = new Preview();
bg.listen(player.levels);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const getMine = () => store.get('unsaid:mine', []);

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function text(tag, cls, t) { const e = el(tag, cls); e.textContent = t; return e; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const appUrl = () => location.origin + location.pathname;
const msgLink = (id) => `${appUrl()}?m=${id}`;
const palOf = (m) => (m.palette && m.palette.length >= 3 ? m.palette : paletteFromString(m.song_title + m.id));

function cleanHandle(raw) {
  const h = String(raw || '').trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null;
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  const u = [[60, 'm'], [24, 'h'], [7, 'd'], [4.35, 'w'], [12, 'mo']];
  let v = s / 60;
  for (let i = 0; i < u.length; i++) {
    const next = u[i + 1];
    if (!next || v < next[0]) return `${Math.floor(v)}${u[i][1]} ago`;
    v /= next[0];
  }
  return `${Math.floor(v)}y ago`;
}

function randomId(n = 10) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => abc[b % 62]).join('');
}
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── anonymous usage events (random per-device id, nothing personal) ──
const DEVICE = (() => {
  let d = store.get('unsaid:device', null);
  if (!/^[0-9a-f]{32}$/.test(d || '')) { d = randomHex(16); store.set('unsaid:device', d); }
  return d;
})();
function track(kind, ref = null) {
  if (demo) return;
  sb.from('events').insert({ device: DEVICE, kind, ref }).then(() => {}, () => {});
}

// ── visual feedback ──────────────────────────────────────────────
function setPalette(p) {
  const pal = p && p.length >= 3 ? p : DEFAULT_PALETTE;
  bg.setPalette(pal);
  root.style.setProperty('--accent', pal[2]);
  root.style.setProperty('--accent2', pal[1]);
}
setPalette(DEFAULT_PALETTE);

function pulseFrom(node, s = 1) {
  if (!node) return bg.pulse(innerWidth / 2, innerHeight / 2, s);
  const r = node.getBoundingClientRect();
  bg.pulse(r.left + r.width / 2, r.top + r.height / 2, s);
}
function afterimage() { document.body.classList.remove('afterimage'); void document.body.offsetWidth; document.body.classList.add('afterimage'); }
function shake(node) { if (!node) return; node.classList.remove('shake'); void node.offsetWidth; node.classList.add('shake'); }

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function copy(link, notify = true) {
  return navigator.clipboard?.writeText(link)
    .then(() => notify && toast('link copied'))
    .catch(() => notify && window.prompt('copy this link', link));
}

addEventListener('pointermove', (e) => bg.mouse(e.clientX, e.clientY), { passive: true });
document.addEventListener('input', (e) => { if (e.target.matches('input, textarea')) bg.energy(0.12); });

// album art / buttons breathe with the bass
(function tick() {
  const l = player.levels();
  root.style.setProperty('--lvl', l ? l.bass.toFixed(3) : '0');
  requestAnimationFrame(tick);
})();

// ── router ───────────────────────────────────────────────────────
const VIEWS = ['setup', 'home', 'search', 'send', 'sent', 'message', 'mine', 'missing', 'loading'];
function show(name) {
  for (const v of VIEWS) $('#view-' + v).hidden = v !== name;
  scrollTo(0, 0);
  if (name !== 'loading') afterimage();
}

// Demo mode routes in memory (sandboxed previews can't change the URL).
let memParams = demo ? new URLSearchParams() : null;
const params = () => memParams || new URLSearchParams(location.search);
function go(url) {
  if (memParams) memParams = new URL(url, location.href).searchParams;
  else history.pushState(null, '', url);
  route();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
addEventListener('popstate', route);

async function route() {
  player.stop(); syncPlay();
  document.title = "UNSAID — songs you can't say";
  const p = params();
  if (p.get('m')) return showMessage(p.get('m'));
  if (p.has('q')) return showSearch(p.get('q') || '');
  if (p.has('for')) return showSend({ to: p.get('for') || '', name: p.get('n'), prompt: p.get('p') });
  if (p.has('send')) return showSend({});
  if (p.has('mine')) return showMine();
  if (p.has('guide')) { await showHome(); return openTour(0); }
  return showHome();
}

// ── cards ────────────────────────────────────────────────────────
function card(m) {
  const li = el('li');
  const a = el('a', 'card');
  a.href = `./?m=${m.id}`;
  a.dataset.nav = '';
  const pal = palOf(m);
  a.style.setProperty('--c1', pal[1]);
  a.style.setProperty('--c2', pal[2]);
  const art = el('div', 'card-art');
  if (isSafeArt(m.artwork_url)) {
    const img = el('img'); img.src = m.artwork_url; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    art.append(img);
  } else art.classList.add('noart');
  const body = el('div', 'card-body');
  body.append(
    text('p', 'card-to', 'to: ' + m.to_name + (m.to_handle ? ' · @' + m.to_handle : '')),
    text('p', 'card-msg', m.message),
    text('p', 'card-song', '♪ ' + m.song_title + (m.song_artist ? ' — ' + m.song_artist : '')),
    text('p', 'card-time', timeAgo(m.created_at) + (m.private ? ' · private' : '')),
  );
  a.append(art, body);
  a.addEventListener('pointerenter', () => setPalette(pal));
  li.append(a);
  return li;
}

// ── home ─────────────────────────────────────────────────────────
let wallPage = 0;
async function showHome() {
  show('home');
  setPalette(DEFAULT_PALETTE);
  wallPage = 0;
  $('#wall').replaceChildren();
  await loadWall();
}
async function loadWall() {
  const from = wallPage * PAGE;
  const { data, error } = await sb.from('messages').select(COLS)
    .order('created_at', { ascending: false }).range(from, from + PAGE - 1);
  if (error) return toast(error.message);
  for (const m of data) $('#wall').append(card(m));
  $('#moreBtn').hidden = data.length < PAGE;
  wallPage++;
}
$('#moreBtn').addEventListener('click', loadWall);

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  if (!q) return shake($('#searchInput'));
  go('./?q=' + encodeURIComponent(q));
});

// ── search ───────────────────────────────────────────────────────
async function showSearch(q) {
  show('loading');
  track('search');
  const handle = q.startsWith('@') ? cleanHandle(q) : null;
  const key = q.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\\%_,()*"]/g, '');
  let query = sb.from('messages').select(COLS).order('created_at', { ascending: false }).limit(60);
  if (handle) query = query.eq('to_handle', handle);
  else if (key) query = query.or(`to_key.ilike.%${key}%,to_handle.ilike.%${key}%`);
  const { data, error } = await query;
  if (error) { toast(error.message); return showHome(); }

  $('#searchTitle').textContent = handle ? '@' + handle : `“${q}”`;
  $('#searchSendBtn').href = './?for=' + encodeURIComponent(handle ? '@' + handle : q);
  const list = $('#searchResults');
  list.replaceChildren(...data.map(card));
  $('#searchEmpty').hidden = data.length > 0;
  setPalette(data[0] ? palOf(data[0]) : paletteFromString(q));
  document.title = `songs for ${handle ? '@' + handle : q} · UNSAID`;
  show('search');
}

// ── send ─────────────────────────────────────────────────────────
let chosen = null;
let chooseToken = 0, searchToken = 0, linkToken = 0;

function resetSend() {
  $('#sendForm').reset();
  chosen = null;
  $('#chosen').hidden = true;
  $('#songResults').replaceChildren();
  $('#linkHint').textContent = '';
  $('.tabs').hidden = false;
  setTab('search');
  $('#toFields').hidden = false;
  $('#emailField').hidden = !(EMAIL_DELIVERY || demo);
  syncPrivacyNote();
  updateCounters();
}

function syncPrivacyNote() {
  $('#sendNote').textContent = $('#isPrivate').checked
    ? 'private · only people with the link · no name attached'
    : 'public on the wall · no account · no name attached';
}
$('#isPrivate').addEventListener('change', () => { syncPrivacyNote(); bg.energy(0.4); pulseFrom($('#isPrivate').closest('.switch'), 0.4); });

const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
const EMAIL_ERRORS = {
  not_configured: 'email delivery isn’t switched on yet. send them the link instead',
  unavailable: 'that address can’t get UNSAID emails. send them the link instead',
  device_limit: 'you’ve used today’s 3 emails. send them the link instead',
  daily_limit: 'UNSAID hit today’s email limit. send them the link instead',
  too_old: 'too late to email this one. send them the link instead',
  already_sent: 'already emailed',
};
async function deliverEmail(id, email) {
  if (demo) { await new Promise((r) => setTimeout(r, 700)); return { ok: true }; }
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/send-song-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ id, email, device: DEVICE }),
    });
    return await r.json().catch(() => ({ ok: false, reason: 'send_failed' }));
  } catch { return { ok: false, reason: 'send_failed' }; }
}

function setupDeliver(id, isPrivate) {
  const link = msgLink(id);
  const teaser = 'someone sent you a song 🎧';
  const msg = `${teaser}\n${link}`;
  const enc = encodeURIComponent;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  $('#dWhatsApp').href = `https://wa.me/?text=${enc(msg)}`;
  $('#dTelegram').href = `https://t.me/share/url?url=${enc(link)}&text=${enc(teaser)}`;
  $('#dMessenger').href = mobile ? `fb-messenger://share/?link=${enc(link)}` : `https://www.messenger.com/`;
  $('#dWhatsApp').onclick = () => track('deliver', id);
  $('#dTelegram').onclick = () => track('deliver', id);
  $('#dMessenger').onclick = () => {
    track('deliver', id);
    if (!mobile) { copy(link, false); toast('link copied. paste it in Messenger'); }
  };
  $('#dShare').hidden = !navigator.share;
  $('#dShare').onclick = async () => {
    track('deliver', id);
    try { await navigator.share({ title: 'UNSAID', text: teaser, url: link }); } catch { /* cancelled */ }
  };
  $('#dCopy').onclick = () => { track('deliver', id); copy(link); };
  $('#sentLead').textContent = isPrivate
    ? 'it’s private: only this link opens it. get it to them.'
    : 'your name isn’t on it. it’s on the wall, or get it to them directly.';
}

function showSend({ to, name, prompt }) {
  resetSend();
  if (to) {
    const h = to.startsWith('@') ? cleanHandle(to) : null;
    const n = (name || (h ? '' : to)).trim().slice(0, LIMITS.name);
    $('#toHandle').value = h ? '@' + h : '';
    $('#toName').value = n;
    $('#forHeader').hidden = false;
    $('#sendTitle').hidden = true;
    $('#forName').textContent = h ? '@' + h : n;
    $('#forPrompt').textContent = (prompt || DEFAULT_PROMPT).slice(0, 80);
    $('#toFields').hidden = !!n;           // recipient fixed by their request link
    setPalette(paletteFromString(h || n));
    document.title = `send ${h ? '@' + h : n} a song · UNSAID`;
  } else {
    $('#forHeader').hidden = true;
    $('#sendTitle').hidden = false;
    setPalette(DEFAULT_PALETTE);
  }
  show('send');
}

function setTab(name) {
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const p of $$('[data-pane]')) p.hidden = p.dataset.pane !== name || !!chosen;
}
for (const t of $$('.tab')) t.addEventListener('click', () => setTab(t.dataset.tab));

$('#songQuery').addEventListener('input', debounce(async () => {
  const q = $('#songQuery').value.trim();
  const tok = ++searchToken;
  const list = $('#songResults');
  if (q.length < 2) { list.replaceChildren(); return; }
  list.classList.add('loading');
  let res = [];
  try { res = await findSongs(q); } catch { /* network */ }
  if (tok !== searchToken) return;
  list.classList.remove('loading');
  list.replaceChildren();
  if (!res.length) { list.append(text('li', 'empty-row', 'no matches. try the paste-link tab')); return; }
  for (const s of res) {
    const li = el('li');
    const b = el('button', 'result'); b.type = 'button';
    const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.src = s.artwork.replace(/\/600x600bb\./, '/100x100bb.');
    const meta = el('span');
    meta.append(text('strong', null, s.title), text('small', null, s.artist));
    b.append(img, meta);
    b.addEventListener('click', () => choose(s, b));
    li.append(b);
    list.append(li);
  }
}, 350));

$('#songLink').addEventListener('input', debounce(async () => {
  const raw = $('#songLink').value.trim();
  const tok = ++linkToken;
  if (!raw) { $('#linkHint').textContent = ''; return; }
  const url = normalizeLink(raw);
  if (!url) { $('#linkHint').textContent = 'spotify, youtube, soundcloud or apple music links only'; return; }
  $('#linkHint').textContent = 'reading link…';
  const meta = await fetchLinkMeta(url);
  if (tok !== linkToken) return;
  $('#linkHint').textContent = '';
  choose({ title: meta.title, artist: meta.artist, artwork: meta.artwork, preview: null, url }, $('#songLink'));
  if (!meta.title) toast('couldn’t read the title. type it in');
}, 450));

async function choose(s, fromEl) {
  const tok = ++chooseToken;
  chosen = {
    title: s.title || '',
    artist: s.artist || '',
    artwork: isSafeArt(s.artwork) ? s.artwork : null,
    preview: isSafePreview(s.preview) ? s.preview : null,
    url: s.url ? normalizeLink(s.url) : null,
    palette: null,
  };
  $('#songResults').replaceChildren();
  $('#songQuery').value = '';
  $('#chosenTitle').value = chosen.title;
  $('#chosenArtist').value = chosen.artist;
  const art = $('#chosenArt');
  if (chosen.artwork) { art.src = chosen.artwork; art.hidden = false; } else { art.removeAttribute('src'); art.hidden = true; }
  $('#chosenPlay').hidden = !chosen.preview;
  $('#chosen').hidden = false;
  for (const p of $$('[data-pane]')) p.hidden = true;
  $('.tabs').hidden = true;
  pulseFrom(fromEl || $('#chosen'), 0.8);
  bg.energy(0.6);

  const pal = await paletteFor(chosen.artwork, chosen.title || chosen.url);
  if (tok !== chooseToken) return;
  chosen.palette = pal;
  setPalette(pal);
  player.stop(); syncPlay();
  if (chosen.preview) player.load(chosen.preview).then(syncPlay).catch(() => { $('#chosenPlay').hidden = true; });
  if (!chosen.title) $('#chosenTitle').focus();
}

$('#chosenClear').addEventListener('click', () => {
  chooseToken++;
  chosen = null;
  player.stop(); syncPlay();
  $('#chosen').hidden = true;
  $('.tabs').hidden = false;
  $('#songLink').value = '';
  setTab($('.tab.active')?.dataset.tab || 'search');
  $('#songQuery').focus();
});
$('#chosenPlay').addEventListener('click', () => player.toggle().catch(() => toast('preview unavailable')));

function bindCounter(input, out, max) {
  const upd = () => { out.textContent = `${input.value.length}/${max}`; out.classList.toggle('near', input.value.length > max * 0.85); };
  input.addEventListener('input', upd);
  return upd;
}
const counters = [bindCounter($('#message'), $('#messageCount'), LIMITS.message), bindCounter($('#lyric'), $('#lyricCount'), LIMITS.lyric)];
function updateCounters() { counters.forEach((f) => f()); }

$('#sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#sendBtn');
  if ($('#hp').value) return show('sent'); // bot: pretend success

  const to_name = $('#toName').value.trim().replace(/\s+/g, ' ');
  const handleRaw = $('#toHandle').value.trim();
  const to_handle = handleRaw ? cleanHandle(handleRaw) : null;
  const message = $('#message').value.trim();
  const lyric = $('#lyric').value.trim();
  const title = $('#chosenTitle').value.trim();
  const artist = $('#chosenArtist').value.trim();
  const isPrivate = $('#isPrivate').checked;
  const toEmail = $('#emailField').hidden ? '' : $('#toEmail').value.trim();
  const fail = (msg, node) => { toast(msg); if (node && !node.closest('[hidden]')) { node.focus(); shake(node); } };

  if (!to_name) { $('#toFields').hidden = false; return fail('who is it for?', $('#toName')); }
  if (handleRaw && !to_handle) return fail('that @handle looks off', $('#toHandle'));
  if (!chosen) return fail('pick a song first', $('#songQuery'));
  if (!title) return fail('add the song title', $('#chosenTitle'));
  if (!message) return fail('say something. even one word', $('#message'));
  if (toEmail && !EMAIL_RE.test(toEmail)) return fail('that email looks off', $('#toEmail'));
  const last = store.get('unsaid:last', 0);
  if (Date.now() - last < SEND_COOLDOWN_MS) return fail('breathe. try again in a few seconds', btn);

  btn.disabled = true;
  btn.classList.add('sending');
  const id = randomId(10);
  const token = randomHex(24);
  const row = {
    id, to_name, to_handle, message,
    lyric: lyric || null,
    song_title: title,
    song_artist: artist || null,
    artwork_url: chosen.artwork,
    preview_url: chosen.preview,
    song_url: chosen.url,
    palette: chosen.palette || paletteFromString(title),
    token_hash: await sha256(token),
    private: isPrivate,
  };
  const { error } = await sb.from('messages').insert(row);
  btn.disabled = false;
  btn.classList.remove('sending');
  if (error) { console.warn(error); return fail('couldn’t send: ' + error.message, btn); }

  store.set('unsaid:last', Date.now());
  store.set('unsaid:mine', [{ id, token, at: Date.now() }, ...getMine()].slice(0, 200));
  track('send', id);
  pulseFrom(btn, 1);
  player.stop(); syncPlay();
  $('#sentOpen').href = `./?m=${id}`;
  setupDeliver(id, isPrivate);
  const status = $('#emailStatus');
  status.hidden = !toEmail;
  show('sent');
  if (toEmail) {
    status.className = 'email-status pending';
    status.textContent = 'emailing them anonymously…';
    const r = await deliverEmail(id, toEmail);
    if (r.ok) {
      status.className = 'email-status ok';
      status.textContent = '✓ emailed. it says “someone sent you a song”, nothing about you';
      track('email', id);
      pulseFrom(status, 0.6);
    } else {
      status.className = 'email-status err';
      status.textContent = EMAIL_ERRORS[r.reason] || 'couldn’t email it. send them the link instead';
    }
  }
});
$('#sentAnother').addEventListener('click', () => route());

// ── single message ───────────────────────────────────────────────
let current = null;

async function showMessage(id) {
  show('loading');
  if (!/^[A-Za-z0-9]{10}$/.test(id)) return show('missing');
  const { data: rows, error } = await sb.rpc('get_messages', { p_ids: [id] });
  const m = rows?.[0];
  if (error || !m) return show('missing');
  current = m;
  track('view', m.id);
  setPalette(palOf(m));

  $('#mPrivate').hidden = !m.private;
  $('#mTo').textContent = 'to: ' + m.to_name + (m.to_handle ? ' · @' + m.to_handle : '');
  const art = $('#mArt');
  const hasArt = isSafeArt(m.artwork_url);
  if (hasArt) art.src = m.artwork_url; else art.removeAttribute('src');
  art.hidden = !hasArt;
  $('#mVinyl').hidden = hasArt;
  $('#mTitle').textContent = m.song_title;
  $('#mArtist').textContent = m.song_artist || '';
  $('#mLyric').textContent = m.lyric ? `“${m.lyric}”` : '';
  $('#mLyric').hidden = !m.lyric;
  $('#mMessage').textContent = m.message;
  $('#mTime').textContent = timeAgo(m.created_at);

  const wrap = $('#mEmbed');
  wrap.replaceChildren();
  const em = embedFor(m.song_url);
  if (em) {
    const f = el('iframe', 'embed-' + em.kind);
    f.src = em.src; f.loading = 'lazy'; f.title = 'song player';
    f.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    wrap.append(f);
  }
  if (m.song_url) {
    const a = text('a', 'link', 'open song ↗');
    a.href = m.song_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    wrap.append(a);
  }

  $('#mDelete').hidden = !getMine().some((x) => x.id === m.id);
  $('#mSendOne').href = './?for=' + encodeURIComponent(m.to_handle ? '@' + m.to_handle : m.to_name) + (m.to_handle ? '&n=' + encodeURIComponent(m.to_name) : '');
  $('#mSendOne').textContent = `send ${m.to_handle ? '@' + m.to_handle : m.to_name} a song`;
  document.title = `${m.song_title} · for ${m.to_name} · UNSAID`;

  const canPlay = isSafePreview(m.preview_url);
  $('#mPlay').hidden = !canPlay;
  show('message');
  pulseFrom($('#msgCard .art-wrap'), 0.9);
  if (canPlay) player.load(m.preview_url).then(syncPlay).catch(() => { $('#mPlay').hidden = true; });
}

$('#mPlay').addEventListener('click', () => {
  if (!player.playing) track('play', current?.id);
  player.toggle().catch(() => toast('preview unavailable'));
  pulseFrom($('#mPlay'), 0.6);
});
$('#mCopy').addEventListener('click', () => current && copy(msgLink(current.id)));
$('#mStory').addEventListener('click', () => current && makeStory(
  renderMessageStory(current, palOf(current)),
  `unsaid-${current.id}.png`,
  msgLink(current.id),
  'Instagram → Story → add a Link sticker on the dashed box → paste. The link is already copied.',
));

$('#mReport').addEventListener('click', async () => {
  if (!current) return;
  const reported = store.get('unsaid:reported', []);
  if (reported.includes(current.id)) return toast('already reported. thanks');
  if (!confirm('Report this message as abusive or harmful?')) return;
  const { error } = await sb.rpc('report_message', { p_id: current.id });
  if (error) return toast(error.message);
  store.set('unsaid:reported', [...reported, current.id].slice(-500));
  toast('reported. thank you');
});

$('#mDelete').addEventListener('click', async () => {
  const entry = getMine().find((x) => x.id === current?.id);
  if (!entry || !confirm('Delete this song for good?')) return;
  const { data, error } = await sb.rpc('delete_message', { p_id: entry.id, p_token: entry.token });
  if (error || !data) return toast(error ? error.message : 'couldn’t delete');
  store.set('unsaid:mine', getMine().filter((x) => x.id !== entry.id));
  toast('deleted');
  go('./?mine');
});

// play button state + progress ring
const RING = 2 * Math.PI * 20;
$('#mRing').style.strokeDasharray = RING;
function syncPlay() {
  const playing = player.playing;
  $('#mPlayIcon').textContent = playing ? '❚❚' : '▶';
  $('#chosenPlay').textContent = playing ? '❚❚' : '▶';
  $('#mRing').style.strokeDashoffset = RING * (1 - player.progress());
  document.body.classList.toggle('is-playing', playing);
}
player.onstate = syncPlay;

// ── my sent ──────────────────────────────────────────────────────
async function showMine() {
  show('loading');
  const mine = getMine();
  let rows = [];
  if (mine.length) {
    const { data, error } = await sb.rpc('get_messages', { p_ids: mine.slice(0, 50).map((x) => x.id) });
    if (error) toast(error.message);
    rows = (data || []).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  $('#mineList').replaceChildren(...rows.map(card));
  $('#mineEmpty').hidden = rows.length > 0;
  setPalette(rows[0] ? palOf(rows[0]) : DEFAULT_PALETTE);
  show('mine');
}

// ── stories ──────────────────────────────────────────────────────
let story = null;
async function makeStory(canvasPromise, filename, link, hint) {
  toast('rendering…');
  let blob;
  try { blob = await toBlob(await canvasPromise); }
  catch (e) { console.warn(e); return toast('couldn’t render that one'); }
  if (story?.url) URL.revokeObjectURL(story.url);
  const url = URL.createObjectURL(blob);
  story = { blob, filename, link, url };
  $('#storyPreview').src = url;
  $('#storyDownload').href = url;
  $('#storyDownload').download = filename;
  $('#storyHint').textContent = hint;
  copy(link, false);
  $('#storyDialog').showModal();
  pulseFrom(null, 0.7);
}

$('#storyShare').addEventListener('click', async () => {
  if (!story) return;
  track('story_share');
  copy(story.link, false);
  const r = await shareImage(story.blob, story.filename);
  if (r === 'shared') toast('link copied. add a Link sticker ✦');
  else if (r === 'downloaded') toast('saved. post it from Instagram → Story');
});

// request card
function requestLink({ name, handle, prompt }) {
  const u = new URL(appUrl());
  u.searchParams.set('for', handle ? '@' + handle : name);
  if (handle) u.searchParams.set('n', name);
  if (prompt && prompt !== DEFAULT_PROMPT) u.searchParams.set('p', prompt);
  return u.toString();
}

$('#reqOpenBtn').addEventListener('click', () => {
  const me = store.get('unsaid:me', {});
  $('#reqName').value = me.name || '';
  $('#reqHandle').value = me.handle ? '@' + me.handle : '';
  $('#reqPrompt').value = me.prompt && me.prompt !== DEFAULT_PROMPT ? me.prompt : '';
  $('#reqDialog').showModal();
});

$('#reqForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#reqName').value.trim().replace(/\s+/g, ' ').slice(0, LIMITS.name);
  const handleRaw = $('#reqHandle').value.trim();
  const handle = handleRaw ? cleanHandle(handleRaw) : null;
  if (!name) return shake($('#reqName'));
  if (handleRaw && !handle) { toast('that @handle looks off'); return shake($('#reqHandle')); }
  const prompt = $('#reqPrompt').value.trim().slice(0, 80) || DEFAULT_PROMPT;
  store.set('unsaid:me', { name, handle, prompt });
  track('request_card');
  $('#reqDialog').close();
  const pal = paletteFromString(handle || name);
  setPalette(pal);
  makeStory(
    renderRequestStory({ name, handle, prompt }, pal),
    'unsaid-request.png',
    requestLink({ name, handle, prompt }),
    'Instagram → Story → add a Link sticker over the dashed box → paste. Your link is already copied.',
  );
});

// dialogs: close buttons + backdrop click
for (const b of $$('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());
for (const d of $$('dialog')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });

// ── guided tour (same pattern as AFTERIMAGE's) ───────────────────
const TOUR = [
  {
    title: 'Say it with a song',
    body: 'UNSAID lets you send someone a song and the words you never said. It is anonymous: no account, no name attached. Here is how it works in one minute.',
    hero: true,
  },
  {
    title: 'Send a song',
    body: 'Write who it is for, pick a song, then say what you never said.',
    target: '.cta .btn.primary',
    flow: ['to: their name or @handle', 'search a song or paste a Spotify / YouTube link', 'add your message (and the line that hit)', 'send. then deliver it by link or email, or let them find it'],
    numbered: true,
    actions: [{ label: 'send one now', run: () => { closeTour(); go('./?send'); } }],
  },
  {
    title: 'Find songs sent to you',
    body: 'Search your name or your @handle. A handle finds only yours; a name finds everyone with that name.',
    target: '#searchForm',
    actions: [{ label: 'search my name', run: () => { closeTour(); $('#searchInput').focus(); } }],
  },
  {
    title: 'Ask for songs',
    body: 'Make a request card for your Instagram story. Friends who tap it land on a form already addressed to you.',
    target: '#reqOpenBtn',
    actions: [{ label: 'make my card', run: () => { closeTour(); $('#reqOpenBtn').click(); } }],
  },
  {
    title: 'Post it to your story',
    body: 'Works for your request card and for any song someone sent you.',
    flow: ['tap share', 'pick Instagram, then Story', 'add a Link sticker', 'paste. the link is already copied'],
    numbered: true,
    foot: 'On a laptop the image downloads instead. Post it from your phone.',
  },
  {
    title: 'Get it to them',
    body: 'After sending you choose how it reaches them.',
    flow: ['email: anonymous. UNSAID sends it, your name never appears', 'WhatsApp, Messenger, Telegram: quick, but it comes from you', 'private: off the wall, only the link opens it'],
  },
  {
    title: 'The wall',
    body: 'Every song lands here. Tap one to hear a 30-second preview: the whole screen takes the cover’s colours and moves with the beat.',
    target: '#wall',
  },
  {
    title: 'Kept kind',
    body: 'A few things that keep it safe:',
    flow: ['your name is never stored', 'delete anything you sent from “my sent” on the same device', 'anything hurtful can be reported. 3 reports hide it'],
    foot: 'Open this guide again any time from “guide” at the top.',
  },
];
let tourAt = 0;
let tourFocus = null;

function renderTour() {
  const step = TOUR[tourAt];
  const body = $('#tourBody');
  body.replaceChildren();
  $('#tourStep').textContent = `${tourAt + 1} / ${TOUR.length}`;
  if (step.hero) { const v = el('div', 'vinyl spin tour-hero'); v.setAttribute('aria-hidden', 'true'); body.append(v); }
  const h = text('h2', 'tour-title ghost-text', step.title);
  h.id = 'tourTitle';
  body.append(h, text('p', 'tour-text', step.body));
  if (step.flow) {
    const ol = el(step.numbered ? 'ol' : 'ul', 'tour-flow' + (step.numbered ? ' numbered' : ''));
    for (const f of step.flow) ol.append(text('li', null, f));
    body.append(ol);
  }
  if (step.actions) {
    const row = el('div', 'row tour-actions');
    for (const a of step.actions) { const b = text('button', 'btn', a.label); b.type = 'button'; b.addEventListener('click', a.run); row.append(b); }
    body.append(row);
  }
  if (step.foot) body.append(text('p', 'tour-foot', step.foot));

  const dots = $('#tourDots');
  dots.replaceChildren();
  TOUR.forEach((_, i) => {
    const d = el('button', 'tour-dot');
    d.type = 'button';
    d.setAttribute('aria-label', `step ${i + 1}`);
    if (i === tourAt) d.setAttribute('aria-current', 'step');
    d.addEventListener('click', () => { tourAt = i; renderTour(); });
    dots.append(d);
  });
  $('#tourBack').disabled = tourAt === 0;
  $('#tourNext').textContent = tourAt === 0 ? 'show me' : tourAt === TOUR.length - 1 ? 'start' : 'next';

  const card = $('.tour-card');
  card.classList.remove('swap'); void card.offsetWidth; card.classList.add('swap');

  tourFocus?.classList.remove('tour-focus');
  tourFocus = step.target ? $(step.target) : null;
  $('#tour').classList.toggle('spot', !!tourFocus);
  if (tourFocus) {
    tourFocus.classList.add('tour-focus');
    const r = tourFocus.getBoundingClientRect();
    scrollTo({ top: Math.max(0, r.top + scrollY - innerHeight * 0.18), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setTimeout(() => pulseFrom(tourFocus, 0.7), 350);
  } else {
    scrollTo({ top: 0, behavior: 'smooth' });
    pulseFrom(null, 0.5);
  }
}

function openTour(i = 0) {
  if (!$('#view-home').hidden || params().has('guide')) {
    tourAt = i;
    $('#tour').hidden = false;
    document.body.classList.add('touring');
    renderTour();
    $('#tourNext').focus();
    track('guide');
  } else {
    go('./?guide');
  }
}
function closeTour() {
  $('#tour').hidden = true;
  document.body.classList.remove('touring');
  tourFocus?.classList.remove('tour-focus');
  tourFocus = null;
  store.set('unsaid:toured', 1);
}
$('#tourNext').addEventListener('click', () => {
  if (tourAt >= TOUR.length - 1) return closeTour();
  tourAt++; renderTour();
});
$('#tourBack').addEventListener('click', () => { if (tourAt > 0) { tourAt--; renderTour(); } });
$('#tourSkip').addEventListener('click', closeTour);
$('#guideBtn').addEventListener('click', (e) => { e.preventDefault(); openTour(0); });
document.addEventListener('keydown', (e) => {
  if ($('#tour').hidden) return;
  if (e.key === 'ArrowRight') $('#tourNext').click();
  else if (e.key === 'ArrowLeft') $('#tourBack').click();
  else if (e.key === 'Escape') closeTour();
});

// ── go ───────────────────────────────────────────────────────────
updateCounters();
await route();
try {
  if (!sessionStorage.getItem('unsaid:visited')) { sessionStorage.setItem('unsaid:visited', '1'); track('visit'); }
} catch { track('visit'); }
// first visit on the home page → open the guide once
if (!store.get('unsaid:toured', 0) && !$('#view-home').hidden && $('#tour').hidden) setTimeout(() => openTour(0), 900);

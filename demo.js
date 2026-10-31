// Demo mode: used when config.js has no Supabase keys.
// In-memory messages, generated cover art and a synthetic beat, so the
// whole UI can be clicked through without a backend.
import { paletteFromString } from './palette.js';

// ── generated cover art ──────────────────────────────────────────
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (const ch of seed) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

const artCache = new Map();
export function makeArt(seed) {
  if (artCache.has(seed)) return artCache.get(seed);
  const pal = paletteFromString(seed);
  const r = rng(seed);
  const S = 360;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, pal[0]); g.addColorStop(1, pal[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 4; i++) {
    const x = r() * S, y = r() * S, rad = 40 + r() * 140;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, i % 2 ? pal[2] : pal[1]); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2;
  const cx = S * (0.3 + r() * 0.4), cy = S * (0.3 + r() * 0.4);
  for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(cx, cy, 20 + k * 18, 0, Math.PI * 2); ctx.stroke(); }
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 22; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL('image/jpeg', 0.85);
  artCache.set(seed, url);
  return url;
}

// ── synthetic 8-second beat (WAV blob) ───────────────────────────
let beatUrl = null;
export function beat() {
  if (beatUrl) return beatUrl;
  const sr = 22050, secs = 8, n = sr * secs;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  const spb = 60 / 84;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, bt = t % spb;
    ph += (2 * Math.PI * (48 + 110 * Math.exp(-bt * 28))) / sr;
    const kick = Math.sin(ph) * Math.exp(-bt * 6);
    const ht = (t + spb / 2) % spb;
    const hat = (Math.random() * 2 - 1) * Math.exp(-ht * 70) * 0.12;
    const pad = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.18 * t) + Math.sin(2 * Math.PI * 329.63 * t)) / 3 * 0.12 * (0.6 + 0.4 * Math.sin(t * 0.8));
    const env = Math.min(1, t * 4, (secs - t) * 2);
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, (kick * 0.7 + hat + pad) * env)) * 32767 * 0.7, true);
  }
  beatUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return beatUrl;
}

// ── fake catalog + seed messages (all invented) ──────────────────
const CATALOG = [
  ['Monsoon Static', 'Dhaka Lights'], ['Last Bus to Mirpur', 'The Overpass'],
  ['Paper Moons', 'Saffron Tapes'], ['Low Battery Love', 'Neon Rickshaw'],
  ['Glass Rooftops', 'Hollow Tide'], ['Slow Fade, Fast Heart', 'Kites Over Banani'],
  ['Chai at 3AM', 'The Lantern Club'], ['Blue Hour Postcards', 'Saffron Tapes'],
  ['Satellite Hearts', 'Dhaka Lights'], ['Rain on Tin Roofs', 'Hollow Tide'],
  ['Midnight Ferry', 'The Overpass'], ['Unsent Drafts', 'Neon Rickshaw'],
];

const SEED = [
  ['Nusrat', 'nusrat.draws', 0, 'you laughed at the tea stall last week and i forgot what i was saying. this is that feeling.', 'you\'re the only weather i check', 12],
  ['Arif', null, 1, 'we don\'t talk anymore but i still save memes for you. every single day.', 'i kept your seat warm the whole ride home', 47],
  ['Riya', 'riya.writes', 2, 'congrats on the exhibition. i was there. you didn\'t see me.', null, 130],
  ['Tanvir', null, 3, 'charge your phone and call your mom. also you\'re doing great, genuinely.', null, 300],
  ['Mim', 'mim.jpg', 4, 'sorry for that night. no excuses. just this song.', 'i rehearsed sorry in the mirror for a week', 620],
  ['Sami', null, 5, 'you made the whole office bearable. good luck in Toronto, we\'ll miss the bad jokes.', null, 1500],
  ['Ishaan', 'ishaan.k', 6, 'best roommate ever. i ate your noodles in march. this is my confession.', 'some secrets taste like instant ramen', 4000],
  ['Nusrat', 'nusrat.draws', 7, 'someone else thinks you\'re the best thing too, apparently.', null, 9000],
];

const id10 = (i) => ('Demo' + i + 'xxxxxxxxxx').slice(0, 10).replace(/x/g, () => 'abcdefghjk'[i]);
const toKey = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();

let rows = null;
function getRows() {
  if (!rows) {
    rows = SEED.map(([to, handle, si, msg, lyric, minsAgo], i) => {
      const [title, artist] = CATALOG[si];
      return {
        id: id10(i), to_name: to, to_key: toKey(to), to_handle: handle, message: msg, lyric,
        song_title: title, song_artist: artist, artwork_url: makeArt(title + artist),
        preview_url: beat(), song_url: null, palette: null,
        created_at: new Date(Date.now() - minsAgo * 60000).toISOString(),
      };
    });
  }
  return rows;
}

export async function demoSearch(q) {
  const s = q.toLowerCase();
  let hits = CATALOG.filter(([t, a]) => (t + ' ' + a).toLowerCase().includes(s));
  if (!hits.length) hits = CATALOG.slice(0, 6);
  return hits.map(([title, artist]) => ({ title, artist, artwork: makeArt(title + artist), preview: beat(), url: null }));
}

// ── minimal stand-in for the supabase-js calls app.js makes ──────
class Query {
  constructor() { this.ops = []; this.one = false; }
  select() { return this; }
  order(col, { ascending = true } = {}) { this.ops.push((r) => [...r].sort((a, b) => (a[col] > b[col] ? 1 : -1) * (ascending ? 1 : -1))); return this; }
  range(a, b) { this.ops.push((r) => r.slice(a, b + 1)); return this; }
  limit(n) { this.ops.push((r) => r.slice(0, n)); return this; }
  eq(c, v) { this.ops.push((r) => r.filter((x) => x[c] === v)); return this; }
  in(c, arr) { this.ops.push((r) => r.filter((x) => arr.includes(x[c]))); return this; }
  or(expr) {
    const terms = expr.split(',').map((t) => t.match(/^(\w+)\.ilike\.%(.*)%$/)).filter(Boolean).map((m) => [m[1], m[2].toLowerCase()]);
    this.ops.push((r) => r.filter((x) => terms.some(([col, s]) => (x[col] || '').toLowerCase().includes(s))));
    return this;
  }
  maybeSingle() { this.one = true; return this; }
  then(res, rej) {
    let r = getRows().filter((x) => !x.private);
    for (const op of this.ops) r = op(r);
    return new Promise((ok) => setTimeout(ok, 180))
      .then(() => ({ data: this.one ? r[0] || null : r, error: null }))
      .then(res, rej);
  }
}

export function demoClient() {
  return {
    from: () => ({
      select: () => new Query(),
      insert: async (row) => {
        getRows().unshift({ ...row, to_key: toKey(row.to_name), created_at: new Date().toISOString() });
        return { error: null };
      },
    }),
    rpc: async (name, { p_id, p_ids }) => {
      if (name === 'get_messages') return { data: getRows().filter((x) => p_ids.includes(x.id)), error: null };
      if (name === 'delete_message') {
        const before = getRows().length;
        rows = getRows().filter((x) => x.id !== p_id);
        return { data: rows.length < before, error: null };
      }
      return { data: null, error: null };
    },
  };
}

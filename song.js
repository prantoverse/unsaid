// Song search (iTunes catalog), link parsing, embeds and URL safety checks.
import { ITUNES_COUNTRY } from './config.js';

const ART_RE = /^https:\/\/([a-z0-9-]+\.)*(mzstatic\.com|scdn\.co|spotifycdn\.com|ytimg\.com|sndcdn\.com)\//i;
const PREVIEW_RE = /^https:\/\/audio-ssl\.itunes\.apple\.com\//i;
const LINK_HOSTS = [/^open\.spotify\.com$/, /^(www\.|m\.|music\.)?youtube\.com$/, /^youtu\.be$/, /^music\.apple\.com$/, /^(www\.|m\.)?soundcloud\.com$/];

// data:/blob: only ever come from demo mode; the database rejects them anyway.
export const isSafeArt = (u) => typeof u === 'string' && (ART_RE.test(u) || u.startsWith('data:image/'));
export const isSafePreview = (u) => typeof u === 'string' && (PREVIEW_RE.test(u) || u.startsWith('blob:'));

// ── iTunes Search ────────────────────────────────────────────────
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = '__itunes_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const done = () => { delete window[cb]; s.remove(); };
    const t = setTimeout(() => { done(); reject(new Error('timeout')); }, 8000);
    window[cb] = (data) => { clearTimeout(t); done(); resolve(data); };
    s.onerror = () => { clearTimeout(t); done(); reject(new Error('search failed')); };
    s.src = url + '&callback=' + cb;
    document.head.append(s);
  });
}

export async function searchSongs(term) {
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=10&country=${ITUNES_COUNTRY}&term=${encodeURIComponent(term)}`;
  let data;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    data = await r.json();
  } catch {
    data = await jsonp(url);   // iTunes also serves JSONP when CORS is blocked
  }
  return (data.results || []).map((t) => ({
    title: t.trackName,
    artist: t.artistName,
    artwork: (t.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.'),
    preview: t.previewUrl || null,
    url: t.trackViewUrl ? t.trackViewUrl.replace(/[?&]uo=\d+/, '') : null,
  })).filter((s) => s.title);
}

// ── Pasted links ─────────────────────────────────────────────────
export function normalizeLink(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.protocol = 'https:';
  if (!LINK_HOSTS.some((r) => r.test(u.hostname))) return null;
  ['si', 'feature', 'pp', 'utm_source', 'utm_medium', 'utm_campaign'].forEach((k) => u.searchParams.delete(k));
  u.hash = '';
  if (u.hostname === 'open.spotify.com') u.pathname = u.pathname.replace(/^\/intl-[a-z-]+\//i, '/');
  return u.toString();
}

export function youtubeId(url) {
  const u = new URL(url);
  if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
  return m ? m[2] : null;
}

function spotifyRef(url) {
  const m = new URL(url).pathname.match(/^\/(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
  return m ? { type: m[1], id: m[2] } : null;
}

export function linkKind(url) {
  const h = new URL(url).hostname;
  if (h === 'open.spotify.com') return 'spotify';
  if (/youtube\.com$|youtu\.be$/.test(h)) return 'youtube';
  if (h === 'music.apple.com') return 'apple';
  if (/soundcloud\.com$/.test(h)) return 'soundcloud';
  return null;
}

export function embedFor(url) {
  if (!url) return null;
  const kind = linkKind(url);
  if (kind === 'spotify') { const r = spotifyRef(url); return r ? { src: `https://open.spotify.com/embed/${r.type}/${r.id}?theme=0`, kind } : null; }
  if (kind === 'youtube') { const id = youtubeId(url); return id ? { src: `https://www.youtube-nocookie.com/embed/${id}`, kind } : null; }
  if (kind === 'soundcloud') return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&visual=false`, kind };
  return null; // Apple Music links play via the iTunes preview instead
}

// Title/artist/artwork for a pasted link (best effort; user can edit).
export async function fetchLinkMeta(url) {
  const kind = linkKind(url);
  const enc = encodeURIComponent(url);
  const tries = [];
  if (kind === 'spotify') tries.push(`https://open.spotify.com/oembed?url=${enc}`);
  if (kind === 'soundcloud') tries.push(`https://soundcloud.com/oembed?format=json&url=${enc}`);
  if (kind === 'youtube') { const id = youtubeId(url); if (id) tries.push(`https://noembed.com/embed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`); }
  tries.push(`https://noembed.com/embed?url=${enc}`);
  for (const t of tries) {
    try {
      const r = await fetch(t);
      if (!r.ok) continue;
      const j = await r.json();
      if (j.error) continue;
      return {
        title: j.title || '',
        artist: (j.author_name || '').replace(/\s*-\s*Topic$/, ''),
        artwork: isSafeArt(j.thumbnail_url) ? j.thumbnail_url : null,
      };
    } catch { /* try next */ }
  }
  if (kind === 'youtube') { const id = youtubeId(url); if (id) return { title: '', artist: '', artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }; }
  return { title: '', artist: '', artwork: null };
}

// 1080×1920 Instagram-story images rendered on canvas.
import { renderStill } from './gl.js';
import { loadImage } from './palette.js';
import { isSafeArt } from './song.js';

const W = 1080, H = 1920;
const SANS = '"Space Grotesk", system-ui, sans-serif';
const SERIF = '"Instrument Serif", Georgia, serif';

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load(`700 80px ${SANS}`),
      document.fonts.load(`500 40px ${SANS}`),
      document.fonts.load(`italic 400 80px ${SERIF}`),
    ]);
  } catch { /* fall back to system fonts */ }
}

function base(palette) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const still = renderStill(palette, W, H);
  if (still) { ctx.drawImage(still, 0, 0); still.dispose?.(); }
  else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, palette[0]); g.addColorStop(0.6, palette[1]); g.addColorStop(1, palette[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, 0, W, H);
  }
  ctx.textBaseline = 'top';
  return { c, ctx };
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + word : word;
      if (!line || ctx.measureText(test).width <= maxW) line = test;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
  }
  return out;
}

function fit(ctx, text, { maxW, maxLines, size, min, font }) {
  let s = size, lines;
  for (;;) {
    ctx.font = font(s);
    lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines || s <= min) break;
    s -= 4;
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  }
  return { lines, size: s };
}

// white text with cyan/magenta "afterimage" ghosts
function ghost(ctx, text, x, y, palette, spread = 6) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = palette[1]; ctx.fillText(text, x - spread, y);
  ctx.fillStyle = palette[2]; ctx.fillText(text, x + spread, y);
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y);
}

function wordmark(ctx, palette, y) {
  ctx.save();
  ctx.font = `700 46px ${SANS}`;
  ctx.textAlign = 'center';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '16px';
  ghost(ctx, 'UNSAID', W / 2 + 8, y, palette, 5);
  ctx.restore();
}

function vinyl(ctx, cx, cy, r, palette) {
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#16111c'); g.addColorStop(1, '#050308');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 2;
  for (let rr = r * 0.38; rr < r * 0.97; rr += r * 0.035) { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke(); }
  const sh = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  sh.addColorStop(0.35, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,.12)'); sh.addColorStop(0.65, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  const lg = ctx.createLinearGradient(cx - r * 0.3, cy - r * 0.3, cx + r * 0.3, cy + r * 0.3);
  lg.addColorStop(0, palette[1]); lg.addColorStop(1, palette[2]);
  ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#050308'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.035, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function linkSlot(ctx, y, label) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `600 36px ${SANS}`;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillText(label, W / 2, y);
  ctx.setLineDash([18, 14]);
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 4;
  rrect(ctx, W / 2 - 290, y + 70, 580, 120, 60); ctx.stroke();
  ctx.restore();
}

function footer(ctx, text) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `500 30px ${SANS}`;
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.fillText(text, W / 2, H - 130);
  ctx.restore();
}

function drawCover(ctx, img, x, y, size) {
  let sw = img.naturalWidth, sh = img.naturalHeight;
  // YouTube hqdefault is 4:3 with letterbox bars — crop to the 16:9 band, then square
  if (/ytimg\.com/.test(img.src)) sh = sh * 0.75;
  const s = Math.min(sw, sh);
  const sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) / 2;
  ctx.drawImage(img, sx, sy, s, s, x, y, size, size);
}

/** "someone sent me a song" story */
export async function renderMessageStory(m, palette) {
  await ensureFonts();
  const { c, ctx } = base(palette);
  wordmark(ctx, palette, 120);

  const toLine = 'to: ' + m.to_name + (m.to_handle ? `  @${m.to_handle}` : '');
  ctx.textAlign = 'center';
  ctx.font = `500 34px ${SANS}`;
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.fillText(toLine.length > 48 ? toLine.slice(0, 47) + '…' : toLine, W / 2, 205);

  const busy = (m.lyric ? 1 : 0) + (m.message ? 1 : 0);
  const size = busy === 2 ? 440 : 540;
  const ax = (W - size) / 2, ay = 290;

  let img = null;
  if (isSafeArt(m.artwork_url)) { try { img = await loadImage(m.artwork_url); } catch { /* no art */ } }
  if (img) {
    for (const [dx, col] of [[-24, palette[1]], [24, palette[2]]]) {
      ctx.save(); ctx.globalAlpha = 0.55; ctx.shadowColor = col; ctx.shadowBlur = 70;
      rrect(ctx, ax + dx, ay + dx * 0.4, size, size, 40); ctx.fillStyle = col; ctx.fill(); ctx.restore();
    }
    ctx.save(); rrect(ctx, ax, ay, size, size, 40); ctx.clip(); drawCover(ctx, img, ax, ay, size); ctx.restore();
  } else {
    ctx.save(); ctx.shadowColor = palette[2]; ctx.shadowBlur = 90;
    vinyl(ctx, W / 2, ay + size / 2, size / 2, palette); ctx.restore();
  }

  let y = ay + size + 70;
  ctx.textAlign = 'center';
  const t = fit(ctx, m.song_title, { maxW: 880, maxLines: 2, size: 60, min: 42, font: (s) => `700 ${s}px ${SANS}` });
  ctx.font = `700 ${t.size}px ${SANS}`;
  for (const l of t.lines) { ghost(ctx, l, W / 2, y, palette, 3); y += t.size * 1.15; }
  if (m.song_artist) {
    ctx.font = `500 36px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(m.song_artist.length > 40 ? m.song_artist.slice(0, 39) + '…' : m.song_artist, W / 2, y + 6);
    y += 56;
  }

  if (m.lyric) {
    y += 44;
    const L = fit(ctx, `“${m.lyric}”`, { maxW: 860, maxLines: 3, size: 70, min: 46, font: (s) => `italic 400 ${s}px ${SERIF}` });
    ctx.font = `italic 400 ${L.size}px ${SERIF}`;
    for (const l of L.lines) { ctx.fillStyle = '#fff'; ctx.fillText(l, W / 2, y); y += L.size * 1.12; }
  }

  if (m.message) {
    y += 40;
    const N = fit(ctx, m.message, { maxW: 780, maxLines: 5, size: 38, min: 30, font: (s) => `500 ${s}px ${SANS}` });
    const lh = N.size * 1.35;
    const boxH = N.lines.length * lh + 80;
    ctx.save(); rrect(ctx, 110, y, 860, boxH, 36);
    ctx.fillStyle = 'rgba(8,5,20,.55)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    ctx.font = `500 ${N.size}px ${SANS}`; ctx.fillStyle = '#fff';
    let ty = y + 40;
    for (const l of N.lines) { ctx.fillText(l, W / 2, ty); ty += lh; }
    y += boxH;
  }

  if (y < H - 420) linkSlot(ctx, Math.max(y + 60, H - 470), 'tap to listen ↓');
  footer(ctx, 'sent anonymously · send yours on UNSAID');
  return c;
}

/** "send me a song" request story */
export async function renderRequestStory({ name, handle, prompt }, palette) {
  await ensureFonts();
  const { c, ctx } = base(palette);
  wordmark(ctx, palette, 150);

  const x = 90, w = W - 180, y = 470;
  const P = fit(ctx, prompt, { maxW: w - 120, maxLines: 4, size: 84, min: 54, font: (s) => `700 ${s}px ${SANS}` });
  const lh = P.size * 1.12;
  const headH = Math.max(340, P.lines.length * lh + 170);
  const bodyH = 280;

  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 80; ctx.shadowOffsetY = 30;
  rrect(ctx, x, y, w, headH + bodyH, 56); ctx.fillStyle = 'rgba(8,5,20,.62)'; ctx.fill(); ctx.restore();

  ctx.save(); rrect(ctx, x, y, w, headH + bodyH, 56); ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w, y + headH);
  g.addColorStop(0, palette[1]); g.addColorStop(1, palette[2]);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, headH);
  ctx.restore();
  ctx.save(); rrect(ctx, x, y, w, headH + bodyH, 56);
  ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();

  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `700 ${P.size}px ${SANS}`;
  let ty = y + headH / 2 - (P.lines.length * lh) / 2 + (lh - P.size) / 2;
  for (const l of P.lines) { ctx.fillText(l, W / 2, ty); ty += lh; }

  const cy = y + headH + bodyH / 2;
  vinyl(ctx, x + 150, cy, 92, palette);
  ctx.textAlign = 'left';
  const who = handle ? '@' + handle : name;
  let s = 54; ctx.font = `700 ${s}px ${SANS}`;
  while (ctx.measureText(who).width > w - 330 && s > 30) { s -= 2; ctx.font = `700 ${s}px ${SANS}`; }
  ctx.fillStyle = '#fff'; ctx.fillText(who, x + 285, cy - 52);
  ctx.font = `500 34px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.fillText('send me a song, anonymously', x + 285, cy + 14);

  linkSlot(ctx, y + headH + bodyH + 110, '↓ tap the link ↓');
  footer(ctx, 'UNSAID · songs you can’t say');
  return c;
}

/** admin "so far" stats story */
export async function renderStatsStory(stats, palette) {
  await ensureFonts();
  const { c, ctx } = base(palette);
  const t = stats.totals;
  const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : n.toLocaleString('en-US'));
  wordmark(ctx, palette, 140);
  ctx.textAlign = 'center';
  ctx.font = `500 34px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.fillText('so far', W / 2, 212);

  let y = 300;
  for (const [n, label] of [[t.messages, 'songs sent'], [t.recipients, 'people got a song'], [t.visitors, 'people visited']]) {
    ctx.font = `700 176px ${SANS}`;
    ghost(ctx, fmt(n), W / 2, y, palette, 10);
    y += 186;
    ctx.font = `500 42px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.fillText(label, W / 2, y);
    y += 116;
  }

  const top = stats.top_songs?.[0];
  if (top) {
    const bx = 110, bw = W - 220, bh = 200, by = y + 10;
    ctx.save(); rrect(ctx, bx, by, bw, bh, 36);
    ctx.fillStyle = 'rgba(8,5,20,.55)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    let tx = bx + 40;
    if (isSafeArt(top.art)) {
      try {
        const img = await loadImage(top.art);
        ctx.save(); rrect(ctx, bx + 30, by + 30, 140, 140, 20); ctx.clip(); drawCover(ctx, img, bx + 30, by + 30, 140); ctx.restore();
        tx = bx + 200;
      } catch { /* no art */ }
    }
    ctx.textAlign = 'left';
    ctx.font = `500 30px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillText('most sent song', tx, by + 42);
    const T = fit(ctx, top.title, { maxW: bx + bw - tx - 30, maxLines: 1, size: 50, min: 34, font: (s) => `700 ${s}px ${SANS}` });
    ctx.font = `700 ${T.size}px ${SANS}`; ctx.fillStyle = '#fff';
    ctx.fillText(T.lines[0], tx, by + 86);
    if (top.artist) {
      ctx.font = `500 32px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.fillText(top.artist.length > 32 ? top.artist.slice(0, 31) + '…' : top.artist, tx, by + 146);
    }
  }
  footer(ctx, 'send yours, anonymously · UNSAID');
  return c;
}

export function toBlob(canvas) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('render failed'))), 'image/png'));
}

/** Native share sheet (→ Instagram → Story) where supported, else download. */
// In-app browsers (Facebook, Instagram, Messenger, TikTok…) can't download
// blob files: following one shows "page can't be loaded". Detect them.
const UA = navigator.userAgent;
export const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram|Messenger|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|Bytedance|; wv\)/i.test(UA);
export const IS_ANDROID = /Android/i.test(UA);
export const IS_IOS = /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
export const inAppName = () =>
  /Instagram/i.test(UA) ? 'Instagram' : /Messenger/i.test(UA) ? 'Messenger' : /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(UA) ? 'Facebook'
  : /TikTok|musical_ly|Bytedance/i.test(UA) ? 'TikTok' : /Snapchat/i.test(UA) ? 'Snapchat' : 'this app';

/** Android: an intent link that reopens the current page in the real browser. */
export function browserIntent(url = location.href) {
  if (!IS_ANDROID) return null;
  const u = new URL(url);
  return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=https;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

export function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}

export async function shareImage(blob, filename) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  if (IN_APP) return 'inapp'; // never trigger a blob download inside an app browser
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

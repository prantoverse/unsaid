// Album-art → 3-colour palette [base, accentA, accentB] (lowercase hex).

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image blocked'));
    img.src = src;
  });
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToHex(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

export function paletteFromString(str = '') {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const hue = (h % 360) / 360;
  const shift = 0.1 + ((h >>> 9) % 25) / 100;
  return [hslToHex(hue, 0.55, 0.06), hslToHex(hue, 0.85, 0.58), hslToHex(hue + shift, 0.9, 0.62)];
}

export async function extractPalette(src) {
  const img = await loadImage(src);
  const N = 48;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data; // throws if the image is CORS-tainted

  const buckets = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const key = ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5);
    let e = buckets.get(key);
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, e); }
    e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
  }

  const cands = [...buckets.values()].map((e) => {
    const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
    const [h, s, l] = rgbToHsl(r, g, b);
    const usable = l > 0.08 && l < 0.92 ? 1 : 0.15;
    return { r, g, b, h, s, l, score: e.n * (0.25 + s) * usable };
  }).sort((x, y) => y.score - x.score);

  const picked = [];
  for (const c of cands) {
    if (picked.every((p) => Math.hypot(p.r - c.r, p.g - c.g, p.b - c.b) > 70)) picked.push(c);
    if (picked.length === 2) break;
  }
  if (!picked.length || Math.max(...picked.map((p) => p.s)) < 0.12) return paletteFromString(src);

  const a = picked[0];
  const b = picked[1] || { ...a, h: a.h + 0.14 };
  const vivid = (p) => hslToHex(p.h, Math.max(p.s, 0.55), clamp(p.l, 0.52, 0.7));
  return [hslToHex(a.h, Math.min(a.s, 0.6), 0.06), vivid(a), vivid(b)];
}

export async function paletteFor(artwork, fallbackSeed) {
  if (artwork) { try { return await extractPalette(artwork); } catch { /* CORS or load failure */ } }
  return paletteFromString(fallbackSeed || artwork || 'unsaid');
}

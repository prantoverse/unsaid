// UNSAID — anonymous email delivery.
// POST { id, email, device }  → emails the recipient a "someone sent you a song" card.
// GET  ?unsub=<email b64>&sig=<hmac> → that address never gets UNSAID emails again.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY  required
//   EMAIL_FROM      e.g. "UNSAID <unsaid@patihash.com>" (domain verified in Resend)
//   SITE_URL        defaults to https://prantoverse.github.io/unsaid/
//   UNSUB_SECRET    optional; HMAC key for unsubscribe links
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('EMAIL_FROM') ?? 'UNSAID <onboarding@resend.dev>';
const SITE = (Deno.env.get('SITE_URL') ?? 'https://prantoverse.github.io/unsaid/').replace(/\/?$/, '/');
const UNSUB_SECRET = Deno.env.get('UNSUB_SECRET') ?? SERVICE;
const FN_URL = `${SB_URL}/functions/v1/send-song-email`;

const LIMITS = { perDevice: 3, perEmail: 2, perDay: 90, freshMinutes: 15 };
const db = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmac(s: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(UNSUB_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(s))).slice(0, 32);
}
const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;

function page(title: string, text: string) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#07050f;color:#f5f2ff;font:16px/1.5 system-ui,sans-serif;padding:24px">
<div style="max-width:420px;text-align:center"><p style="letter-spacing:.34em;font-weight:700;font-size:13px">UNSAID</p>
<h1 style="font-size:28px;margin:8px 0">${esc(title)}</h1><p style="color:rgba(245,242,255,.65)">${esc(text)}</p></div></body>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

function emailHtml(m: { id: string; to_name: string; song_title: string; song_artist: string | null; artwork_url: string | null; palette: string[] | null }, unsubUrl: string) {
  const link = `${SITE}?m=${m.id}`;
  const c1 = m.palette?.[1] ?? '#7b5cff', c2 = m.palette?.[2] ?? '#ff3d81';
  const art = m.artwork_url
    ? `<img src="${esc(m.artwork_url)}" width="240" height="240" alt="" style="display:block;margin:0 auto;border-radius:20px;width:240px;height:240px;object-fit:cover">`
    : `<div style="width:200px;height:200px;margin:0 auto;border-radius:50%;background:radial-gradient(circle,#050308 0 4%,${c2} 4.5% 28%,#16111c 28.5%)"></div>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#07050f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07050f;background-image:radial-gradient(120% 70% at 20% 0%,${c1}55,transparent 60%),radial-gradient(100% 60% at 100% 100%,${c2}44,transparent 55%)">
<tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;font-family:Helvetica,Arial,sans-serif;color:#f5f2ff;text-align:center">
<tr><td style="font-size:13px;letter-spacing:6px;font-weight:700;padding-bottom:28px">UNSAID</td></tr>
<tr><td style="font-size:14px;color:#bdb7d6;padding-bottom:6px">for ${esc(m.to_name)}</td></tr>
<tr><td style="font-size:30px;font-weight:700;line-height:1.15;padding-bottom:28px">someone sent you a song.</td></tr>
<tr><td style="padding-bottom:24px">${art}</td></tr>
<tr><td style="font-size:22px;font-weight:700;padding-bottom:4px">${esc(m.song_title)}</td></tr>
<tr><td style="font-size:15px;color:#bdb7d6;padding-bottom:30px">${esc(m.song_artist ?? '')}</td></tr>
<tr><td style="padding-bottom:16px"><a href="${link}" style="display:inline-block;padding:15px 34px;border-radius:999px;background:${c2};background-image:linear-gradient(120deg,${c1},${c2});color:#fff;font-weight:700;font-size:16px;text-decoration:none">open it &amp; listen</a></td></tr>
<tr><td style="font-size:13px;color:#bdb7d6;padding-bottom:40px">there's a message waiting with it. they didn't leave their name.</td></tr>
<tr><td style="font-size:12px;color:#8a84a3;line-height:1.6;border-top:1px solid #ffffff22;padding-top:18px">
Sent anonymously through UNSAID. The sender's name is never stored.<br>
Don't want songs by email? <a href="${unsubUrl}" style="color:#bdb7d6">Stop UNSAID emails to this address</a>.</td></tr>
</table></td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(req.url);

  // ── unsubscribe ─────────────────────────────────────
  // GET from the email link, POST from mail apps' one-click unsubscribe
  if (url.searchParams.has('unsub')) {
    try {
      const email = unb64(url.searchParams.get('unsub')!).trim().toLowerCase();
      if (!EMAIL_RE.test(email) || (await hmac(email)) !== url.searchParams.get('sig')) return page('Link expired', 'That link doesn’t look right. Open the newest UNSAID email and use its link instead.');
      await db.from('email_optout').upsert({ email_hash: await sha256(email) });
      return page('Done. No more emails.', 'UNSAID will never email this address again, whoever tries.');
    } catch {
      return page('Something went wrong', 'Try the link again in a minute.');
    }
  }

  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  if (!RESEND) return json({ ok: false, reason: 'not_configured' }, 503);

  let body: { id?: string; email?: string; device?: string };
  try { body = await req.json(); } catch { return json({ ok: false, reason: 'bad_request' }, 400); }
  const id = String(body.id ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  const device = String(body.device ?? '');
  if (!/^[A-Za-z0-9]{10}$/.test(id) || !EMAIL_RE.test(email) || !/^[0-9a-f]{32}$/.test(device)) return json({ ok: false, reason: 'bad_request' }, 400);

  const emailHash = await sha256(email);
  const dayAgo = new Date(Date.now() - 864e5).toISOString();

  const { data: opt } = await db.from('email_optout').select('email_hash').eq('email_hash', emailHash).maybeSingle();
  if (opt) return json({ ok: false, reason: 'unavailable' });

  const { data: m } = await db.from('messages')
    .select('id,to_name,song_title,song_artist,artwork_url,palette,hidden,emailed_at,created_at').eq('id', id).maybeSingle();
  if (!m || m.hidden) return json({ ok: false, reason: 'not_found' }, 404);
  if (m.emailed_at) return json({ ok: false, reason: 'already_sent' });
  if (Date.now() - new Date(m.created_at).getTime() > LIMITS.freshMinutes * 60000) return json({ ok: false, reason: 'too_old' });

  const counts = await Promise.all([
    db.from('email_log').select('id', { count: 'exact', head: true }).eq('device', device).gte('created_at', dayAgo),
    db.from('email_log').select('id', { count: 'exact', head: true }).eq('email_hash', emailHash).gte('created_at', dayAgo),
    db.from('email_log').select('id', { count: 'exact', head: true }).gte('created_at', dayAgo),
  ]);
  const [perDevice, perEmail, perDay] = counts.map((c) => c.count ?? 0);
  if (perDevice >= LIMITS.perDevice) return json({ ok: false, reason: 'device_limit' }, 429);
  if (perEmail >= LIMITS.perEmail) return json({ ok: false, reason: 'unavailable' });
  if (perDay >= LIMITS.perDay) return json({ ok: false, reason: 'daily_limit' }, 429);

  // claim the message first so two quick taps can't double-send
  const { data: claimed } = await db.from('messages').update({ emailed_at: new Date().toISOString() }).eq('id', id).is('emailed_at', null).select('id');
  if (!claimed?.length) return json({ ok: false, reason: 'already_sent' });

  const unsubUrl = `${FN_URL}?unsub=${b64(email)}&sig=${await hmac(email)}`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: `someone sent you a song 🎧`,
      html: emailHtml(m, unsubUrl),
      text: `Someone sent you a song on UNSAID: ${m.song_title}${m.song_artist ? ' by ' + m.song_artist : ''}.\nOpen it: ${SITE}?m=${m.id}\n\nThey didn't leave their name.\nStop UNSAID emails to this address: ${unsubUrl}`,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  });
  if (!r.ok) {
    await db.from('messages').update({ emailed_at: null }).eq('id', id);
    console.error('resend', r.status, await r.text());
    return json({ ok: false, reason: 'send_failed' }, 502);
  }
  await db.from('email_log').insert({ device, email_hash: emailHash, message_id: id });
  return json({ ok: true });
});

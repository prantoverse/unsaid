# UNSAID — songs you can't say

Send someone a song and the words you never said, anonymously. Messages land on a public wall. People find theirs by searching their **name or @instagram handle**, or by tapping a link in a story.

No build step. Static files + Supabase. Host on GitHub Pages.

## Features

- **Send:** to a name (plus an optional @handle for exact matching). Pick a song from the iTunes catalog search, or paste a Spotify / YouTube / SoundCloud / Apple Music link. Add a message and optionally *the line that hit*.
- **Find:** search by name (fuzzy) or `@handle` (exact). Latest sends show on the home wall.
- **Message page** (`?m=<id>`): 30s preview with a progress ring, plus a Spotify/YouTube/SoundCloud embed when a link was used.
- **Story loop:**
  - *Request card*: a "send me a song" 1080×1920 image + link `?for=@handle`. Tapping it opens the send form already addressed to you.
  - *Share to story*: renders the received song as a story card and copies its link for the Link sticker.
- **Visual feedback:** a WebGL domain-warped shader recolors to each song's album art. It breathes with the audio (WebAudio analyser), ripples on send/select, follows the pointer and speeds up while you type. Text gets the afterimage ghost on transitions.
- **Safety:** no accounts, no sender identity stored. Each sender gets a device-only delete token (stored hashed). 3 reports hide a message. Artwork/preview URLs are restricted to known music CDNs (no tracking pixels).

## Getting it to them

- **Private:** a toggle on the send form keeps a song off the wall and out of search. Only its link opens it (`get_messages()` RPC).
- **Deliver by app:** after sending, the WhatsApp / Messenger / Telegram / share-sheet / copy buttons send the link with "someone sent you a song 🎧". These come from the sender's own account.
- **Anonymous email:** the optional "email it to them" field calls the `send-song-email` Edge Function, which emails a designed card through Resend. The email shows the song but not the message (the message stays on the moderated site).
  - **Limits:** 3 emails per device per day, 2 per address per day, 90 per day overall, and only within 15 minutes of sending.
  - **Privacy:** addresses are stored only as sha256. A one-click unsubscribe blocks an address permanently.
  - **Switching it on:** set the `RESEND_API_KEY` and `EMAIL_FROM` secrets in Supabase, then set `EMAIL_DELIVERY = true` in `config.js`.

## Guide

A guided tour opens once on a visitor's first visit to the home page, and again any time from **guide** in the top bar (or `?guide`). It spotlights the real buttons and has quick actions (send one now, search my name, make my card). It uses the same pattern as AFTERIMAGE: Back/Next, dots, ← → keys, Esc to close.

## Admin dashboard

`admin.html` (not linked anywhere) → enter the admin key. It shows:
- **Totals:** visitors, songs sent, recipients, visitor → sender conversion, story shares
- **Charts:** songs per day and visitors per day, plus a send-time heat strip (Dhaka time)
- **Usage:** what people do (searches, plays, request cards, story shares, guide opens)
- **Rankings:** top songs, artists and recipients
- **Moderation:** hide, unhide or delete messages
- **Share stats to story:** renders a 1080×1920 "so far" card

It refreshes every 30s. Usage events store only a random per-device id, never names or IPs. The key is checked server-side against a sha256 stored in `public.admin_secret`. To rotate it, update that row with a new hash.

## Demo mode

With no keys in `config.js` the app runs on sample data (fake songs, generated covers, a synthetic beat), so you can click through every screen before setting up Supabase.

## Setup (≈10 min)

1. **Supabase:** create a free project at supabase.com.
2. **SQL Editor:** paste and run `supabase/schema.sql`.
3. **Project Settings → API:** copy the Project URL and the `anon` public key into `config.js`.
4. **Run locally:** any static server works, e.g. `npx serve .` or `python3 -m http.server`, then open `http://localhost:8000`.
   (Opening `index.html` directly from disk won't work, because ES modules need http.)
5. **Deploy:** push to a GitHub repo → Settings → Pages → deploy from `main` / root.

## How story sharing works

Instagram doesn't let websites post to Stories directly, so:

- **Phone:** *Share* opens the native share sheet. Pick Instagram → Story, add a **Link** sticker and paste (the link is already on your clipboard).
- **Desktop:** the image downloads instead.

## Files

| file | what |
|---|---|
| `index.html` | all views (home, search, send, sent, message, my sent) + dialogs |
| `app.js` | router (`?m=`, `?q=`, `?for=`, `?send`, `?mine`), Supabase calls, UI wiring |
| `gl.js` | background shader + `renderStill()` for story backgrounds |
| `audio.js` | preview player + level meter (falls back to a synthetic beat if CORS blocks analysis) |
| `song.js` | iTunes search, link parsing, oEmbed metadata, embeds, URL allow-lists |
| `palette.js` | album art → 3-colour palette |
| `story.js` | 1080×1920 canvas story renderer + share/download |
| `supabase/schema.sql` | table, RLS, column grants, delete/report RPCs |

## Before going big

- **Spam:** the only limits now are a client cooldown, a honeypot field and DB length checks. For real traffic, add Cloudflare Turnstile and route inserts through a Supabase Edge Function that verifies the token and rate-limits by IP.
- **Moderation:** hidden rows stay in the table. Review them in the Supabase table editor (`hidden = true`) and either delete them or unhide them (set `hidden = false, reports = 0`).
- **Lyrics:** the lyric field is capped at 150 characters on purpose, so a single quoted line is fine but full lyrics stay off the site.
- **Anonymity:** senders are anonymous to everyone using the site, but Supabase still logs request IPs like any host does. Don't promise more than that.

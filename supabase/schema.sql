-- UNSAID — database schema
-- Run once in Supabase → SQL Editor. Safe to re-run.

create extension if not exists pg_trgm;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.messages (
  id           text primary key check (id ~ '^[A-Za-z0-9]{10}$'),
  to_name      text not null check (char_length(btrim(to_name)) between 1 and 40),
  to_key       text generated always as (lower(regexp_replace(btrim(to_name), '\s+', ' ', 'g'))) stored,
  to_handle    text check (to_handle ~ '^[a-z0-9._]{1,30}$'),   -- optional instagram handle, no @
  message      text not null check (char_length(btrim(message)) between 1 and 500),
  lyric        text check (char_length(lyric) <= 150),
  song_title   text not null check (char_length(song_title) between 1 and 200),
  song_artist  text check (char_length(song_artist) <= 200),
  -- only images/audio from known music CDNs, so a sender can't plant a tracking pixel
  artwork_url  text check (artwork_url ~ '^https://([a-z0-9-]+\.)*(mzstatic\.com|scdn\.co|spotifycdn\.com|ytimg\.com|sndcdn\.com)/'),
  preview_url  text check (preview_url ~ '^https://audio-ssl\.itunes\.apple\.com/'),
  song_url     text check (song_url ~ '^https://(open\.spotify\.com|(www\.|m\.|music\.)?youtube\.com|youtu\.be|music\.apple\.com|(www\.|m\.)?soundcloud\.com)/'),
  palette      text[] check (palette is null or array_to_string(palette, ',') ~ '^#[0-9a-f]{6}(,#[0-9a-f]{6}){0,4}$'),
  token_hash   text not null check (token_hash ~ '^[0-9a-f]{64}$'),  -- sha256 of the sender's secret delete token
  reports      int not null default 0,
  hidden       boolean not null default false,
  created_at   timestamptz not null default now()
);

-- (for projects created before the handle field existed)
alter table public.messages add column if not exists to_handle text check (to_handle ~ '^[a-z0-9._]{1,30}$');

create index if not exists messages_recent_idx on public.messages (created_at desc) where not hidden;
create index if not exists messages_to_trgm_idx on public.messages using gin (to_key gin_trgm_ops);
create index if not exists messages_handle_idx on public.messages (to_handle, created_at desc) where to_handle is not null;

-- ── Row Level Security ─────────────────────────────────────────────
alter table public.messages enable row level security;

drop policy if exists "read visible" on public.messages;
create policy "read visible" on public.messages
  for select to anon, authenticated using (not hidden);

drop policy if exists "anyone can send" on public.messages;
create policy "anyone can send" on public.messages
  for insert to anon, authenticated with check (not hidden and reports = 0);

-- No update/delete policies: nobody edits rows directly.

-- ── Column privileges ─────────────────────────────────────────────
-- Clients can never read token_hash / reports / hidden, and can't set them on insert.
revoke all on public.messages from anon, authenticated;
grant insert (id, to_name, to_handle, message, lyric, song_title, song_artist, artwork_url, preview_url, song_url, palette, token_hash)
  on public.messages to anon, authenticated;
grant select (id, to_name, to_key, to_handle, message, lyric, song_title, song_artist, artwork_url, preview_url, song_url, palette, created_at)
  on public.messages to anon, authenticated;

-- ── RPCs ──────────────────────────────────────────────────────────
-- Sender deletes their own message with the secret token kept on their device.
create or replace function public.delete_message(p_id text, p_token text)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare n int;
begin
  delete from public.messages
   where id = p_id
     and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Anyone can report; 3 reports hides a message until you review it.
create or replace function public.report_message(p_id text)
returns void
language sql security definer set search_path = public
as $$
  update public.messages
     set reports = reports + 1,
         hidden  = hidden or (reports + 1 >= 3)
   where id = p_id;
$$;

revoke all on function public.delete_message(text, text) from public;
revoke all on function public.report_message(text) from public;
grant execute on function public.delete_message(text, text) to anon, authenticated;
grant execute on function public.report_message(text) to anon, authenticated;

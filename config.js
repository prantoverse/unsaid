// Paste your Supabase project values here (Project Settings → API).
// The anon key is safe to ship publicly — Row Level Security in supabase/schema.sql guards the data.
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

export const LIMITS = { name: 40, message: 500, lyric: 150 };
export const SEND_COOLDOWN_MS = 20_000;   // per device
export const ITUNES_COUNTRY = 'US';       // storefront for song search (e.g. 'IN', 'GB')

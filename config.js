// Paste your Supabase project values here (Project Settings → API).
// The anon key is safe to ship publicly — Row Level Security in supabase/schema.sql guards the data.
export const SUPABASE_URL = 'https://hmjasqablaookjxveujc.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_yaHntGIggJNIgB6H7T4kYA_Mgswjdme';

export const LIMITS = { name: 40, message: 500, lyric: 150 };
export const SEND_COOLDOWN_MS = 20_000;   // per device
export const ITUNES_COUNTRY = 'US';       // storefront for song search (e.g. 'IN', 'GB')
export const EMAIL_DELIVERY = false;     // flip to true once RESEND_API_KEY + EMAIL_FROM are set in Supabase

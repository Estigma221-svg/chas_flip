/**
 * @returns {boolean}
 */
export function isSupabaseBrowserConfigured() {
  const url = typeof import.meta.env.VITE_SUPABASE_URL === 'string'
    ? import.meta.env.VITE_SUPABASE_URL.trim()
    : '';
  const anon = typeof import.meta.env.VITE_SUPABASE_ANON_KEY === 'string'
    ? import.meta.env.VITE_SUPABASE_ANON_KEY.trim()
    : '';
  return Boolean(url && anon);
}

/**
 * Matching PvP vía Postgres + opcionalmente Edge Functions.
 * @returns {boolean}
 */
export function isSupabaseMatchmakingEnabled() {
  const v = (import.meta.env.VITE_USE_SUPABASE_MATCHMAKING || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

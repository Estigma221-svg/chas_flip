import { createClient } from '@supabase/supabase-js';
import { isSupabaseBrowserConfigured } from '../config/supabaseEnv.js';

/** @type {ReturnType<typeof createClient> | undefined} */
let _client;

/**
 * Cliente Supabase singleton para el navegador.
 * Lee VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY desde `.env.local`.
 * Soporta keys publicables nuevas (`sb_publishable_…`) y JWT clásicas.
 *
 * @returns {ReturnType<typeof createClient>}
 */
export function getSupabaseBrowserClient() {
  if (!isSupabaseBrowserConfigured()) {
    throw new Error(
      'Supabase no configurado: define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.local',
    );
  }

  const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!_client) {
    _client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: {
        params: { eventsPerSecond: 8 },
      },
    });
  }
  return _client;
}

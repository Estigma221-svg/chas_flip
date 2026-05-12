import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/**
 * Auth-scoped cliente: respeta JWT del jugador (`auth.uid()` en RPC).
 */
export function supabaseClientFromRequest(req: Request) {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authHeader = req.headers.get('Authorization') ?? '';

  if (!url || !anonKey) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');

  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
}

/**
 * Service-role cliente: bypass RLS. SOLO para flujos server-side de confianza
 * (listener on-chain, jobs reconciliacion). Nunca exponer al frontend.
 */
export function supabaseServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !svcKey) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, svcKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

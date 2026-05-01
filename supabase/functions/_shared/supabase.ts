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

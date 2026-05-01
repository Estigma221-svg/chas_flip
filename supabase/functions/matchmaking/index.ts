import { corsHeaders } from '../_shared/cors.ts';
import { supabaseClientFromRequest } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: corsHeaders() });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return Response.json({ error: 'missing_authorization' }, { status: 401, headers: corsHeaders() });
    }

    const body = (await req.json().catch(() => ({}))) as { stake_amount?: number };
    const stakeRaw = body.stake_amount;
    const stake = typeof stakeRaw === 'number' ? Math.trunc(stakeRaw) : parseInt(String(stakeRaw ?? ''), 10);
    if (!Number.isFinite(stake) || stake <= 0) {
      return Response.json({ error: 'invalid_stake_amount' }, { status: 400, headers: corsHeaders() });
    }

    const supabase = supabaseClientFromRequest(req);
    const { data, error } = await supabase.rpc('matchmaking_join', {
      p_stake_amount: stake,
    });

    if (error) {
      console.error('[matchmaking]', error);
      return Response.json({ error: error.message }, { status: 400, headers: corsHeaders() });
    }

    return Response.json(data, { headers: corsHeaders() });
  } catch (e) {
    console.error('[matchmaking]', e);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders() });
  }
});

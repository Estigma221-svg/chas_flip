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

    const body = (await req.json().catch(() => ({}))) as {
      stake_amount?: number;
      idempotency_key?: string | null;
    };
    const stakeRaw = body.stake_amount;
    const stake = typeof stakeRaw === 'number' ? Math.trunc(stakeRaw) : parseInt(String(stakeRaw ?? ''), 10);
    if (!Number.isFinite(stake) || stake <= 0) {
      return Response.json({ error: 'invalid_stake_amount' }, { status: 400, headers: corsHeaders() });
    }

    const idemRaw = body.idempotency_key;
    const idem =
      typeof idemRaw === 'string' && /^[0-9a-f-]{32,36}$/i.test(idemRaw) ? idemRaw : null;

    const supabase = supabaseClientFromRequest(req);
    const { data, error } = await supabase.rpc('matchmaking_join', {
      p_stake_amount: stake,
      p_idempotency_key: idem,
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

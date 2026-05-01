import { corsHeaders } from '../_shared/cors.ts';
import { supabaseClientFromRequest } from '../_shared/supabase.ts';

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: corsHeaders() });
    }

    if (!req.headers.get('Authorization')) {
      return Response.json({ error: 'missing_authorization' }, { status: 401, headers: corsHeaders() });
    }

    const body = (await req.json().catch(() => ({}))) as { match_id?: string };
    const matchId = (body.match_id || '').trim();
    if (!UUID_RX.test(matchId)) {
      return Response.json({ error: 'invalid_match_id' }, { status: 400, headers: corsHeaders() });
    }

    const supabase = supabaseClientFromRequest(req);
    const { data, error } = await supabase.rpc('resolve_match_round', {
      p_match_id: matchId,
    });

    if (error) {
      console.error('[resolve-match]', error);
      return Response.json({ error: error.message }, { status: 400, headers: corsHeaders() });
    }

    return Response.json(data, { headers: corsHeaders() });
  } catch (e) {
    console.error('[resolve-match]', e);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders() });
  }
});

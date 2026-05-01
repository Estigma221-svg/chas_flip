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

    if (!req.headers.get('Authorization')) {
      return Response.json({ error: 'missing_authorization' }, { status: 401, headers: corsHeaders() });
    }

    const supabase = supabaseClientFromRequest(req);
    const { data, error } = await supabase.rpc('cancel_matchmaking');

    if (error) {
      console.error('[cancel-matchmaking]', error);
      return Response.json({ error: error.message }, { status: 400, headers: corsHeaders() });
    }

    return Response.json(data, { headers: corsHeaders() });
  } catch (e) {
    console.error('[cancel-matchmaking]', e);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders() });
  }
});

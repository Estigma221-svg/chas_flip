import { normalizeStoredAvatar } from '../data/chasflipAvatars.js';
import { getSupabaseBrowserClient } from '../lib/supabaseClient.js';

export { subscribeMatchInserts, subscribeMatchRowUpdates } from './supabaseRealtime.js';

/**
 * Perfil aplicación ChasFlip (tabla `public.profiles`).
 * @typedef {object} ChasflipAppUser
 * @property {string} email
 * @property {string} avatar
 * @property {string} paisCode
 */

async function invokeOrRpc(functionName, body, rpcName, rpcArgs) {
  const supabase = getSupabaseBrowserClient();
  try {
    const { data: invData, error: invErr } = await supabase.functions.invoke(functionName, {
      body,
    });
    if (!invErr && invData != null) return invData;
    if (import.meta.env.DEV && invErr) {
      console.info(`[chasflip] Edge ${functionName} falló (${invErr.message}), usando RPC`, invErr);
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.info(`[chasflip] Edge ${functionName} no disponible, usando RPC`, e);
    }
  }

  const { data, error } = await supabase.rpc(rpcName, rpcArgs);
  if (error) throw error;
  return data;
}

/**
 * Crea un Error con un código identificable para que la UI pueda mostrar
 * el HUD adecuado (anon-disabled vs profile-upsert vs unknown).
 *
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 */
function taggedError(code, message, cause) {
  const e = new Error(message);
  /** @type {any} */ (e).code = code;
  if (cause !== undefined) /** @type {any} */ (e).cause = cause;
  return e;
}

/**
 * @param {ChasflipAppUser} usuario
 */
export async function ensureSupabaseSessionAndProfile(usuario) {
  const supabase = getSupabaseBrowserClient();

  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      throw taggedError('anon_disabled', error.message || 'signInAnonymously falló', error);
    }
    ({ data: { session } } = await supabase.auth.getSession());
  }
  if (!session?.user) {
    throw taggedError('anon_disabled', 'No se obtuvo sesión tras signInAnonymously');
  }

  const { error: upErr } = await supabase.from('profiles').upsert({
    id: session.user.id,
    email: usuario.email,
    avatar: normalizeStoredAvatar(usuario.avatar, usuario.email),
    pais_code: usuario.paisCode || 'XX',
  }, { onConflict: 'id' });

  if (upErr) {
    throw taggedError(
      'profile_upsert_failed',
      upErr.message || 'No se pudo escribir profiles',
      upErr,
    );
  }

  return { supabase, userId: session.user.id };
}

/**
 * Único punto de entrada: comisión decidida solo en servidor.
 *
 * Respuesta ejemplo: `{ matched, match_id, commission_decimal, opponent?, stake_amount?, queue_id? }`
 *
 * Fase 2.B.2 — acepta opcionalmente `idempotencyKey` (UUID generado por el
 * cliente con `freshIdempotencyKey()`). Si se pasa, el servidor debita un
 * asiento `bet` al ledger antes de tocar match_queue / matches. Si NO se pasa,
 * comportamiento legacy (no toca ledger).
 *
 * @param {number} stakeAmount
 * @param {object} [opts]
 * @param {string} [opts.idempotencyKey]
 */
export async function joinMatchmaking(stakeAmount, opts) {
  const idem = opts?.idempotencyKey ?? null;
  return invokeOrRpc(
    'matchmaking',
    {
      stake_amount: Math.trunc(stakeAmount),
      ...(idem ? { idempotency_key: idem } : {}),
    },
    'matchmaking_join',
    {
      p_stake_amount: Math.trunc(stakeAmount),
      p_idempotency_key: idem,
    },
  );
}

/**
 * RNG y payout coherentes para ambos jugadores (RPC idempotente).
 *
 * @param {string} matchId  uuid string
 */
export async function resolveMatchRound(matchId) {
  return invokeOrRpc(
    'resolve-match',
    { match_id: matchId },
    'resolve_match_round',
    { p_match_id: matchId },
  );
}

export async function cancelQueuedMatchmaking() {
  return invokeOrRpc(
    'cancel-matchmaking',
    {},
    'cancel_matchmaking',
    {},
  );
}

/**
 * Snapshot de rival según quién sos en la partida.
 *
 * @param {Record<string, unknown>} row
 * @param {string} myUserId
 */
export function pickOpponentFromMatchMeta(row, myUserId) {
  const meta = /** @type {Record<string, unknown> | undefined} */ (row.meta);
  const p1see = meta && /** @type {Record<string, unknown> | undefined} */ (meta.player_one_sees);
  const p2see = meta && /** @type {Record<string, unknown> | undefined} */ (meta.player_two_sees);
  if (row.player_one_id === myUserId) return p1see || null;
  if (row.player_two_id === myUserId) return p2see || null;
  return null;
}

/**
 * Normaliza campo `opponent` de `matchmaking_join` o meta.
 *
 * @param {unknown} raw
 */
export function rivalFromOpponentBlob(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const avatarRaw = typeof o.avatar === 'string' ? o.avatar : '';
  const paisCode = typeof o.pais_code === 'string' ? o.pais_code : 'XX';
  const email = typeof o.email === 'string' ? o.email : '?';
  const short = email.length > 28 ? `${email.slice(0, 12)}…` : email;
  const seed = email !== '?' ? email : short;
  const avatar =
    avatarRaw.trim() !== ''
      ? normalizeStoredAvatar(avatarRaw, seed)
      : normalizeStoredAvatar(null, seed);
  return {
    avatar,
    paisCode,
    nombre: short.startsWith('@') ? short : `@${short.split('@')[0] || short}`,
  };
}

import { getSupabaseBrowserClient } from '../lib/supabaseClient.js';

/**
 * Suscripción oficial a partidas donde el jugador participa (INSERT tiempo real · mesa creada).
 *
 * @param {string} userId  auth.uid
 * @param {(row: Record<string, unknown>) => void} onInsert
 * @returns {() => void} cleanup
 */
export function subscribeMatchInserts(userId, onInsert) {
  const supabase = getSupabaseBrowserClient();
  const channelName = `chasflip:user:${userId}:matches:insert`;

  const ch = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'matches',
        filter: `player_one_id=eq.${userId}`,
      },
      (payload) => onInsert(/** @type {Record<string, unknown>} */ (payload.new)),
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'matches',
        filter: `player_two_id=eq.${userId}`,
      },
      (payload) => onInsert(/** @type {Record<string, unknown>} */ (payload.new)),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(ch);
  };
}

/**
 * Seguimiento de la fila actual (UPDATE: `status`, `winner_user_id`, montos de liquidación).
 *
 * @param {string} matchId  uuid en `matches`
 * @param {(row: Record<string, unknown>) => void} onUpdate
 * @returns {() => void}
 */
export function subscribeMatchRowUpdates(matchId, onUpdate) {
  const supabase = getSupabaseBrowserClient();
  const channelName = `chasflip:match:${matchId}:updates`;

  const ch = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'matches',
        filter: `id=eq.${matchId}`,
      },
      (payload) => onUpdate(/** @type {Record<string, unknown>} */ (payload.new)),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(ch);
  };
}

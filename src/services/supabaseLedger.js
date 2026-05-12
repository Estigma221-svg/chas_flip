/**
 * Wrappers sobre las RPCs del ledger autoritativo (FASE 2.B.1).
 *
 * Todas las funciones que mueven saldo aceptan/exigen `idempotencyKey` para
 * que reintentos por red flaky no dupliquen movimientos. Si el cliente quiere,
 * puede llamar `freshIdempotencyKey()` para generar uno antes de cada
 * operación.
 *
 * IMPORTANTE — hoy estas funciones existen pero NO se usan todavía desde
 * `App.jsx`. El cutover (saldo del juego derivado del ledger) llega en Fase
 * 2.B.2. Aquí dejamos las piezas listas para ese PR.
 */

import { getSupabaseBrowserClient } from '../lib/supabaseClient.js';

/**
 * @typedef {object} LedgerEntryResult
 * @property {string} id              UUID del asiento creado.
 * @property {number} balance_after   Saldo resultante después del asiento.
 * @property {boolean} duplicate      true si la misma `idempotency_key` ya
 *                                    había sido procesada antes (no error).
 */

/**
 * Genera un UUID v4 para usar como `idempotency_key`. Usar el del navegador
 * (crypto.randomUUID) cuando esté disponible (todos los browsers modernos);
 * fallback a una versión basada en `crypto.getRandomValues` por si acaso.
 *
 * @returns {string}
 */
export function freshIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('crypto.randomUUID no disponible en este browser');
}

/**
 * Convierte el `data` devuelto por una RPC `apply_ledger_entry`/wrapper en
 * un objeto JS bien tipado. Postgres devuelve numeric como string.
 *
 * @param {unknown} raw
 * @returns {LedgerEntryResult}
 */
function normalizeLedgerResult(raw) {
  const obj = /** @type {Record<string, unknown>} */ (raw ?? {});
  return {
    id: typeof obj.id === 'string' ? obj.id : '',
    balance_after: Number(obj.balance_after ?? 0),
    duplicate: Boolean(obj.duplicate),
  };
}

async function callRpc(rpcName, args) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc(rpcName, args);
  if (error) throw error;
  return data;
}

/**
 * Acredita un depósito DEMO al ledger del usuario logueado.
 *
 * @param {object} opts
 * @param {number} opts.amount             En unidades enteras de USDT (ej. 100 = $100).
 *                                         La RPC valida que sea > 0 y < 100k.
 * @param {string} [opts.idempotencyKey]   UUID. Si no se pasa, se genera uno.
 * @param {Record<string, unknown>} [opts.meta]
 * @returns {Promise<LedgerEntryResult>}
 */
export async function recordDepositDemo({ amount, idempotencyKey, meta }) {
  const key = idempotencyKey || freshIdempotencyKey();
  const data = await callRpc('record_deposit_demo', {
    p_amount: amount,
    p_idempotency_key: key,
    p_meta: meta || {},
  });
  return normalizeLedgerResult(data);
}

/**
 * Debita un retiro DEMO. Falla con código `insufficient_funds` si el ledger
 * no tiene saldo suficiente.
 *
 * @param {object} opts
 * @param {number} opts.amount
 * @param {string} [opts.idempotencyKey]
 * @param {Record<string, unknown>} [opts.meta]
 * @returns {Promise<LedgerEntryResult>}
 */
export async function recordWithdrawDemo({ amount, idempotencyKey, meta }) {
  const key = idempotencyKey || freshIdempotencyKey();
  const data = await callRpc('record_withdraw_demo', {
    p_amount: amount,
    p_idempotency_key: key,
    p_meta: meta || {},
  });
  return normalizeLedgerResult(data);
}

/**
 * Acredita un bonus (free play "first taste"). El `reason` queda en
 * meta.reason y en audit_log.
 *
 * @param {object} opts
 * @param {number} opts.amount
 * @param {string} opts.reason             Slug `[a-z][a-z0-9_:.\-]+`, ej. "free_play_first".
 * @param {string} [opts.idempotencyKey]
 * @returns {Promise<LedgerEntryResult>}
 */
export async function recordBonus({ amount, reason, idempotencyKey }) {
  const key = idempotencyKey || freshIdempotencyKey();
  const data = await callRpc('record_bonus', {
    p_amount: amount,
    p_idempotency_key: key,
    p_reason: reason,
  });
  return normalizeLedgerResult(data);
}

/**
 * Lee el saldo actual del usuario logueado (último `balance_after`).
 * Devuelve 0 si nunca tuvo asientos.
 *
 * @returns {Promise<number>}
 */
export async function getUserBalance() {
  const data = await callRpc('get_user_balance', {});
  return Number(data ?? 0);
}

/**
 * Suscripción a INSERTs en `public.transactions` del usuario. RLS aplica:
 * solo recibimos asientos del propio user_id (server-side filtering).
 *
 * El callback recibe la fila cruda. Para obtener el saldo nuevo: usar
 * `Number(payload.balance_after)`.
 *
 * @param {string} userId   auth.uid()
 * @param {(row: Record<string, unknown>) => void} onInsert
 * @returns {() => void}    cleanup
 */
export function subscribeUserTransactions(userId, onInsert) {
  const supabase = getSupabaseBrowserClient();
  const channelName = `chasflip:user:${userId}:transactions:insert`;

  const ch = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'transactions',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onInsert(/** @type {Record<string, unknown>} */ (payload.new)),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(ch);
  };
}

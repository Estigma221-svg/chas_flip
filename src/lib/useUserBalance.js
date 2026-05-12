/**
 * Hook que expone el saldo autoritativo del usuario.
 *
 * FASE 2.B.1 — modo "shadow read": el hook lee `get_user_balance()` del server
 * y se suscribe a INSERTs en `public.transactions`, pero NO controla todavía
 * el saldo del juego. App.jsx sigue usando `localStorage`. Esta lectura sirve
 * para:
 *   1. Validar en producción que el ledger funciona sin riesgo de romper UX.
 *   2. Mostrar (opcionalmente) un badge "saldo on-chain vs demo" mientras
 *      llega la Fase 2.B.2.
 *
 * En Fase 2.B.2 este hook reemplaza a `saldo`/`setSaldo` locales: deposito y
 * retiro irán al ledger via supabaseLedger.js y el render leerá `balance` de
 * este hook.
 *
 * Comportamiento:
 *   - Si Supabase NO está configurado (`isSupabaseBrowserConfigured()` false):
 *     devuelve `{ balance: null, status: 'disabled' }` para que el caller
 *     siga su flujo legacy.
 *   - Si NO hay sesión: `{ balance: null, status: 'unauthenticated' }`.
 *   - Si todo OK: refetch inicial + Realtime, `status: 'ready'`.
 */

import { useEffect, useRef, useState } from 'react';
import { isSupabaseBrowserConfigured } from '../config/supabaseEnv.js';
import { getUserBalance, subscribeUserTransactions } from '../services/supabaseLedger.js';

/**
 * @typedef {object} UseUserBalanceResult
 * @property {number | null} balance       Saldo numérico o `null` mientras se
 *                                         desconoce / Supabase no está listo.
 * @property {'disabled' | 'unauthenticated' | 'loading' | 'ready' | 'error'} status
 * @property {Error | null} error          Último error de lectura (si lo hubo).
 * @property {() => Promise<void>} refresh Forzar re-fetch manual.
 */

/**
 * @param {string | null | undefined} supaUserId  `auth.uid()` activo en App.jsx.
 * @returns {UseUserBalanceResult}
 */
export function useUserBalance(supaUserId) {
  const supabaseReady = isSupabaseBrowserConfigured();

  const [balance, setBalance] = useState(/** @type {number | null} */ (null));
  const [status, setStatus] = useState(
    /** @type {UseUserBalanceResult['status']} */ (
      supabaseReady ? (supaUserId ? 'loading' : 'unauthenticated') : 'disabled'
    ),
  );
  const [error, setError] = useState(/** @type {Error | null} */ (null));

  const refreshRef = useRef(/** @type {(() => Promise<void>) | null} */ (null));

  useEffect(() => {
    if (!supabaseReady) {
      setBalance(null);
      setStatus('disabled');
      return undefined;
    }
    if (!supaUserId) {
      setBalance(null);
      setStatus('unauthenticated');
      return undefined;
    }

    let alive = true;
    setStatus('loading');
    setError(null);

    const fetchOnce = async () => {
      try {
        const next = await getUserBalance();
        if (!alive) return;
        setBalance(Number.isFinite(next) ? next : 0);
        setStatus('ready');
        setError(null);
      } catch (err) {
        if (!alive) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setStatus('error');
      }
    };

    refreshRef.current = fetchOnce;
    void fetchOnce();

    const unsubscribe = subscribeUserTransactions(supaUserId, (row) => {
      if (!alive) return;
      const next = Number(row?.balance_after);
      if (Number.isFinite(next)) {
        setBalance(next);
        setStatus('ready');
        setError(null);
      } else {
        // Fallback: si no podemos parsear, refetch directo.
        void fetchOnce();
      }
    });

    return () => {
      alive = false;
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
      refreshRef.current = null;
    };
  }, [supabaseReady, supaUserId]);

  return {
    balance,
    status,
    error,
    refresh: async () => {
      const fn = refreshRef.current;
      if (fn) await fn();
    },
  };
}

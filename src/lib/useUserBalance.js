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
/**
 * Estado inicial calculado a partir de las dependencias actuales. Sirve para
 * (a) inicializar el primer render y (b) resetear de manera SÍNCRONA cuando
 * cambian las deps relevantes — sin caer en `setState dentro de useEffect`,
 * que dispara `react-hooks/set-state-in-effect` y cascading renders.
 *
 * @param {boolean} supabaseReady
 * @param {string | null | undefined} supaUserId
 * @returns {{balance: number | null, status: UseUserBalanceResult['status']}}
 */
function deriveInitial(supabaseReady, supaUserId) {
  if (!supabaseReady) return { balance: null, status: 'disabled' };
  if (!supaUserId) return { balance: null, status: 'unauthenticated' };
  return { balance: null, status: 'loading' };
}

export function useUserBalance(supaUserId) {
  const supabaseReady = isSupabaseBrowserConfigured();

  // Pattern oficial de React 19 para "adjusting some state when a prop
  // changes" (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  // Mantenemos las deps previas en estado y, si cambiaron, reseteamos balance
  // y status DURANTE el render. setState llamados durante el render no
  // causan cascading renders mientras estén guardados detrás de una guarda
  // de igualdad de valores como esta.
  const [prevSupabaseReady, setPrevSupabaseReady] = useState(supabaseReady);
  const [prevSupaUserId, setPrevSupaUserId] = useState(supaUserId ?? null);

  const initial = deriveInitial(supabaseReady, supaUserId);
  const [balance, setBalance] = useState(initial.balance);
  const [status, setStatus] = useState(initial.status);
  const [error, setError] = useState(/** @type {Error | null} */ (null));

  if (
    prevSupabaseReady !== supabaseReady ||
    prevSupaUserId !== (supaUserId ?? null)
  ) {
    setPrevSupabaseReady(supabaseReady);
    setPrevSupaUserId(supaUserId ?? null);
    const next = deriveInitial(supabaseReady, supaUserId);
    setBalance(next.balance);
    setStatus(next.status);
    setError(null);
  }

  const refreshRef = useRef(/** @type {(() => Promise<void>) | null} */ (null));

  useEffect(() => {
    if (!supabaseReady || !supaUserId) return undefined;

    let alive = true;

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

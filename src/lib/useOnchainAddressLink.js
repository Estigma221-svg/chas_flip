/**
 * Hook que vincula automaticamente la wallet conectada con la sesion Supabase.
 * Se llama desde App.jsx tras el bootstrap. La idea es: cuando el user conecta
 * MetaMask, esa address queda asociada a su `auth.uid()` para que la Edge
 * Function `vault-deposit-listener` pueda identificar al beneficiario de cada
 * `Deposited` evento.
 *
 * Idempotente: si la address ya esta vinculada al mismo user, no hace nada.
 * Si esta vinculada a OTRO user (caso raro), lanza HUD de error.
 */
import { useEffect, useRef } from 'react';
import { isSupabaseBrowserConfigured } from '../config/supabaseEnv.js';
import { getVaultConfig } from '../config/onchainEnv.js';
import { linkOnchainAddress } from '../services/supabaseVault.js';

/**
 * @param {object} args
 * @param {string | null | undefined} args.supaUserId  auth.uid() activo.
 * @param {string | null | undefined} args.walletAddress  Address conectada (wagmi).
 * @param {number | null | undefined} args.walletChainId  Chain id de la wallet.
 * @param {boolean} args.walletConnected
 * @param {(payload: { ok?: boolean, error?: Error }) => void} [args.onResult]
 */
export function useOnchainAddressLink({
  supaUserId,
  walletAddress,
  walletChainId,
  walletConnected,
  onResult,
}) {
  const lastTriedKeyRef = useRef(/** @type {string | null} */ (null));

  useEffect(() => {
    if (!isSupabaseBrowserConfigured()) return undefined;
    if (!supaUserId || !walletConnected || !walletAddress || !walletChainId) return undefined;

    const cfg = getVaultConfig();
    // Solo intentamos vincular si la chain de la wallet coincide con la chain
    // que conoce el vault. Para producir mejor UX en estados intermedios,
    // si NO hay vault config aun (env vars vacias), igual hacemos el link
    // — costo cero, util para auditoria temprana.
    if (cfg && walletChainId !== cfg.chainId) return undefined;

    const key = `${supaUserId}|${walletAddress.toLowerCase()}|${walletChainId}`;
    if (lastTriedKeyRef.current === key) return undefined;
    lastTriedKeyRef.current = key;

    let alive = true;
    void (async () => {
      try {
        const res = await linkOnchainAddress(walletAddress.toLowerCase(), walletChainId);
        if (!alive) return;
        onResult?.({ ok: true });
        if (import.meta.env.DEV) console.info('[chasflip] linked onchain address', res);
      } catch (err) {
        if (!alive) return;
        const e = err instanceof Error ? err : new Error(String(err));
        onResult?.({ error: e });
        if (import.meta.env.DEV) console.warn('[chasflip] link_onchain_address failed', e);
      }
    })();

    return () => {
      alive = false;
    };
  }, [supaUserId, walletAddress, walletChainId, walletConnected, onResult]);
}

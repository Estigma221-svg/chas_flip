/**
 * Lectura centralizada de variables Vite (.env).
 * Documentación de claves — ver `.env.example` en la raíz del proyecto.
 */

import { getTargetChain } from './chains.js';
import { GAME_MODEL_ID } from '../game/gameModel.js';
import { isSupabaseBrowserConfigured, isSupabaseMatchmakingEnabled } from './supabaseEnv.js';

/** @typedef {'mock' | 'onchain'} FlipEngineKind */

/**
 * Motor de resultado de ronda. `onchain` aún no implementado (solo contrato / wagmi).
 * @returns {FlipEngineKind}
 */
export function getFlipEngineKind() {
  const v = (import.meta.env.VITE_FLIP_ENGINE || 'mock').trim().toLowerCase();
  if (v === 'onchain') return 'onchain';
  return 'mock';
}

/**
 * RPC opcional (Privy/Wagmi suelen inyectar propio; útil para lecturas o tests).
 * @returns {string | null}
 */
export function getOptionalRpcUrl() {
  const u = import.meta.env.VITE_RPC_URL;
  return typeof u === 'string' && u.trim().length > 0 ? u.trim() : null;
}

/**
 * Dirección del contrato flip (cuando exista ABI + despliegue).
 * @returns {`0x${string}` | null}
 */
export function getFlipContractAddress() {
  const a = import.meta.env.VITE_FLIP_CONTRACT_ADDRESS;
  if (typeof a !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(a.trim())) return null;
  return /** @type {`0x${string}`} */ (a.trim());
}

/**
 * Dirección tesorería / admin que recibe **`2 · S · fee`** en cada partida escrow.
 * Debe coincidir con la del contrato al desplegar (solo lectura aquí para UX y enlaces).
 *
 * @returns {`0x${string}` | null}
 */
export function getProtocolTreasuryAddress() {
  const a = import.meta.env.VITE_PROTOCOL_TREASURY;
  if (typeof a !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(a.trim())) return null;
  return /** @type {`0x${string}`} */ (a.trim());
}

/**
 * Resumen para depuración (sin secretos).
 */
export function getRuntimeConfigSummary() {
  const chain = getTargetChain();
  return {
    chainKey: chain.key,
    chainId: chain.chainId,
    chainName: chain.name,
    gameModel: GAME_MODEL_ID,
    flipEngine: getFlipEngineKind(),
    rpcOverride: Boolean(getOptionalRpcUrl()),
    flipContract: Boolean(getFlipContractAddress()),
    protocolTreasury: Boolean(getProtocolTreasuryAddress()),
    supabaseConfigured: isSupabaseBrowserConfigured(),
    supabaseMatchmaking: Boolean(isSupabaseMatchmakingEnabled() && isSupabaseBrowserConfigured()),
  };
}

import { getFlipEngineKind } from '../config/appEnv.js';
import { createMockFlipEngine } from './mockFlipEngine.js';
import { createOnchainFlipEngineStub } from './onchainFlipEngineStub.js';

/**
 * Motor de resultado (mock síncrono hoy).
 * Producción matching PvP escrow: txs async + indexer (ver escrowPvP.js).
 */
export function getFlipEngine() {
  const kind = getFlipEngineKind();
  if (kind === 'onchain') return createOnchainFlipEngineStub();
  return createMockFlipEngine();
}

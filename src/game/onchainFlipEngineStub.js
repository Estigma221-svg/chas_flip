/**
 * Futuro motor on-chain — flujo escrow PvP (matching):
 * crear/unir match → dos `deposit`(S) al contrato escrow → esperar RNG/logs → `settle`.
 */

/**
 * @returns {import('./flipEngineTypes.js').FlipEngine}
 */
export function createOnchainFlipEngineStub() {
  return {
    kind: /** @type {const} */ ('onchain'),
    resolveRoundSync() {
      throw new Error(
        'PvP escrow on-chain pendiente: despliega contrato matching (dos depósitos S, settle al ganador + fee), '
        + 'configura VITE_FLIP_CONTRACT_ADDRESS + ABI + Privy/wagmi/viem. Ver escrowPvP.js y .env.example.',
      );
    },
  };
}

/**
 * Tiers de apuesta ↔ comisión (fracción decimal).
 * Debe estar alineado con `commission_for_stake()` en Supabase migration.
 *
 * Solo se usa para **demo local** (sin servidor). Si `VITE_USE_SUPABASE_MATCHMAKING=true`,
 * la comisión autoritativa llega desde la RPC (`commission_decimal`).
 *
 * Montos válidos únicos permitidos por el contrato / producto previsto:
 */
/** @readonly */
export const STAKE_AMOUNTS = /** @type {const} */ ([10, 100, 1000, 10000, 100000, 1000000]);

/** @type {Record<number, number>} */
export const LOCAL_COMMISSION_BY_STAKE = {
  10: 0.05,
  100: 0.03,
  1000: 0.02,
  10000: 0.01,
  100000: 0.005,
  1000000: 0.003,
};

/**
 * @param {number} stake
 * @returns {number | null}
 */
export function getLocalCommissionDecimal(stake) {
  const v = LOCAL_COMMISSION_BY_STAKE[/** @type {keyof typeof LOCAL_COMMISSION_BY_STAKE} */ (stake)];
  return typeof v === 'number' ? v : null;
}

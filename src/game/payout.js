import { winnerPayoutFromEscrowPot } from './escrowPvP.js';

/**
 * Paga al **jugador local** como si fuera una ronda escrow PvP ya resuelta.
 * Si pierde → 0. Si gana → recibe **`2 · S · (1 − fee)`** (véase `escrowPvP.js`).
 *
 * @param {number} stakePerPlayer  S (misma ficha ambos jugadores en matching).
 * @param {number} commissionDecimal  fracción 0..1 (fee sobre el **pot total 2S**).
 * @param {boolean} localPlayerWon
 */
export function computePayout(stakePerPlayer, commissionDecimal, localPlayerWon) {
  if (!localPlayerWon) return { payout: 0 };
  const payout = winnerPayoutFromEscrowPot(stakePerPlayer, commissionDecimal);
  return { payout };
}

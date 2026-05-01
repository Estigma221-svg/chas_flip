import { computePayout } from './payout.js';
import { GAME_MODEL_ID } from './gameModel.js';

/**
 * Simula resultado de una partida escrow PvP (oponente encontrado ambos ya con S).
 *
 * La UI sigue usando tiemouts de “Buscar rival / Jugando”: eso debe mapear en on-chain a:
 * MATCHMAKING → BOTH_LOCKED → RESOLVING → SETTLED.
 *
 * @typedef {object} MockRoundInput
 * @property {number} stakeAmount  S por jugador en matching
 * @property {number} commissionDecimal
 *
 * @param {MockRoundInput} input
 */
export function resolveMockRoundSync(input) {
  const { stakeAmount, commissionDecimal } = input;
  const usuarioGanaVsRival = Math.random() > 0.5;
  const { payout } = computePayout(stakeAmount, commissionDecimal, usuarioGanaVsRival);
  /** Decimal string alineado a `uint256` on-chain (demo). */
  const matchId = (BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 999_999))).toString();
  return {
    won: usuarioGanaVsRival,
    payout,
    matchId,
    roundId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    source: /** @type {const} */ ('mock'),
    gameModel: GAME_MODEL_ID,
    vrfRequestTxHash: null,
    vrfFulfillmentTxHash: null,
  };
}

export function createMockFlipEngine() {
  return {
    kind: /** @type {const} */ ('mock'),
    resolveRoundSync: resolveMockRoundSync,
  };
}

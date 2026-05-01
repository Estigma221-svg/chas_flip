/**
 * ---------------------------------------------------------------------------
 * ChasFlip — economía escrow PvP (matching)
 * ---------------------------------------------------------------------------
 * - **Matching**: jugadores emparejados con la misma apuesta por jugador `S`
 *   (tier fijo como en la UI actual).
 * - **Escrow**: el contrato recibe **S** de cada lado → custodia total **2·S** hasta resolver.
 * - **Resolución**: ganador con **Chainlink VRF** — aleatoriedad demostrable on-chain y auditable en explorer.
 * - **Liquidación**: el ganador cobra **`2 · S · (1 − fee)`**; el **`2 · S · fee`**
 *   va a la tesorería del protocolo (**`treasury`** en Solidity), misma dirección que
 *   configures en `VITE_PROTOCOL_TREASURY` solo para UX (sin claves en el front).
 * - El perdedor recibe **0** de vuelta (todo el bote asignado al ganador + fee al protocolo).
 *
 * Responsabilidades previstas del **contrato** (referencia para Solidity):
 * 1. `queue` / `openRoom` por `tier` o monto hash (matching off-chain indexer o FIFO on-chain).
 * 2. `deposit`/`lockStake` desde cada jugador (ERC‑20 Permit o transfer al escrow).
 * 3. Requisito explícito: **ambos depósitos = S** antes de pasar a resolución (revert si no coincide).
 * 4. Resolver: **Chainlink VRF** en la red destino (cumplimiento verificable en explorer).
 * 5. `settle(matchId)` transfiere al ganador y fee al treasury; marca match cerrado anti‑replay.
 *
 * Esta capa frontend solo replica la matemática; no hay garantías hasta exista el ABI desplegado.
 * ---------------------------------------------------------------------------
 */

/** Jugadores por partida escrow simétrica (1vs1). */
export const PLAYERS_PER_MATCH = 2;

/**
 * Bote total custodiado antes de fees (cadena debe validar igualdad `S`).
 * @param {number} stakePerPlayer  S ≥ 0
 */
export function totalEscrowPot(stakePerPlayer) {
  return stakePerPlayer * PLAYERS_PER_MATCH;
}

/**
 * Lo que debe recibir el ganador después de aplicar fee sobre todo el pot (demo / diseño objetivo).
 * @param {number} stakePerPlayer
 * @param {number} feeDecimal  parte del pot que va a protocolo [0..1], ej. 0.03
 */
export function winnerPayoutFromEscrowPot(stakePerPlayer, feeDecimal) {
  return totalEscrowPot(stakePerPlayer) * (1 - feeDecimal);
}

/**
 * Fee total en mismas unidades que el pot (`2·S`).
 * @param {number} stakePerPlayer
 * @param {number} feeDecimal
 */
export function protocolFeeTotal(stakePerPlayer, feeDecimal) {
  return totalEscrowPot(stakePerPlayer) * feeDecimal;
}

/**
 * Estado de ciclo del match (útiles UI / indexer; el contrato puede usar enums distintos).
 * @readonly
 */
export const MatchPhaseIntent = /** @type {const} */ ({
  /** En cola o buscando oponente compatible en `S`. */
  MATCHMAKING: 'matchmaking',
  /** Ambos desposits efectivos dentro del escrow. */
  BOTH_LOCKED_IN_ESCROW: 'both_locked',
  /** Esperando RNG / tiempo de bloque / reveal según contrato. */
  RESOLVING: 'resolving',
  /** Ganador y treasury pagados. */
  SETTLED: 'settled',
});

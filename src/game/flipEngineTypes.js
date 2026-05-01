/**
 * Contrato común entre mock y onchain (JSDoc).
 *
 * Matching PvP + escrow — `stakeAmount` equivale a **apuesta por jugador S** ambos igual.
 *
 * @typedef {object} RoundInput
 * @property {number} stakeAmount   S por jugador (matched); pot escrow = 2S.
 * @property {number} commissionDecimal fee sobre pot [0..1]
 *
 * @typedef {object} RoundResult
 * @property {boolean} won  ¿el jugador local (Tu) ganó contra el oponente emparejado?
 * @property {number} payout  líquido si gana = 2S(1-fee)
 * @property {string} matchId id `uint256` de partida en el contrato escrow (mismo campo en Solidity)
 * @property {string} roundId correlación off-chain / indexer (puede igualar logs de VRF por ronda)
 * @property {'mock' | 'onchain' | 'supabase'} source
 * @property {'pvp_matching_escrow'} gameModel
 * @property {string | null | undefined} [vrfRequestTxHash]  petición VRF (explorer)
 * @property {string | null | undefined} [vrfFulfillmentTxHash]  cumplimiento VRF (explorer)
 *
 * @typedef {object} FlipEngine
 * @property {'mock' | 'onchain'} kind
 * @property {(input: RoundInput) => RoundResult} resolveRoundSync
 */

export {};

/**
 * Identificador estable del modelo de producto — útil para logs, indexer y backends.
 *
 * Matching PvP: dos jugadores con la misma ficha `S`; el contrato actúa como **escrow**,
 * acumula **2·S**, resuelve el ganador de forma determinista on-chain y reparte fondos.
 */
export const GAME_MODEL_ID = 'pvp_matching_escrow';

/**
 * Checklist de ingeniería prevista para blindar el protocolo (referencia Solidity).
 * No sustituye auditoría externa. El front solo documenta el estándar esperado.
 */

export const ESCROW_SECURITY_CHECKLIST = Object.freeze([
  'Tesorería (comisiones): dirección fijada en constructor (immutable) o actualizable solo por timelock + multisig (Ownable2Step).',
  '`settle(matchId)`: checks-effects-interactions; ReentrancyGuard en transferencias ERC-20 / nativo.',
  'Sin `delegatecall` arbitrario ni saltos a direcciones controladas por usuarios.',
  'Matching: validar que ambos depósitos tienen el mismo `tier` / cantidad antes de abrir VRF.',
  'VRF: consumidor verificado contra coordenadora Chainlink de la red; revisar `subscriptionId` y límites de gas.',
  'Pausable de emergencia (multisig) transparente para usuarios en la UI.',
  'Retiros grandes del treasury: preferir multisig / cold wallet; nunca claves en servidor o en el bundle del front.',
]);

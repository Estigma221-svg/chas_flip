/**
 * Configuración wagmi + RainbowKit para ChasFlip.
 *
 * Hoy soporta SOLO Polygon mainnet — decisión tomada con el dueño:
 * - Gas casi cero (~$0.001 por tx).
 * - Gran liquidez en USDT (token elegido para apuestas reales en Fase 2.C).
 * - Soporte universal en MetaMask, Coinbase Wallet, Rabby y WalletConnect.
 *
 * En Fase 2.C cuando despleguemos el escrow podemos:
 *   1. Cambiar `[polygon]` por `[polygon, polygonAmoy]` para testnet.
 *   2. Agregar más cadenas en `chains` y RainbowKit las muestra como tabs.
 *
 * IMPORTANTE: `VITE_WALLETCONNECT_PROJECT_ID` se obtiene gratis en
 * <https://cloud.reown.com> (antes WalletConnect Cloud). Sin un projectId
 * válido, las wallets móviles que usan WalletConnect no podrán conectarse
 * (MetaMask/Coinbase de escritorio sí porque son inyectadas).
 */

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { polygon } from 'wagmi/chains';
import { http } from 'wagmi';

/** Lee `VITE_WALLETCONNECT_PROJECT_ID` con fallback. */
function readWalletConnectProjectId() {
  const raw = typeof import.meta.env.VITE_WALLETCONNECT_PROJECT_ID === 'string'
    ? import.meta.env.VITE_WALLETCONNECT_PROJECT_ID.trim()
    : '';
  if (raw) return raw;
  // Sin projectId real las wallets móviles WC fallarán; el modal seguirá
  // funcionando con MetaMask/Coinbase/Rabby inyectadas.
  console.warn(
    '[chasflip] VITE_WALLETCONNECT_PROJECT_ID vacío. Wallets móviles vía WalletConnect no estarán disponibles. Crea uno gratis en https://cloud.reown.com',
  );
  return 'chasflip-dev-placeholder';
}

/** RPC público de Polygon. Si el usuario aporta `VITE_RPC_URL_POLYGON` lo usamos. */
function readPolygonRpcUrl() {
  const raw = typeof import.meta.env.VITE_RPC_URL_POLYGON === 'string'
    ? import.meta.env.VITE_RPC_URL_POLYGON.trim()
    : '';
  return raw || undefined;
}

export const SUPPORTED_CHAINS = /** @type {const} */ ([polygon]);

export const wagmiConfig = getDefaultConfig({
  appName: 'ChasFlip',
  appDescription: 'Bitcoin Native PvP coin flip',
  appUrl: 'https://chas-flip.vercel.app',
  appIcon: 'https://chas-flip.vercel.app/icon.png',
  projectId: readWalletConnectProjectId(),
  chains: SUPPORTED_CHAINS,
  transports: {
    [polygon.id]: http(readPolygonRpcUrl()),
  },
  ssr: false,
});

/**
 * USDT en Polygon PoS (Tether). Stablecoin más usada en la red.
 * 6 decimales (no 18). Si en Fase 2.C decidimos USDC, cambiar aquí.
 */
export const USDT_POLYGON = /** @type {const} */ ({
  address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  decimals: 6,
  symbol: 'USDT',
});

/**
 * ABI mínimo ERC-20: solo `balanceOf` para lectura decorativa.
 */
export const ERC20_BALANCE_ABI = /** @type {const} */ ([
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
]);

/**
 * Trunca una dirección a `0x1234…abcd` para mostrar en UI.
 * @param {string | undefined | null} address
 * @returns {string}
 */
export function truncateAddress(address) {
  if (typeof address !== 'string') return '';
  if (!/^0x[a-fA-F0-9]{40}$/i.test(address)) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

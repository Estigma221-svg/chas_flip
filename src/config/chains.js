/**
 * Redes objetivo — EVM L2 / sidechain con bajo coste y buen soporte en carteras
 * embedded (Magic, Privy, etc.). Los IDs son los oficialmente usados por wagmi/viem.
 *
 * @typedef {object} ChainDefinition
 * @property {number} chainId
 * @property {string} name
 * @property {string} key  identificador estable en variables de entorno
 * @property {string} nativeSymbol
 * @property {string} blockExplorerUrl
 */

/** @type {Record<string, ChainDefinition>} */
export const CHAIN_PRESETS = {
  /** Base Sepolia — entorno recomendado mientras desarrollamos contratos */
  'base-sepolia': {
    key: 'base-sepolia',
    chainId: 84532,
    name: 'Base Sepolia',
    nativeSymbol: 'ETH',
    blockExplorerUrl: 'https://sepolia.basescan.org',
  },
  /** Base Mainnet */
  base: {
    key: 'base',
    chainId: 8453,
    name: 'Base',
    nativeSymbol: 'ETH',
    blockExplorerUrl: 'https://basescan.org',
  },
  /** Polygon PoS Mainnet */
  polygon: {
    key: 'polygon',
    chainId: 137,
    name: 'Polygon PoS',
    nativeSymbol: 'POL',
    blockExplorerUrl: 'https://polygonscan.com',
  },
  /** Amoy — testnet Polygon */
  'polygon-amoy': {
    key: 'polygon-amoy',
    chainId: 80002,
    name: 'Polygon Amoy',
    nativeSymbol: 'POL',
    blockExplorerUrl: 'https://amoy.polygonscan.com',
  },
};

const DEFAULT_CHAIN_KEY = 'base-sepolia';

/**
 * Cadena configurada por `VITE_CHAIN_KEY`. Si el valor es inválido, usa Base Sepolia.
 * @returns {ChainDefinition}
 */
export function getTargetChain() {
  const raw = typeof import.meta.env.VITE_CHAIN_KEY === 'string'
    ? import.meta.env.VITE_CHAIN_KEY.trim().toLowerCase()
    : '';
  const key = raw || DEFAULT_CHAIN_KEY;
  const chain = CHAIN_PRESETS[key];
  if (!chain) {
    console.warn(
      `[chasflip] VITE_CHAIN_KEY="${raw}" no reconocido; usando ${DEFAULT_CHAIN_KEY}. Opciones:`,
      Object.keys(CHAIN_PRESETS).join(', '),
    );
    return CHAIN_PRESETS[DEFAULT_CHAIN_KEY];
  }
  return chain;
}

/**
 * @param {number} chainId
 * @returns {ChainDefinition | null}
 */
export function getChainById(chainId) {
  const found = Object.values(CHAIN_PRESETS).find((c) => c.chainId === chainId);
  return found ?? null;
}

/**
 * @param {string} blockExplorerUrl
 * @param {`0x${string}`} address
 * @returns {string | null}
 */
export function getExplorerAddressUrl(blockExplorerUrl, address) {
  const a = typeof address === 'string' ? address.trim() : '';
  if (!/^0x[a-fA-F0-9]{40}$/i.test(a)) return null;
  const base = blockExplorerUrl.replace(/\/$/, '');
  const normalized = `0x${a.slice(2).toLowerCase()}`;
  return `${base}/address/${normalized}`;
}

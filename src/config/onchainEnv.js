/**
 * Config on-chain del Vault (Fase 2.C.1).
 *
 * Lee variables `VITE_VAULT_*` que se setean en Vercel / .env.local. Si no
 * estan completas, retorna `null` y el frontend cae automaticamente al modo
 * "demo only" (el botón "Depositar real" queda deshabilitado).
 */

/**
 * @typedef {object} VaultConfig
 * @property {string} address           ChasFlipVault deployado (checksum address)
 * @property {string} tokenAddress      ERC-20 que custodia el vault (USDT o mUSDT)
 * @property {number} chainId           80002 Amoy / 137 Polygon mainnet
 * @property {string} chainName         "Polygon Amoy" / "Polygon"
 * @property {string} domainName        "ChasFlipVault" (debe matchear EIP-712 del contrato)
 * @property {string} domainVersion     "1"
 */

/** @returns {VaultConfig | null} */
export function getVaultConfig() {
  const vault = String(import.meta.env.VITE_VAULT_ADDRESS || '').trim();
  const token = String(import.meta.env.VITE_VAULT_TOKEN_ADDRESS || '').trim();
  const chainIdRaw = String(import.meta.env.VITE_VAULT_CHAIN_ID || '').trim();
  const chainId = Number(chainIdRaw);

  if (!vault || !token || !chainId) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(vault)) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) return null;

  const chainName =
    chainId === 80002 ? 'Polygon Amoy' :
    chainId === 137   ? 'Polygon'      : `Chain ${chainId}`;

  return {
    address: vault,
    tokenAddress: token,
    chainId,
    chainName,
    domainName: 'ChasFlipVault',
    domainVersion: '1',
  };
}

export function isVaultEnabled() {
  return getVaultConfig() !== null;
}

/**
 * Hook que encapsula la conexión de wallet on-chain con wagmi + RainbowKit.
 *
 * Devuelve los datos necesarios para que el Header / Arena pinten estado real:
 *  - `address`: `0x…` conectada (o `null`).
 *  - `chainId` activo del cliente.
 *  - `isConnected`: booleano derivado de wagmi.
 *  - `isOnSupportedChain`: si el user está en Polygon mainnet.
 *  - `usdtBalanceFormatted`: balance de USDT formateado con 2 decimales (o `null`).
 *  - `openConnectModal` / `disconnect` / `openAccountModal`: handlers para el botón.
 *
 * NO mueve saldo demo, NO escribe al ledger. Hoy es solo lectura.
 * El "saldo" mostrado en el header sigue siendo el de `localStorage`.
 */

import { useMemo } from 'react';
import { useAccount, useDisconnect, useReadContract } from 'wagmi';
import { polygon } from 'wagmi/chains';
import { useAccountModal, useConnectModal } from '@rainbow-me/rainbowkit';
import { ERC20_BALANCE_ABI, USDT_POLYGON } from './wagmiConfig.js';

/**
 * Formatea una cantidad uint con `decimals` decimales como string con 2 dígitos.
 * @param {bigint | undefined | null} raw
 * @param {number} decimals
 * @returns {string | null}
 */
function formatUnitsSafe(raw, decimals) {
  if (raw === undefined || raw === null) return null;
  try {
    const negative = raw < 0n;
    const abs = negative ? -raw : raw;
    const base = 10n ** BigInt(decimals);
    const whole = abs / base;
    const frac = abs % base;
    const fracStr = frac.toString().padStart(decimals, '0').slice(0, 2);
    const out = `${whole.toString()}.${fracStr}`;
    return negative ? `-${out}` : out;
  } catch {
    return null;
  }
}

export function useWalletPanel() {
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { disconnect } = useDisconnect();

  const isOnSupportedChain = chainId === polygon.id;

  const { data: rawBalance, isFetching: isBalanceLoading } = useReadContract({
    abi: ERC20_BALANCE_ABI,
    address: USDT_POLYGON.address,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: polygon.id,
    query: {
      enabled: Boolean(address) && isOnSupportedChain,
      // Refetch suave: cada 30s para no spamear el RPC público.
      refetchInterval: 30_000,
      staleTime: 15_000,
    },
  });

  const usdtBalanceFormatted = useMemo(
    () => formatUnitsSafe(/** @type {bigint | undefined} */ (rawBalance), USDT_POLYGON.decimals),
    [rawBalance],
  );

  return {
    address: address ?? null,
    chainId: chainId ?? null,
    isConnected,
    isOnSupportedChain,
    usdtSymbol: USDT_POLYGON.symbol,
    usdtBalanceFormatted,
    isBalanceLoading,
    openConnectModal,
    openAccountModal,
    disconnect,
  };
}

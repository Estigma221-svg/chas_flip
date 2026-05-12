/**
 * Cliente del Vault on-chain — Supabase RPCs + Edge Functions (Fase 2.C.1).
 */
import { getSupabaseBrowserClient } from '../lib/supabaseClient.js';

/**
 * Vincula `address` con `auth.uid()` del cliente. Idempotente. Si la address
 * ya pertenece a OTRO user, falla con `address_taken`.
 *
 * @param {string} address  Address EOA (lowercase) que el user controla.
 * @param {number} chainId  Chain id (80002 Amoy / 137 Polygon).
 * @returns {Promise<{ ok: boolean, address: string, chain_id: number }>}
 */
export async function linkOnchainAddress(address, chainId) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('link_onchain_address', {
    p_address: address,
    p_chain_id: chainId,
  });
  if (error) throw error;
  return data;
}

/**
 * Pide al server un ticket EIP-712 firmado autorizando al user a retirar
 * `amount` del vault al `address` indicado. El server debita el saldo
 * atomicamente antes de firmar.
 *
 * Internamente llama la Edge Function `vault-withdraw-ticket` (que a su vez
 * invoca el RPC `issue_withdraw_intent` con el JWT del cliente).
 *
 * @param {object} args
 * @param {number} args.amount     Monto en unidades enteras del token (USDT). Ej. 25 = 25 USDT.
 * @param {string} args.address    Address que recibe los fondos on-chain.
 * @returns {Promise<{
 *   ok: boolean,
 *   intent_id: string,
 *   ticket: { user: string, amount: string, nonce: string, deadline: string, signature: string },
 *   chain_id: number,
 *   vault: string,
 *   balance_after: number,
 * }>}
 */
export async function requestWithdrawTicket({ amount, address }) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.functions.invoke('vault-withdraw-ticket', {
    body: { amount, address },
  });
  if (error) throw error;
  return data;
}

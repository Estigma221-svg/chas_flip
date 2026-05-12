/**
 * vault-withdraw-ticket — Edge Function que el frontend invoca cuando el user
 *                        pide retirar dinero del vault. Hace dos cosas:
 *                        1. Llama `issue_withdraw_intent` (debita ledger
 *                           atomicamente, asigna nonce/deadline).
 *                        2. Firma EIP-712 del struct `WithdrawTicket` con la
 *                           private key del SERVER_SIGNER (env secret).
 *                           Devuelve la firma + datos para que el cliente
 *                           presente la tx al contrato.
 *
 * Variables de entorno necesarias en Supabase:
 *   - SUPABASE_URL
 *   - SUPABASE_ANON_KEY
 *   - SUPABASE_SERVICE_ROLE_KEY   (no necesario aqui, pero util en futuro)
 *   - VAULT_CONTRACT_ADDRESS
 *   - VAULT_CHAIN_ID
 *   - SERVER_SIGNER_PRIVATE_KEY   (privkey de la wallet que firma tickets)
 *   - VAULT_WITHDRAW_TTL_SECONDS  (opcional, default 900s = 15 minutos)
 *
 * Auth: requiere JWT del jugador (Authorization header). El RPC
 * `issue_withdraw_intent` usa auth.uid() para identificar al user.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseClientFromRequest } from '../_shared/supabase.ts';
import { keccak_256 } from 'https://esm.sh/@noble/hashes@1.4.0/sha3';
import { secp256k1 } from 'https://esm.sh/@noble/curves@1.6.0/secp256k1';

// ---------------------------------------------------------------------------
// EIP-712 helpers (sin librerias pesadas, manual y auditable).
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('invalid_hex_length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '0x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function leftPad32(input: Uint8Array): Uint8Array {
  if (input.length > 32) throw new Error('overflow_left_pad');
  const out = new Uint8Array(32);
  out.set(input, 32 - input.length);
  return out;
}

function uint256ToBytes(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('negative_uint');
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  return leftPad32(hexToBytes(`0x${hex}`));
}

function addressToBytes32(addrHex: string): Uint8Array {
  const clean = addrHex.startsWith('0x') ? addrHex.slice(2) : addrHex;
  if (clean.length !== 40) throw new Error('invalid_address');
  return leftPad32(hexToBytes(`0x${clean}`));
}

function keccakBytes(input: Uint8Array): Uint8Array {
  return keccak_256(input);
}

const TYPE_HASH_DOMAIN = keccakBytes(
  new TextEncoder().encode('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
);

const TYPE_HASH_WITHDRAW = keccakBytes(
  new TextEncoder().encode('WithdrawTicket(address user,uint256 amount,uint256 nonce,uint256 deadline)'),
);

function domainSeparator(chainId: number, verifyingContract: string): Uint8Array {
  const nameHash = keccakBytes(new TextEncoder().encode('ChasFlipVault'));
  const versionHash = keccakBytes(new TextEncoder().encode('1'));
  const encoded = concatBytes(
    TYPE_HASH_DOMAIN,
    nameHash,
    versionHash,
    uint256ToBytes(BigInt(chainId)),
    addressToBytes32(verifyingContract),
  );
  return keccakBytes(encoded);
}

function structHashWithdraw(user: string, amount: bigint, nonce: bigint, deadline: bigint): Uint8Array {
  return keccakBytes(
    concatBytes(
      TYPE_HASH_WITHDRAW,
      addressToBytes32(user),
      uint256ToBytes(amount),
      uint256ToBytes(nonce),
      uint256ToBytes(deadline),
    ),
  );
}

function digest(domainSep: Uint8Array, structH: Uint8Array): Uint8Array {
  return keccakBytes(concatBytes(new Uint8Array([0x19, 0x01]), domainSep, structH));
}

function signDigest(digestBytes: Uint8Array, privKeyHex: string): string {
  const pk = hexToBytes(privKeyHex);
  if (pk.length !== 32) throw new Error('invalid_priv_key');
  const sig = secp256k1.sign(digestBytes, pk, { lowS: true });
  const r = uint256ToBytes(sig.r);
  const s = uint256ToBytes(sig.s);
  // Ethereum recovery id = recovery + 27. recovery viene en sig.recovery (0 o 1).
  const v = new Uint8Array([(sig.recovery ?? 0) + 27]);
  return bytesToHex(concatBytes(r, s, v));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: corsHeaders() });
    }
    const auth = req.headers.get('Authorization');
    if (!auth) {
      return Response.json({ error: 'missing_authorization' }, { status: 401, headers: corsHeaders() });
    }

    const vaultAddress = (Deno.env.get('VAULT_CONTRACT_ADDRESS') ?? '').toLowerCase();
    const chainId = Number(Deno.env.get('VAULT_CHAIN_ID') ?? '0');
    const signerPriv = (Deno.env.get('SERVER_SIGNER_PRIVATE_KEY') ?? '').trim();
    const ttlSeconds = Number(Deno.env.get('VAULT_WITHDRAW_TTL_SECONDS') ?? '900');
    if (!vaultAddress || !chainId || !signerPriv) {
      return Response.json(
        { error: 'missing_env', need: ['VAULT_CONTRACT_ADDRESS', 'VAULT_CHAIN_ID', 'SERVER_SIGNER_PRIVATE_KEY'] },
        { status: 500, headers: corsHeaders() },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      amount?: number | string;
      address?: string;
    };
    const amountNum = typeof body.amount === 'number' ? body.amount : parseFloat(String(body.amount ?? 'NaN'));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return Response.json({ error: 'invalid_amount' }, { status: 400, headers: corsHeaders() });
    }
    const address = String(body.address ?? '').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return Response.json({ error: 'invalid_address' }, { status: 400, headers: corsHeaders() });
    }

    const supabase = supabaseClientFromRequest(req);
    const { data: intent, error: rpcErr } = await supabase.rpc('issue_withdraw_intent', {
      p_amount: amountNum,
      p_address: address,
      p_chain_id: chainId,
      p_ttl_seconds: ttlSeconds,
    });
    if (rpcErr) {
      console.error('[vault-withdraw-ticket] rpc', rpcErr);
      const msg = rpcErr.message ?? 'rpc_error';
      const status = /unauthenticated|address_not_linked|insufficient_funds|invalid/.test(msg) ? 400 : 500;
      return Response.json({ error: msg }, { status, headers: corsHeaders() });
    }
    if (!intent) {
      return Response.json({ error: 'no_intent' }, { status: 500, headers: corsHeaders() });
    }

    // RPC devuelve amount como number (1e6 fraccionario), nonce y deadline como strings.
    // El contrato espera amount en unidades del token (6 decimales).
    const amountUnits = BigInt(Math.round(Number(intent.amount) * 1_000_000));
    const nonce = BigInt(intent.nonce);
    const deadline = BigInt(intent.deadline);

    const dSep = domainSeparator(chainId, vaultAddress);
    const sHash = structHashWithdraw(address, amountUnits, nonce, deadline);
    const dig = digest(dSep, sHash);
    const signature = signDigest(dig, signerPriv);

    return Response.json(
      {
        ok: true,
        intent_id: intent.intent_id,
        ticket: {
          user: address,
          amount: amountUnits.toString(),
          nonce: nonce.toString(),
          deadline: deadline.toString(),
          signature,
        },
        chain_id: chainId,
        vault: vaultAddress,
        balance_after: intent.balance_after,
      },
      { headers: corsHeaders() },
    );
  } catch (e) {
    console.error('[vault-withdraw-ticket]', e);
    return Response.json(
      { error: 'internal_error', message: (e as Error).message },
      { status: 500, headers: corsHeaders() },
    );
  }
});

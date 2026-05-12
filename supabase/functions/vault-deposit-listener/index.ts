/**
 * vault-deposit-listener — Edge Function que escucha eventos `Deposited` y
 *                         `Withdrawn` del contrato `ChasFlipVault` y reconcilia
 *                         el ledger autoritativo en `public.transactions`.
 *
 * Diseño:
 *  - Sin cron-job nativo de Supabase (todavía limitado); invocamos esta
 *    función cada N segundos desde un workflow externo (GitHub Actions cron,
 *    Vercel cron, o un upstash QStash). El payload del request indica
 *    "from_block" opcional para reescaneo manual.
 *  - Mantenemos el cursor del último bloque escaneado en el audit_log
 *    (clave 'vault_listener_cursor'). Lectura/escritura via RPC dedicada.
 *  - Idempotencia: `record_vault_deposit` y `mark_withdraw_completed` son
 *    seguras de re-ejecutar (UNIQUE constraints + branches "duplicate").
 *  - Confirmaciones: solo procesamos hasta `latest - CONFIRMATIONS` para
 *    evitar reorgs cortos.
 *
 * Variables de entorno necesarias en Supabase:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - VAULT_RPC_URL              (ej. https://rpc-amoy.polygon.technology)
 *   - VAULT_CONTRACT_ADDRESS     (address del ChasFlipVault deployado)
 *   - VAULT_CHAIN_ID             (numero, ej. 80002 para Amoy)
 *   - VAULT_DEPLOY_BLOCK         (bloque inicial del deploy, fallback del cursor)
 *   - VAULT_LISTENER_SHARED_SECRET (opcional, si se setea exige header
 *                                   X-Listener-Secret en cada request)
 *
 * Output: { fromBlock, toBlock, processedDeposits, processedWithdrawals, ... }
 */
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseServiceClient } from '../_shared/supabase.ts';
import { keccak_256 } from 'https://esm.sh/@noble/hashes@1.4.0/sha3';

// Topics derivados deterministicamente de las signatures del contrato.
// Si la firma de los eventos cambia, recalcular y desplegar el contrato.
const SIG_DEPOSITED = 'Deposited(address,uint256,uint256,uint256)';
const SIG_WITHDRAWN = 'Withdrawn(address,uint256,uint256,uint256,uint256)';

function keccakHex(input: string): string {
  const enc = new TextEncoder().encode(input);
  const out = keccak_256(enc);
  let hex = '0x';
  for (const b of out) hex += b.toString(16).padStart(2, '0');
  return hex;
}

const DEPOSITED_TOPIC = keccakHex(SIG_DEPOSITED);
const WITHDRAWN_TOPIC = keccakHex(SIG_WITHDRAWN);

const MAX_BLOCKS_PER_RUN = 5000;
const DEFAULT_CONFIRMATIONS = 6;

type EvmLog = {
  address: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  data: string;
};

type EvmBlock = {
  number: string;
  timestamp: string;
};

async function rpcCall(rpcUrl: string, method: string, params: unknown[]) {
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!resp.ok) throw new Error(`rpc_http_${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(`rpc_err:${json.error?.message || JSON.stringify(json.error)}`);
  return json.result;
}

function hexToBigInt(h: string): bigint {
  return BigInt(h.startsWith('0x') ? h : `0x${h}`);
}

function hexToNumber(h: string): number {
  return Number(hexToBigInt(h));
}

function decodeAddressTopic(topic: string): string {
  // topic = 0x000...000 + 40 hex chars de address.
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function decodeUint256Data(dataHex: string, offset: number): bigint {
  const start = 2 + offset * 64;
  return hexToBigInt(`0x${dataHex.slice(start, start + 64)}`);
}

function getTopic(name: 'Deposited' | 'Withdrawn'): string {
  const override = Deno.env.get(`VAULT_TOPIC_${name.toUpperCase()}`);
  if (override) return override.toLowerCase();
  return name === 'Deposited' ? DEPOSITED_TOPIC : WITHDRAWN_TOPIC;
}

async function getCursor(supabase: ReturnType<typeof supabaseServiceClient>, fallback: number): Promise<number> {
  const { data } = await supabase
    .from('audit_log')
    .select('payload')
    .eq('action', 'vault_listener_cursor')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const cursor = data?.payload?.block_number;
  return typeof cursor === 'number' && cursor > 0 ? cursor : fallback;
}

async function saveCursor(supabase: ReturnType<typeof supabaseServiceClient>, blockNumber: number) {
  await supabase.from('audit_log').insert({
    action: 'vault_listener_cursor',
    target_id: null,
    payload: { block_number: blockNumber, saved_at: new Date().toISOString() },
  });
}

async function resolveUserForAddress(
  supabase: ReturnType<typeof supabaseServiceClient>,
  address: string,
  chainId: number,
): Promise<string | null> {
  const { data } = await supabase
    .from('onchain_addresses')
    .select('user_id')
    .eq('address', address.toLowerCase())
    .eq('chain_id', chainId)
    .is('unlinked_at', null)
    .maybeSingle();
  return data?.user_id ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  try {
    const sharedSecret = Deno.env.get('VAULT_LISTENER_SHARED_SECRET');
    if (sharedSecret) {
      if (req.headers.get('X-Listener-Secret') !== sharedSecret) {
        return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders() });
      }
    }

    const rpcUrl = Deno.env.get('VAULT_RPC_URL');
    const vaultAddress = (Deno.env.get('VAULT_CONTRACT_ADDRESS') ?? '').toLowerCase();
    const chainId = Number(Deno.env.get('VAULT_CHAIN_ID') ?? '0');
    const deployBlock = Number(Deno.env.get('VAULT_DEPLOY_BLOCK') ?? '0');
    const confirmations = Number(Deno.env.get('VAULT_CONFIRMATIONS') ?? `${DEFAULT_CONFIRMATIONS}`);

    if (!rpcUrl || !vaultAddress || !chainId) {
      return Response.json(
        { error: 'missing_env', need: ['VAULT_RPC_URL', 'VAULT_CONTRACT_ADDRESS', 'VAULT_CHAIN_ID'] },
        { status: 500, headers: corsHeaders() },
      );
    }

    const overrideBody = (await req.json().catch(() => ({}))) as {
      from_block?: number;
      max_blocks?: number;
    };

    const supabase = supabaseServiceClient();

    const latestHex = await rpcCall(rpcUrl, 'eth_blockNumber', []);
    const latest = hexToNumber(latestHex);
    const safeLatest = Math.max(0, latest - confirmations);

    const cursorBefore = overrideBody.from_block ?? (await getCursor(supabase, deployBlock));
    const fromBlock = Math.max(cursorBefore, deployBlock);
    const maxBlocks = Math.min(overrideBody.max_blocks ?? MAX_BLOCKS_PER_RUN, MAX_BLOCKS_PER_RUN);
    const toBlock = Math.min(fromBlock + maxBlocks - 1, safeLatest);

    if (toBlock < fromBlock) {
      return Response.json(
        {
          ok: true,
          message: 'no_new_blocks',
          latest,
          safeLatest,
          fromBlock,
          toBlock,
          cursorBefore,
        },
        { headers: corsHeaders() },
      );
    }

    const depositedTopic = getTopic('Deposited');
    const withdrawnTopic = getTopic('Withdrawn');

    const logs: EvmLog[] = await rpcCall(rpcUrl, 'eth_getLogs', [
      {
        address: vaultAddress,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
        topics: [[depositedTopic, withdrawnTopic]],
      },
    ]);

    let depositsProcessed = 0;
    let depositsSkipped = 0;
    let withdrawalsProcessed = 0;
    let withdrawalsSkipped = 0;
    const errors: string[] = [];

    // Cache de timestamps de bloques (evita llamadas repetidas para mismo bloque).
    const blockTimestamps = new Map<number, Date>();
    const fetchBlockTime = async (blockNumber: number): Promise<Date | null> => {
      if (blockTimestamps.has(blockNumber)) return blockTimestamps.get(blockNumber)!;
      try {
        const block: EvmBlock = await rpcCall(rpcUrl, 'eth_getBlockByNumber', [
          `0x${blockNumber.toString(16)}`,
          false,
        ]);
        const ts = new Date(hexToNumber(block.timestamp) * 1000);
        blockTimestamps.set(blockNumber, ts);
        return ts;
      } catch {
        return null;
      }
    };

    for (const log of logs) {
      const topic0 = (log.topics?.[0] ?? '').toLowerCase();
      const blockNumber = hexToNumber(log.blockNumber);
      const logIndex = hexToNumber(log.logIndex);
      const txHash = log.transactionHash.toLowerCase();

      if (topic0 === depositedTopic.toLowerCase()) {
        const userAddress = decodeAddressTopic(log.topics[1]);
        const amount = decodeUint256Data(log.data, 0);
        const userId = await resolveUserForAddress(supabase, userAddress, chainId);
        if (!userId) {
          depositsSkipped += 1;
          await supabase.from('audit_log').insert({
            action: 'vault_deposit_unlinked',
            target_id: txHash,
            payload: { address: userAddress, log_index: logIndex, amount: amount.toString() },
          });
          continue;
        }
        const blockTime = await fetchBlockTime(blockNumber);
        const { data, error } = await supabase.rpc('record_vault_deposit', {
          p_user_id: userId,
          p_address: userAddress,
          p_chain_id: chainId,
          p_amount: Number(amount) / 1_000_000,
          p_tx_hash: txHash,
          p_log_index: logIndex,
          p_block_number: blockNumber,
          p_block_time: blockTime?.toISOString() ?? null,
        });
        if (error) {
          errors.push(`deposit_${txHash}_${logIndex}: ${error.message}`);
        } else if (data && (data as { duplicate?: boolean }).duplicate) {
          depositsSkipped += 1;
        } else {
          depositsProcessed += 1;
        }
      } else if (topic0 === withdrawnTopic.toLowerCase()) {
        const userAddress = decodeAddressTopic(log.topics[1]);
        const nonce = decodeUint256Data(log.data, 1);
        const { data, error } = await supabase.rpc('mark_withdraw_completed', {
          p_address: userAddress,
          p_chain_id: chainId,
          p_nonce: nonce.toString(),
          p_tx_hash: txHash,
        });
        if (error) {
          errors.push(`withdraw_${txHash}_nonce_${nonce}: ${error.message}`);
        } else if (data && (data as { already_completed?: boolean }).already_completed) {
          withdrawalsSkipped += 1;
        } else {
          withdrawalsProcessed += 1;
        }
      }
    }

    if (toBlock > cursorBefore) {
      await saveCursor(supabase, toBlock);
    }

    return Response.json(
      {
        ok: true,
        latest,
        safeLatest,
        fromBlock,
        toBlock,
        cursorBefore,
        cursorAfter: toBlock,
        depositsProcessed,
        depositsSkipped,
        withdrawalsProcessed,
        withdrawalsSkipped,
        logsScanned: logs.length,
        errors,
      },
      { headers: corsHeaders() },
    );
  } catch (e) {
    console.error('[vault-deposit-listener]', e);
    return Response.json(
      { error: 'internal_error', message: (e as Error).message },
      { status: 500, headers: corsHeaders() },
    );
  }
});

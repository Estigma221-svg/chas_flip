# ChasFlip + Supabase

## 1. Base de datos

1. Crear proyecto en [Supabase Dashboard](https://supabase.com/dashboard).
2. **Authentication → Providers → Anonymous sign-ins**: activar.
3. **SQL Editor**: ejecutar las migraciones en orden cronológico (el timestamp del archivo es la fecha). La forma más rápida es pegar `BOOTSTRAP.sql` entero — es idempotente e incluye TODAS las migraciones hasta hoy. Si prefieres ir una por una:

   1. `migrations/20260429120000_chasflip_matchmaking.sql` — tablas base + RPCs de matching.
   2. `migrations/20260430104500_matches_payout_audit.sql` — columnas `payout_winner_numeric`, `protocol_fee_total`.
   3. `migrations/20260501123000_commissions_v2.sql` — tiers de comisión.
   4. `migrations/20260501142000_chat_messages.sql` — tabla `messages` + RLS.
   5. `migrations/20260501150000_user_stats.sql` — agregados PnL.
   6. `migrations/20260501161500_messages_v2_columns.sql` — badges PnL + país.
   7. `migrations/20260503020000_security_hardening.sql` — rate limits, anti-suplantación, `audit_log`.
   8. `migrations/20260512100000_transactions_ledger.sql` — ledger autoritativo (Fase 2.B.1).
   9. `migrations/20260512120000_ledger_cutover.sql` — cutover: `matchmaking_join` debita `bet`, `cancel_matchmaking` hace `refund`, `resolve_match_round` acredita `win` (Fase 2.B.2).
   10. `migrations/20260513090000_onchain_vault.sql` — vault on-chain: `onchain_addresses`, `vault_deposits_seen`, `vault_withdraw_intents`, RPCs `link_onchain_address` / `record_vault_deposit` / `issue_withdraw_intent` / `mark_withdraw_completed` (Fase 2.C.1).

   Si Postgres se queja del trigger (`EXECUTE FUNCTION`), sustituye por `EXECUTE PROCEDURE set_profiles_updated_at();` según tu versión.

Esto crea:

- `profiles` — avatar, país, email de perfil demo, wallet (opcional en columna).
- `match_queue` — espera FIFO por `stake_amount` con bloqueo `FOR UPDATE SKIP LOCKED`.
- `matches` — monto (`stake_amount`), comisión servidor (`commission_decimal`), `winner_user_id`, liquidación opcional (`payout_winner_numeric`, `protocol_fee_total` tras la migración de auditoría), `meta` con snapshot del rival y **Realtime** habilitado.
- `messages` + `user_stats` — chat live y agregados PnL para badges.
- `audit_log` — auditoría append-only de operaciones críticas.
- `transactions` — **ledger autoritativo** (Fase 2.B.1): append-only con
  `balance_after` snapshot e `idempotency_key UUID` único por usuario. RLS:
  SELECT solo del propio user, INSERT bloqueado al cliente (solo SECURITY
  DEFINER RPCs escriben).
- Funciones: `commission_for_stake`, `matchmaking_join`, `cancel_matchmaking`,
  `resolve_match_round` (idempotente), `write_audit`, y las RPCs del ledger:
  `record_deposit_demo`, `record_withdraw_demo`, `record_bonus`, `get_user_balance`.

## 2. Edge Functions (opcional pero recomendado)

Desde la carpeta `/mi-web3-app`:

```bash
npx supabase login
npx supabase link --project-ref TU_REF
npx supabase functions deploy matchmaking resolve-match cancel-matchmaking
```

Las funciones llaman con el JWT del usuario a las mismas RPC (CORS + punto único HTTP). Si no las despliegas, la app usará **`supabase.rpc(...)`** en el navegador.

Variables de proyecto inyectadas automáticamente: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

## 3. Front (`.env.local`)

Copia `.env.example` en la raíz de `mi-web3-app`:

```bash
VITE_USE_SUPABASE_MATCHMAKING=true
VITE_SUPABASE_URL=https://....supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## Prueba de matching

Abre dos ventanas navegador (o uno normal + uno incógnito), inicia sesión en Chasflip y pulsa el **mismo monto**. El primero queda en cola; el segundo crea una fila en `matches` y ambos reciben el evento realtime.

La UI también se suscribe a **UPDATE** de esa fila: verás cambios cuando el servidor marca `completed` y persiste payout / fee protocolo.

## Siguiente: wallet y fondos reales

1. Conectar **wagmi/viem** (o Privy/Magic ya previstos) con la red de `VITE_CHAIN_KEY`.
2. Al conectar la cartera, escribir `wallet_address` en `public.profiles` (misma política `auth.uid()` que el perfil demo).
3. Sustituir el saldo de demostración por flujo escrow on-chain (`VITE_PROTOCOL_TREASURY`, contrato escrow) usando `matches.id` como correlación off-chain/on-chain donde encaje tu diseño Solidity.

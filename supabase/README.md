# ChasFlip + Supabase

## 1. Base de datos

1. Crear proyecto en [Supabase Dashboard](https://supabase.com/dashboard).
2. **Authentication → Providers → Anonymous sign-ins**: activar.
3. **SQL Editor**: pegar y ejecutar el contenido de `migrations/20260429120000_chasflip_matchmaking.sql`.

4. Ejecutar también `migrations/20260430104500_matches_payout_audit.sql` (columnas `payout_winner_numeric`, `protocol_fee_total` en `matches` + `resolve_match_round` actualizado).

   Si Postgres se queja del trigger (`EXECUTE FUNCTION`), sustituye por `EXECUTE PROCEDURE set_profiles_updated_at();` según tu versión.

Esto crea:

- `profiles` — avatar, país, email de perfil demo, wallet (opcional en columna).
- `match_queue` — espera FIFO por `stake_amount` con bloqueo `FOR UPDATE SKIP LOCKED`.
- `matches` — monto (`stake_amount`), comisión servidor (`commission_decimal`), `winner_user_id`, liquidación opcional (`payout_winner_numeric`, `protocol_fee_total` tras la migración de auditoría), `meta` con snapshot del rival y **Realtime** habilitado.
- Funciones: `commission_for_stake`, `matchmaking_join`, `cancel_matchmaking`, `resolve_match_round` (idempotente).

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

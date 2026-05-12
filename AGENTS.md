# ChasFlip — AGENTS.md

> **Para agentes IA (Cursor, Codex, Claude, etc.):** este archivo es el manual
> del proyecto. Léelo siempre antes de hacer cambios. Está pensado para que
> cualquier chat nuevo pueda retomar trabajo sin perder contexto.

---

## 0) TL;DR del proyecto

**ChasFlip** es una app web de cara-o-cruz PvP en tiempo real con estética
"Bitcoin native · live". Dos jugadores apuestan la misma cifra `S`, el ganador
se lleva `2·S·(1-fee)` y la casa cobra `2·S·fee` en comisión.

- Producción: <https://chas-flip.vercel.app>
- Repo: <https://github.com/Estigma221-svg/chas_flip>
- Mercado objetivo: USA + Europa (auto-detección de idioma por navegador)

> ⚠️ **Hoy todo el dinero es DEMO** (saldo en `localStorage` del navegador).
> No hay pagos reales, no hay contratos on-chain desplegados, no hay Stripe.

---

## 1) Stack y arquitectura

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | React 19 + Vite 8 + JS (no TS, JSDoc) | Build a `dist/`, sin SSR |
| 3D | three.js + @react-three/fiber + drei | `Bitcoin3D.jsx` |
| Estilos | CSS plano en `src/App.css` | Glassmorphism, neon, mobile-first |
| i18n | i18next + react-i18next + browser-languagedetector | 6 idiomas |
| Backend | Supabase (Postgres + Auth + Realtime) | NO hay Edge Functions hoy |
| Deploy | Vercel (auto deploy desde `main`) | Previews en cada rama |

**No usar** (intencionalmente):
- TypeScript estricto — el repo usa JS + JSDoc.
- ~~Wagmi/Privy/RainbowKit — comentados en código pero NO instalados.~~ → Wagmi
  + RainbowKit YA instalados (Fase 2.A). Privy sigue NO instalado.
- Edge Functions de Supabase — el cliente llama RPC directo.

---

## 2) Estado de producción (qué está vivo HOY)

### ✅ Features completas y deployadas
1. **i18n 6 idiomas** (`feat/i18n` mergeado): EN, ES, PT, FR, DE, IT con
   auto-detección por navegador y picker manual en el header.
2. **Security hardening FASE 1** (`feat/security-hardening` mergeado y SQL
   aplicado en Supabase):
   - Rate limit chat (5 msj / 60s) y matchmaking (3 joins / 30s)
   - Triggers anti-suplantación (server reescribe `user_name`/`avatar`/`pais_code`/`badge_earnings`)
   - Tabla `audit_log` + `write_audit()` en RPCs críticos
   - `safeSupabaseErrorCode()` sanitiza errores hacia el usuario
   - Double-click guards (`jugarBusyRef`, `retiroBusyRef`, `sendingRef`)
   - Modal de retiro con paso de confirmación
3. **Free play "first taste"** (`feat/free-play` mergeado): botón rojo neón
   "Probar gratis" cuando saldo=0; el user gana siempre; banner especial con
   CTA "Conectar wallet" + "Probar con depósito demo". Persistido en
   localStorage `chasflip:freePlayClaimed`.
4. **Live chat con badges PnL en tiempo real** (Supabase Realtime).
5. **Matchmaking PvP real** vía RPC `matchmaking_join` + `resolve_match_round`.
6. **Wallet connect REAL — Fase 2.A** (`feat/wallet-connect` mergeado):
   `wagmi@2` + `viem@2` + `@rainbow-me/rainbowkit@2` + `@tanstack/react-query@5`
   sobre **Polygon mainnet**. Soporta MetaMask, Coinbase Wallet, Rabby y
   WalletConnect. Muestra address truncada + balance USDT (token
   `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`, 6 decimales) en el botón del
   header. Detecta red incorrecta y la marca en rojo. Hook
   `src/lib/useWalletPanel.js`, config en `src/lib/wagmiConfig.js`. **El saldo
   del juego sigue siendo DEMO local — la wallet conectada todavía NO mueve
   dinero (eso llega en Fase 2.C).**
7. **Ledger autoritativo + cutover — Fase 2.B (1 y 2 completas)** (rama
   `feat/ledger-cutover`): tabla `public.transactions` (append-only) en Supabase
   con RLS estricto (`SELECT` solo del propio user, `INSERT/UPDATE/DELETE`
   bloqueado al cliente). Helper interno `apply_ledger_entry()` con `FOR UPDATE`
   para atomicidad. RPCs públicas: `record_deposit_demo`, `record_withdraw_demo`,
   `record_bonus`, `get_user_balance`. Idempotencia con UUID client-generated.
   Realtime publication agregada. **Cutover activo (Fase 2.B.2)**:
   - `matchmaking_join(p_stake, p_idempotency_key uuid)` debita asiento `bet`
     antes de tocar match_queue/matches; rechaza con `insufficient_funds` si
     no hay saldo.
   - `cancel_matchmaking()` emite `refund` por cada waiting eliminado.
   - `resolve_match_round()` acredita `win` al ganador con idem deterministica.
   - `App.jsx` consume el saldo via `useUserBalance(supaUserId)` con Realtime;
     depósitos/retiros van por `recordDepositDemo` / `recordWithdrawDemo`.
   - Si Supabase no está configurado el código cae al flujo legacy de
     `localStorage` automáticamente.

### 🟡 Decorativo / placeholder hoy
- **`VITE_FLIP_ENGINE=mock`** + `random()` server-side: el resultado del flip
  lo decide `random()` de Postgres en `resolve_match_round`. NO hay VRF
  criptográfico todavía (eso llega en Fase 2.C con Chainlink VRF v2.5).
- **Balance USDT on-chain** que se muestra en el botón de wallet: solo lectura.
  Ni se suma al saldo del juego ni habilita depósitos reales.
- **Fee del protocolo**: hoy queda capturado en `matches.protocol_fee_total`
  pero NO escribe un asiento en `transactions`. Cuando llegue la tabla
  treasury en Fase 2.C, agregaremos el asiento `fee` con `user_id` de la
  cuenta de tesorería.

### 🔴 Lo que NO existe todavía (FASE 2+)
- Chainlink VRF (random() de Postgres todavía decide los flips).
- Contrato `ChasFlipVault.sol` **deployado** (codigo + tests listos en
  `contracts/`, pero esperando el `npm run deploy:amoy:vault`).
- UI completa de "Depositar real" / "Retirar real" en el Modal (PR
  posterior tras deploy del Vault).
- Pagos fiat (Stripe / MercadoPago / OXXO).
- KYC / AML.
- Roles (admin) y rutas protegidas.
- MFA en retiros.
- Captcha en sign-in anónimo.

---

## 3) Convenciones del proyecto

### Idioma del usuario
- **El dueño habla español** (mexicano). Responder siempre en español, salvo
  pedido contrario.
- Los textos de UI viven SIEMPRE en `src/i18n/locales/<lng>.json`. **No
  hardcodear strings** en componentes — usar `t('namespace.key')`.
- Si añades un string nuevo, **agrégalo a los 6 idiomas en la misma PR**.
- Para números: usar `numLocale` derivado de `i18n.resolvedLanguage`.

### Branch naming y workflow git
- `feat/<nombre-corto-en-kebab>` para features (ej. `feat/free-play`).
- `fix/<nombre>` para bugs (ej. `fix/mobile-layout`).
- Siempre **merge `--no-ff`** a `main` con mensaje descriptivo.
- Nunca `git push --force` a `main`.
- Push usa el PAT de GitHub que el usuario provee a mano (no committear
  credenciales). Pattern `git -c http.extraheader="Authorization: Basic <b64>"`.

### Deploy
- Push a `main` → Vercel auto-deploya a producción (~30-60s).
- Push a cualquier otra rama → Vercel auto-genera preview.
- Las URLs de preview tienen Deployment Protection activo (requieren login
  Vercel).

### Migraciones Supabase
- Una migración SQL nueva = un archivo en `supabase/migrations/<timestamp>_<nombre>.sql`
- **Idempotente siempre**: usar `CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP IF EXISTS`.
- Anexar el contenido al final de `supabase/BOOTSTRAP.sql` para que el
  bootstrap único quede actualizado.
- El usuario aplica las migraciones manualmente pegando en Supabase Dashboard
  → SQL Editor → Run (no usa CLI).

### Supabase environment
- **Project ref**: `idfzvcnevihooaydvzmv`
- **URL**: `https://idfzvcnevihooaydvzmv.supabase.co`
- **Anon key (publishable)**: `sb_publishable_8iBgBSNNzHe8WMcHHYgv_g_XOHYXUcv` (en `.env.local`)
- **Service role key**: NO la tenemos. Si necesitas correr SQL desde un agente
  IA, pedir al usuario que genere un Personal Access Token en
  <https://supabase.com/dashboard/account/tokens> y úsalo con la Management
  API.

### Vercel environment
- **Project ID**: `prj_izIaRdCLEyAtSFydEVOR8Lo4Ws79`
- Variables de entorno requeridas (todas con prefijo `VITE_`):
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_USE_SUPABASE_MATCHMAKING=true`
  - `VITE_WALLETCONNECT_PROJECT_ID` (gratis en <https://cloud.reown.com>) — sin
    él, solo conectan wallets inyectadas (MetaMask/Coinbase/Rabby). Móviles vía
    WalletConnect fallan.
- Variables opcionales:
  - `VITE_RPC_URL_POLYGON` — RPC dedicado (Alchemy/Infura/QuickNode). Si no se
    define, wagmi usa el RPC público de Polygon (rate-limited, ok para dev).

---

## 4) Archivos clave (mapa mental)

### Frontend principal
- `src/App.jsx` — orquestador: estado global, matchmaking listeners, modal,
  HUD, wallet conectada, busy guards.
- `src/components/Arena.jsx` — UI del juego, free play flow, banner especial.
- `src/components/Header.jsx` — branding, balance, sound, language picker, wallet.
- `src/components/LiveChatArena.jsx` — chat realtime con Supabase + badges PnL.
- `src/components/Modal.jsx` — depósito y retiro (con paso de confirmación).
- `src/components/MatchmakingSheet.jsx` — overlay de búsqueda de oponente.
- `src/components/Sidebar.jsx` — pool en vivo, usuarios entrando.
- `src/components/AppleHudAlert.jsx` — alertas estilo iOS.
- `src/components/LanguagePicker.jsx` — dropdown de idiomas.
- `src/components/Bitcoin3D.jsx` — moneda 3D.

### Configuración
- `src/lib/supabaseClient.js` — singleton del cliente Supabase.
- `src/lib/supabaseError.js` — `safeSupabaseErrorCode()` para sanitizar errores.
- `src/lib/wagmiConfig.js` — config wagmi/RainbowKit, USDT Polygon address y
  ABI mínimo `balanceOf`, helper `truncateAddress()`.
- `src/lib/useWalletPanel.js` — hook que expone `address`, `chainId`,
  `isConnected`, `isOnSupportedChain`, `usdtBalanceFormatted` +
  `openConnectModal`/`openAccountModal`/`disconnect`.
- `src/lib/useUserBalance.js` — hook que lee `get_user_balance()` + Realtime
  sobre `public.transactions`. Activado en Fase 2.B.2 (fuente de verdad del
  saldo cuando Supabase está listo).
- `src/lib/useOnchainAddressLink.js` — hook que vincula la wallet conectada
  con `auth.uid()` server-side (Fase 2.C.1).
- `src/config/onchainEnv.js` — `getVaultConfig()` lee `VITE_VAULT_*`. Si
  vacío, on-chain queda deshabilitado (UI cae al flujo demo).
- `src/services/supabaseMatchmaking.js` — RPC wrappers + ensureSession.
- `src/services/supabaseLedger.js` — wrappers de RPCs del ledger
  (`recordDepositDemo`, `recordWithdrawDemo`, `recordBonus`, `getUserBalance`,
  `subscribeUserTransactions`) + helper `freshIdempotencyKey()`.
- `src/services/supabaseVault.js` — `linkOnchainAddress()`,
  `requestWithdrawTicket()`. Fase 2.C.1.
- `contracts/` — toolchain Hardhat (sub-proyecto npm). Contiene
  `ChasFlipVault.sol`, `MockUSDT.sol`, tests, scripts de deploy y
  `generate_wallets.js`. Solo se toca cuando hay cambios on-chain.
- `src/config/supabaseEnv.js`, `src/config/appEnv.js`, `src/config/chains.js`.
- `src/i18n/index.js` — init de i18next.
- `src/i18n/locales/{en,es,pt,fr,de,it}.json` — traducciones.
- `src/game/escrowPvP.js` — fórmulas (referencia de diseño on-chain futuro).
- `src/game/stakeTiers.js` — comisiones locales por tier.

### Backend (SQL)
- `supabase/BOOTSTRAP.sql` — script único idempotente con TODO.
- `supabase/migrations/*.sql` — migraciones individuales en orden cronológico.

---

## 5) Reglas críticas de seguridad (no romper)

1. **Nunca exponer secretos en código ni commits**. El `VITE_SUPABASE_ANON_KEY`
   está en el bundle a propósito (es el publishable key, está OK). Pero el
   service role key, GitHub PATs, Vercel tokens, Supabase Personal Access
   Tokens — NUNCA al repo.
2. **Nunca confiar en el cliente** para datos críticos:
   - `user_name`, `avatar`, `pais_code`, `badge_earnings` en mensajes los
     reescribe el server vía trigger.
   - Las comisiones las calcula `commission_for_stake()` en Postgres, no JS.
   - El ganador lo decide `resolve_match_round` server-side.
3. **Errores nunca deben filtrar internals**. Usar `safeSupabaseErrorCode()`
   para mapear a códigos estables (`chat_rate_limited`, `forbidden`, etc.) y
   traducir vía i18n (`hud.err.<code>`).
4. **Toda operación que mueva dinero (jugar/depositar/retirar)** debe tener:
   - `useRef` busy guard (anti-doble-click intra-tick)
   - Botón `disabled` durante la operación
   - Idempotencia cuando exista ledger real (FASE 2)
5. **Operaciones financieras reales (cuando lleguen)**: idempotencia con
   client-generated UUID + tabla `transactions` con unique constraint.

---

## 6) Cómo retomar trabajo (para un agente nuevo)

Antes de empezar:
1. `git log --oneline -10` — ver últimos commits.
2. Lee este `AGENTS.md` completo.
3. Si vas a tocar SQL: lee también `supabase/BOOTSTRAP.sql` para entender
   tablas, RLS y RPCs.
4. Si vas a tocar i18n: lee `src/i18n/locales/en.json` (es el master).

Para cada tarea:
1. Crea rama nueva `feat/<nombre>` desde `main` actualizado.
2. Implementa cambios.
3. `npm run build` para verificar (no es obligatorio correr tests porque no
   hay suite todavía).
4. Pide al usuario el PAT de GitHub para hacer push (siempre redactar el
   token en el output).
5. Merge `--no-ff` a `main` y push.
6. Si la rama incluye SQL nuevo: dile al usuario que lo aplique en Supabase
   Dashboard, dale el link directo:
   `https://supabase.com/dashboard/project/idfzvcnevihooaydvzmv/sql/new`

---

## 7) Roadmap sugerido (para alinear conversaciones futuras)

### Decisión arquitectónica vigente (mayo 2026)
- **Provider de wallet**: RainbowKit (MetaMask + Coinbase + Rabby + WC). ✅
- **Red blockchain**: Polygon mainnet. ✅
- **Stablecoin**: USDT (6 decimales) en `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`.
- **Fase 2.A — Wallet connect real**: ✅ COMPLETADA.
- **Fase 2.B.1 — Ledger autoritativo aditivo**: ✅ COMPLETADA. Tabla
  `transactions`, helper `apply_ledger_entry()`, 4 RPCs y Realtime listos.
- **Fase 2.B.2 — Cutover**: ✅ COMPLETADA. Migración
  `20260512120000_ledger_cutover.sql`:
  - `match_queue` agrega columna `bet_idem_key uuid` para refunds.
  - `matchmaking_join(p_stake, p_idempotency_key uuid DEFAULT NULL)`: si el
    cliente manda `p_idempotency_key`, debita asiento `bet -stake` ANTES de
    tocar `match_queue`/`matches`. Si falla con `insufficient_funds` no entra
    a cola. Si la llamada llega sin idem (legacy), no toca ledger.
  - `cancel_matchmaking()`: refund por cada row eliminado con `bet_idem_key`,
    con idempotency_key deterministica derivada del `queue_id`.
  - `resolve_match_round(p_match_id)`: cuando declara winner, escribe asiento
    `win` con idempotency_key deterministica
    `deterministic_uuid('win:'||match_id)`. NO escribe `fee` (queda capturado
    en `matches.protocol_fee_total` hasta que llegue la tabla treasury).
  - Frontend: `App.jsx` ahora lee saldo de `useUserBalance(supaUserId)` cuando
    `status === 'ready'`. `handleDepositar`/`handleRetirar` llaman a
    `recordDepositDemo` / `recordWithdrawDemo`. `joinMatchmaking` recibe el
    idem del `bet`. Cuando el ledger no está listo (Supabase no configurado
    o auth pendiente) el cliente cae a `localSaldo` y el flujo legacy sigue
    intacto.
  - i18n: añadidos códigos de error `insufficient_funds`, `invalid_amount`,
    `amount_too_small`, `amount_too_large`, `invalid_kind`, `invalid_reason`,
    `idempotency_required` en los 6 idiomas.
- **Fase 2.C — Dinero real on-chain**: pendiente. Contrato escrow `.sol`
  (referencia: `src/game/escrowPvP.js`) desplegado en Polygon + Chainlink VRF.
  El cliente firma `approve()` + `deposit()` con la wallet conectada; el server
  lee eventos del contrato y acredita al ledger como `kind='deposit'` y
  `source='on_chain:<txHash>'`. La misma vía sirve para retiros.

- **Fase 2.C.1 — Vault on-chain básico**: ✅ EN REVIEW (rama
  `feat/onchain-vault-amoy`). Componentes:
  - **Contrato `ChasFlipVault.sol`** (Hardhat / Solidity 0.8.27, evm `cancun`,
    `viaIR: true`). Hereda `Ownable2Step`, `Pausable`, `ReentrancyGuard`,
    `EIP712`. Estado clave: `serverSigner`, `maxVaultSize`, `maxDepositAmount`,
    `usedWithdrawNonces`. 18/18 tests pasan.
  - **Contrato `MockUSDT.sol`** (ERC-20 con 6 decimales y `mint(addr, amount)`
    publico) — usado en Hardhat local y en Polygon Amoy donde USDT canonico
    no existe.
  - **Migration SQL `20260513090000_onchain_vault.sql`** (aplicada en
    Supabase): tablas `onchain_addresses`, `vault_deposits_seen`,
    `vault_withdraw_intents`. RPCs:
    `link_onchain_address` (cliente, idempotente, falla con `address_taken`),
    `record_vault_deposit` (service_role, idempotente vía UNIQUE),
    `issue_withdraw_intent` (cliente, debita atomicamente + asigna nonce),
    `mark_withdraw_completed` (service_role, idempotente).
  - **Edge Function `vault-deposit-listener`**: cron-poll de eventos
    `Deposited` y `Withdrawn` del contrato. Cursor en `audit_log`,
    confirmaciones configurables, max blocks por run, recuento de
    `depositsProcessed/Skipped` y `errors[]` en la respuesta.
  - **Edge Function `vault-withdraw-ticket`**: invoca `issue_withdraw_intent`
    y firma EIP-712 con `SERVER_SIGNER_PRIVATE_KEY`. Implementado sin
    dependencias pesadas: keccak via `@noble/hashes`, ECDSA secp256k1 via
    `@noble/curves`.
  - **Frontend**: `src/config/onchainEnv.js` (lee `VITE_VAULT_*`),
    `src/services/supabaseVault.js` (link + ticket), hook
    `src/lib/useOnchainAddressLink.js` que auto-vincula la wallet conectada
    con el `auth.uid()` apenas el user firma sesión.
  - **Pendiente para Fase 2.C.1.b**: UI completa "Depositar real" /
    "Retirar real" en el Modal (requiere contrato deployado para testar
    e2e).
- **Fase 2.C.2 — VRF on-chain**: pendiente. Chainlink VRF v2.5 en Polygon
  reemplazara `random()` server-side. Tipico costo ~$0.005 en LINK por
  match.
- **Fase 2.C.3 — Escrow por match**: opcional. Bets bloquean fondos
  on-chain por match. Maxima auditabilidad publica.

### Próximos pasos (FASE 2.C.1.b — deploy en Amoy)
1. **Generar wallets**: `cd contracts && npm install && npm run generate-wallets`.
   Copiar las dos privkeys al lugar indicado en stdout.
2. **Fondear deployer**: pegar la `DEPLOYER` address en el faucet de Polygon
   (https://faucet.polygon.technology/, seleccionar Amoy) para obtener MATIC.
3. **Deploy MockUSDT** (solo Amoy, no en mainnet):
   `npm run deploy:amoy:mock-usdt` → output: address del token.
4. **Deploy ChasFlipVault**: `npm run deploy:amoy:vault` → output: address del
   vault. El JSON queda en `contracts/deployments/amoy.local.json` (gitignored).
5. **Setear env Vercel**: `VITE_VAULT_CHAIN_ID=80002`,
   `VITE_VAULT_ADDRESS=0x...`, `VITE_VAULT_TOKEN_ADDRESS=0x...`.
6. **Setear secrets Supabase Edge**:
   ```sh
   npx supabase secrets set --project-ref idfzvcnevihooaydvzmv \
     SERVER_SIGNER_PRIVATE_KEY=0x... \
     VAULT_RPC_URL=https://rpc-amoy.polygon.technology \
     VAULT_CONTRACT_ADDRESS=0x... \
     VAULT_CHAIN_ID=80002 \
     VAULT_DEPLOY_BLOCK=<block_number_del_deploy>
   ```
7. **Deploy Edge Functions**:
   ```sh
   npx supabase functions deploy vault-deposit-listener vault-withdraw-ticket \
     --project-ref idfzvcnevihooaydvzmv --no-verify-jwt
   ```
   (El listener corre via service_role, no necesita JWT. El ticket sí lo
   necesita pero el flag se aplica solo a la verificación interna; el JWT
   del cliente sigue siendo requerido por el RPC.)
8. **Cron del listener**: armar workflow GitHub Actions cada minuto que
   haga POST a `https://idfzvcnevihooaydvzmv.supabase.co/functions/v1/vault-deposit-listener`
   con header `X-Listener-Secret: $VAULT_LISTENER_SHARED_SECRET` (set como
   secret en Actions y como env de la Edge Function).

### Próximos pasos (FASE 2.C.2 — VRF)
1. Crear suscripcion Chainlink VRF v2.5 en Amoy (UI:
   https://vrf.chain.link/polygon-amoy). Fondear con LINK del faucet.
2. Escribir contrato `MatchOracle.sol` con
   `requestMatchRandomness(matchId)` + `fulfillRandomWords(...)`.
3. Modificar `resolve_match_round`: marcar match como `awaiting_vrf`, NO
   decidir winner ahi. Crear Edge Function `vrf-trigger` que hace la
   peticion on-chain y un listener `vrf-fulfilled-listener` que cierra el
   match cuando llega el randomness.

### Otras tareas pendientes
- Backups programados de Supabase + alertas (cuando haya tráfico).
- Captcha en `signInAnonymously` cuando se vea abuso.
- Roles + admin route + MFA (cuando haya panel admin).
- Migración bridge opcional: `bonus:welcome_migration` del saldo
  `localStorage` legacy al primer login con auth real.

---

## 8) Cosas que el usuario NO quiere

- **No quiere problemas legales**. Por eso descartó la idea de "ruleta de
  premios" en chats previos: dijo que prefería evitar fricción regulatoria.
- **No quiere romper la estética actual**. Glassmorphism + neon + mobile-first
  está funcionando bien.
- **No quiere agregar muchas dependencias** sin necesidad clara.

---

*Última actualización: rama `feat/onchain-vault-amoy` (Fase 2.C.1 — vault
on-chain básico). Contrato `ChasFlipVault.sol` (Hardhat, 18 tests pasan),
migración `20260513090000_onchain_vault.sql`, dos Edge Functions
(`vault-deposit-listener`, `vault-withdraw-ticket`) y vinculación
wallet ↔ auth.uid en el frontend. UI de "Depositar/Retirar real" se hace
en un PR posterior despues del deploy en Amoy. Siguiente paso: Fase 2.C.2
(Chainlink VRF para randomness).*
*Si tocas algo importante, actualiza la sección "Estado de producción" arriba.*

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
- Wagmi/Privy/RainbowKit — comentados en código pero NO instalados.
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

### 🟡 Decorativo / placeholder hoy
- **Botón "Connect wallet"** en header: hace toggle visual + HUD educativo
  ("Wallet on-chain · próximamente"). NO se conecta a ninguna wallet real.
- **`VITE_FLIP_ENGINE=mock`**: el resultado del flip lo decide `random()` de
  Postgres en `resolve_match_round`. NO hay VRF criptográfico todavía.
- **Saldo USDT del header**: solo número en localStorage, sin ledger en server.

### 🔴 Lo que NO existe todavía (FASE 2+)
- Tabla `transactions` / ledger autoritativo en Supabase
- Idempotencia de depósitos/retiros
- Chainlink VRF
- Contrato escrow desplegado (sin `.sol`, sin ABI)
- Pagos fiat (Stripe / MercadoPago / OXXO)
- KYC / AML
- Roles (admin) y rutas protegidas
- MFA en retiros
- Captcha en sign-in anónimo

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
- `src/services/supabaseMatchmaking.js` — RPC wrappers + ensureSession.
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

### Próximo paso natural (FASE 2)
Cuando el usuario decida cómo recibir dinero real, atacar:

**Si elige cripto on-chain** (Privy/RainbowKit + contrato escrow):
1. Instalar `wagmi`, `viem`, `@privy-io/react-auth` (o RainbowKit).
2. Reemplazar `handleConnectWallet` en `App.jsx` con el provider real.
3. Escribir contrato escrow `.sol` (referencia: `src/game/escrowPvP.js`).
4. Integrar Chainlink VRF para randomness.
5. Reemplazar `resolve_match_round` por lectura del contrato on-chain.

**Si elige fiat (Stripe/MercadoPago)**:
1. Crear tabla `transactions` (ledger autoritativo) en Supabase.
2. Cambiar saldo de localStorage a server-side.
3. Idempotencia con UUID por intent.
4. Stripe Checkout o MP → webhook a Edge Function de Supabase.
5. KYC/AML preparado (mínimo: edad, país, monto).

**Camino prudente intermedio (recomendado en chats previos):**
- Empezar por **Ruta D**: tabla `transactions` + ledger en Supabase, sin
  conectar provider real todavía. Eso "blinda el cimiento" para que cualquier
  provider futuro enchufe sin reescribir.

### Otras tareas pendientes
- Backups programados de Supabase + alertas (cuando haya tráfico).
- Captcha en `signInAnonymously` cuando se vea abuso.
- Roles + admin route + MFA (cuando haya panel admin).

---

## 8) Cosas que el usuario NO quiere

- **No quiere problemas legales**. Por eso descartó la idea de "ruleta de
  premios" en chats previos: dijo que prefería evitar fricción regulatoria.
- **No quiere romper la estética actual**. Glassmorphism + neon + mobile-first
  está funcionando bien.
- **No quiere agregar muchas dependencias** sin necesidad clara.

---

*Última actualización: tras merge de `feat/free-play` (commit `1aa8f2f`).*
*Si tocas algo importante, actualiza la sección "Estado de producción" arriba.*

/**
 * Sanitiza errores devueltos por Supabase / RPC para que NUNCA filtremos al
 * usuario detalles internos (nombres de tabla, hints de Postgres, stack, etc.).
 *
 * Convierte el error en un código estable (string) que el frontend mapea a
 * una traducción i18n. Por defecto: 'unknown'.
 *
 * Códigos conocidos (sincronizados con `hud.error_*` en src/i18n/locales/*.json):
 *   - chat_rate_limited        → escribiste muy seguido
 *   - matchmaking_rate_limited → diste click a jugar demasiadas veces seguidas
 *   - unauthenticated          → tu sesión expiró, vuelve a entrar
 *   - invalid_stake_tier       → mesa no válida
 *   - match_not_found          → ronda inexistente
 *   - match_not_in_progress    → la ronda ya cerró
 *   - forbidden                → no puedes resolver una ronda que no es tuya
 *   - profile_upsert_failed    → no se pudo escribir tu perfil
 *   - anon_disabled            → falta activar anon sign-ins en Supabase
 *   - network                  → error de red genérico
 *   - unknown                  → fallback
 */

const KNOWN_CODES = new Set([
  'chat_rate_limited',
  'matchmaking_rate_limited',
  'unauthenticated',
  'invalid_stake_tier',
  'match_not_found',
  'match_not_in_progress',
  'forbidden',
  'profile_upsert_failed',
  'anon_disabled',
  'network',
  // Fase 2.B — errores del ledger.
  'insufficient_funds',
  'invalid_amount',
  'amount_too_small',
  'amount_too_large',
  'invalid_kind',
  'invalid_reason',
  'idempotency_required',
]);

/** @param {unknown} err */
export function safeSupabaseErrorCode(err) {
  if (!err) return 'unknown';

  // Supabase-js v2: { message, code, details, hint } o un Error nativo.
  const message = String(
    /** @type {{ message?: string }} */ (err).message ?? err,
  ).toLowerCase();

  // Errores explícitos lanzados por nuestras RPCs (RAISE EXCEPTION 'codigo').
  for (const code of KNOWN_CODES) {
    if (message.includes(code)) return code;
  }

  // Mapeos heurísticos comunes.
  if (message.includes('jwt') || message.includes('session')) return 'unauthenticated';
  if (message.includes('failed to fetch') || message.includes('networkerror')) return 'network';
  if (message.includes('row-level security') || message.includes('permission denied')) {
    return 'forbidden';
  }

  return 'unknown';
}

/**
 * Devuelve un mensaje genérico (NO el original) listo para mostrar al user.
 * El mensaje real se traduce en el componente con `t('hud.err_' + code)`.
 *
 * @param {unknown} err
 */
export function safeSupabaseErrorMessage(err) {
  return safeSupabaseErrorCode(err);
}

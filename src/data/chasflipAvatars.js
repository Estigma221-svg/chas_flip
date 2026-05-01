/** Rutas públicas procesadas (`public/avatars/chasflip/`). */
export const CHASFLIP_AVATAR_URLS = Object.freeze([
  '/avatars/chasflip/avatar-01.webp',
  '/avatars/chasflip/avatar-02.webp',
  '/avatars/chasflip/avatar-03.webp',
  '/avatars/chasflip/avatar-04.webp',
  '/avatars/chasflip/avatar-05.webp',
]);

export const DEFAULT_CHASFLIP_AVATAR_URL = CHASFLIP_AVATAR_URLS[0];

/** Rutas públicas típicas de avatar (webp/png/svg…). */
export function looksLikeAvatarImageSrc(raw) {
  const t = typeof raw === 'string' ? raw.trim() : '';
  return (
    (t.startsWith('/') || t.startsWith('http://') || t.startsWith('https://')) &&
    /\.(webp|png|jpe?g|gif|svg)(\?.*)?$/i.test(t)
  );
}

/** Elige un avatar estable a partir de un string (email, id, etc.). */
export function pickChasflipAvatarUrlFromSeed(seed) {
  const s = typeof seed === 'string' ? seed : String(seed ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % CHASFLIP_AVATAR_URLS.length;
  return CHASFLIP_AVATAR_URLS[idx];
}

/**
 * Convierte valores legacy (solo emoji/texto) a URL WebP; mantiene URLs ya guardadas.
 * @param {unknown} raw
 * @param {string} [seedForLegacy=''] preferir email para que sea estable por usuario
 */
export function normalizeStoredAvatar(raw, seedForLegacy = '') {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
    return pickChasflipAvatarUrlFromSeed(seedForLegacy || 'chasflip');
  }
  const t = typeof raw === 'string' ? raw.trim() : String(raw);
  if (looksLikeAvatarImageSrc(t)) return t;
  return pickChasflipAvatarUrlFromSeed(seedForLegacy || t || 'chasflip');
}

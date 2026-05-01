import { looksLikeAvatarImageSrc } from '../data/chasflipAvatars.js';

/** Muestra texto legacy (raro) o `<img>` si parece URL pública (`/avatars/...webp`). */
export default function AvatarFace({ value, variant = 'inline' }) {
  if (value == null || value === '') return null;

  const raw = typeof value === 'string' ? value.trim() : String(value);

  const isImg = looksLikeAvatarImageSrc(raw);

  const mod = variant && variant !== 'inline' ? ` avatar-face-img--${variant}` : '';

  if (isImg) {
    return (
      <img
        src={raw}
        alt=""
        draggable={false}
        className={`avatar-face-img${mod}`.trim()}
      />
    );
  }

  const emod = variant && variant !== 'inline' ? ` avatar-face-emoji--${variant}` : '';
  return (
    <span className={`avatar-face-emoji${emod}`} aria-hidden>
      {raw}
    </span>
  );
}

import { useState } from 'react';

/**
 * Bandera por código ISO alpha-2.
 * Sin dependencias pesadas: evita cargar ~250 SVG en un solo módulo
 * (`import *` en country-flag-icons) que en algunos equipos/Vite puede
 * frenar tanto el navegador que ves pantalla blanca antes de pintar UI.
 *
 * CDN: flagcdn — si falla red o código desconocido, se muestra fallback.
 */
export default function CountryFlag({ code, fallback = '🏳️', style, className, ...rest }) {
  const [broken, setBroken] = useState(false);

  if (!code || broken) {
    return (
      <span style={style} className={className} {...rest}>
        {fallback}
      </span>
    );
  }

  const norm = String(code).trim().toLowerCase();

  const src80 = `https://flagcdn.com/w80/${norm}.png`;

  return (
    <img
      {...rest}
      className={className}
      src={src80}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setBroken(true)}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        ...style,
      }}
      alt=""
    />
  );
}

import { useState } from 'react';
import GlassSelect from './GlassSelect';
import AvatarFace from './AvatarFace';
import { CHASFLIP_AVATAR_URLS } from '../data/chasflipAvatars.js';
import { COUNTRIES } from '../data/countries';
import { playLaunchSound, prewarmAudio } from '../utils/sound';

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  code: c.code,
}));

export default function Login({ onEntrar }) {
  const [email, setEmail] = useState('');
  const [avatarIndex, setAvatarIndex] = useState(null);
  const [paisCode, setPaisCode] = useState('MX');
  const [error, setError] = useState('');

  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const avatarOk = avatarIndex !== null;
  const paisOk = !!paisCode;

  const handleEntrar = () => {
    const missing = [];
    if (!emailOk) missing.push('un correo válido (ej. tu@chas.com)');
    if (!paisOk) missing.push('tu país');
    if (!avatarOk) missing.push('un avatar');

    if (missing.length > 0) {
      setError(`Falta: ${missing.join(', ')}.`);
      return;
    }

    setError('');
    // Unlock the AudioContext inside this user gesture so the launch sound
    // (and every subsequent sound) plays without browser autoplay blocks.
    prewarmAudio();
    playLaunchSound({ volume: 0.9 });

    onEntrar({
      email: email.trim(),
      avatar: CHASFLIP_AVATAR_URLS[avatarIndex],
      paisCode,
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleEntrar();
  };

  return (
    <div className="login-screen">
      <div className="login-hero">
        <h1 className="login-logo">
          <span className="gold-text">CHAS</span>FLIP
        </h1>
        <p className="login-sub">Blockchain · Bitcoin Native · Live</p>
      </div>

      <div className="login-box">
        <div>
          <p className="field-label">Correo</p>
          <input
            className="input-glass"
            type="email"
            placeholder="tu@correo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="email"
          />
        </div>

        <div>
          <p className="field-label">País</p>
          <GlassSelect
            value={paisCode}
            onChange={setPaisCode}
            options={COUNTRY_OPTIONS}
            placeholder="Elige tu país…"
          />
        </div>

        <div>
          <p className="field-label field-label--tight-gap">Elige tu avatar</p>
          <div className="avatar-grid">
            {CHASFLIP_AVATAR_URLS.map((src, i) => (
              <div
                key={src}
                role="button"
                tabIndex={0}
                aria-pressed={avatarIndex === i}
                aria-label={`Avatar ${i + 1}`}
                className={`avatar-option ${avatarIndex === i ? 'selected' : ''}`}
                onClick={() => setAvatarIndex(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setAvatarIndex(i);
                  }
                }}
              >
                <AvatarFace value={src} variant="pick" />
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <button className="btn-cta" onClick={handleEntrar}>
          Entrar a la arena
        </button>
      </div>
    </div>
  );
}
